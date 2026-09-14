import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
  available,
  createLedger,
  draw,
  drawNullifier,
  identityCommitment,
  lineCommitment,
  merchantCommitment,
  openLine,
  postQuote,
  quoteCommitment,
  repayNullifier,
  setStatus,
} from "./protocol.ts";
import type { Ledger, LineWitness, QuotePreimage, RepayReceipt } from "./types.ts";
import { CONTRACT_ID } from "./types.ts";

const ISSUER = "issuer-demo-key";
const MERCHANT = "merchant-demo-key";
const AGENT = "agent-demo-key";
const LIMIT = 150;

function opened() {
  const ledger = createLedger();
  const r = openLine(ledger, {
    caller: ISSUER,
    agentSecret: AGENT,
    limit: LIMIT,
    salt: "salt-0",
    expiry: 10_000,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("open");
  return r;
}

function quote(ledger: Ledger, amount: number, invoiceId: string, nonce = invoiceId) {
  const r = postQuote(ledger, {
    caller: MERCHANT,
    amount,
    invoiceId,
    expiry: 10_000,
    nonce,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("quote");
  return r;
}

function receipt(w: LineWitness, C: string, amount: number, nonce: string): RepayReceipt {
  return {
    identity: w.I,
    currentC: C,
    amount,
    paymentRef: `pay-${nonce}`,
    nonce,
    expiry: 10_000,
    contractId: CONTRACT_ID,
  };
}

describe("openLine", () => {
  it("opens with a commitment and zero balance, limit not on ledger", () => {
    const r = opened();
    assert.equal(r.ledger.status, "open");
    assert.ok(r.ledger.lineCommitment);
    assert.equal(r.agent.witness?.B, 0);
    assert.equal(r.agent.witness?.L, 150);
    assert.equal(r.ledger.lineCommitment, lineCommitment(r.agent.witness!));
    const blob = JSON.stringify(r.ledger);
    assert.equal(blob.includes("150"), false);
  });

  it("rejects a forged issuer", () => {
    const r = openLine(createLedger(), {
      caller: "attacker",
      agentSecret: AGENT,
      limit: 150,
      salt: "s",
      expiry: 10_000,
    });
    assert.equal(r.ok, false);
  });

  it("rejects a second open while live", () => {
    const first = opened();
    const r = openLine(first.ledger, {
      caller: ISSUER,
      agentSecret: AGENT,
      limit: 10,
      salt: "s2",
      expiry: 10_000,
    });
    assert.equal(r.ok, false);
  });
});

describe("postQuote", () => {
  it("stores only an opaque commitment", () => {
    const { ledger } = opened();
    const q = quote(ledger, 40, "inv-40");
    assert.ok(q.ledger.quotes[0]?.commitment);
    const blob = JSON.stringify(q.ledger);
    assert.equal(blob.includes("inv-40"), false);
    assert.equal(blob.includes(":40"), false);
  });

  it("rejects an unauthorized merchant", () => {
    const { ledger } = opened();
    const r = postQuote(ledger, {
      caller: "not-merchant",
      amount: 40,
      invoiceId: "x",
      expiry: 10_000,
      nonce: "n",
    });
    assert.equal(r.ok, false);
  });

  it("rejects zero-amount quotes", () => {
    const { ledger } = opened();
    const r = postQuote(ledger, {
      caller: MERCHANT,
      amount: 0,
      invoiceId: "z",
      expiry: 10_000,
      nonce: "z",
    });
    assert.equal(r.ok, false);
  });
});

describe("draw", () => {
  it("clears a 40-unit invoice and rotates C", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.agent.witness?.B, 40);
    assert.equal(available(r.agent.witness!), 110);
    assert.notEqual(r.ledger.lineCommitment, o.ledger.lineCommitment);
  });

  it("rejects over-limit draws without mutating state", () => {
    const o = opened();
    const q = quote(o.ledger, 151, "inv-151");
    const before = q.ledger.lineCommitment;
    const r = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-x",
    });
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("expected fail");
    assert.equal(r.message, "Clearance could not be proven.");
    assert.equal(q.ledger.lineCommitment, before);
    assert.equal(q.ledger.quotes[0]?.used, false);
  });

  it("rejects replay of the same quote / nullifier", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r1 = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "salt-1",
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) throw new Error("d1");
    const r2 = draw(r1.ledger, {
      agentSecret: AGENT,
      witness: r1.agent.witness!,
      quote: q.quote,
      newSalt: "salt-2",
    });
    assert.equal(r2.ok, false);
  });

  it("rejects a stale line-state commitment (concurrent double-draw)", () => {
    const o = opened();
    const q1 = quote(o.ledger, 40, "a");
    const q2 = quote(q1.ledger, 40, "b");
    const d1 = draw(q2.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q1.quote,
      newSalt: "s1",
    });
    assert.equal(d1.ok, true);
    if (!d1.ok) throw new Error("d1");
    const d2 = draw(d1.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!, // old witness / old C
      quote: q2.quote,
      newSalt: "s2",
    });
    assert.equal(d2.ok, false);
    if (d2.ok) throw new Error("expected stale");
    assert.match(d2.reason, /stale/i);
  });

  it("only one of two proofs against the same C can apply", () => {
    const o = opened();
    const q1 = quote(o.ledger, 100, "a");
    const q2 = quote(q1.ledger, 100, "b");
    const proofA = draw(q2.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q1.quote,
      newSalt: "s1",
    });
    const proofB = draw(q2.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q2.quote,
      newSalt: "s2",
    });
    assert.equal(proofA.ok, true);
    assert.equal(proofB.ok, true);
    if (!proofA.ok || !proofB.ok) throw new Error("proofs");
    const includeBAfterA = draw(proofA.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q2.quote,
      newSalt: "s2",
    });
    assert.equal(includeBAfterA.ok, false);
  });

  it("rejects the wrong agent", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(q.ledger, {
      agentSecret: "other-agent",
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "x",
    });
    assert.equal(r.ok, false);
  });

  it("rejects a tampered amount", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const tampered: QuotePreimage = { ...q.quote, amount: 1 };
    const r = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: tampered,
      newSalt: "x",
    });
    assert.equal(r.ok, false);
  });

  it("rejects a quote bound to another merchant commitment", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const foreign: QuotePreimage = {
      ...q.quote,
      merchantCommitment: merchantCommitment("other-shop"),
    };
    const r = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: foreign,
      newSalt: "x",
    });
    assert.equal(r.ok, false);
  });
});

describe("acknowledgeRepayment", () => {
  it("rejects fake repayments without issuer authorization", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s1",
    });
    assert.equal(d.ok, true);
    if (!d.ok) throw new Error("d");
    const r = acknowledgeRepayment(d.ledger, {
      caller: AGENT,
      witness: d.agent.witness!,
      receipt: receipt(d.agent.witness!, d.ledger.lineCommitment!, 40, "r1"),
      newSalt: "s2",
    });
    assert.equal(r.ok, false);
  });

  it("issuer ack restores capacity so a 120-draw can succeed", () => {
    const o = opened();
    const q40 = quote(o.ledger, 40, "inv-40");
    const d40 = draw(q40.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q40.quote,
      newSalt: "s1",
    });
    assert.equal(d40.ok, true);
    if (!d40.ok) throw new Error("d40");

    const q120failLedger = quote(d40.ledger, 120, "inv-120");
    const fail120 = draw(q120failLedger.ledger, {
      agentSecret: AGENT,
      witness: d40.agent.witness!,
      quote: q120failLedger.quote,
      newSalt: "s-fail",
    });
    assert.equal(fail120.ok, false);

    const ack = acknowledgeRepayment(q120failLedger.ledger, {
      caller: ISSUER,
      witness: d40.agent.witness!,
      receipt: receipt(d40.agent.witness!, d40.ledger.lineCommitment!, 40, "r1"),
      newSalt: "s2",
    });
    assert.equal(ack.ok, true);
    if (!ack.ok) throw new Error("ack");
    assert.equal(ack.witness.B, 0);

    const q120 = quote(ack.ledger, 120, "inv-120-b");
    const d120 = draw(q120.ledger, {
      agentSecret: AGENT,
      witness: ack.witness,
      quote: q120.quote,
      newSalt: "s3",
    });
    assert.equal(d120.ok, true);
  });

  it("rejects a receipt for another line identity", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s1",
    });
    if (!d.ok) throw new Error("d");
    const bad: RepayReceipt = {
      ...receipt(d.agent.witness!, d.ledger.lineCommitment!, 40, "r1"),
      identity: identityCommitment("someone-else"),
    };
    const r = acknowledgeRepayment(d.ledger, {
      caller: ISSUER,
      witness: d.agent.witness!,
      receipt: bad,
      newSalt: "s2",
    });
    assert.equal(r.ok, false);
  });

  it("rejects a reused repayment receipt", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "s1",
    });
    if (!d.ok) throw new Error("d");
    const rec = receipt(d.agent.witness!, d.ledger.lineCommitment!, 40, "r1");
    const ack1 = acknowledgeRepayment(d.ledger, {
      caller: ISSUER,
      witness: d.agent.witness!,
      receipt: rec,
      newSalt: "s2",
    });
    assert.equal(ack1.ok, true);
    if (!ack1.ok) throw new Error("ack1");
    const q2 = quote(ack1.ledger, 40, "inv-40b");
    const d2 = draw(q2.ledger, {
      agentSecret: AGENT,
      witness: ack1.witness,
      quote: q2.quote,
      newSalt: "s3",
    });
    if (!d2.ok) throw new Error("d2");
    const r = acknowledgeRepayment(d2.ledger, {
      caller: ISSUER,
      witness: d2.agent.witness!,
      receipt: rec,
      newSalt: "s4",
    });
    assert.equal(r.ok, false);
  });
});

describe("setStatus", () => {
  it("defaulted lines reject draws", () => {
    const o = opened();
    const s = setStatus(o.ledger, { caller: ISSUER, status: "defaulted" });
    assert.equal(s.ok, true);
    if (!s.ok) throw new Error("s");
    const q = quote(s.ledger, 40, "inv-40");
    const d = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "x",
    });
    assert.equal(d.ok, false);
  });
});

describe("nullifier domains", () => {
  it("draw and repay nullifiers do not collide on similar inputs", () => {
    const I = identityCommitment(AGENT);
    const Q = quoteCommitment({
      merchantCommitment: merchantCommitment(MERCHANT),
      amount: 1,
      invoiceId: "same",
      expiry: 1,
      nonce: "same",
    });
    const a = drawNullifier(AGENT, Q);
    const b = repayNullifier("same", I);
    assert.notEqual(a, b);
  });
});

describe("expiry, closed, overflow, zero", () => {
  it("rejects an expired quote", () => {
    const o = opened();
    const q = postQuote(o.ledger, {
      caller: MERCHANT,
      amount: 10,
      invoiceId: "old",
      expiry: o.ledger.clock + 1,
      nonce: "old",
    });
    assert.equal(q.ok, true);
    if (!q.ok) throw new Error("q");
    // clock advanced on postQuote; expiry == clock now or past
    const r = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "x",
    });
    assert.equal(r.ok, false);
  });

  it("closed lines reject draws; a new epoch can open after closed", () => {
    const o = opened();
    const closed = setStatus(o.ledger, { caller: ISSUER, status: "closed" });
    assert.equal(closed.ok, true);
    if (!closed.ok) throw new Error("c");
    const q = quote(closed.ledger, 10, "z");
    const d = draw(q.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q.quote,
      newSalt: "x",
    });
    assert.equal(d.ok, false);
    const reopen = openLine(closed.ledger, {
      caller: ISSUER,
      agentSecret: AGENT,
      limit: 80,
      salt: "new-epoch",
      expiry: 10_000,
    });
    assert.equal(reopen.ok, true);
  });

  it("rejects overflow draws", () => {
    const o = openLine(createLedger(), {
      caller: ISSUER,
      agentSecret: AGENT,
      limit: Number.MAX_SAFE_INTEGER,
      salt: "s",
      expiry: 10_000,
    });
    assert.equal(o.ok, true);
    if (!o.ok) throw new Error("o");
    const q1 = quote(o.ledger, 1, "one");
    const d1 = draw(q1.ledger, {
      agentSecret: AGENT,
      witness: o.agent.witness!,
      quote: q1.quote,
      newSalt: "s1",
    });
    assert.equal(d1.ok, true);
    if (!d1.ok) throw new Error("d1");
    const q2 = quote(d1.ledger, Number.MAX_SAFE_INTEGER, "huge");
    const d2 = draw(q2.ledger, {
      agentSecret: AGENT,
      witness: d1.agent.witness!,
      quote: q2.quote,
      newSalt: "s2",
    });
    assert.equal(d2.ok, false);
  });
});
