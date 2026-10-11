import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../src/test/fixtures/compact.ts";
import { blankPrivate, call, readLedger, Status, type CircuitCall, type PrivateState } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, drawNoteCommit, lineStateCommit, merchantPublicKey, pad32, paymentNullifier, refundCommit, toHex } from "../src/lib/line/encoding.ts";
import { DEMO } from "../src/test/fixtures/keys.ts";

const DEADLINE = 100n, RECEIPT = 10_000n, FEE = 2n;
type Note = { D: Uint8Array; Q: Uint8Array; amount: bigint; fee: bigint; identity: Uint8Array; generation: bigint;
  nonce: Uint8Array; salt: Uint8Array; expiry: bigint; merchantPk: Uint8Array };

async function fixture() {
  let now = 0, sequence = 0;
  let agent = DEMO.agent;
  let book = { identity: agentId(agent), limit: 150n, outstanding: 0n, epoch: 0n, salt: pad32("comp-opening") };
  let session = await boot(DEMO.issuer, DEMO.merchantA, pad32("comp-instance"), undefined, () => now);
  const execute = async (op: CircuitCall, overrides: Partial<PrivateState> = {}) => {
    const ps = blankPrivate({ callerSecret: DEMO.issuer, agentSecret: agent, lineLimit: book.limit,
      lineOutstanding: book.outstanding, lineEpoch: book.epoch, salt: book.salt, quoteMerchantPk: merchantPublicKey(DEMO.merchantA), ...overrides });
    const result = await call(session, ps, op); if (result.ok) session = result.session; return result;
  };
  const ledger = () => readLedger(session);
  assert.equal((await execute({ name: "fundReserve", args: [500n] })).ok, true);
  assert.equal((await execute({ name: "openLine", args: [RECEIPT, FEE, 0n] })).ok, true);
  const draw = async (amount = 20n, expiry = DEADLINE): Promise<Note> => {
    const n = ++sequence, invoiceId = pad32(`comp-invoice-${n}`), quoteNonce = pad32(`comp-quote-${n}`);
    const quoted = await execute({ name: "postQuote", args: [expiry] }, { callerSecret: DEMO.merchantA, invoiceId, quoteNonce, quoteAmount: amount });
    assert.equal(quoted.ok, true, quoted.ok ? "" : quoted.error);
    const Q = [...ledger().quotes].find(([, m]) => !m.used)![0];
    const noteNonce = pad32(`comp-note-${n}`), noteSalt = pad32(`comp-note-salt-${n}`), newSalt = pad32(`comp-draw-${n}`);
    const note = { Q, amount, fee: FEE, identity: book.identity, generation: ledger().lineGeneration, nonce: noteNonce, salt: noteSalt,
      expiry, merchantPk: merchantPublicKey(DEMO.merchantA) };
    const D = drawNoteCommit({ domain: ledger().contractDomain, lineGeneration: note.generation, identity: note.identity,
      quoteCommit: Q, merchantPk: note.merchantPk, amount, fee: FEE, noteNonce, expiry }, noteSalt);
    const drawn = await execute({ name: "draw", args: [Q, expiry, FEE] }, { invoiceId, quoteNonce, drawAmount: amount, noteNonce, noteSalt, newSalt });
    assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error); assert.equal(ledger().notes.member(D), true);
    book = { ...book, outstanding: book.outstanding + amount + FEE, epoch: book.epoch + 1n, salt: newSalt };
    return { ...note, D };
  };
  const repay = async (amount: bigint, reference = `incoming-${++sequence}`) => {
    const newSalt = pad32(`comp-repay-${++sequence}`);
    const result = await execute({ name: "acknowledgeRepayment", args: [RECEIPT] }, { repayAmount: amount,
      paymentRef: canonicalPaymentReferenceBytes(reference), receiptNonce: pad32(`comp-receipt-${sequence}`), newSalt });
    if (result.ok) book = { ...book, outstanding: book.outstanding - amount, epoch: book.epoch + 1n, salt: newSalt };
    return result;
  };
  const opening = (note: Note): Partial<PrivateState> => ({ noteIdentity: note.identity, noteQuoteCommit: note.Q,
    quoteMerchantPk: note.merchantPk, noteNonce: note.nonce, noteSalt: note.salt });
  const expire = (note: Note) => execute({ name: "cancelOrExpireNote", args: [note.D, 0n, 0n] }, { callerSecret: DEMO.merchantB });
  const allocate = async (note: Note, overrides: Partial<PrivateState> = {}) => {
    const current = ledger().lineGeneration === note.generation;
    const refundAmount = current ? (book.outstanding < note.amount + note.fee ? note.amount + note.fee - book.outstanding : 0n) : note.amount + note.fee;
    const newSalt = pad32(`comp-allocation-${++sequence}`);
    const result = await execute({ name: "cancelOrExpireNote", args: [note.D, 1n, 0n] }, { ...opening(note), callerSecret: DEMO.agent, newSalt, ...overrides });
    if (result.ok && current) book = { ...book, outstanding: book.outstanding > note.amount + note.fee ? book.outstanding - note.amount - note.fee : 0n,
      epoch: book.epoch + 1n, salt: newSalt };
    return { result, refundAmount, refundSalt: newSalt };
  };
  const reportRefund = (note: Note, amount: bigint, refundSalt: Uint8Array, reference = `refund-${++sequence}`, overrides: Partial<PrivateState> = {}, deadline = RECEIPT) =>
    execute({ name: "cancelOrExpireNote", args: [note.D, 2n, deadline] }, { callerSecret: DEMO.issuer, noteIdentity: note.identity,
      repayAmount: amount, salt: refundSalt, paymentRef: canonicalPaymentReferenceBytes(reference), ...overrides });
  const reopen = async (nextAgent = DEMO.agent) => {
    assert.equal((await execute({ name: "setStatus", args: [Status.CLOSED] })).ok, true);
    agent = nextAgent; book = { identity: agentId(agent), limit: 150n, outstanding: 0n, epoch: 0n, salt: pad32(`comp-reopen-${++sequence}`) };
    assert.equal((await execute({ name: "openLine", args: [RECEIPT, FEE, 0n] })).ok, true);
  };
  return { ledger, execute, draw, repay, opening, expire, allocate, reportRefund, reopen,
    setTime: (value: number) => { now = value; }, book: () => book, meta: (note: Note) => ledger().notes.lookup(note.D) };
}

function snapshot(l: ReturnType<typeof readLedger>) {
  return { C: toHex(l.lineCommit), generation: l.lineGeneration, status: l.status, clock: l.actionClock, T: l.totalReserve,
    E: l.encumberedReserve, R: l.redeemedReserve, F: l.feeReserve, P: l.pendingFeeReserve, U: l.refundReserve, reported: l.reportedRefundReserve,
    notes: [...l.notes].map(([D, m]) => ({ D: toHex(D), ...m, refundCommitment: toHex(m.refundCommitment),
      refundPaymentNullifier: toHex(m.refundPaymentNullifier) })), nullifiers: [...l.nullifiers].map(toHex) };
}
function assertBook(f: Awaited<ReturnType<typeof fixture>>, outstanding: bigint) {
  assert.equal(f.book().outstanding, outstanding);
  const { identity, limit, epoch, salt } = f.book();
  assert.equal(toHex(f.ledger().lineCommit), toHex(lineStateCommit({ domain: f.ledger().contractDomain, identity, limit, outstanding, epoch }, salt)));
}
function assertReserve(f: Awaited<ReturnType<typeof fixture>>) {
  const l = f.ledger(); assert.ok(l.encumberedReserve + l.redeemedReserve + l.feeReserve + l.pendingFeeReserve + l.refundReserve + l.reportedRefundReserve <= l.totalReserve);
}

describe("generated Compact: expiry compensation and earned fees", () => {
  it("publishes no refund receipt before an authenticated report and binds that report to the exact stable payment nullifier", async () => {
    const f = await fixture(), note = await f.draw(), zero = toHex(new Uint8Array(32));
    assert.equal(toHex(f.meta(note).refundPaymentNullifier), zero);
    assert.equal((await f.repay(7n, "rail:incoming:receipt-binding")).ok, true);
    assert.equal(toHex(f.meta(note).refundPaymentNullifier), zero);
    f.setTime(Number(DEADLINE)); assert.equal((await f.expire(note)).ok, true);
    assert.equal(toHex(f.meta(note).refundPaymentNullifier), zero);
    const allocated = await f.allocate(note); assert.equal(allocated.result.ok, true);
    assert.equal(toHex(f.meta(note).refundPaymentNullifier), zero);
    const reference = "rail:outgoing:receipt-binding", before = snapshot(f.ledger());
    for (const overrides of [{ callerSecret: DEMO.agent }, { salt: pad32("forged-refund-opening") },
      { noteIdentity: agentId(DEMO.merchantB) }, { paymentRef: new Uint8Array(32) }]) {
      assert.equal((await f.reportRefund(note, 7n, allocated.refundSalt, reference, overrides)).ok, false);
      assert.deepEqual(snapshot(f.ledger()), before);
      assert.equal(toHex(f.meta(note).refundPaymentNullifier), zero);
    }
    assert.equal((await f.reportRefund(note, 7n, allocated.refundSalt, reference)).ok, true);
    const expected = paymentNullifier(DEMO.issuer, canonicalPaymentReferenceBytes(reference), f.ledger().contractDomain);
    assert.equal(toHex(f.meta(note).refundPaymentNullifier), toHex(expected));
    assert.equal(f.ledger().nullifiers.member(expected), true);
    assert.notEqual(toHex(expected), toHex(paymentNullifier(DEMO.issuer, canonicalPaymentReferenceBytes("rail:outgoing:different-reference"), f.ledger().contractDomain)));
    const acknowledged = snapshot(f.ledger());
    assert.equal((await f.reportRefund(note, 7n, allocated.refundSalt, "rail:outgoing:different-reference")).ok, false);
    assert.deepEqual(snapshot(f.ledger()), acknowledged);
  });

  it("distinguishes a note's refund receipt from references consumed by repayment or another note", async () => {
    const f = await fixture(), a = await f.draw(), b = await f.draw();
    const incoming = "rail:incoming:unrelated-receipt", outgoingA = "rail:outgoing:note-a", outgoingB = "rail:outgoing:note-b";
    assert.equal((await f.repay(44n, incoming)).ok, true); f.setTime(Number(DEADLINE));
    const ca = await f.allocate(a), cb = await f.allocate(b); assert.equal(ca.result.ok, true); assert.equal(cb.result.ok, true);
    const nullifier = (reference: string) => paymentNullifier(DEMO.issuer, canonicalPaymentReferenceBytes(reference), f.ledger().contractDomain);
    assert.equal(f.ledger().nullifiers.member(nullifier(incoming)), true);
    const before = snapshot(f.ledger());
    assert.equal((await f.reportRefund(a, 22n, ca.refundSalt, incoming)).ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.reportRefund(a, 22n, ca.refundSalt, outgoingA)).ok, true);
    // Both global receipts exist, but only the outgoing one is evidence of this note's report.
    assert.equal(f.ledger().nullifiers.member(nullifier(incoming)), true);
    assert.equal(toHex(f.meta(a).refundPaymentNullifier), toHex(nullifier(outgoingA)));
    assert.notEqual(toHex(f.meta(a).refundPaymentNullifier), toHex(nullifier(incoming)));
    assert.equal(toHex(f.meta(b).refundPaymentNullifier), toHex(new Uint8Array(32)));
    const reportedA = snapshot(f.ledger());
    assert.equal((await f.reportRefund(b, 22n, cb.refundSalt, outgoingA)).ok, false); assert.deepEqual(snapshot(f.ledger()), reportedA);
    assert.equal((await f.reportRefund(b, 22n, cb.refundSalt, outgoingB)).ok, true);
    assert.equal(toHex(f.meta(a).refundPaymentNullifier), toHex(nullifier(outgoingA)));
    assert.equal(toHex(f.meta(b).refundPaymentNullifier), toHex(nullifier(outgoingB)));
    assert.notEqual(toHex(f.meta(a).refundPaymentNullifier), toHex(f.meta(b).refundPaymentNullifier)); assertReserve(f);
  });

  it("locks fees at authorization, earns them at merchant redemption and only then permits withdrawal", async () => {
    const f = await fixture(), note = await f.draw(); assert.equal(f.ledger().pendingFeeReserve, FEE); assert.equal(f.ledger().feeReserve, 0n);
    const before = snapshot(f.ledger());
    assert.equal((await f.execute({ name: "withdrawFees", args: [] })).ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.execute({ name: "withdrawUnencumberedReserve", args: [479n] })).ok, false);
    const redeemed = await f.execute({ name: "redeemDraw", args: [note.D, note.expiry] }, { ...f.opening(note), callerSecret: DEMO.merchantA, redeemAmount: note.amount });
    assert.equal(redeemed.ok, true, redeemed.ok ? "" : redeemed.error); assert.equal(f.ledger().pendingFeeReserve, 0n); assert.equal(f.ledger().feeReserve, FEE);
    assert.equal((await f.execute({ name: "withdrawFees", args: [] })).ok, true); assert.equal(f.ledger().totalReserve, 498n);
    f.setTime(Number(DEADLINE)); assert.equal((await f.expire(note)).ok, false); assert.equal((await f.allocate(note)).result.ok, false); assertReserve(f);
  });

  it("permissionless expiry retains the full cost budget and leaves private debt unchanged until allocation", async () => {
    const f = await fixture(), note = await f.draw(); const C = toHex(f.ledger().lineCommit); f.setTime(Number(DEADLINE));
    assert.equal((await f.expire(note)).ok, true); assert.equal(f.meta(note).compensationAllocated, false);
    assert.equal(f.ledger().encumberedReserve, 0n); assert.equal(f.ledger().pendingFeeReserve, 0n); assert.equal(f.ledger().feeReserve, 0n);
    assert.equal(f.ledger().refundReserve, 22n); assert.equal(toHex(f.ledger().lineCommit), C); assertBook(f, 22n);
    const before = snapshot(f.ledger()); assert.equal((await f.expire(note)).ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.execute({ name: "withdrawUnencumberedReserve", args: [479n] })).ok, false); assertReserve(f);
  });

  it("the original agent restores unpaid principal and pending fees once without inventing a cash refund", async () => {
    const f = await fixture(), note = await f.draw(); f.setTime(Number(DEADLINE)); assert.equal((await f.expire(note)).ok, true);
    const a = await f.allocate(note); assert.equal(a.result.ok, true, a.result.ok ? "" : a.result.error); assertBook(f, 0n);
    assert.equal(f.meta(note).compensationAllocated, true); assert.equal(f.meta(note).cashRefundOwed, false); assert.equal(f.ledger().refundReserve, 0n);
    const before = snapshot(f.ledger()); assert.equal((await f.allocate(note)).result.ok, false); assert.equal((await f.reportRefund(note, 1n, a.refundSalt)).ok, false);
    assert.deepEqual(snapshot(f.ledger()), before); assert.equal((await f.execute({ name: "withdrawUnencumberedReserve", args: [500n] })).ok, true);
  });

  for (const paid of [7n, 22n]) {
    it(`privately records a ${paid === 22n ? "full" : "partial"} refund after repayment and retains the full original budget`, async () => {
      const f = await fixture(), note = await f.draw(); assert.equal((await f.repay(paid)).ok, true); f.setTime(Number(DEADLINE));
      const a = await f.allocate(note, { callerSecret: DEMO.issuer }); assert.equal(a.result.ok, true, a.result.ok ? "" : a.result.error); assertBook(f, 0n);
      assert.equal(a.refundAmount, paid); assert.equal(f.meta(note).cashRefundOwed, true); assert.equal(f.ledger().refundReserve, 22n);
      const expected = refundCommit({ domain: f.ledger().contractDomain, lineGeneration: note.generation, identity: note.identity, noteCommit: note.D, amount: paid }, a.refundSalt);
      assert.equal(toHex(f.meta(note).refundCommitment), toHex(expected));
      assert.equal(Object.hasOwn(f.meta(note), "refundAmount"), false); assert.equal(Object.hasOwn(f.meta(note), "refundDue"), false);
      const T = f.ledger().totalReserve, C = toHex(f.ledger().lineCommit);
      assert.equal((await f.reportRefund(note, paid, a.refundSalt)).ok, true);
      assert.equal(f.ledger().refundReserve, 0n); assert.equal(f.ledger().reportedRefundReserve, 22n); assert.equal(f.ledger().totalReserve, T);
      assert.equal(toHex(f.ledger().lineCommit), C); assert.equal(f.meta(note).refundAcknowledged, true); assertReserve(f);
      // Reporting the private amount retires the same full budget and cannot free spendable reserves.
      assert.equal((await f.execute({ name: "withdrawUnencumberedReserve", args: [479n] })).ok, false);
      const after = snapshot(f.ledger()); assert.equal((await f.reportRefund(note, paid, a.refundSalt)).ok, false); assert.deepEqual(snapshot(f.ledger()), after);
    });
  }

  it("rejects stale books, fabricated note openings and unauthorized compensation atomically", async () => {
    const f = await fixture(), note = await f.draw(); f.setTime(Number(DEADLINE)); const before = snapshot(f.ledger());
    for (const overrides of [{ lineOutstanding: 0n }, { salt: pad32("wrong-book") }, { noteSalt: pad32("wrong-note") },
      { noteIdentity: agentId(DEMO.merchantB) }, { quoteMerchantPk: merchantPublicKey(DEMO.merchantB) }, { callerSecret: DEMO.merchantA }]) {
      const rejected = await f.allocate(note, overrides); assert.equal(rejected.result.ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    }
    assert.equal((await f.allocate(note)).result.ok, true);
  });

  it("rejects all compensation modes before expiry and rejects unsupported action modes", async () => {
    const f = await fixture(), note = await f.draw(), before = snapshot(f.ledger());
    assert.equal((await f.expire(note)).ok, false); assert.equal((await f.allocate(note)).result.ok, false);
    assert.equal((await f.reportRefund(note, 1n, pad32("no-allocation"))).ok, false);
    for (const mode of [3n, 255n]) assert.equal((await f.execute({ name: "cancelOrExpireNote", args: [note.D, mode, RECEIPT] })).ok, false);
    assert.deepEqual(snapshot(f.ledger()), before);
  });

  it("refund acknowledgment requires the exact private commitment, original recipient, fresh deadline and issuer authority", async () => {
    const f = await fixture(), note = await f.draw(); assert.equal((await f.repay(7n)).ok, true); f.setTime(Number(DEADLINE)); const a = await f.allocate(note);
    assert.equal(a.result.ok, true); const before = snapshot(f.ledger());
    for (const [amount, salt, overrides] of [[6n, a.refundSalt, {}], [0n, a.refundSalt, {}], [23n, a.refundSalt, {}],
      [7n, pad32("wrong-refund"), {}], [7n, a.refundSalt, { noteIdentity: agentId(DEMO.merchantB) }],
      [7n, a.refundSalt, { callerSecret: DEMO.agent }], [7n, a.refundSalt, { paymentRef: new Uint8Array(32) }]] as const) {
      const r = await f.reportRefund(note, amount, salt, "bad-report", overrides); assert.equal(r.ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    }
    assert.equal((await f.reportRefund(note, 7n, a.refundSalt, "expired-report", {}, DEADLINE)).ok, false); assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.reportRefund(note, 7n, a.refundSalt)).ok, true);
  });

  it("one external reference cannot authorize both repayment and reported refund in either order", async () => {
    const f = await fixture(), note = await f.draw(); const reference = "rail:event:shared";
    assert.equal((await f.repay(7n, reference)).ok, true); f.setTime(Number(DEADLINE)); const a = await f.allocate(note); assert.equal(a.result.ok, true);
    const before = snapshot(f.ledger()); const duplicate = await f.reportRefund(note, 7n, a.refundSalt, reference);
    assert.equal(duplicate.ok, false); assert.match(duplicate.ok ? "" : duplicate.error, /payment used/); assert.deepEqual(snapshot(f.ledger()), before);
    const outgoing = "rail:event:outgoing"; assert.equal((await f.reportRefund(note, 7n, a.refundSalt, outgoing)).ok, true);
    await f.draw(10n, 200n); const after = snapshot(f.ledger()); const repay = await f.repay(1n, outgoing);
    assert.equal(repay.ok, false); assert.match(repay.ok ? "" : repay.error, /payment used/); assert.deepEqual(snapshot(f.ledger()), after);
  });

  it("old agent claims after identity replacement without new private books and never credits new-generation debt", async () => {
    const f = await fixture(), old = await f.draw(); assert.equal((await f.repay(22n)).ok, true);
    const newAgent = new Uint8Array(32).fill(91); await f.reopen(newAgent); await f.draw(30n, 200n); f.setTime(Number(DEADLINE));
    const C = toHex(f.ledger().lineCommit), outstanding = f.book().outstanding;
    const a = await f.allocate(old, { lineLimit: 0n, lineOutstanding: 0n, lineEpoch: 0n, salt: pad32("unknown-new-book"), agentSecret: DEMO.agent });
    assert.equal(a.result.ok, true, a.result.ok ? "" : a.result.error); assert.equal(a.refundAmount, 22n);
    assert.equal(toHex(f.ledger().lineCommit), C); assert.equal(f.book().outstanding, outstanding); assertBook(f, 32n);
    assert.equal(f.ledger().pendingFeeReserve, 2n); assert.equal(f.ledger().encumberedReserve, 30n); assert.equal(f.ledger().refundReserve, 22n);
    assert.equal((await f.reportRefund(old, 22n, a.refundSalt)).ok, true); assert.equal(toHex(f.ledger().lineCommit), C); assertReserve(f);
  });

  it("multiple cancellations conserve credits plus privately owed refunds and each full escrow budget", async () => {
    const f = await fixture(), a = await f.draw(20n), b = await f.draw(30n); assertBook(f, 54n);
    assert.equal((await f.repay(40n)).ok, true); assertBook(f, 14n); f.setTime(Number(DEADLINE));
    assert.equal((await f.expire(a)).ok, true); assert.equal((await f.expire(b)).ok, true); assert.equal(f.ledger().refundReserve, 54n);
    const ca = await f.allocate(a), cb = await f.allocate(b); assert.equal(ca.result.ok, true); assert.equal(cb.result.ok, true); assertBook(f, 0n);
    assert.equal(ca.refundAmount, 8n); assert.equal(cb.refundAmount, 32n); assert.equal(ca.refundAmount + cb.refundAmount, 40n);
    assert.equal(f.ledger().refundReserve, 54n); assert.equal(f.ledger().pendingFeeReserve, 0n); assert.equal(f.ledger().feeReserve, 0n);
    assert.equal((await f.reportRefund(a, 8n, ca.refundSalt)).ok, true); assert.equal((await f.reportRefund(b, 32n, cb.refundSalt)).ok, true);
    assert.equal(f.ledger().reportedRefundReserve, 54n); assert.equal(f.ledger().refundReserve, 0n); assertReserve(f);
  });

  it("credits only the cancelled cost while other purchase debt remains", async () => {
    const f = await fixture(), a = await f.draw(20n); await f.draw(30n); assertBook(f, 54n); f.setTime(Number(DEADLINE));
    const allocation = await f.allocate(a); assert.equal(allocation.result.ok, true); assert.equal(allocation.refundAmount, 0n); assertBook(f, 32n);
    assert.equal(f.ledger().refundReserve, 0n); assert.equal(f.ledger().encumberedReserve, 30n); assert.equal(f.ledger().pendingFeeReserve, 2n);
    assert.equal(f.meta(a).cashRefundOwed, false); assertReserve(f);
  });

  it("a fully repaid note can be allocated after zero-debt closure without reopening the facility", async () => {
    const f = await fixture(), note = await f.draw(); assert.equal((await f.repay(22n)).ok, true);
    assert.equal((await f.execute({ name: "setStatus", args: [Status.CLOSED] })).ok, true); f.setTime(Number(DEADLINE));
    const allocation = await f.allocate(note); assert.equal(allocation.result.ok, true, allocation.result.ok ? "" : allocation.result.error);
    assert.equal(allocation.refundAmount, 22n); assertBook(f, 0n); assert.equal(f.ledger().status, Status.CLOSED);
    assert.equal((await f.reportRefund(note, 22n, allocation.refundSalt)).ok, true); assert.equal(f.ledger().status, Status.CLOSED); assertReserve(f);
  });

  it("the same outgoing receipt cannot retire a second note's refund budget", async () => {
    const f = await fixture(), a = await f.draw(), b = await f.draw(); assert.equal((await f.repay(44n)).ok, true); f.setTime(Number(DEADLINE));
    const ca = await f.allocate(a), cb = await f.allocate(b); assert.equal(ca.result.ok, true); assert.equal(cb.result.ok, true);
    assert.equal((await f.reportRefund(a, 22n, ca.refundSalt, "rail:outgoing:one-event")).ok, true);
    const before = snapshot(f.ledger()); const replay = await f.reportRefund(b, 22n, cb.refundSalt, "rail:outgoing:one-event");
    assert.equal(replay.ok, false); assert.match(replay.ok ? "" : replay.error, /payment used/); assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.reportRefund(b, 22n, cb.refundSalt, "rail:outgoing:second-event")).ok, true); assertReserve(f);
  });

  it("compensation during default does not erase lifecycle status", async () => {
    const f = await fixture(), a = await f.draw(); assert.equal((await f.execute({ name: "setStatus", args: [Status.DEFAULTED] })).ok, true);
    f.setTime(Number(DEADLINE)); assert.equal((await f.allocate(a)).result.ok, true); assert.equal(f.ledger().status, Status.DEFAULTED); assertBook(f, 0n);
    assert.equal((await f.execute({ name: "setStatus", args: [Status.CLOSED] })).ok, true);
    assert.equal((await f.allocate(a)).result.ok, false); assert.equal(f.ledger().status, Status.CLOSED);
  });
});
