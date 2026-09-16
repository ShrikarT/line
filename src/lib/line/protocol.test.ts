import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
  available,
  cancelOrExpireNote,
  createLedger,
  draw,
  drawNoteCommitment,
  drawNullifier,
  fundReserve,
  identityCommitment,
  lineCommitment,
  merchantCommitment,
  merchantPublicKey,
  openLine,
  postQuote,
  quoteCommitment,
  redeemDraw,
  redeemNullifier,
  registerMerchant,
  repayNullifier,
  setStatus,
  withdrawUnencumberedReserve,
} from "./protocol.ts";
import type { Ledger, LineWitness, QuotePreimage, RepayReceipt } from "./types.ts";
import { AGENT_SK, INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_SK, MERCHANT_B_SK } from "../../test/fixtures/keys.ts";

const LIMIT = 150;
const createTestLedger = () => createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_A_SK, instanceNonce: INSTANCE_NONCE });

function opened() {
  const ledger = createTestLedger();
  const funded = fundReserve(ledger, { caller: ISSUER_SK, amount: 1000 });
  assert.equal(funded.ok, true);
  if (!funded.ok) throw new Error("fund");
  const r = openLine(funded.ledger, {
    caller: ISSUER_SK,
    agentSecret: AGENT_SK,
    limit: LIMIT,
    salt: "salt-0",
    expiry: 10_000,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("open");
  return r;
}

function quote(ledger: Ledger, amount: number, invoiceId: string, nonce = invoiceId, merchant = MERCHANT_A_SK) {
  const r = postQuote(ledger, {
    caller: merchant,
    amount,
    invoiceId,
    expiry: 10_000,
    nonce,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("quote");
  return r;
}

function receipt(w: LineWitness, C: string, amount: number, nonce: string, domain: string): RepayReceipt {
  return {
    identity: w.I,
    currentC: C,
    amount,
    paymentRef: `pay-${nonce}`,
    nonce,
    expiry: 10_000,
    contractDomain: domain,
  };
}

function publicHasNoBooks(ledger: Ledger) {
  assert.equal("limit" in ledger, false);
  assert.equal("outstanding" in ledger, false);
  assert.equal("balance" in ledger, false);
  for (const q of ledger.quotes) {
    assert.equal("amount" in q, false);
    assert.equal("invoiceId" in q, false);
  }
}

describe("reference engine: merchant registry", () => {
  it("issuer registers Merchant B", () => {
    const o = opened();
    const mBPk = merchantPublicKey(MERCHANT_B_SK);
    const r = registerMerchant(o.ledger, { caller: ISSUER_SK, merchantPk: mBPk });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("reg");
    assert.equal(r.ledger.registeredMerchants[mBPk], true);
  });

  it("non-issuer cannot register merchant", () => {
    const o = opened();
    const mBPk = merchantPublicKey(MERCHANT_B_SK);
    const r = registerMerchant(o.ledger, { caller: AGENT_SK, merchantPk: mBPk });
    assert.equal(r.ok, false);
  });
});

describe("reference engine: reserve accounting", () => {
  it("fund increases totalReserve", () => {
    const ledger = createTestLedger();
    const r = fundReserve(ledger, { caller: ISSUER_SK, amount: 500 });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("fund");
    assert.equal(r.ledger.totalReserve, 500);
  });

  it("non-issuer cannot fund reserve", () => {
    const ledger = createTestLedger();
    const r = fundReserve(ledger, { caller: AGENT_SK, amount: 500 });
    assert.equal(r.ok, false);
  });

  it("withdraws unencumbered reserve", () => {
    const ledger = createTestLedger();
    const f = fundReserve(ledger, { caller: ISSUER_SK, amount: 500 });
    if (!f.ok) throw new Error("fund");
    const w = withdrawUnencumberedReserve(f.ledger, { caller: ISSUER_SK, amount: 200 });
    assert.equal(w.ok, true);
    if (!w.ok) throw new Error("withdraw");
    assert.equal(w.ledger.totalReserve, 300);
  });

  it("cannot withdraw more than unencumbered reserve", () => {
    const ledger = createTestLedger();
    const f = fundReserve(ledger, { caller: ISSUER_SK, amount: 100 });
    if (!f.ok) throw new Error("fund");
    const w = withdrawUnencumberedReserve(f.ledger, { caller: ISSUER_SK, amount: 150 });
    assert.equal(w.ok, false);
  });
});

describe("reference engine: openLine", () => {
  it("opens with a commitment and zero balance; limit is not a ledger field", () => {
    const r = opened();
    assert.equal(r.ledger.status, "open");
    assert.ok(r.ledger.lineCommitment);
    assert.equal(r.agent.witness?.B, 0);
    assert.equal(r.agent.witness?.L, 150);
    assert.equal(r.ledger.lineCommitment, lineCommitment(r.agent.witness!));
    publicHasNoBooks(r.ledger);
  });

  it("rejects a forged issuer", () => {
    const r = openLine(createTestLedger(), {
      caller: "attacker",
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "s",
      expiry: 10_000,
    });
    assert.equal(r.ok, false);
  });

  it("rejects a second open while live", () => {
    const first = opened();
    const r = openLine(first.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 10,
      salt: "s2",
      expiry: 10_000,
    });
    assert.equal(r.ok, false);
  });

  it("rejects zero limit", () => {
    const r = openLine(createTestLedger(), {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 0,
      salt: "s",
      expiry: 10_000,
    });
    assert.equal(r.ok, false);
  });
});

describe("reference engine: postQuote", () => {
  it("stores only an opaque commitment", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    assert.equal(q.ledger.quotes.length, 1);
    publicHasNoBooks(q.ledger);
  });

  it("rejects an unauthorized merchant", () => {
    const o = opened();
    const r = postQuote(o.ledger, {
      caller: "attacker",
      amount: 40,
      invoiceId: "inv-1",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });

  it("rejects zero-amount quotes", () => {
    const o = opened();
    const r = postQuote(o.ledger, {
      caller: MERCHANT_A_SK,
      amount: 0,
      invoiceId: "inv-1",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });

  it("rejects quote before line exists", () => {
    const r = postQuote(createTestLedger(), {
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-1",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });

  it("rejects quote when line is defaulted", () => {
    const o = opened();
    const def = setStatus(o.ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!def.ok) throw new Error("setStatus");
    const r = postQuote(def.ledger, {
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-1",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });

  it("rejects quote when line is closed", () => {
    const o = opened();
    const closed = setStatus(o.ledger, { caller: ISSUER_SK, status: "closed" });
    if (!closed.ok) throw new Error("setStatus");
    const r = postQuote(closed.ledger, {
      caller: MERCHANT_A_SK,
      amount: 40,
      invoiceId: "inv-1",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });
});

describe("reference engine: draw and note creation", () => {
  it("clears a 40-unit invoice, rotates C, and creates a merchant-bound draw note", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.agent.witness?.B, 40);
    assert.equal(available(r.agent.witness!), 110);
    assert.notEqual(r.ledger.lineCommitment, o.ledger.lineCommitment);
    assert.equal(r.ledger.encumberedReserve, 40);
    assert.equal(r.ledger.notes.length, 1);
    assert.equal(r.note.D, r.ledger.notes[0]!.commitment);
    publicHasNoBooks(r.ledger);
  });

  it("rejects over-limit draws without mutating state", () => {
    const o = opened();
    const q = quote(o.ledger, 160, "inv-160");
    const r = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
    });
    assert.equal(r.ok, false);
    assert.equal(q.ledger.encumberedReserve, 0);
  });

  it("rejects draw when reserve is insufficient", () => {
    const ledger = createTestLedger();
    const f = fundReserve(ledger, { caller: ISSUER_SK, amount: 30 });
    if (!f.ok) throw new Error("fund");
    const o = openLine(f.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "s0",
      expiry: 10_000,
    });
    if (!o.ok) throw new Error("open");
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s1",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "RESERVE_CAPACITY");
  });

  it("rejects replay of the same quote / nullifier", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const first = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("draw 1");
    const second = draw(first.ledger, {
      agentSecret: AGENT_SK,
      witness: first.agent.witness!,
      quote: q.quote,
      newSalt: "salt-2",
    });
    assert.equal(second.ok, false);
  });

  it("rejects a stale line-state commitment", () => {
    const o = opened();
    const q1 = quote(o.ledger, 20, "inv-20");
    const first = draw(q1.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q1.quote,
      newSalt: "salt-1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("first");

    const q2 = quote(first.ledger, 20, "inv-20-b");
    const secondStale = draw(q2.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!, // stale witness!
      quote: q2.quote,
      newSalt: "salt-2",
    });
    assert.equal(secondStale.ok, false);
  });

  it("rejects the wrong agent", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(q.ledger, {
      agentSecret: "attacker",
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
    });
    assert.equal(r.ok, false);
  });
});

describe("reference engine: merchant redemption", () => {
  it("designated Merchant A redeems note successfully; reserve accounting updates", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    if (!d.ok) throw new Error("draw");
    assert.equal(d.ledger.encumberedReserve, 40);

    const r = redeemDraw(d.ledger, {
      caller: MERCHANT_A_SK,
      noteCommitment: d.note.D,
      notePreimage: d.note.preimage,
      noteSalt: d.note.salt,
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("redeem");
    assert.equal(r.ledger.encumberedReserve, 0);
    assert.equal(r.ledger.redeemedReserve, 40);
  });

  it("Merchant B cannot redeem Merchant A's note (role separation)", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    if (!d.ok) throw new Error("draw");

    const r = redeemDraw(d.ledger, {
      caller: MERCHANT_B_SK,
      noteCommitment: d.note.D,
      notePreimage: d.note.preimage,
      noteSalt: d.note.salt,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOTE_AUTH");
  });

  it("double redemption fails", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    if (!d.ok) throw new Error("draw");

    const r1 = redeemDraw(d.ledger, {
      caller: MERCHANT_A_SK,
      noteCommitment: d.note.D,
      notePreimage: d.note.preimage,
      noteSalt: d.note.salt,
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) throw new Error("redeem 1");

    const r2 = redeemDraw(r1.ledger, {
      caller: MERCHANT_A_SK,
      noteCommitment: d.note.D,
      notePreimage: d.note.preimage,
      noteSalt: d.note.salt,
    });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, "NOTE_USED");
  });
});

describe("reference engine: note cancellation / expiry", () => {
  it("unexpired note cannot be cancelled", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
      noteNonce: "nn-40",
      noteSalt: "ns-40",
    });
    if (!d.ok) throw new Error("draw");
    const r = cancelOrExpireNote(d.ledger, { noteCommitment: d.note.D });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOTE_NOT_EXPIRED");
  });
});

describe("reference engine: acknowledgeRepayment", () => {
  it("issuer ack restores capacity so a 120-draw can succeed", () => {
    const o = opened();
    const q1 = quote(o.ledger, 40, "inv-40");
    const d1 = draw(q1.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q1.quote,
      newSalt: "salt-1",
    });
    if (!d1.ok) throw new Error("d1");

    const qOver = quote(d1.ledger, 120, "inv-120");
    const drawOver = draw(qOver.ledger, {
      agentSecret: AGENT_SK,
      witness: d1.agent.witness!,
      quote: qOver.quote,
      newSalt: "salt-2",
    });
    assert.equal(drawOver.ok, false); // 40 + 120 > 150

    const rcpt = receipt(d1.agent.witness!, d1.ledger.lineCommitment!, 40, "r1", d1.ledger.contractDomain);
    const ack = acknowledgeRepayment(drawOver.ok ? d1.ledger : qOver.ledger, {
      caller: ISSUER_SK,
      witness: d1.agent.witness!,
      receipt: rcpt,
      newSalt: "salt-repay-1",
    });
    assert.equal(ack.ok, true);
    if (!ack.ok) throw new Error("ack");
    assert.equal(ack.witness.B, 0);

    const qFresh = quote(ack.ledger, 120, "inv-120-fresh");
    const d2 = draw(qFresh.ledger, {
      agentSecret: AGENT_SK,
      witness: ack.witness,
      quote: qFresh.quote,
      newSalt: "salt-3",
    });
    assert.equal(d2.ok, true);
  });
});

describe("reference engine: setStatus", () => {
  it("defaulted lines reject draws", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const def = setStatus(q.ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!def.ok) throw new Error("setStatus");
    const r = draw(def.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s",
    });
    assert.equal(r.ok, false);
  });

  it("unauthorized caller cannot change status", () => {
    const o = opened();
    const r = setStatus(o.ledger, { caller: AGENT_SK, status: "defaulted" });
    assert.equal(r.ok, false);
  });
});

describe("reference engine: expiry, closed, and generations", () => {
  it("closed lines reject draws; new line can open after closed", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const cl = setStatus(q.ledger, { caller: ISSUER_SK, status: "closed" });
    if (!cl.ok) throw new Error("close");
    const r = draw(cl.ledger, {
      agentSecret: AGENT_SK,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s",
    });
    assert.equal(r.ok, false);

    const o2 = openLine(cl.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 200,
      salt: "s2",
      expiry: 10_000,
    });
    assert.equal(o2.ok, true);
    if (!o2.ok) throw new Error("open2");
    assert.equal(o2.ledger.lineGeneration, 2);
  });

  it("quote from generation 1 cannot be drawn on generation 2", () => {
    const o1 = opened();
    const q1 = quote(o1.ledger, 40, "inv-gen1");
    const cl = setStatus(q1.ledger, { caller: ISSUER_SK, status: "closed" });
    if (!cl.ok) throw new Error("close");
    const o2 = openLine(cl.ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "s2",
      expiry: 10_000,
    });
    if (!o2.ok) throw new Error("open2");

    const r = draw(o2.ledger, {
      agentSecret: AGENT_SK,
      witness: o2.agent.witness!,
      quote: q1.quote,
      newSalt: "s3",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE_GEN");
  });
});
