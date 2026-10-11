import { boot } from "../src/test/fixtures/compact.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileConsole } from "../src/app/reconcile-console.ts";
import { candidateConsole, consoleJournalScope, snapshotConsole, type ConsoleMutationContext, type ConsolePrivateState } from "../src/app/console-recovery.ts";
import { createOperationJournal, type OperationJournalLease } from "../src/lib/security/operation-journal.ts";
import { unlockVaultSession, lockVaultSession, decodeVaultJson, encodeVaultJson } from "../src/lib/security/vault.ts";
import { blankPrivate, call, readLedger, type Session } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, drawNoteCommit, hexToBytes, pad32, paymentNullifier, refundCommit, toHex } from "../src/lib/line/encoding.ts";
import type { LineRuntime, LedgerPublicStatus, RuntimeRecoveryEvidence } from "../src/lib/runtime/types.ts";

const issuer = new Uint8Array(32).fill(71), merchant = new Uint8Array(32).fill(72), agent = new Uint8Array(32).fill(73);
const copy = <T,>(v: T): T => decodeVaultJson(encodeVaultJson(v)) as T;
async function fixture() {
  const ps = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt: pad32("recovery-salt"), lineLimit: 100n });
  let session = await boot(issuer, merchant, crypto.getRandomValues(new Uint8Array(32)), ps);
  const funded = await call(session, ps, { name: "fundReserve", args: [200n] }); assert.equal(funded.ok, true); session = funded.session;
  const publicStatus = (s: Session): LedgerPublicStatus => { const l = readLedger(s); return {
    runtime: "test", networkId: "test-reconcile", contractAddress: "test-contract", contractDomain: toHex(l.contractDomain),
    identityCommitment: toHex(l.identityCommit), lineCommitment: toHex(l.lineCommit), lineGeneration: Number(l.lineGeneration), actionClock: Number(l.actionClock), feeFlat: Number(l.feeFlat), feeBps: Number(l.feeBps),
    status: l.status === 1 ? "open" : "none", totalReserve: Number(l.totalReserve), encumberedReserve: Number(l.encumberedReserve), redeemedReserve: Number(l.redeemedReserve), feeReserve: Number(l.feeReserve),
    withdrawableReserve: Number(l.totalReserve - l.encumberedReserve - l.redeemedReserve - l.feeReserve), quoteCount: Number(l.quotes.size()), noteCount: Number(l.notes.size()), nullifierCount: Number(l.nullifiers.size()) }; };
  const beforeLedger = publicStatus(session);
  const observe = (s: Session): RuntimeRecoveryEvidence => { const l = readLedger(s); return { runtime: "test", networkId: "test-reconcile", contractAddress: "test-contract", contractDomain: toHex(l.contractDomain),
    identityCommitment: toHex(l.identityCommit), lineCommitment: toHex(l.lineCommit), lineGeneration: l.lineGeneration.toString(), actionClock: l.actionClock.toString(), feeFlat: l.feeFlat.toString(), feeBps: l.feeBps.toString() }; };
  const beforeEvidence = observe(session);
  let evidence = beforeEvidence;
  const runtime = { mode: "test", networkId: "test-reconcile", getContractAddress: () => "test-contract", getRecoveryEvidence: async () => copy(evidence) } as unknown as LineRuntime;
  const scope = consoleJournalScope(runtime, beforeLedger);
  const empty: ConsolePrivateState = { agentLineRecord: null, agentRecord: null, issuerRecord: { issuerSecret: toHex(issuer) }, merchantRecord: { merchantSecret: toHex(merchant), merchantPk: "00".repeat(32) }, merchantQuotes: [], drawNotes: [], repayments: [] };
  const before = snapshotConsole(empty, beforeLedger, "test-contract");
  const params = { limit: 100, expiry: 100, callerSk: toHex(issuer), agentSecret: toHex(agent), salt: toHex(ps.salt) };
  const context = { runtime, ledger: beforeLedger, address: "test-contract", before } as ConsoleMutationContext;
  const candidate = candidateConsole(context, "openLine", [params]);
  const opened = await call(session, ps, { name: "openLine", args: [100n] }); assert.equal(opened.ok, true); session = opened.session;
  const afterEvidence = observe(session), afterLedger = publicStatus(session);
  assert.equal(candidate.privateState.agentLineRecord!.lineCommitment, afterEvidence.lineCommitment);
  unlockVaultSession("reconcile-test-password");
  const journal = createOperationJournal(scope, "reconcile-test-password");
  const prepare = (lease: OperationJournalLease, altered = candidate) => lease.prepare({ id: "open", kind: "openLine", fingerprint: "11".repeat(32), beforeCommitment: beforeEvidence.lineCommitment,
    candidateCommitment: afterEvidence.lineCommitment, beforeSnapshot: before, candidateSnapshot: altered });
  return { runtime, scope, journal, beforeLedger, afterLedger, beforeEvidence, afterEvidence, candidate, before, prepare, setEvidence: (next: RuntimeRecoveryEvidence) => { evidence = next; } };
}

describe("encrypted console reconciliation against exact public observations", () => {
  it("abandons only a prepared intent without pretending submission occurred", async () => {
    const f = await fixture(); await f.journal.withExclusive(async lease => {
      await f.prepare(lease); const r = await reconcileConsole(lease, f.scope, f.runtime, f.beforeLedger, () => {});
      assert.equal(r.blocked, false); assert.equal(r.privateState, null); assert.equal((await lease.read()).operations[0].status, "rejected");
    }); lockVaultSession();
  });
  it("keeps a submitted candidate unresolved on unchanged public commitment", async () => {
    const f = await fixture(); await f.journal.withExclusive(async lease => {
      await f.prepare(lease); await lease.markSubmitting("open", { transactionId: "tx-pending" });
      const r = await reconcileConsole(lease, f.scope, f.runtime, f.beforeLedger, () => {});
      assert.equal(r.blocked, true); assert.equal(r.privateState, null); assert.equal((await lease.read()).operations[0].status, "submitting");
    }); lockVaultSession();
  });
  it("confirms a real generated Compact opening from fresh evidence and leaves acknowledgment to the publisher", async () => {
    const f = await fixture(); f.setEvidence(f.afterEvidence); await f.journal.withExclusive(async lease => {
      await f.prepare(lease); await lease.markSubmitting("open", { transactionId: "tx-open" }); await lease.markUncertain("open");
      const r = await reconcileConsole(lease, f.scope, f.runtime, f.beforeLedger, () => {});
      assert.equal(r.blocked, false); assert.equal(r.confirmedId, "open"); assert.equal(r.privateState!.agentLineRecord!.limit, 100);
      assert.equal(r.privateState!.agentLineRecord!.lineCommitment, f.afterEvidence.lineCommitment);
      const op = (await lease.read()).operations[0]; assert.equal(op.status, "confirmed"); assert.equal(op.acknowledged, false);
    }); lockVaultSession();
  });
  it("requires domain, network, address, identity, generation and fee policy, not just matching C", async () => {
    for (const patch of [{ contractDomain: "ff".repeat(32) }, { networkId: "other-network" }, { contractAddress: "other-contract" }, { identityCommitment: "ff".repeat(32) }, { lineGeneration: "2" }, { feeFlat: "1" }, { feeBps: "1" }, { feeFlat: undefined }, { feeBps: undefined }, { runtime: "local" as const }]) {
      const f = await fixture(); f.setEvidence({ ...f.afterEvidence, ...patch }); await f.journal.withExclusive(async lease => {
        await f.prepare(lease); await lease.markSubmitting("open"); const r = await reconcileConsole(lease, f.scope, f.runtime, f.beforeLedger, () => {});
        assert.equal(r.blocked, true); assert.equal((await lease.read()).operations[0].status, "submitting");
      }); lockVaultSession();
    }
  });
  it("never restores a divergent confirmed snapshot or inconsistent duplicate private book", async () => {
    const f = await fixture(); f.setEvidence(f.afterEvidence); await f.journal.withExclusive(async lease => {
      const bad = copy(f.candidate); bad.privateState.agentRecord!.B = 5;
      await f.prepare(lease, bad); await lease.markSubmitting("open"); await lease.confirm("open", { ...f.scope, kind: "definiteReceipt", receipt: { executionMode: "test", txId: "confirmed-tx" } });
      const r = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}); assert.equal(r.blocked, true); assert.equal(r.privateState, null);
    }); lockVaultSession();
  });
  it("does not overwrite acknowledged snapshots during a fresh action, but restores them on unlock", async () => {
    const f = await fixture(); f.setEvidence(f.afterEvidence); await f.journal.withExclusive(async lease => {
      await f.prepare(lease); await lease.markSubmitting("open"); await lease.confirm("open", { ...f.scope, kind: "definiteReceipt", receipt: { executionMode: "test", txId: "confirmed-tx" } }); await lease.acknowledgeConfirmed("open");
      const action = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}); assert.equal(action.blocked, false); assert.equal(action.privateState, null);
      const unlock = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}, { restoreAcknowledged: true }); assert.equal(unlock.blocked, false); assert.ok(unlock.privateState);
      f.setEvidence({ ...f.afterEvidence, lineCommitment: "ee".repeat(32) });
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {})).blocked, true);
    }); lockVaultSession();
  });
  it("does not confirm financial aggregate changes without an exact unique effect", async () => {
    const f = await fixture(); f.setEvidence(f.afterEvidence); await f.journal.withExclusive(async lease => {
      await lease.prepare({ id: "fund", kind: "fundReserve", fingerprint: "22".repeat(32), beforeCommitment: f.afterEvidence.lineCommitment, candidateCommitment: null, beforeSnapshot: f.candidate, candidateSnapshot: f.candidate }); await lease.markSubmitting("fund");
      const r = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}); assert.equal(r.blocked, true); assert.equal((await lease.read()).operations[0].status, "submitting");
    }); lockVaultSession();
  });
  it("matches exact note/quote effects and refuses a different target or generation", async () => {
    for (const effect of ["quote-present", "note-redeemed", "note-cancelled"] as const) {
      const f = await fixture(); const target = "ab".repeat(32); const kind = effect === "quote-present" ? "postQuote" : effect === "note-redeemed" ? "redeemDraw" : "cancelOrExpireNote";
      const metadata = effect === "quote-present" ? { quote: { commitment: target, present: true, lineGeneration: "1", used: false } } : { note: { commitment: target, present: true, lineGeneration: "1", redeemed: effect === "note-redeemed", cancelled: effect === "note-cancelled" } };
      await f.journal.withExclusive(async lease => {
        await lease.prepare({ id: "effect", kind, fingerprint: "33".repeat(32), beforeCommitment: f.afterEvidence.lineCommitment, candidateCommitment: null, beforeSnapshot: f.candidate, candidateSnapshot: f.candidate,
          expectedEffect: { circuit: kind, targetCommitment: target, contractDomain: f.afterEvidence.contractDomain, lineGeneration: "1", effect } }); await lease.markSubmitting("effect");
        f.setEvidence({ ...f.afterEvidence, ...(effect === "quote-present" ? { quote: { ...metadata.quote!, commitment: "ee".repeat(32) } } : { note: { ...metadata.note!, lineGeneration: "2" } }) });
        assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {})).blocked, true);
        f.setEvidence({ ...f.afterEvidence, ...metadata }); const r = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}); assert.equal(r.blocked, false); assert.equal(r.confirmedId, "effect");
      }); lockVaultSession();
    }
  });
  it("does not mutate or expose recovery state after a session assertion fails", async () => {
    const f = await fixture(); f.setEvidence(f.afterEvidence); await f.journal.withExclusive(async lease => {
      await f.prepare(lease); await lease.markSubmitting("open"); let assertions = 0;
      await assert.rejects(() => reconcileConsole(lease, f.scope, f.runtime, f.beforeLedger, () => { if (++assertions === 3) throw new Error("SESSION_CHANGED"); }), /SESSION_CHANGED/);
      assert.equal((await lease.read()).operations[0].status, "submitting");
    }); lockVaultSession();
  });
  it("retires an acknowledged previous-generation book only for a verified original note and never bypasses pending submission", async () => {
    const f = await fixture();
    const old = copy(f.candidate);
    const note = { version: 1 as const, networkId: f.runtime.networkId, contractAddress: "test-contract",
      contractDomain: f.afterEvidence.contractDomain, lineGeneration: 1, identityCommitment: toHex(agentId(agent)),
      quoteCommitment: "aa".repeat(32), merchantPublicKey: "bb".repeat(32), amount: 40, fee: 2,
      noteNonce: toHex(pad32("historical-note")), noteSalt: toHex(pad32("historical-salt")), expiry: 100,
      status: "active" as const, updatedAt: Date.now(), noteCommitment: "" };
    note.noteCommitment = toHex(drawNoteCommit({ domain: hexToBytes(note.contractDomain), lineGeneration: 1n,
      identity: agentId(agent), quoteCommit: hexToBytes(note.quoteCommitment), merchantPk: hexToBytes(note.merchantPublicKey),
      amount: 40n, fee: 2n, noteNonce: hexToBytes(note.noteNonce), expiry: 100n }, hexToBytes(note.noteSalt)));
    old.privateState.drawNotes = [note];
    f.setEvidence({ ...f.afterEvidence, lineGeneration: "2", lineCommitment: "ee".repeat(32), identityCommitment: "dd".repeat(32) });
    await f.journal.withExclusive(async lease => {
      await f.prepare(lease, old); await lease.markSubmitting("open");
      await lease.confirm("open", { ...f.scope, kind: "definiteReceipt", receipt: { executionMode: "test", txId: "old-open-confirmed" } });
      await lease.acknowledgeConfirmed("open");
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {})).blocked, true);
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}, { historicalNoteCommitment: "ff".repeat(32) })).blocked, true);
      const retired = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}, { historicalNoteCommitment: note.noteCommitment });
      assert.equal(retired.blocked, false); assert.equal(retired.privateState!.agentLineRecord, null); assert.equal(retired.privateState!.agentRecord, null);
      assert.deepEqual(retired.privateState!.historicalAgentKeys, [{ identityCommitment: note.identityCommitment, agentSecret: toHex(agent) }]);
      await lease.prepare({ id: "pending", kind: "fundReserve", fingerprint: "44".repeat(32), beforeCommitment: f.afterEvidence.lineCommitment,
        candidateCommitment: null, beforeSnapshot: old, candidateSnapshot: old });
      await lease.markSubmitting("pending");
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {}, { historicalNoteCommitment: note.noteCommitment })).blocked, true);
      assert.equal((await lease.read()).operations.at(-1)!.status, "submitting");
    }); lockVaultSession();
  });
  it("preserves allocation evidence after an independent issuer report without inventing its payment reference", async () => {
    const f = await fixture();
    const target = "ab".repeat(32), salt = toHex(pad32("monotonic-refund"));
    const refund = toHex(refundCommit({ domain: hexToBytes(f.afterEvidence.contractDomain), lineGeneration: 1n,
      identity: agentId(agent), noteCommit: hexToBytes(target), amount: 20n }, hexToBytes(salt)));
    const candidate = copy(f.candidate);
    candidate.privateState.refunds = [{ version: 1, networkId: f.runtime.networkId, contractAddress: "test-contract",
      contractDomain: f.afterEvidence.contractDomain, lineGeneration: 1, identityCommitment: toHex(agentId(agent)),
      noteCommitment: target, refundCommitment: refund, amount: 20, allocatedCredit: 25, salt, status: "allocated", updatedAt: Date.now() }];
    f.setEvidence({ ...f.afterEvidence, note: { commitment: target, present: true, lineGeneration: "1", redeemed: false, cancelled: true,
      compensationAllocated: true, refundCommitment: refund, cashRefundOwed: true, refundAcknowledged: true } });
    await f.journal.withExclusive(async lease => {
      await lease.prepare({ id: "allocate", kind: "cancelOrExpireNote", fingerprint: "55".repeat(32), beforeCommitment: "cc".repeat(32),
        candidateCommitment: f.afterEvidence.lineCommitment, beforeSnapshot: f.before, candidateSnapshot: candidate,
        expectedEffect: { circuit: "cancelOrExpireNote", targetCommitment: target, contractDomain: f.afterEvidence.contractDomain,
          lineGeneration: "1", effect: "note-compensation-allocated", refundCommitment: refund, cashRefundOwed: true, lineCommitment: f.afterEvidence.lineCommitment } });
      await lease.markSubmitting("allocate");
      const recovered = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {});
      assert.equal(recovered.blocked, false); assert.equal(recovered.privateState!.refunds![0].issuerReportObserved, true);
      assert.equal(recovered.privateState!.refunds![0].status, "allocated"); assert.equal(recovered.privateState!.refunds![0].paymentReference, undefined);
      await lease.acknowledgeConfirmed("allocate");
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {})).blocked, false);
    }); lockVaultSession();
  });
  it("cannot attribute a repayment's global payment nullifier to a note acknowledged with a different refund reference", async () => {
    const f = await fixture();
    const target = "ac".repeat(32), salt = toHex(pad32("refund-reference-binding"));
    const domain = hexToBytes(f.afterEvidence.contractDomain);
    const X = toHex(paymentNullifier(issuer, canonicalPaymentReferenceBytes("reference-used-for-repayment"), domain));
    const Y = toHex(paymentNullifier(issuer, canonicalPaymentReferenceBytes("actual-refund-reference"), domain));
    const refund = toHex(refundCommit({ domain, lineGeneration: 1n, identity: agentId(agent), noteCommit: hexToBytes(target), amount: 20n }, hexToBytes(salt)));
    const candidate = copy(f.candidate);
    candidate.privateState.refunds = [{ version: 1, networkId: f.runtime.networkId, contractAddress: "test-contract",
      contractDomain: f.afterEvidence.contractDomain, lineGeneration: 1, identityCommitment: toHex(agentId(agent)),
      noteCommitment: target, refundCommitment: refund, amount: 20, allocatedCredit: 25, salt, status: "issuer-reported",
      paymentReference: "reference-used-for-repayment", receiptExpiry: 100, updatedAt: Date.now() }];
    const note = { commitment: target, present: true, lineGeneration: "1", redeemed: false, cancelled: true,
      compensationAllocated: true, refundCommitment: refund, cashRefundOwed: true, refundAcknowledged: true, refundPaymentNullifier: Y };
    f.setEvidence({ ...f.afterEvidence, note, nullifier: { value: X, present: true } });
    await f.journal.withExclusive(async lease => {
      await lease.prepare({ id: "report-X", kind: "cancelOrExpireNote", fingerprint: "66".repeat(32), beforeCommitment: f.afterEvidence.lineCommitment,
        candidateCommitment: null, beforeSnapshot: f.before, candidateSnapshot: candidate,
        expectedEffect: { circuit: "cancelOrExpireNote", targetCommitment: target, contractDomain: f.afterEvidence.contractDomain,
          lineGeneration: "1", effect: "note-refund-acknowledged", refundCommitment: refund, cashRefundOwed: true, paymentNullifier: X } });
      await lease.markSubmitting("report-X");
      assert.equal((await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {})).blocked, true);
      assert.equal((await lease.read()).operations[0].status, "submitting");
      f.setEvidence({ ...f.afterEvidence, note: { ...note, refundPaymentNullifier: X }, nullifier: { value: X, present: true } });
      const exact = await reconcileConsole(lease, f.scope, f.runtime, f.afterLedger, () => {});
      assert.equal(exact.blocked, false); assert.equal(exact.privateState!.refunds![0].paymentReference, "reference-used-for-repayment");
    }); lockVaultSession();
  });
});
