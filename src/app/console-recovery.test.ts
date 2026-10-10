import { boot } from "../test/fixtures/compact.ts";
import { it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { candidateConsole, snapshotConsole, LINE_SOURCE_FINGERPRINT, type ConsoleMutationContext, type ConsolePrivateState } from "./console-recovery.ts";
import { InMemoryTestRuntime } from "../lib/runtime/memory.ts";
import { blankPrivate, call, readLedger, firstQuote, notesOf } from "../lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, drawNoteCommit, merchantPublicKey, hexToBytes, pad32, toHex } from "../lib/line/encoding.ts";

it("journal provenance tracks the exact authoritative Compact source", () => {
  assert.equal(createHash("sha256").update(readFileSync(new URL("../../contracts/line.compact", import.meta.url))).digest("hex"), LINE_SOURCE_FINGERPRINT);
});

it("prewritten opening, note and repayment candidates match actual generated Compact execution", async () => {
  const issuer = new Uint8Array(32).fill(71), merchant = new Uint8Array(32).fill(72), agent = new Uint8Array(32).fill(73);
  const runtime = new InMemoryTestRuntime(undefined, { clock: () => 0 });
  const base = await runtime.getStatus();
  const address = runtime.getContractAddress();
  let session = await boot(issuer, merchant, new Uint8Array(32).fill(74));
  let privateState: ConsolePrivateState = { issuerRecord: { issuerSecret: toHex(issuer) }, merchantRecord: {
    merchantSecret: toHex(merchant), merchantPk: toHex(merchantPublicKey(merchant)) }, agentRecord: null,
    agentLineRecord: null, merchantQuotes: [], drawNotes: [], repayments: [] };
  const context = (): ConsoleMutationContext => {
    const ledger = readLedger(session);
    const status = { ...base, contractDomain: toHex(ledger.contractDomain), lineGeneration: Number(ledger.lineGeneration),
      actionClock: Number(ledger.actionClock), lineCommitment: toHex(ledger.lineCommit), identityCommitment: toHex(ledger.identityCommit) };
    status.feeFlat = Number(ledger.feeFlat); status.feeBps = Number(ledger.feeBps);
    return { runtime, address, ledger: status, before: snapshotConsole(privateState, status, address),
      scope: { networkId: runtime.networkId, contractAddress: status.contractDomain, sourceFingerprint: LINE_SOURCE_FINGERPRINT },
      lease: null as unknown as ConsoleMutationContext["lease"], assertCurrent() {}, operation: null };
  };
  const witnesses = blankPrivate({ callerSecret: issuer, agentSecret: agent, lineLimit: 150n, salt: pad32("initial-salt") });
  const execute = async (ps: typeof witnesses, name: Parameters<typeof call>[2]["name"], args: any[]) => {
    const result = await call(session, ps, { name, args } as Parameters<typeof call>[2]);
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (!result.ok) throw new Error("Generated circuit execution failed.");
    session = result.session;
  };
  await execute(witnesses, "fundReserve", [500n]);
  const opened = candidateConsole(context(), "openLine", [{ limit: 150, expiry: 10000, feeFlat: 2, feeBps: 0, callerSk: toHex(issuer), agentSecret: toHex(agent), salt: toHex(witnesses.salt) }]);
  await execute(witnesses, "openLine", [10000n, 2n, 0n]);
  assert.equal(opened.privateState.agentLineRecord!.lineCommitment, toHex(readLedger(session).lineCommit));
  assert.equal(opened.privateState.agentLineRecord!.lineGeneration, Number(readLedger(session).lineGeneration));
  privateState = opened.privateState;
  const quoted = candidateConsole(context(), "postQuote", [{ merchantSk: toHex(merchant), amount: 40, invoiceId: "invoice-candidate", expiry: 10000, nonce: toHex(pad32("quote-nonce")) }]);
  await execute({ ...witnesses, callerSecret: merchant, quoteMerchantPk: merchantPublicKey(merchant), quoteAmount: 40n,
    invoiceId: pad32("invoice-candidate"), quoteNonce: pad32("quote-nonce") }, "postQuote", [10000n]);
  const Q = firstQuote(readLedger(session))!.Q;
  assert.equal(quoted.privateState.merchantQuotes[0].quoteCommitment, toHex(Q));
  privateState = quoted.privateState;
  const drawParams = { agentSecret: toHex(agent), limit: 150, outstanding: 0, epoch: 0, amount: 40, fee: 2,
    salt: toHex(witnesses.salt), newSalt: toHex(pad32("draw-salt")), quoteCommit: toHex(Q), merchantPk: toHex(merchantPublicKey(merchant)),
    noteNonce: toHex(pad32("note-nonce")), noteSalt: toHex(pad32("note-salt")), noteExpiry: 10000 };
  const drawn = candidateConsole(context(), "draw", [drawParams]);
  await execute({ ...witnesses, callerSecret: agent, newSalt: pad32("draw-salt"), drawAmount: 40n,
    invoiceId: pad32("invoice-candidate"), quoteNonce: pad32("quote-nonce"), quoteMerchantPk: merchantPublicKey(merchant),
    noteNonce: pad32("note-nonce"), noteSalt: pad32("note-salt") }, "draw", [Q, 10000n, 2n]);
  assert.equal(drawn.privateState.agentLineRecord!.lineCommitment, toHex(readLedger(session).lineCommit));
  assert.equal(drawn.privateState.drawNotes[0].noteCommitment, toHex(notesOf(readLedger(session))[0].D));
  assert.equal(drawn.privateState.agentRecord!.B, 42);
  privateState = drawn.privateState;
  const repaid = candidateConsole(context(), "acknowledgeRepayment", [{ agentSecret: toHex(agent), limit: 150, outstanding: 42, epoch: 1,
    amount: 40, salt: toHex(pad32("draw-salt")), newSalt: toHex(pad32("repay-salt")), receiptNonce: toHex(pad32("receipt")),
    paymentRef: "payment-candidate", receiptExpiry: 10000 }]);
  await execute({ ...witnesses, lineOutstanding: 42n, lineEpoch: 1n, salt: pad32("draw-salt"), newSalt: pad32("repay-salt"),
    repayAmount: 40n, receiptNonce: pad32("receipt"), paymentRef: canonicalPaymentReferenceBytes("payment-candidate") }, "acknowledgeRepayment", [10000n]);
  assert.equal(repaid.privateState.agentLineRecord!.lineCommitment, toHex(readLedger(session).lineCommit));
  assert.equal(repaid.privateState.agentRecord!.B, 2);
  assert.equal(repaid.privateState.repayments[0].paymentReference, "payment-candidate");
  privateState = repaid.privateState;
  session = { ...session, clock: () => 10000 };
  const note = privateState.drawNotes[0];
  const compensation = { note: { identity: note.identityCommitment, quoteCommit: note.quoteCommitment, merchantPk: note.merchantPublicKey,
    amount: note.amount, fee: note.fee, noteNonce: note.noteNonce, expiry: note.expiry, lineGeneration: note.lineGeneration },
    noteSalt: note.noteSalt, newSalt: toHex(pad32("refund-salt")), book: { limit: 150, outstanding: 2, epoch: 2, salt: toHex(pad32("repay-salt")) } };
  const compensated = candidateConsole(context(), "cancelOrExpireNote", [note.noteCommitment, toHex(issuer), { compensation }]);
  await execute({ ...witnesses, lineOutstanding: 2n, lineEpoch: 2n, salt: pad32("repay-salt"), newSalt: pad32("refund-salt"),
    noteIdentity: agentId(agent), noteQuoteCommit: Q, quoteMerchantPk: merchantPublicKey(merchant), noteNonce: pad32("note-nonce"), noteSalt: pad32("note-salt") },
    "cancelOrExpireNote", [notesOf(readLedger(session))[0].D, 1n, 0n]);
  assert.equal(compensated.privateState.agentLineRecord!.lineCommitment, toHex(readLedger(session).lineCommit));
  assert.equal(compensated.privateState.agentRecord!.B, 0);
  const refund = compensated.privateState.refunds![0];
  assert.equal(refund.amount, 40); assert.equal(refund.allocatedCredit, 2);
  assert.equal(refund.refundCommitment, toHex(notesOf(readLedger(session))[0].refundCommitment));
  assert.equal(readLedger(session).refundReserve, 42n);
  privateState = compensated.privateState;
  const refundAck = { identity: note.identityCommitment, amount: 40, salt: refund.salt, paymentRef: "refund-payment-candidate", receiptExpiry: 11000 };
  const acknowledged = candidateConsole(context(), "cancelOrExpireNote", [note.noteCommitment, toHex(issuer), { refundAck }]);
  await execute({ ...witnesses, noteIdentity: agentId(agent), repayAmount: 40n, salt: pad32("refund-salt"),
    paymentRef: canonicalPaymentReferenceBytes(refundAck.paymentRef) }, "cancelOrExpireNote", [notesOf(readLedger(session))[0].D, 2n, 11000n]);
  assert.equal(acknowledged.privateState.refunds![0].status, "issuer-reported");
  assert.equal(acknowledged.privateState.agentLineRecord!.lineCommitment, toHex(readLedger(session).lineCommit));
  assert.equal(notesOf(readLedger(session))[0].refundAcknowledged, true);
  assert.equal(readLedger(session).reportedRefundReserve, 42n);
  const merchantOnly = context();
  merchantOnly.ledger = { ...merchantOnly.ledger, lineGeneration: 2 };
  merchantOnly.before.privateState.drawNotes = [];
  const redeemedHistorical = candidateConsole(merchantOnly, "redeemDraw", [{ noteCommit: note.noteCommitment,
    noteIdentity: note.identityCommitment, noteQuoteCommit: note.quoteCommitment, merchantSk: toHex(merchant),
    amount: note.amount, fee: note.fee, noteGeneration: note.lineGeneration, noteNonce: note.noteNonce, noteSalt: note.noteSalt, noteExpiry: note.expiry }]);
  const stored = redeemedHistorical.privateState.drawNotes[0];
  assert.equal(stored.lineGeneration, 1, "direct package redemption retains the original generation without a prior import");
  assert.equal(stored.fee, 2);
  assert.equal(toHex(drawNoteCommit({ domain: hexToBytes(stored.contractDomain), lineGeneration: BigInt(stored.lineGeneration),
    identity: hexToBytes(stored.identityCommitment), quoteCommit: hexToBytes(stored.quoteCommitment), merchantPk: hexToBytes(stored.merchantPublicKey),
    amount: BigInt(stored.amount), fee: BigInt(stored.fee), noteNonce: hexToBytes(stored.noteNonce), expiry: BigInt(stored.expiry) }, hexToBytes(stored.noteSalt))), stored.noteCommitment);
});
