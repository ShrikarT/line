import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOperationJournal, fingerprintOperationIntent, latestConfirmedOperation,
  operationJournalStorageKey, OPERATION_KINDS, MAX_JOURNAL_OPERATIONS,
  type JournalScope, type OperationJournalLease, type PreparedOperation, type JournalExpectedEffect,
} from "./operation-journal.ts";
import { clearVaultState, loadEncryptedJson, saveEncryptedJson, lockVaultSession, unlockVaultSession, type EncryptedEnvelope } from "./vault.ts";

const passphrase = "journal-test-correct-horse-battery";
const scope: JournalScope = { networkId: "preprod", contractAddress: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
const oldCommit = "c".repeat(64), nextCommit = "d".repeat(64);
const prepared = (id = "draw:1", candidate = nextCommit): PreparedOperation => ({
  id, kind: "draw", fingerprint: "e".repeat(64), beforeCommitment: oldCommit, candidateCommitment: candidate,
  beforeSnapshot: { debt: 0n, salt: new Uint8Array([1, 2]) },
  candidateSnapshot: { debt: 18_446_744_073_709_551_615n, salt: new Uint8Array([3, 4]), note: { nonce: new Uint8Array([5, 6]) } },
});
const observed = (lineCommitment = nextCommit) => ({ ...scope, kind: "observedCandidate" as const, lineCommitment });

/** IDB transaction model: request success occurs first, but only completion commits the staged map. */
function durableIdb() {
  const records = new Map<string, EncryptedEnvelope>();
  let failNextWrite = false;
  let beforeCommit: (() => void) | undefined;
  const factory = {
    open() {
      const request: Record<string, unknown> = {};
      setTimeout(() => {
        const database = {
          close() {},
          transaction(_store: string, mode: string) {
            const staged = new Map(records);
            const shouldFail = mode === "readwrite" && failNextWrite;
            if (mode === "readwrite") failNextWrite = false;
            let aborted = false;
            const tx: Record<string, unknown> = {
              abort() { aborted = true; (tx.onabort as (() => void) | undefined)?.(); },
              objectStore() {
                return {
                  get(id: string) {
                    const req: Record<string, unknown> = { result: staged.get(id) };
                    setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
                    return req;
                  },
                  put(envelope: EncryptedEnvelope) { staged.set(envelope.id, envelope); return {}; },
                  clear() { staged.clear(); return {}; },
                };
              },
            };
            setTimeout(() => {
              if (aborted) return;
              if (mode === "readwrite") beforeCommit?.();
              if (aborted) return;
              if (shouldFail) { (tx.onabort as (() => void) | undefined)?.(); return; }
              if (mode === "readwrite") { records.clear(); for (const [key, value] of staged) records.set(key, value); }
              (tx.oncomplete as (() => void) | undefined)?.();
            }, 5);
            return tx;
          },
        };
        request.result = database; (request.onsuccess as (() => void) | undefined)?.();
      }, 0);
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, records, failWrite() { failNextWrite = true; }, beforeCommit(fn?: () => void) { beforeCommit = fn; } };
}

describe("encrypted operation journal", () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  beforeEach(async () => { await clearVaultState(); unlockVaultSession(passphrase); });
  afterEach(() => {
    lockVaultSession();
    for (const [key, descriptor] of [["indexedDB", originalIndexedDb], ["window", originalWindow], ["navigator", originalNavigator]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });

  it("covers the twelve circuits and fingerprints typed intent independently of object key order", async () => {
    assert.equal(OPERATION_KINDS.length, 12);
    const a = await fingerprintOperationIntent({ amount: 42n, opening: { salt: new Uint8Array([1]), limit: 60n } });
    const b = await fingerprintOperationIntent({ opening: { limit: 60n, salt: new Uint8Array([1]) }, amount: 42n });
    assert.equal(a, b);
    assert.notEqual(a, await fingerprintOperationIntent({ amount: 43n, opening: { salt: new Uint8Array([1]), limit: 60n } }));
  });

  it("persists the full typed candidate before submission and recovers it with a new journal handle", async () => {
    const journal = createOperationJournal(scope, passphrase);
    const intent = prepared();
    await journal.withExclusive(async lease => { await lease.prepare(intent); await lease.markSubmitting(intent.id); });
    intent.candidateSnapshot = { modifiedAfterPrepare: true };
    const reloaded = createOperationJournal(scope, passphrase);
    await reloaded.withExclusive(async lease => {
      const record = await lease.read();
      assert.equal(record.operations[0].status, "submitting");
      assert.deepEqual(record.operations[0].candidateSnapshot, prepared().candidateSnapshot);
      assert.equal(latestConfirmedOperation(record), null, "Saved candidate must not become confirmed from storage alone");
      await assert.rejects(() => lease.prepare(prepared("draw:2")), /requires reconciliation/);
      await assert.rejects(() => lease.markSubmitting(intent.id), /ambiguous|prepared/); // Idempotent mark requires an already-held submitting lease, tested below.
    });
  });

  it("retains the transaction identifier at the before-submit hook without allowing a changed identifier", async () => {
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => {
      await lease.prepare(prepared()); await lease.markSubmitting("draw:1");
      await lease.markSubmitting("draw:1", { transactionId: "tx:1" });
      assert.equal((await lease.read()).operations[0].transactionId, "tx:1");
      await assert.rejects(() => lease.markSubmitting("draw:1", { transactionId: "tx:2" }), /Conflicting submission/);
      await lease.markUncertain("draw:1");
      await assert.rejects(() => lease.markSubmitting("draw:1", { transactionId: "tx:1" }), /cannot be retried/);
    });
  });

  it("cannot confirm a merely prepared candidate, wrong public commitment, cross-contract or cross-source evidence", async () => {
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare(prepared());
      await assert.rejects(() => lease.confirm("draw:1", observed()), /not a confirmed submission/);
      await lease.markSubmitting("draw:1");
      await assert.rejects(() => lease.confirm("draw:1", observed(oldCommit)), /does not match/);
      await assert.rejects(() => lease.confirm("draw:1", { ...observed(), contractAddress: "f".repeat(64) }), /another scope/);
      await assert.rejects(() => lease.confirm("draw:1", { ...observed(), sourceFingerprint: "f".repeat(64) }), /another scope/);
      const confirmed = await lease.confirm("draw:1", observed());
      assert.equal(confirmed.status, "confirmed");
      assert.deepEqual(confirmed.candidateSnapshot, prepared().candidateSnapshot);
    });
  });

  it("old commitment alone cannot release an ambiguous operation", async () => {
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare(prepared()); await lease.markSubmitting("draw:1"); await lease.markUncertain("draw:1");
      await assert.rejects(() => lease.abandonPrepared("draw:1"), /cannot be abandoned/);
      await assert.rejects(() => lease.reject("draw:1", { ...scope, kind: "observedOld", lineCommitment: oldCommit } as never), /definite runtime rejection/);
      await assert.rejects(() => lease.prepare(prepared("draw:2")), /reconciliation/);
      await lease.reject("draw:1", { ...scope, kind: "definiteRejection" });
      assert.equal((await lease.prepare(prepared("draw:2"))).status, "prepared");
    });
  });

  it("allows a captured confirmed recovery write after lock but blocks any new submission", async () => {
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => {
      await lease.prepare(prepared()); await lease.markSubmitting("draw:1"); lockVaultSession();
      assert.equal((await lease.confirm("draw:1", observed())).status, "confirmed");
      await assert.rejects(() => lease.prepare(prepared("draw:2")), /revoked/);
      await assert.rejects(() => lease.acknowledgeConfirmed("draw:1"), /revoked/);
      await assert.rejects(() => lease.read(), /revoked/);
    });
    unlockVaultSession(passphrase);
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      const record = await lease.read(); assert.equal(record.operations[0].status, "confirmed");
      await lease.acknowledgeConfirmed("draw:1");
    });
    await assert.rejects(() => journal.withExclusive(async () => undefined), /revoked/);
  });

  it("does not leak a usable lease beyond its exclusive callback", async () => {
    let escaped!: OperationJournalLease;
    await createOperationJournal(scope, passphrase).withExclusive(async lease => { escaped = lease; });
    await assert.rejects(() => escaped.prepare(prepared()), /lease has ended/);
  });

  it("retains ownership until already-issued durable writes finish even if the callback returns early", async () => {
    const db = durableIdb(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: db.factory });
    const journal = createOperationJournal(scope, passphrase);
    let pending!: Promise<unknown>, escaped!: OperationJournalLease;
    await journal.withExclusive(async lease => { escaped = lease; pending = lease.prepare(prepared()); });
    assert.equal(db.records.size, 1, "Exclusive scope cannot resolve before queued durable preparation commits");
    await pending;
    await assert.rejects(() => escaped.markSubmitting("draw:1"), /lease has ended/);
    await createOperationJournal(scope, passphrase).withExclusive(async lease => { await assert.rejects(() => lease.prepare(prepared("draw:2")), /reconciliation/); });
  });

  it("serializes separate handles and concurrent methods without overwriting a pending intent", async () => {
    const journalA = createOperationJournal(scope, passphrase), journalB = createOperationJournal(scope, passphrase);
    let release!: () => void, firstEntered!: () => void;
    const entered = new Promise<void>(resolve => { firstEntered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const visits: string[] = [];
    const first = journalA.withExclusive(async lease => { visits.push("first"); firstEntered(); await wait; await lease.prepare(prepared()); });
    await entered;
    const second = journalB.withExclusive(async lease => { visits.push("second"); await assert.rejects(() => lease.prepare(prepared("draw:2")), /reconciliation/); });
    await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(visits, ["first"]);
    release(); await Promise.all([first, second]); assert.deepEqual(visits, ["first", "second"]);
    await journalA.withExclusive(async lease => {
      const results = await Promise.allSettled([lease.markSubmitting("draw:1", { transactionId: "tx:1" }), lease.markSubmitting("draw:1", { transactionId: "tx:2" })]);
      assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
      assert.equal((await lease.read()).operations[0].transactionId, "tx:1");
    });
  });

  it("uses an encrypted committed IDB document and preserves the original candidate after an aborted confirmation", async () => {
    const db = durableIdb(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: db.factory });
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => { await lease.prepare(prepared()); await lease.markSubmitting("draw:1"); });
    const envelope = db.records.get(journal.storageKey)!;
    assert.equal(envelope.version, 2); assert.ok(!JSON.stringify(envelope).includes("candidateSnapshot"));
    await journal.withExclusive(async lease => { await lease.read(); db.failWrite(); await assert.rejects(() => lease.confirm("draw:1", observed()), /did not commit/); });
    assert.deepEqual(db.records.get(journal.storageKey), envelope, "Aborted replacement must leave the earlier ciphertext intact");
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      const recovered = (await lease.read()).operations[0];
      assert.equal(recovered.status, "submitting"); assert.deepEqual(recovered.candidateSnapshot, prepared().candidateSnapshot);
      await lease.confirm("draw:1", observed());
    });
  });

  it("aborts an in-flight prepared write when the session locks before IDB commit", async () => {
    const db = durableIdb(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: db.factory });
    const journal = createOperationJournal(scope, passphrase); db.beforeCommit(lockVaultSession);
    await assert.rejects(() => journal.withExclusive(lease => lease.prepare(prepared())), /revoked/);
    assert.equal(db.records.size, 0);
  });

  it("rejects scope/schema substitution even when the ciphertext decrypts with the correct password", async () => {
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => { await lease.prepare(prepared()); });
    await assert.rejects(() => createOperationJournal({ ...scope, sourceFingerprint: "f".repeat(64) }, passphrase).withExclusive(lease => lease.read()), /Invalid or mismatched/);
    const record = await loadEncryptedJson<Record<string, unknown>>(journal.storageKey, passphrase);
    await saveEncryptedJson(journal.storageKey, { ...record, unexpected: true }, passphrase);
    await assert.rejects(() => journal.withExclusive(lease => lease.read()), /Invalid or mismatched/);
  });

  it("keeps latest confirmed recovery and immutable intent history while compacting older full snapshots", async () => {
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => {
      const first = prepared(); await lease.prepare(first); await lease.markSubmitting(first.id); await lease.confirm(first.id, observed()); await lease.acknowledgeConfirmed(first.id);
      const second = prepared("draw:2", "f".repeat(64)); await lease.prepare(second); await lease.markSubmitting(second.id); await lease.confirm(second.id, observed("f".repeat(64)));
      const record = await lease.read();
      assert.equal(record.operations[0].snapshotsCompacted, true); assert.equal(record.operations[0].candidateSnapshot, null);
      assert.deepEqual(latestConfirmedOperation(record)?.candidateSnapshot, second.candidateSnapshot);
      await lease.acknowledgeConfirmed(second.id);
      assert.equal((await lease.prepare(first)).status, "confirmed", "Existing stable ID is detected after snapshot compaction");
      await assert.rejects(() => lease.prepare({ ...first, fingerprint: "1".repeat(64) }), /different intent/);
    });
  });

  it("accepts a definite receipt for nonbook actions and rejects missing network confirmation evidence", async () => {
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      const input = { ...prepared("fund:1"), kind: "fundReserve" as const, candidateCommitment: null };
      await lease.prepare(input); await lease.markSubmitting(input.id, { transactionId: "tx:network" });
      await assert.rejects(() => lease.confirm(input.id, { ...scope, kind: "definiteReceipt", receipt: { executionMode: "network", txHash: "hash:1" } }), /Invalid confirmed runtime/);
      await assert.rejects(() => lease.confirm(input.id, { ...scope, kind: "definiteReceipt", receipt: { executionMode: "network", txId: "tx:wrong", blockHeight: 9 } }), /differs/);
      const result = await lease.confirm(input.id, { ...scope, kind: "definiteReceipt", receipt: { executionMode: "network", txId: "tx:network", txHash: "hash:1", blockHeight: 9 } });
      assert.equal(result.status, "confirmed"); assert.equal(result.receipt?.blockHeight, 9);
    });
  });

  it("recovers a posted quote only from the exact prewritten unique effect", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "postQuote", targetCommitment: nextCommit, contractDomain: "1".repeat(64), lineGeneration: "2", effect: "quote-present" };
    const input = { ...prepared("quote:1"), kind: "postQuote" as const, candidateCommitment: null, expectedEffect };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => { await lease.prepare(input); await lease.markSubmitting(input.id); await lease.markUncertain(input.id); });
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await assert.rejects(() => lease.confirm(input.id, { ...scope, kind: "observedEffect", ...expectedEffect, targetCommitment: oldCommit }), /does not match/);
      assert.equal((await lease.confirm(input.id, { ...scope, kind: "observedEffect", ...expectedEffect })).status, "confirmed");
    });
  });

  it("rejects another generation or domain when reconciling a redeemed note", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "redeemDraw", targetCommitment: nextCommit, contractDomain: "1".repeat(64), lineGeneration: "18", effect: "note-redeemed" };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare({ ...prepared("redeem:1"), kind: "redeemDraw", candidateCommitment: null, expectedEffect }); await lease.markSubmitting("redeem:1");
      await assert.rejects(() => lease.confirm("redeem:1", { ...scope, kind: "observedEffect", ...expectedEffect, lineGeneration: "19" }), /does not match/);
      await assert.rejects(() => lease.confirm("redeem:1", { ...scope, kind: "observedEffect", ...expectedEffect, contractDomain: "2".repeat(64) }), /does not match/);
      assert.equal((await lease.confirm("redeem:1", { ...scope, kind: "observedEffect", ...expectedEffect })).status, "confirmed");
    });
  });

  it("does not confirm cancelled notes from a redemption effect or arbitrary aggregate state delta", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "cancelOrExpireNote", targetCommitment: nextCommit, contractDomain: "1".repeat(64), lineGeneration: "18", effect: "note-cancelled" };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare({ ...prepared("cancel:1"), kind: "cancelOrExpireNote", candidateCommitment: null, expectedEffect }); await lease.markSubmitting("cancel:1");
      await assert.rejects(() => lease.confirm("cancel:1", { ...scope, kind: "observedEffect", ...expectedEffect, circuit: "redeemDraw", effect: "note-redeemed" }), /does not match/);
      await lease.confirm("cancel:1", { ...scope, kind: "observedEffect", ...expectedEffect }); await lease.acknowledgeConfirmed("cancel:1");
      await lease.prepare({ ...prepared("reserve:2"), kind: "fundReserve", candidateCommitment: null }); await lease.markSubmitting("reserve:2");
      await assert.rejects(() => lease.confirm("reserve:2", { ...scope, kind: "observedEffect", ...expectedEffect }), /does not match/);
    });
  });

  it("requires the complete refund commitment, cash marker and book candidate for compensation", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "cancelOrExpireNote", targetCommitment: "1".repeat(64), contractDomain: "2".repeat(64), lineGeneration: "18",
      effect: "note-compensation-allocated", refundCommitment: "3".repeat(64), cashRefundOwed: true, lineCommitment: nextCommit };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await assert.rejects(lease.prepare({ ...prepared("invalid"), kind: "cancelOrExpireNote", expectedEffect: { ...expectedEffect, lineCommitment: oldCommit } }), /bind the prepared/);
      await lease.prepare({ ...prepared("comp:1"), kind: "cancelOrExpireNote", expectedEffect }); await lease.markSubmitting("comp:1");
      await assert.rejects(lease.confirm("comp:1", observed()), /complete public effect/);
      for (const changed of [{ refundCommitment: "4".repeat(64) }, { cashRefundOwed: false }, { lineCommitment: oldCommit }]) {
        await assert.rejects(lease.confirm("comp:1", { ...scope, kind: "observedEffect", ...expectedEffect, ...changed }), /does not match/);
      }
      assert.equal((await lease.confirm("comp:1", { ...scope, kind: "observedEffect", ...expectedEffect })).status, "confirmed");
    });
  });

  it("requires a fresh historical allocation marker even when no current book changes", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "cancelOrExpireNote", targetCommitment: "1".repeat(64), contractDomain: "2".repeat(64), lineGeneration: "18",
      effect: "note-compensation-allocated", refundCommitment: "3".repeat(64), cashRefundOwed: true, lineCommitment: null };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare({ ...prepared("historical:1"), kind: "cancelOrExpireNote", candidateCommitment: null, expectedEffect }); await lease.markSubmitting("historical:1");
      await assert.rejects(lease.confirm("historical:1", { ...scope, kind: "observedEffect", circuit: "cancelOrExpireNote", targetCommitment: expectedEffect.targetCommitment,
        contractDomain: expectedEffect.contractDomain, lineGeneration: "18", effect: "note-cancelled" }), /does not match/);
      assert.equal((await lease.confirm("historical:1", { ...scope, kind: "observedEffect", ...expectedEffect })).status, "confirmed");
    });
  });

  it("binds reported-refund confirmation to the supplied payment reference's stable nullifier", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "cancelOrExpireNote", targetCommitment: "1".repeat(64), contractDomain: "2".repeat(64), lineGeneration: "18",
      effect: "note-refund-acknowledged", refundCommitment: "3".repeat(64), cashRefundOwed: true, paymentNullifier: "4".repeat(64) };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await lease.prepare({ ...prepared("refund:1"), kind: "cancelOrExpireNote", candidateCommitment: null, expectedEffect }); await lease.markSubmitting("refund:1");
      await assert.rejects(lease.confirm("refund:1", { ...scope, kind: "observedEffect", ...expectedEffect, paymentNullifier: "5".repeat(64) }), /does not match/);
      await assert.rejects(lease.confirm("refund:1", { ...scope, kind: "observedEffect", ...expectedEffect, paymentNullifier: undefined }), /payment nullifier/);
      assert.equal((await lease.confirm("refund:1", { ...scope, kind: "observedEffect", ...expectedEffect })).status, "confirmed");
    });
  });

  it("validates effect circuit pairing and full-width canonical generation without numeric coercion", async () => {
    const expectedEffect: JournalExpectedEffect = { circuit: "postQuote", targetCommitment: nextCommit, contractDomain: "1".repeat(64), lineGeneration: "18446744073709551615", effect: "quote-present" };
    await createOperationJournal(scope, passphrase).withExclusive(async lease => {
      await assert.rejects(() => lease.prepare({ ...prepared(), expectedEffect }), /does not belong/);
      await assert.rejects(() => lease.prepare({ ...prepared("quote:1"), kind: "postQuote", candidateCommitment: null, expectedEffect: { ...expectedEffect, lineGeneration: "18446744073709551616" } }), /Invalid unique/);
      await assert.rejects(() => lease.prepare({ ...prepared("quote:1"), kind: "postQuote", candidateCommitment: null, expectedEffect: { ...expectedEffect, lineGeneration: "018" } }), /Invalid unique/);
      const result = await lease.prepare({ ...prepared("quote:1"), kind: "postQuote", candidateCommitment: null, expectedEffect });
      assert.equal(result.expectedEffect?.lineGeneration, "18446744073709551615");
    });
  });

  it("fails closed at its explicit bounded history capacity while retaining stable IDs", async () => {
    const journal = createOperationJournal(scope, passphrase);
    await journal.withExclusive(async lease => { await lease.prepare(prepared()); await lease.abandonPrepared("draw:1"); });
    const record = await loadEncryptedJson<import("./operation-journal.ts").OperationJournalRecord>(journal.storageKey, passphrase);
    assert.ok(record);
    const template = record.operations[0];
    record.operations = Array.from({ length: MAX_JOURNAL_OPERATIONS }, (_, i) => ({ ...template, id: `terminal:${i}`, sequence: i + 1 }));
    record.revision = MAX_JOURNAL_OPERATIONS;
    await saveEncryptedJson(journal.storageKey, record, passphrase);
    await journal.withExclusive(async lease => {
      assert.equal((await lease.read()).operations.length, MAX_JOURNAL_OPERATIONS);
      await assert.rejects(() => lease.prepare(prepared("new:1")), /capacity exhausted/);
      assert.equal((await lease.prepare(prepared("terminal:0"))).status, "rejected");
    });
  });

  it("fails closed in a browser without cross-tab Web Locks", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await assert.rejects(() => createOperationJournal(scope, passphrase).withExclusive(lease => lease.prepare(prepared())), /Web Locks are required/);
  });

  it("requests an exclusive browser Web Lock for the exact storage scope", async () => {
    const db = durableIdb(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: db.factory });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const requested: unknown[] = [];
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (name: string, options: unknown, action: () => Promise<unknown>) => { requested.push([name, options]); return action(); } } } });
    await createOperationJournal(scope, passphrase).withExclusive(async lease => { await lease.prepare(prepared()); });
    assert.deepEqual(requested, [[operationJournalStorageKey(scope), { mode: "exclusive" }]]);
  });
});
