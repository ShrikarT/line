import { boot } from "../src/test/fixtures/compact.ts";
import { it } from "node:test";
import assert from "node:assert/strict";
import { blankPrivate, call, firstQuote, notesOf, readLedger, Status } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, merchantPublicKey, pad32, toHex } from "../src/lib/line/encoding.ts";

it("authenticated zero-debt closure prevents debt erasure and preserves prior merchant claims across a clean reopening", async () => {
  const issuer = new Uint8Array(32).fill(81), merchant = new Uint8Array(32).fill(82), agent = new Uint8Array(32).fill(83);
  let session = await boot(issuer, merchant, new Uint8Array(32).fill(84));
  let privateState = blankPrivate({ callerSecret: issuer, agentSecret: agent, salt: pad32("opening"), newSalt: pad32("draw-opening"),
    lineLimit: 100n, invoiceId: pad32("closing-invoice"), quoteNonce: pad32("closing-quote"), quoteMerchantPk: merchantPublicKey(merchant),
    quoteAmount: 20n, drawAmount: 20n, noteNonce: pad32("closing-note"), noteSalt: pad32("closing-note-salt") });
  const execute = async (name: Parameters<typeof call>[2]["name"], args: any[], overrides: Partial<typeof privateState> = {}) => {
    const result = await call(session, { ...privateState, ...overrides }, { name, args } as Parameters<typeof call>[2]);
    if (result.ok) session = result.session;
    return result;
  };
  assert.equal((await execute("fundReserve", [500n])).ok, true);
  assert.equal((await execute("openLine", [10000n, 1n, 0n])).ok, true);
  assert.equal((await execute("postQuote", [10000n], { callerSecret: merchant })).ok, true);
  const Q = firstQuote(readLedger(session))!.Q;
  assert.equal((await execute("draw", [Q, 10000n, 1n])).ok, true);
  privateState = { ...privateState, salt: pad32("draw-opening"), lineOutstanding: 21n, lineEpoch: 1n };
  const before = readLedger(session), C = toHex(before.lineCommit), generation = before.lineGeneration, clock = before.actionClock;
  const indebted = await execute("setStatus", [Status.CLOSED]);
  assert.equal(indebted.ok, false); assert.match(indebted.ok ? "" : indebted.error, /outstanding debt/);
  const forged = await execute("setStatus", [Status.CLOSED], { lineOutstanding: 0n });
  assert.equal(forged.ok, false); assert.match(forged.ok ? "" : forged.error, /stale closing book/);
  const stranger = await execute("setStatus", [Status.CLOSED], { callerSecret: merchant });
  assert.equal(stranger.ok, false); assert.match(stranger.ok ? "" : stranger.error, /not issuer/);
  assert.equal(toHex(readLedger(session).lineCommit), C);
  assert.equal(readLedger(session).actionClock, clock);
  assert.equal(readLedger(session).lineGeneration, generation);
  assert.equal((await execute("setStatus", [Status.DEFAULTED])).ok, true);
  assert.equal((await execute("setStatus", [Status.OPEN])).ok, true);
  assert.equal(toHex(readLedger(session).lineCommit), C);
  assert.equal(readLedger(session).lineGeneration, generation);
  assert.equal((await execute("acknowledgeRepayment", [10000n], { newSalt: pad32("repaid-opening"), repayAmount: 21n,
    receiptNonce: pad32("closing-receipt"), paymentRef: canonicalPaymentReferenceBytes("rail:event:closing-payment") })).ok, true);
  privateState = { ...privateState, salt: pad32("repaid-opening"), lineOutstanding: 0n, lineEpoch: 2n };
  assert.equal((await execute("setStatus", [Status.CLOSED])).ok, true);
  assert.equal(readLedger(session).encumberedReserve, 20n);
  assert.equal(readLedger(session).pendingFeeReserve, 1n);
  assert.equal(readLedger(session).feeReserve, 0n);
  assert.equal((await execute("openLine", [10000n], { lineLimit: 200n, salt: pad32("reopened") })).ok, true);
  assert.equal(readLedger(session).lineGeneration, generation + 1n);
  const D = notesOf(readLedger(session))[0].D;
  assert.equal((await execute("redeemDraw", [D, 10000n], { callerSecret: merchant, noteIdentity: agentId(agent),
    noteQuoteCommit: Q, redeemAmount: 20n })).ok, true);
  assert.equal(readLedger(session).encumberedReserve, 0n);
  assert.equal(readLedger(session).redeemedReserve, 20n);
});
