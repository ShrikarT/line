import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../src/lib/line/compact-harness.ts";
import { blankPrivate, call, firstQuote, notesOf, readLedger, type CircuitCall, type PrivateState } from "../src/lib/line/compact-harness.ts";
import { agentId, pad32, merchantPublicKey, toHex } from "../src/lib/line/encoding.ts";
import { DEMO } from "../src/test/fixtures/keys.ts";

// The simulator supplies ledger execution time, never a caller-controlled witness.
const START = 1_800_000_000;
async function fixture(lineDeadline = START + 200, quoteDeadline = START + 100, initialTime = START) {
  let now = initialTime;
  let session = await boot(DEMO.issuer, DEMO.merchantA, pad32("expiry-regression"), undefined, () => now);
  const ps = blankPrivate({ callerSecret: DEMO.issuer, agentSecret: DEMO.agent, salt: pad32("expiry-book"),
    newSalt: pad32("expiry-next-book"), lineLimit: 100n, quoteAmount: 20n, drawAmount: 20n,
    invoiceId: pad32("expiry-invoice"), quoteNonce: pad32("expiry-quote"), quoteMerchantPk: merchantPublicKey(DEMO.merchantA),
    noteNonce: pad32("expiry-note"), noteSalt: pad32("expiry-note-salt"),
    repayAmount: 10n, receiptNonce: pad32("expiry-receipt"), paymentRef: pad32("expiry-payment") });
  const execute = async (op: CircuitCall, overrides: Partial<PrivateState> = {}) => {
    const result = await call(session, { ...ps, ...overrides }, op);
    if (result.ok) session = result.session;
    return result;
  };
  assert.equal((await execute({ name: "fundReserve", args: [500n] })).ok, true);
  assert.equal((await execute({ name: "openLine", args: [BigInt(lineDeadline), 1n, 0n] })).ok, true);
  assert.equal((await execute({ name: "postQuote", args: [BigInt(quoteDeadline)] }, { callerSecret: DEMO.merchantA })).ok, true);
  const Q = firstQuote(readLedger(session))!.Q;
  const draw = (expiry = quoteDeadline) => execute({ name: "draw", args: [Q, BigInt(expiry), 1n] });
  const redeem = (expiry = quoteDeadline) => execute({ name: "redeemDraw", args: [notesOf(readLedger(session))[0].D, BigInt(expiry)] },
    { callerSecret: DEMO.merchantA, noteIdentity: agentId(DEMO.agent), noteQuoteCommit: Q, redeemAmount: 20n });
  return { execute, draw, redeem, setTime: (value: number) => { now = value; }, ledger: () => readLedger(session),
    note: () => notesOf(readLedger(session))[0], deadline: quoteDeadline };
}

describe("generated Compact: absolute ledger-time expiry", () => {
  it("administrative traffic cannot expire an unexpired merchant claim", async () => {
    // Small absolute epoch seconds make the activity count exceed the actual
    // deadline number, so the former action-clock predicates would fail.
    const f = await fixture(20, 5, 0);
    assert.equal((await f.draw()).ok, true);
    for (let i = 0; i < 8; i++) assert.equal((await f.execute({ name: "fundReserve", args: [1n] })).ok, true);
    assert.ok(f.ledger().actionClock > 5n);
    const rejected = await f.execute({ name: "cancelOrExpireNote", args: [f.note().D] });
    assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /note not expired/);
    assert.equal(f.ledger().encumberedReserve, 20n);
    f.setTime(4);
    assert.equal((await f.redeem()).ok, true);
    assert.equal(f.ledger().encumberedReserve, 0n);
    assert.equal(f.ledger().redeemedReserve, 20n);
  });

  it("at the exact deadline redemption fails and permissionless expiry releases reserve once", async () => {
    const f = await fixture(); assert.equal((await f.draw()).ok, true);
    const C = toHex(f.ledger().lineCommit), clock = f.ledger().actionClock;
    f.setTime(f.deadline);
    const expired = await f.redeem(); assert.equal(expired.ok, false); assert.match(expired.ok ? "" : expired.error, /note expired/);
    assert.equal(f.ledger().actionClock, clock);
    const cancelled = await f.execute({ name: "cancelOrExpireNote", args: [f.note().D] }, { callerSecret: DEMO.merchantB });
    assert.equal(cancelled.ok, true, cancelled.ok ? "" : cancelled.error);
    assert.equal(f.note().cancelled, true); assert.equal(f.ledger().encumberedReserve, 0n);
    assert.equal(f.ledger().redeemedReserve, 0n); assert.equal(f.ledger().feeReserve, 0n);
    assert.equal(f.ledger().pendingFeeReserve, 0n); assert.equal(f.ledger().refundReserve, 21n);
    assert.equal(toHex(f.ledger().lineCommit), C); // Expiry does not silently forgive the private debt.
    const twice = await f.execute({ name: "cancelOrExpireNote", args: [f.note().D] });
    assert.equal(twice.ok, false); assert.match(twice.ok ? "" : twice.error, /already cancelled/);
    assert.equal((await f.redeem()).ok, false);
  });

  for (const [label, delta] of [["shortened", -1], ["extended", 1], ["already past", -101]] as const) {
    it(`rejects an agent's ${label} note deadline without consuming the quote`, async () => {
      const f = await fixture(); const C = toHex(f.ledger().lineCommit), clock = f.ledger().actionClock;
      const rejected = await f.draw(f.deadline + delta);
      assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /note expiry terms/);
      assert.equal(firstQuote(f.ledger())!.used, false); assert.equal(f.ledger().notes.size(), 0n);
      assert.equal(f.ledger().encumberedReserve, 0n); assert.equal(f.ledger().feeReserve, 0n);
      assert.equal(toHex(f.ledger().lineCommit), C); assert.equal(f.ledger().actionClock, clock);
      assert.equal((await f.draw()).ok, true);
    });
  }

  it("an expired credit line rejects a draw even when the merchant quote remains live", async () => {
    const f = await fixture(START + 10, START + 100); f.setTime(START + 10);
    const rejected = await f.draw(); assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /line expired/);
    assert.equal(firstQuote(f.ledger())!.used, false); assert.equal(f.ledger().encumberedReserve, 0n);
  });

  it("an expired quote rejects a draw while the credit line remains live", async () => {
    const f = await fixture(); f.setTime(f.deadline);
    const rejected = await f.draw(); assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /expired/);
    assert.equal(firstQuote(f.ledger())!.used, false); assert.equal(f.ledger().encumberedReserve, 0n);
  });

  it("repayment receipts reject their exact expiry and accept a future deadline with the same private book", async () => {
    const f = await fixture(); assert.equal((await f.draw()).ok, true); f.setTime(START + 50);
    const overrides = { lineOutstanding: 21n, lineEpoch: 1n, salt: pad32("expiry-next-book"), newSalt: pad32("expiry-repaid") };
    const C = toHex(f.ledger().lineCommit), nullifiers = f.ledger().nullifiers.size();
    const rejected = await f.execute({ name: "acknowledgeRepayment", args: [BigInt(START + 50)] }, overrides);
    assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /expiry/);
    assert.equal(toHex(f.ledger().lineCommit), C); assert.equal(f.ledger().nullifiers.size(), nullifiers);
    const accepted = await f.execute({ name: "acknowledgeRepayment", args: [BigInt(START + 51)] }, overrides);
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    assert.notEqual(toHex(f.ledger().lineCommit), C); assert.equal(f.ledger().nullifiers.size(), nullifiers + 2n);
  });

  it("opening and quote issuance both reject deadlines at or before ledger time", async () => {
    const f = await fixture();
    for (const deadline of [START - 1, START]) {
      const quoted = await f.execute({ name: "postQuote", args: [BigInt(deadline)] }, { callerSecret: DEMO.merchantA });
      assert.equal(quoted.ok, false); assert.match(quoted.ok ? "" : quoted.error, /expiry/);
      const session = await boot(DEMO.issuer, DEMO.merchantA, pad32("expired-open"), undefined, () => START);
      const opened = await call(session, blankPrivate({ callerSecret: DEMO.issuer, agentSecret: DEMO.agent,
        lineLimit: 100n, salt: pad32("expired-book") }), { name: "openLine", args: [BigInt(deadline)] });
      assert.equal(opened.ok, false); assert.match(opened.ok ? "" : opened.error, /expiry/);
      assert.equal(opened.ledger.lineGeneration, 0n);
    }
  });
});
