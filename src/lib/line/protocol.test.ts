import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
  available,
  cancelOrExpireNote,
  cloneLedger,
  createLedger,
  disableMerchant,
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
  publicLedgerView,
  quoteCommitment,
  redeemDraw,
  redeemNullifier,
  registerMerchant,
  repayNullifier,
  setStatus,
  withdrawFees,
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
  const r = openLine(
    funded.ledger,
    {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      salt: "salt-0",
      expiry: 10_000,
    },
    // The credit limit is a private witness, never a public parameter.
    { limit: LIMIT },
  );
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("open");
  return r;
}

function quote(ledger: Ledger, amount: number, invoiceId: string, nonce = invoiceId, merchant = MERCHANT_A_SK) {
  const r = postQuote(
    ledger,
    {
      caller: merchant,
      invoiceId,
      expiry: 10_000,
      nonce,
    },
    // The invoice amount is a private witness, never a public parameter.
    { amount },
  );
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
    // Audit H3: the ledger stores no merchantPk on quotes — merchant<->quote
    // linkage must be impossible from public state.
    assert.equal("merchantPk" in q, false);
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

  it("issuer disables a registered merchant: flag cleared, membership kept", () => {
    const o = opened();
    const mBPk = merchantPublicKey(MERCHANT_B_SK);
    const reg = registerMerchant(o.ledger, { caller: ISSUER_SK, merchantPk: mBPk });
    if (!reg.ok) throw new Error("reg");
    const r = disableMerchant(reg.ledger, { caller: ISSUER_SK, merchantPk: mBPk });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("disable");
    // Flag cleared (new quotes blocked) but the entry stays in the registry
    // (already-posted quotes remain drawable — the circuit's audit-L2 design).
    assert.equal(r.ledger.registeredMerchants[mBPk], false);
    assert.ok(mBPk in r.ledger.registeredMerchants);
  });

  it("non-issuer cannot disable a merchant", () => {
    const o = opened();
    const mAPk = merchantPublicKey(MERCHANT_A_SK);
    const r = disableMerchant(o.ledger, { caller: AGENT_SK, merchantPk: mAPk });
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTH_ISSUER");
    // Registry untouched on auth failure.
    assert.equal(o.ledger.registeredMerchants[mAPk], true);
  });

  it("disabling an unknown merchant fails", () => {
    const o = opened();
    const r = disableMerchant(o.ledger, {
      caller: ISSUER_SK,
      merchantPk: merchantPublicKey("unknown-merchant-secret"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "UNKNOWN_MERCHANT");
  });

  it("re-disabling a disabled merchant is idempotent", () => {
    const o = opened();
    const mAPk = merchantPublicKey(MERCHANT_A_SK);
    const first = disableMerchant(o.ledger, { caller: ISSUER_SK, merchantPk: mAPk });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("first");
    // The circuit has no "already disabled" assert — second disable succeeds.
    const second = disableMerchant(first.ledger, { caller: ISSUER_SK, merchantPk: mAPk });
    assert.equal(second.ok, true);
    if (!second.ok) throw new Error("second");
    assert.equal(second.ledger.registeredMerchants[mAPk], false);
  });

  it("disabling blocks NEW quotes from that merchant", () => {
    const o = opened();
    const mBPk = merchantPublicKey(MERCHANT_B_SK);
    const reg = registerMerchant(o.ledger, { caller: ISSUER_SK, merchantPk: mBPk });
    if (!reg.ok) throw new Error("reg");
    // Quote posted while enabled succeeds.
    const before = postQuote(
      reg.ledger,
      { caller: MERCHANT_B_SK, invoiceId: "inv-before", expiry: 10_000, nonce: "n1" },
      { amount: 10 },
    );
    assert.equal(before.ok, true);
    if (!before.ok) throw new Error("quote-before");
    const dis = disableMerchant(before.ledger, { caller: ISSUER_SK, merchantPk: mBPk });
    if (!dis.ok) throw new Error("disable");
    // Quote posted after disable is rejected (mirrors "merchant disabled").
    const after = postQuote(
      dis.ledger,
      { caller: MERCHANT_B_SK, invoiceId: "inv-after", expiry: 10_000, nonce: "n2" },
      { amount: 10 },
    );
    assert.equal(after.ok, false);
    assert.equal(after.code, "MERCHANT_DISABLED");
  });

  it("already-posted quotes from a disabled merchant stay drawable (membership-only check)", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40"); // Merchant A posts BEFORE disable.
    const dis = disableMerchant(q.ledger, {
      caller: ISSUER_SK,
      merchantPk: merchantPublicKey(MERCHANT_A_SK),
    });
    if (!dis.ok) throw new Error("disable");
    // draw checks registry MEMBERSHIP only, exactly as the circuit: the
    // already-posted quote remains drawable.
    const r = draw(
      dis.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.ledger.encumberedReserve, 40);
    assert.equal(r.ledger.notes.length, 1);
    assert.equal(r.note.D, r.ledger.notes[0]!.commitment);
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
    const r = openLine(
      createTestLedger(),
      {
        caller: "attacker",
        agentSecret: AGENT_SK,
        salt: "s",
        expiry: 10_000,
      },
      { limit: 150 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects a second open while live", () => {
    const first = opened();
    const r = openLine(
      first.ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "s2",
        expiry: 10_000,
      },
      { limit: 10 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects zero limit", () => {
    const r = openLine(
      createTestLedger(),
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "s",
        expiry: 10_000,
      },
      { limit: 0 },
    );
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
    const r = postQuote(
      o.ledger,
      { caller: "attacker", invoiceId: "inv-1", expiry: 10_000, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects zero-amount quotes", () => {
    const o = opened();
    const r = postQuote(
      o.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "inv-1", expiry: 10_000, nonce: "n" },
      { amount: 0 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects quote before line exists", () => {
    const r = postQuote(
      createTestLedger(),
      { caller: MERCHANT_A_SK, invoiceId: "inv-1", expiry: 10_000, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects quote when line is defaulted", () => {
    const o = opened();
    const def = setStatus(o.ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!def.ok) throw new Error("setStatus");
    const r = postQuote(
      def.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "inv-1", expiry: 10_000, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(r.ok, false);
  });

  it("rejects quote when line is closed", () => {
    const o = opened();
    const closed = setStatus(o.ledger, { caller: ISSUER_SK, status: "closed" });
    if (!closed.ok) throw new Error("setStatus");
    const r = postQuote(
      closed.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "inv-1", expiry: 10_000, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(r.ok, false);
  });
});

describe("reference engine: draw and note creation", () => {
  it("clears a 40-unit invoice, rotates C, and creates a merchant-bound draw note", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
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
    const r = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);
    assert.equal(q.ledger.encumberedReserve, 0);
  });

  it("rejects draw when reserve is insufficient", () => {
    const ledger = createTestLedger();
    const f = fundReserve(ledger, { caller: ISSUER_SK, amount: 30 });
    if (!f.ok) throw new Error("fund");
    const o = openLine(
      f.ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "s0",
        expiry: 10_000,
      },
      { limit: 150 },
    );
    if (!o.ok) throw new Error("open");
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "s1",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "RESERVE_CAPACITY");
  });

  it("rejects replay of the same quote / nullifier", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const first = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("draw 1");
    const second = draw(
      first.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-2",
      },
      { books: first.agent.witness!, quote: q.quote },
    );
    assert.equal(second.ok, false);
  });

  it("rejects a stale line-state commitment", () => {
    const o = opened();
    const q1 = quote(o.ledger, 20, "inv-20");
    const first = draw(
      q1.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q1.Q,
        newSalt: "salt-1",
      },
      { books: o.agent.witness!, quote: q1.quote },
    );
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("first");

    const q2 = quote(first.ledger, 20, "inv-20-b");
    const secondStale = draw(
      q2.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q2.Q,
        newSalt: "salt-2",
      },
      { books: o.agent.witness!, quote: q2.quote },
    );
    assert.equal(secondStale.ok, false);
  });

  it("rejects the wrong agent", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const r = draw(
      q.ledger,
      {
        agentSecret: "attacker",
        quoteCommit: q.Q,
        newSalt: "salt-1",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);
  });
});

describe("reference engine: merchant redemption", () => {
  it("designated Merchant A redeems note successfully; reserve accounting updates", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    if (!d.ok) throw new Error("draw");
    assert.equal(d.ledger.encumberedReserve, 40);

    const r = redeemDraw(
      d.ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry,
        noteSalt: d.note.salt,
      },
      { note: d.note.preimage },
    );
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("redeem");
    assert.equal(r.ledger.encumberedReserve, 0);
    assert.equal(r.ledger.redeemedReserve, 40);
  });

  it("Merchant B cannot redeem Merchant A's note (role separation)", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    if (!d.ok) throw new Error("draw");

    const r = redeemDraw(
      d.ledger,
      {
        caller: MERCHANT_B_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry,
        noteSalt: d.note.salt,
      },
      { note: d.note.preimage },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOTE_AUTH");
  });

  it("double redemption fails", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    if (!d.ok) throw new Error("draw");

    const r1 = redeemDraw(
      d.ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry,
        noteSalt: d.note.salt,
      },
      { note: d.note.preimage },
    );
    assert.equal(r1.ok, true);
    if (!r1.ok) throw new Error("redeem 1");

    const r2 = redeemDraw(
      r1.ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry,
        noteSalt: d.note.salt,
      },
      { note: d.note.preimage },
    );
    assert.equal(r2.ok, false);
    assert.equal(r2.code, "NOTE_USED");
  });
});

describe("reference engine: note cancellation / expiry", () => {
  it("unexpired note cannot be cancelled", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
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
    const d1 = draw(
      q1.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q1.Q,
        newSalt: "salt-1",
      },
      { books: o.agent.witness!, quote: q1.quote },
    );
    if (!d1.ok) throw new Error("d1");

    const qOver = quote(d1.ledger, 120, "inv-120");
    const drawOver = draw(
      qOver.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: qOver.Q,
        newSalt: "salt-2",
      },
      { books: d1.agent.witness!, quote: qOver.quote },
    );
    assert.equal(drawOver.ok, false); // 40 + 120 > 150

    const rcpt = receipt(d1.agent.witness!, d1.ledger.lineCommitment!, 40, "r1", d1.ledger.contractDomain);
    const ack = acknowledgeRepayment(
      drawOver.ok ? d1.ledger : qOver.ledger,
      {
        caller: ISSUER_SK,
        newSalt: "salt-repay-1",
        receiptExpiry: rcpt.expiry,
      },
      { books: d1.agent.witness!, receipt: rcpt },
    );
    assert.equal(ack.ok, true);
    if (!ack.ok) throw new Error("ack");
    assert.equal(ack.witness.B, 0);

    const qFresh = quote(ack.ledger, 120, "inv-120-fresh");
    const d2 = draw(
      qFresh.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: qFresh.Q,
        newSalt: "salt-3",
      },
      { books: ack.witness, quote: qFresh.quote },
    );
    assert.equal(d2.ok, true);
  });
});

describe("reference engine: setStatus", () => {
  it("defaulted lines reject draws", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const def = setStatus(q.ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!def.ok) throw new Error("setStatus");
    const r = draw(
      def.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "s",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
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
    const r = draw(
      cl.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "s",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);

    const o2 = openLine(
      cl.ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "s2",
        expiry: 10_000,
      },
      { limit: 200 },
    );
    assert.equal(o2.ok, true);
    if (!o2.ok) throw new Error("open2");
    assert.equal(o2.ledger.lineGeneration, 2);
  });

  it("quote from generation 1 cannot be drawn on generation 2", () => {
    const o1 = opened();
    const q1 = quote(o1.ledger, 40, "inv-gen1");
    const cl = setStatus(q1.ledger, { caller: ISSUER_SK, status: "closed" });
    if (!cl.ok) throw new Error("close");
    const o2 = openLine(
      cl.ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "s2",
        expiry: 10_000,
      },
      { limit: 150 },
    );
    if (!o2.ok) throw new Error("open2");

    const r = draw(
      o2.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q1.Q,
        newSalt: "s3",
      },
      { books: o2.agent.witness!, quote: q1.quote },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE_GEN");
  });
});

describe("reference engine: issuer fees (FEE_SPEC)", () => {
  function drawWithFee(fee: number, amount = 40) {
    const o = opened();
    const q = quote(o.ledger, amount, `fee-inv-${fee}-${amount}`);
    return {
      o,
      r: draw(
        q.ledger,
        {
          agentSecret: AGENT_SK,
          quoteCommit: q.Q,
          newSalt: "fee-salt",
          fee,
        },
        { books: o.agent.witness!, quote: q.quote },
      ),
    };
  }

  it("fee charges outstanding by amount+fee; encumbers amount; accrues feeReserve", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.agent.witness!.B, 45); // outstanding = amount + fee
    assert.equal(r.ledger.encumberedReserve, 40); // note encumbers amount only
    assert.equal(r.ledger.feeReserve, 5); // fee accrues to the issuer
    assert.equal(r.note.preimage.amount, 40); // settlement note is for amount, not amount+fee
  });

  it("zero fee behaves exactly like the pre-fee draw", () => {
    const { r } = drawWithFee(0);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.agent.witness!.B, 40);
    assert.equal(r.ledger.encumberedReserve, 40);
    assert.equal(r.ledger.feeReserve, 0);
  });

  it("fee counts toward the credit limit: B + amount + fee <= L", () => {
    // B=0, L=150: amount 140 + fee 20 = 160 > 150 must fail CAPACITY
    const { r } = drawWithFee(20, 140);
    assert.equal(r.ok, false);
    assert.equal(r.code, "CAPACITY");
    // ...but amount 140 + fee 10 = 150 == L passes
    const { r: r2 } = drawWithFee(10, 140);
    assert.equal(r2.ok, true);
  });

  it("fee counts toward reserve solvency: amount + fee <= unencumberedReserve", () => {
    // Big line (L=2000) but thin reserve (1000): 990 + 20 = 1010 passes
    // capacity yet exceeds unencumbered reserve -> RESERVE_CAPACITY.
    let ledger = createLedger({
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    const funded = fundReserve(ledger, { caller: ISSUER_SK, amount: 1000 });
    if (!funded.ok) throw new Error("fund");
    const openedBig = openLine(
      funded.ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "fee-solv-s0",
        expiry: 10_000,
      },
      { limit: 2000 },
    );
    if (!openedBig.ok) throw new Error("open");
    const q = quote(openedBig.ledger, 990, "fee-solv");
    const r = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "fee-solv-s",
        fee: 20,
      },
      { books: openedBig.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "RESERVE_CAPACITY");
  });

  it("issuer withdraws accrued fees: feeReserve zeroes, totalReserve shrinks", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    const w = withdrawFees(r.ledger, { caller: ISSUER_SK });
    assert.equal(w.ok, true);
    if (!w.ok) throw new Error("withdrawFees");
    assert.equal(w.fees, 5);
    assert.equal(w.ledger.feeReserve, 0);
    assert.equal(w.ledger.totalReserve, 995); // 1000 - 5
    assert.equal(w.ledger.encumberedReserve, 40); // notes untouched
  });

  it("withdrawFees is issuer-only", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    const w = withdrawFees(r.ledger, { caller: AGENT_SK });
    assert.equal(w.ok, false);
    assert.equal(w.code, "AUTH_ISSUER");
  });

  it("withdrawFees with no accrued fees is rejected", () => {
    const o = opened();
    const w = withdrawFees(o.ledger, { caller: ISSUER_SK });
    assert.equal(w.ok, false);
    assert.equal(w.code, "NO_FEES");
  });

  it("withdrawUnencumberedReserve locks accrued fees (only withdrawFees releases them)", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    // total 1000, encumbered 40, feeReserve 5 -> withdrawable = 955
    const w = withdrawUnencumberedReserve(r.ledger, { caller: ISSUER_SK, amount: 956 });
    assert.equal(w.ok, false);
    assert.equal(w.code, "RESERVE_WITHDRAW");
    const w2 = withdrawUnencumberedReserve(r.ledger, { caller: ISSUER_SK, amount: 955 });
    assert.equal(w2.ok, true);
    if (!w2.ok) throw new Error("withdraw");
    assert.equal(w2.ledger.feeReserve, 5); // fees stay locked
    assert.equal(w2.ledger.totalReserve, 45); // 1000 - 955
  });
});

describe("reference engine: witness privacy boundary (H1/H2/H3 mirror)", () => {
  function drawn40() {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    const d = draw(
      q.ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(d.ok, true);
    if (!d.ok) throw new Error("draw");
    return { o, q, d };
  }

  it("draw with a tampered witness amount fails quote reconstruction", () => {
    const { o, q } = drawn40();
    // The drawAmount() witness no longer matches the amount Q commits to.
    const tampered = { ...q.quote, amount: 39 };
    const r = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "salt-1" },
      { books: o.agent.witness!, quote: tampered },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE");
  });

  it("draw with the wrong witness merchantPk fails quote reconstruction (unlinkability)", () => {
    const { o, q } = drawn40();
    // The ledger stores no merchantPk for the quote; the agent must supply the
    // correct quoteMerchantPk() witness. A wrong one cannot open Q.
    const tampered = { ...q.quote, merchantCommitment: merchantPublicKey(MERCHANT_B_SK) };
    const r = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "salt-1" },
      { books: o.agent.witness!, quote: tampered },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE");
  });

  it("draw fails QUOTE_AUTH when the witness merchant leaves the allowlist", () => {
    const { o, q } = drawn40();
    // The witness still opens Q, but the merchant is no longer a registry
    // member — mirrors the circuit's `registeredMerchants.member(pubM)` assert.
    const ledger = cloneLedger(q.ledger);
    delete ledger.registeredMerchants[merchantPublicKey(MERCHANT_A_SK)];
    const r = draw(
      ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "salt-1" },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUOTE_AUTH");
  });

  it("a disabled merchant's already-posted quote stays drawable (membership, not enabled)", () => {
    const { o, q } = drawn40();
    // Audit L2: disabling blocks NEW quotes at postQuote; the draw circuit
    // checks membership only, so quotes posted while active stay valid.
    const ledger = cloneLedger(q.ledger);
    ledger.registeredMerchants[merchantPublicKey(MERCHANT_A_SK)] = false;
    const r = draw(
      ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q.Q,
        newSalt: "salt-1",
        noteNonce: "nn-x",
        noteSalt: "ns-x",
      },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(r.ok, true);
  });

  it("draw uses the public quote meta, not the witness's expiry/generation copies", () => {
    const { o, q } = drawn40();
    // The merchant's recorded expiry/generation copies are advisory: the
    // circuit recomputes Q from the witness (merchantPk/invoiceId/amount/nonce)
    // plus the PUBLIC meta, so corrupting the copies does not break the draw.
    const skewed = { ...q.quote, expiry: 999_999, generation: 999 };
    const r = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "salt-1" },
      { books: o.agent.witness!, quote: skewed },
    );
    assert.equal(r.ok, true);
  });

  it("publicLedgerView exposes no L, B, per-quote amounts, or merchant<->quote linkage", () => {
    const { d } = drawn40();
    const view = publicLedgerView(d.ledger);
    assert.equal("limit" in view, false);
    assert.equal("outstanding" in view, false);
    assert.equal("balance" in view, false);
    assert.equal(view.quotes.length, 1);
    const mPk = merchantPublicKey(MERCHANT_A_SK);
    for (const qq of view.quotes) {
      assert.equal("merchantPk" in qq, false);
      assert.equal("amount" in qq, false);
      assert.equal("invoiceId" in qq, false);
      // Quote entries are opaque: no merchantPk in the key or the meta.
      assert.ok(!JSON.stringify(qq).includes(mPk));
    }
    for (const nn of view.notes) {
      assert.ok(!JSON.stringify(nn).includes(mPk));
    }
    for (const n of view.nullifiers) {
      assert.ok(!n.includes(mPk));
    }
    // Public BY DESIGN (mirrors the compact negative-privacy scoping): the
    // registered-merchant allowlist stays visible — unlinkability is about
    // quote/note linkage, not registry membership.
    assert.equal(view.registeredMerchants[mPk], true);
    // ...and settled note amounts ARE public escrow accounting (honest boundary).
    assert.equal(view.notes[0]!.amount, 40);
    assert.equal(view.encumberedReserve, 40);
    assert.equal(view.actionClock, d.ledger.actionClock);
  });

  it("redeemDraw with the wrong public noteExpiry fails note opening", () => {
    const { d } = drawn40();
    // The circuit builds the note preimage with the PUBLIC noteExpiry param;
    // a wrong one cannot open D.
    const r = redeemDraw(
      d.ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry + 1,
        noteSalt: d.note.salt,
      },
      { note: d.note.preimage },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOTE_OPENING");
  });

  it("redeemDraw with a tampered witness amount fails against public escrow accounting", () => {
    const { d } = drawn40();
    // Honest boundary: NoteMeta.amount is public; the redeemAmount() witness
    // must equal it ("amount mismatch").
    const tampered = { ...d.note.preimage, amount: 39 };
    const r = redeemDraw(
      d.ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: d.note.D,
        noteExpiry: d.note.preimage.expiry,
        noteSalt: d.note.salt,
      },
      { note: tampered },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, "AMOUNT");
  });

  it("acknowledgeRepayment enforces the PUBLIC receiptExpiry parameter", () => {
    const { d } = drawn40();
    const rcpt = receipt(d.agent.witness!, d.ledger.lineCommitment!, 40, "r1", d.ledger.contractDomain);
    const bad = acknowledgeRepayment(
      d.ledger,
      {
        caller: ISSUER_SK,
        newSalt: "salt-repay-1",
        receiptExpiry: d.ledger.actionClock, // not > actionClock
      },
      { books: d.agent.witness!, receipt: rcpt },
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "EXPIRY");
    const ok = acknowledgeRepayment(
      d.ledger,
      {
        caller: ISSUER_SK,
        newSalt: "salt-repay-1",
        receiptExpiry: rcpt.expiry,
      },
      { books: d.agent.witness!, receipt: rcpt },
    );
    assert.equal(ok.ok, true);
  });

  it("openLine and postQuote reject expiry = clock+1 (headroom-2, audit L3)", () => {
    const ledger = createLedger({
      issuerSecret: ISSUER_SK,
      merchantSecret: MERCHANT_A_SK,
      instanceNonce: INSTANCE_NONCE,
    });
    // Fresh ledger: clock is 0, so expiry = 1 is clock+1 and must fail.
    const badOpen = openLine(
      ledger,
      { caller: ISSUER_SK, agentSecret: AGENT_SK, salt: "s", expiry: 1 },
      { limit: 150 },
    );
    assert.equal(badOpen.ok, false);
    assert.equal(badOpen.code, "EXPIRY");
    const okOpen = openLine(
      ledger,
      { caller: ISSUER_SK, agentSecret: AGENT_SK, salt: "s", expiry: 2 },
      { limit: 150 },
    );
    assert.equal(okOpen.ok, true);

    // After fund + open the clock is 2: quote expiry = 3 is clock+1.
    const o = opened();
    assert.equal(o.ledger.actionClock, 2);
    const badQuote = postQuote(
      o.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "i", expiry: 3, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(badQuote.ok, false);
    assert.equal(badQuote.code, "EXPIRY");
    const okQuote = postQuote(
      o.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "i", expiry: 4, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(okQuote.ok, true);
  });

  it("draw rejects noteExpiry = clock+1 (headroom-2, audit L3)", () => {
    const o = opened();
    const q = quote(o.ledger, 40, "inv-40");
    assert.equal(q.ledger.actionClock, 3);
    const bad = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "s", noteExpiry: 4 },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(bad.ok, false);
    assert.equal(bad.code, "NOTE_EXPIRED");
    const ok = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "s", noteExpiry: 5 },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(ok.ok, true);
  });
});
