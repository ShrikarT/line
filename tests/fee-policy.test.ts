import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../src/test/fixtures/compact.ts";
import { blankPrivate, call, firstQuote, readLedger, Status, type CircuitCall, type PrivateState } from "../src/lib/line/compact-harness.ts";
import { agentId, lineStateCommit, merchantPublicKey, pad32, quoteCommit, toHex } from "../src/lib/line/encoding.ts";
import { DEMO } from "../src/test/fixtures/keys.ts";

const EXPIRY = 10_000n, U64_MAX = (1n << 64n) - 1n;
async function facility(flat: bigint, bps: bigint, amount = 40n, limit = 1_000n, reserve = 2_000n) {
  let session = await boot(DEMO.issuer, DEMO.merchantA, pad32("fee-policy-instance"));
  const ps = blankPrivate({ callerSecret: DEMO.issuer, agentSecret: DEMO.agent, salt: pad32("fee-policy-book"),
    newSalt: pad32("fee-policy-next"), lineLimit: limit, invoiceId: pad32("fee-policy-invoice"),
    quoteNonce: pad32("fee-policy-quote"), quoteMerchantPk: merchantPublicKey(DEMO.merchantA),
    quoteAmount: amount, drawAmount: amount, noteNonce: pad32("fee-policy-note"), noteSalt: pad32("fee-policy-note-salt") });
  const execute = async (op: CircuitCall, overrides: Partial<PrivateState> = {}) => {
    const result = await call(session, { ...ps, ...overrides }, op);
    if (result.ok) session = result.session;
    return result;
  };
  assert.equal((await execute({ name: "fundReserve", args: [reserve] })).ok, true);
  const opening = await execute({ name: "openLine", args: [EXPIRY, flat, bps] });
  return { opening, execute, ledger: () => readLedger(session), ps, quote: async () => {
    const quoted = await execute({ name: "postQuote", args: [EXPIRY] }, { callerSecret: DEMO.merchantA });
    assert.equal(quoted.ok, true, quoted.ok ? "" : quoted.error);
    return firstQuote(readLedger(session))!.Q;
  } };
}

function snapshot(l: ReturnType<typeof readLedger>) {
  return { C: toHex(l.lineCommit), status: l.status, generation: l.lineGeneration, clock: l.actionClock,
    flat: l.feeFlat, bps: l.feeBps, total: l.totalReserve, E: l.encumberedReserve, R: l.redeemedReserve,
    F: l.feeReserve, P: l.pendingFeeReserve, U: l.refundReserve, reported: l.reportedRefundReserve, nullifiers: l.nullifiers.size(), notes: l.notes.size(), quotes: [...l.quotes].map(([Q, m]) => [toHex(Q), m.used]) };
}

describe("generated Compact: issuer-approved fee policy", () => {
  for (const [label, amount, flat, bps, fee] of [
    ["zero policy", 40n, 0n, 0n, 0n], ["flat only", 40n, 5n, 0n, 5n],
    ["fraction rounds up", 1n, 0n, 1n, 1n], ["exact quotient stays exact", 100n, 2n, 100n, 3n],
    ["combined flat and rounded variable", 101n, 3n, 100n, 5n], ["maximum 100 percent rate", 40n, 2n, 10_000n, 42n],
  ] as const) {
    it(`enforces ${label} and commits principal plus the exact approved fee`, async () => {
      const f = await facility(flat, bps, amount); assert.equal(f.opening.ok, true);
      assert.equal(f.ledger().feeFlat, flat); assert.equal(f.ledger().feeBps, bps);
      const Q = await f.quote();
      const expectedQ = quoteCommit({ merchantPk: merchantPublicKey(DEMO.merchantA), invoiceId: f.ps.invoiceId,
        amount, expiry: EXPIRY, nonce: f.ps.quoteNonce, generation: 1n, domain: f.ledger().contractDomain, feeFlat: flat, feeBps: bps });
      assert.equal(toHex(Q), toHex(expectedQ));
      const drawn = await f.execute({ name: "draw", args: [Q, EXPIRY, fee] });
      assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error);
      assert.equal(f.ledger().pendingFeeReserve, fee); assert.equal(f.ledger().feeReserve, 0n); assert.equal(f.ledger().encumberedReserve, amount);
      const expectedC = lineStateCommit({ domain: f.ledger().contractDomain, identity: agentId(DEMO.agent), limit: 1_000n, outstanding: amount + fee, epoch: 1n }, f.ps.newSalt);
      assert.equal(toHex(f.ledger().lineCommit), toHex(expectedC));
    });
  }

  it("rejects both underpayment and overpayment without consuming capacity, reserve, quote or nullifiers", async () => {
    const f = await facility(3n, 100n, 101n); assert.equal(f.opening.ok, true); const Q = await f.quote();
    const before = snapshot(f.ledger());
    for (const fee of [0n, 2n, 3n, 4n, 6n, 1_000n]) {
      const rejected = await f.execute({ name: "draw", args: [Q, EXPIRY, fee] });
      assert.equal(rejected.ok, false); assert.match(rejected.ok ? "" : rejected.error, /fee policy/);
      assert.deepEqual(snapshot(f.ledger()), before);
    }
    assert.equal((await f.execute({ name: "draw", args: [Q, EXPIRY, 5n] })).ok, true);
  });

  it("uses wide exact multiplication for large Uint64 amounts without number rounding", async () => {
    const amount = 9_000_000_000_000_000_001n, bps = 1n, fee = 900_000_000_000_001n;
    const f = await facility(0n, bps, amount, U64_MAX, U64_MAX); assert.equal(f.opening.ok, true); const Q = await f.quote();
    const offByOne = await f.execute({ name: "draw", args: [Q, EXPIRY, fee - 1n] }); assert.equal(offByOne.ok, false);
    assert.match(offByOne.ok ? "" : offByOne.error, /fee policy/);
    const drawn = await f.execute({ name: "draw", args: [Q, EXPIRY, fee] }); assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error);
    assert.equal(f.ledger().pendingFeeReserve, fee); assert.equal(f.ledger().feeReserve, 0n); assert.equal(f.ledger().encumberedReserve, amount);
  });

  it("rejects a rate above 10000 basis points and out-of-range Uint64 policy inputs", async () => {
    for (const [flat, bps] of [[0n, 10_001n], [-1n, 0n], [U64_MAX + 1n, 0n], [0n, -1n], [0n, U64_MAX + 1n]]) {
      const f = await facility(flat, bps); assert.equal(f.opening.ok, false);
      assert.equal(f.ledger().status, Status.NONE); assert.equal(f.ledger().lineGeneration, 0n);
      assert.equal(f.ledger().feeFlat, 0n); assert.equal(f.ledger().feeBps, 0n);
      assert.equal(f.ledger().actionClock, 1n);
    }
  });

  it("only the issuer can authorize a policy when opening a line", async () => {
    const session = await boot(DEMO.issuer, DEMO.merchantA, pad32("unauthorized-policy"));
    const result = await call(session, blankPrivate({ callerSecret: DEMO.merchantA, agentSecret: DEMO.agent,
      lineLimit: 100n, salt: pad32("unauthorized-book") }), { name: "openLine", args: [EXPIRY, 2n, 500n] });
    assert.equal(result.ok, false); assert.match(result.ok ? "" : result.error, /not issuer/);
    assert.equal(result.ledger.feeFlat, 0n); assert.equal(result.ledger.feeBps, 0n); assert.equal(result.ledger.lineGeneration, 0n);
  });

  it("policy cannot change while active or defaulted; clean reopening binds a new generation and quote", async () => {
    const f = await facility(2n, 100n); assert.equal(f.opening.ok, true); const oldQ = await f.quote();
    const before = snapshot(f.ledger());
    const active = await f.execute({ name: "openLine", args: [EXPIRY, 0n, 0n] }); assert.equal(active.ok, false);
    assert.deepEqual(snapshot(f.ledger()), before);
    assert.equal((await f.execute({ name: "setStatus", args: [Status.DEFAULTED] })).ok, true);
    const defaulted = await f.execute({ name: "openLine", args: [EXPIRY, 0n, 0n] }); assert.equal(defaulted.ok, false);
    assert.equal(f.ledger().feeFlat, 2n); assert.equal(f.ledger().feeBps, 100n);
    assert.equal((await f.execute({ name: "setStatus", args: [Status.OPEN] })).ok, true);
    assert.equal((await f.execute({ name: "setStatus", args: [Status.CLOSED] })).ok, true);
    assert.equal((await f.execute({ name: "openLine", args: [EXPIRY, 4n, 200n] })).ok, true);
    assert.equal(f.ledger().feeFlat, 4n); assert.equal(f.ledger().feeBps, 200n); assert.equal(f.ledger().lineGeneration, 2n);
    const oldDraw = await f.execute({ name: "draw", args: [oldQ, EXPIRY, 3n] }); assert.equal(oldDraw.ok, false);
    assert.match(oldDraw.ok ? "" : oldDraw.error, /line generation mismatch/);
    const quoted = await f.execute({ name: "postQuote", args: [EXPIRY] }, { callerSecret: DEMO.merchantA });
    assert.equal(quoted.ok, true);
    const newQ = [...f.ledger().quotes].find(([Q]) => toHex(Q) !== toHex(oldQ))![0];
    assert.notEqual(toHex(newQ), toHex(oldQ));
    assert.equal((await f.execute({ name: "draw", args: [newQ, EXPIRY, 5n] })).ok, true);
  });
});
