import { boot } from "../src/test/fixtures/compact.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompactTypeBytes, CompactTypeVector, persistentHash } from "@midnight-ntwrk/compact-runtime";
import { blankPrivate, call, readLedger, Status, type CircuitCall } from "../src/lib/line/compact-harness.ts";
import { agentId, canonicalPaymentReferenceBytes, issuerPublicKey, merchantPublicKey, pad32, paymentNullifier, repayNullifier, quoteCommit, toHex } from "../src/lib/line/encoding.ts";
import { acknowledgeRepayment, createLedger, draw, fundReserve, openLine, postQuote } from "../src/lib/line/protocol.ts";
import type { Ledger, LineWitness } from "../src/lib/line/types.ts";
import { DEMO } from "../src/test/fixtures/keys.ts";

const expiry = 10_000n;
const reference = pad32("bank-transfer-17");

/** Actual generated Compact execution; the helper retains witness openings only. */
async function facility(instance = "payment-instance") {
  let session = await boot(DEMO.issuer, DEMO.merchantA, pad32(instance));
  let secret = DEMO.agent, salt = pad32("initial"), balance = 0n, epoch = 0n, sequence = 0;
  const limit = 200n;
  const witnesses = () => blankPrivate({ callerSecret: DEMO.issuer, agentSecret: secret, salt,
    lineLimit: limit, lineOutstanding: balance, lineEpoch: epoch, quoteMerchantPk: merchantPublicKey(DEMO.merchantA) });
  async function execute(op: CircuitCall, overrides: Partial<ReturnType<typeof blankPrivate>> = {}) {
    const result = await call(session, { ...witnesses(), ...overrides }, op);
    if (result.ok) session = result.session;
    return result;
  }
  const funded = await execute({ name: "fundReserve", args: [1_000n] }); assert.equal(funded.ok, true);
  const opened = await execute({ name: "openLine", args: [expiry] }); assert.equal(opened.ok, true);
  return {
    ledger: () => readLedger(session),
    async purchase(amount: bigint) {
      const n = ++sequence, invoice = pad32(`invoice-${n}`), nonce = pad32(`quote-${n}`);
      const quoted = await execute({ name: "postQuote", args: [expiry] }, { callerSecret: DEMO.merchantA, invoiceId: invoice, quoteNonce: nonce, quoteAmount: amount });
      assert.equal(quoted.ok, true, quoted.ok ? "" : quoted.error);
      const ledger = readLedger(session);
      const Q = quoteCommit({ merchantPk: merchantPublicKey(DEMO.merchantA), invoiceId: invoice, nonce, amount,
        expiry, generation: ledger.lineGeneration, domain: ledger.contractDomain });
      const newSalt = pad32(`purchase-salt-${n}`);
      const drawn = await execute({ name: "draw", args: [Q, expiry, 0n] }, { invoiceId: invoice, quoteNonce: nonce,
        drawAmount: amount, newSalt, noteNonce: pad32(`note-${n}`), noteSalt: pad32(`note-salt-${n}`) });
      assert.equal(drawn.ok, true, drawn.ok ? "" : drawn.error);
      if (drawn.ok) { balance += amount; epoch += 1n; salt = newSalt; }
    },
    async acknowledge(amount: bigint, payment = reference, nonce = "receipt-1", caller = DEMO.issuer) {
      const newSalt = pad32(`repay-salt-${++sequence}`);
      const before = readLedger(session), beforeCommitment = toHex(before.lineCommit), beforeClock = before.actionClock;
      const result = await execute({ name: "acknowledgeRepayment", args: [expiry] }, {
        callerSecret: caller, newSalt, repayAmount: amount, paymentRef: payment, receiptNonce: pad32(nonce) });
      if (result.ok) { balance -= amount; epoch += 1n; salt = newSalt; }
      else { assert.equal(toHex(readLedger(session).lineCommit), beforeCommitment); assert.equal(readLedger(session).actionClock, beforeClock); }
      return result;
    },
    async reopen(newSecret: Uint8Array = DEMO.agent) {
      const closed = await execute({ name: "setStatus", args: [Status.CLOSED] });
      assert.equal(closed.ok, true, closed.ok ? "" : closed.error);
      secret = newSecret; salt = pad32(`reopen-salt-${++sequence}`); epoch = 0n; balance = 0n;
      const openedAgain = await execute({ name: "openLine", args: [expiry] });
      assert.equal(openedAgain.ok, true, openedAgain.ok ? "" : openedAgain.error);
    },
  };
}

describe("stable payment identity in actual generated Compact", () => {
  it("stores both independent payment and receipt nullifiers", async () => {
    const f = await facility(); await f.purchase(80n);
    const before = f.ledger(), C = before.lineCommit, I = agentId(DEMO.agent);
    const paid = await f.acknowledge(20n); assert.equal(paid.ok, true);
    const paymentN = paymentNullifier(DEMO.issuer, reference, before.contractDomain);
    const receiptN = repayNullifier({ nonce: pad32("receipt-1"), identity: I, currentC: C,
      amount: 20n, paymentRef: reference, domain: before.contractDomain });
    assert.equal(f.ledger().nullifiers.member(paymentN), true);
    assert.equal(f.ledger().nullifiers.member(receiptN), true);
    assert.notEqual(toHex(paymentN), toHex(receiptN));
    assert.equal([...f.ledger().nullifiers].length, 3); // One draw, two repayment nullifiers.
  });

  for (const variant of [{ amount: 20n, nonce: "receipt-1" }, { amount: 20n, nonce: "another-receipt" }, { amount: 5n, nonce: "smaller-allocation" }]) {
    it(`rejects reused reference on updated books, amount ${variant.amount}, nonce ${variant.nonce}`, async () => {
      const f = await facility(); await f.purchase(80n);
      const paid = await f.acknowledge(20n); assert.equal(paid.ok, true);
      const replay = await f.acknowledge(variant.amount, reference, variant.nonce);
      assert.equal(replay.ok, false); if (!replay.ok) assert.match(replay.error, /payment used/);
    });
  }

  it("rejects after another draw and distinct repayment while fresh payments succeed", async () => {
    const f = await facility(); await f.purchase(80n); assert.equal((await f.acknowledge(20n)).ok, true);
    await f.purchase(15n); assert.equal((await f.acknowledge(10n, pad32("independent-payment"), "other")).ok, true);
    const replay = await f.acknowledge(5n, reference, "third");
    assert.equal(replay.ok, false); if (!replay.ok) assert.match(replay.error, /payment used/);
  });

  for (const replacement of [false, true]) {
    it(`rejects after zero-debt close/reopen${replacement ? " and replacement agent" : ""}`, async () => {
      const f = await facility(); await f.purchase(80n); assert.equal((await f.acknowledge(80n)).ok, true);
      await f.reopen(replacement ? pad32("different-agent") : DEMO.agent);
      assert.equal(f.ledger().lineGeneration, 2n); await f.purchase(30n);
      const replay = await f.acknowledge(10n, reference, "new-generation");
      assert.equal(replay.ok, false); if (!replay.ok) assert.match(replay.error, /payment used/);
    });
  }

  it("separate contract domains independently consume the same reference", async () => {
    const a = await facility("payment-domain-a"), b = await facility("payment-domain-b");
    await a.purchase(40n); await b.purchase(40n);
    assert.equal((await a.acknowledge(20n)).ok, true); assert.equal((await b.acknowledge(20n)).ok, true);
    const aN = paymentNullifier(DEMO.issuer, reference, a.ledger().contractDomain), bN = paymentNullifier(DEMO.issuer, reference, b.ledger().contractDomain);
    assert.notEqual(toHex(aN), toHex(bN));
    assert.equal(a.ledger().nullifiers.member(aN), true); assert.equal(b.ledger().nullifiers.member(bN), true);
  });

  it("unauthorized acknowledgement cannot consume a payment identity", async () => {
    const f = await facility(); await f.purchase(80n);
    const rejected = await f.acknowledge(20n, reference, "forged", DEMO.agent);
    assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(rejected.error, /not issuer/);
    assert.equal(f.ledger().nullifiers.member(paymentNullifier(DEMO.issuer, reference, f.ledger().contractDomain)), false);
    assert.equal((await f.acknowledge(20n)).ok, true);
  });
});

describe("stable payment encoding and reference model", () => {
  it("encodes exact secret-keyed Vector4 and is not computable with public issuer key", () => {
    const domain = pad32("payment-domain"), vec4 = new CompactTypeVector(4, new CompactTypeBytes(32));
    const expected = persistentHash(vec4, [pad32("line:v3:payment"), DEMO.issuer, reference, domain]);
    assert.deepEqual(paymentNullifier(DEMO.issuer, reference, domain), expected);
    const publicGuess = persistentHash(vec4, [pad32("line:v3:payment"), issuerPublicKey(DEMO.issuer), reference, domain]);
    assert.notEqual(toHex(publicGuess), toHex(expected)); // Not a claim that fixture secrets are secure.
  });

  it("model rejects changed amount/nonce/current C and later draws with one payment reference", () => {
    const issuer = toHex(DEMO.issuer), agent = toHex(DEMO.agent), merchant = toHex(DEMO.merchantA);
    let ledger: Ledger = createLedger({ clock: () => 0, issuerSecret: issuer, merchantSecret: merchant, instanceNonce: toHex(pad32("model-payment")) });
    const funding = fundReserve(ledger, { caller: issuer, amount: 1_000 }); assert.equal(funding.ok, true); if (!funding.ok) throw new Error("fund");
    const opening = openLine(funding.ledger, { caller: issuer, agentSecret: agent, salt: "model-initial", expiry: Number(expiry) }, { limit: 200 });
    assert.equal(opening.ok, true); if (!opening.ok || !opening.agent.witness) throw new Error("open");
    ledger = opening.ledger; let books: LineWitness = opening.agent.witness;
    let step = 0;
    function purchase(amount: number) {
      const q = postQuote(ledger, { caller: merchant, invoiceId: `model-invoice-${++step}`, nonce: `model-nonce-${step}`, expiry: Number(expiry) }, { amount });
      assert.equal(q.ok, true); if (!q.ok) throw new Error("quote");
      const d = draw(q.ledger, { agentSecret: agent, quoteCommit: q.Q, newSalt: `model-draw-${step}`, noteNonce: `model-note-${step}`, noteSalt: `model-note-salt-${step}`, noteExpiry: Number(expiry) }, { books, quote: q.quote });
      assert.equal(d.ok, true); if (!d.ok || !d.agent.witness) throw new Error("draw"); ledger = d.ledger; books = d.agent.witness;
    }
    function acknowledge(amount: number, payRef: string, nonce: string) {
      return acknowledgeRepayment(ledger, { caller: issuer, newSalt: `model-pay-${++step}`, receiptExpiry: Number(expiry) }, {
        books, receipt: { identity: books.I, currentC: ledger.lineCommitment!, amount, paymentRef: payRef,
          nonce, expiry: Number(expiry), contractDomain: ledger.contractDomain } });
    }
    purchase(80);
    const paid = acknowledge(20, "same-payment", "first"); assert.equal(paid.ok, true); if (!paid.ok) throw new Error("pay"); ledger = paid.ledger; books = paid.witness;
    for (const [amount, nonce] of [[20, "first"], [20, "second"], [5, "partial"]] as const) {
      const replay = acknowledge(amount, "same-payment", nonce); assert.equal(replay.ok, false); if (!replay.ok) assert.equal(replay.code, "RECEIPT_USED");
    }
    purchase(10);
    const later = acknowledge(10, "same-payment", "after-draw"); assert.equal(later.ok, false); if (!later.ok) assert.equal(later.code, "RECEIPT_USED");
    assert.equal(acknowledge(10, "distinct-payment", "fresh").ok, true);
  });

  it("normalizes one long external ID identically for the model and generated contract", async () => {
    const raw = "bank:network:asset:transfer:" + "event-東京-".repeat(12);
    const f = await facility("normalized-payment"); await f.purchase(80n);
    const result = await f.acknowledge(20n, canonicalPaymentReferenceBytes(raw)); assert.equal(result.ok, true);
    const expected = toHex(paymentNullifier(DEMO.issuer, canonicalPaymentReferenceBytes(raw), f.ledger().contractDomain));
    assert.equal([...f.ledger().nullifiers].map(toHex).includes(expected), true);
    const issuer = toHex(DEMO.issuer), agent = toHex(DEMO.agent), merchant = toHex(DEMO.merchantA);
    const genesis = createLedger({ clock: () => 0, issuerSecret: issuer, merchantSecret: merchant, instanceNonce: toHex(pad32("normalized-payment")) });
    assert.equal(genesis.contractDomain, toHex(f.ledger().contractDomain));
    const funded = fundReserve(genesis, { caller: issuer, amount: 1_000 }); if (!funded.ok) throw new Error("fund");
    const opened = openLine(funded.ledger, { caller: issuer, agentSecret: agent, salt: "initial", expiry: Number(expiry) }, { limit: 200 });
    if (!opened.ok || !opened.agent.witness) throw new Error("open");
    const q = postQuote(opened.ledger, { caller: merchant, invoiceId: "normalized-invoice", nonce: "normalized-quote", expiry: Number(expiry) }, { amount: 80 });
    if (!q.ok) throw new Error("quote");
    const d = draw(q.ledger, { agentSecret: agent, quoteCommit: q.Q, newSalt: "normalized-draw", noteExpiry: Number(expiry) }, { books: opened.agent.witness, quote: q.quote });
    if (!d.ok || !d.agent.witness) throw new Error("draw");
    const paid = acknowledgeRepayment(d.ledger, { caller: issuer, newSalt: "normalized-repay", receiptExpiry: Number(expiry) }, { books: d.agent.witness,
      receipt: { identity: d.agent.witness.I, currentC: d.ledger.lineCommitment!, amount: 20, paymentRef: raw, nonce: "receipt",
        expiry: Number(expiry), contractDomain: d.ledger.contractDomain } });
    assert.equal(paid.ok, true); if (!paid.ok) throw new Error("ack");
    assert.equal(paid.ledger.nullifiers.includes(expected), true);
    const replay = await f.acknowledge(5n, canonicalPaymentReferenceBytes(raw), "changed-long-receipt");
    assert.equal(replay.ok, false); if (!replay.ok) assert.match(replay.error, /payment used/);
  });
});
