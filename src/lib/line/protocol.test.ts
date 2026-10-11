import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acknowledgeRepayment,
  asBytes32,
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
import { requiredDrawFee, canonicalPaymentReferenceBytes, paymentNullifier, toHex } from "./encoding.ts";
import { FEE_POLICY, validateQuoteTransferPackage, validateMerchantQuoteRecord, validateAgentLineRecord, validateDrawNoteTransferPackage, validateDrawNoteRecord, validateRefundRecord, type QuoteTransferPackage } from "./types.ts";
import { AGENT_SK, INSTANCE_NONCE, ISSUER_SK, MERCHANT_A_SK, MERCHANT_B_SK } from "../../test/fixtures/keys.ts";

const LIMIT = 150;
const createTestLedger = (clock: () => number = () => 0) => createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_A_SK, instanceNonce: INSTANCE_NONCE, clock });

function opened(clock?: () => number, feePolicy: { feeFlat?: number; feeBps?: number } = {}) {
  const ledger = createTestLedger(clock);
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
      ...feePolicy,
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
    const closed = setStatus(o.ledger, { caller: ISSUER_SK, status: "closed", witness: o.agent.witness! });
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
    const cl = setStatus(q.ledger, { caller: ISSUER_SK, status: "closed", witness: o.agent.witness! });
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
    const cl = setStatus(q1.ledger, { caller: ISSUER_SK, status: "closed", witness: o1.agent.witness! });
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
    const o = opened(undefined, { feeFlat: fee });
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

  it("fee charges outstanding by amount+fee and stays pending until redemption", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    assert.equal(r.agent.witness!.B, 45); // outstanding = amount + fee
    assert.equal(r.ledger.encumberedReserve, 40); // note encumbers amount only
    assert.equal(r.ledger.feeReserve, 0);
    assert.equal(r.ledger.pendingFeeReserve, 5);
    assert.equal(r.note.preimage.fee, 5);
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
      clock: () => 0,
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
        feeFlat: 20,
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

  it("issuer withdraws only redeemed fees: feeReserve zeroes, totalReserve shrinks", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    const pending = withdrawFees(r.ledger, { caller: ISSUER_SK });
    assert.equal(pending.ok, false); if (!pending.ok) assert.equal(pending.code, "NO_FEES");
    const redeemed = redeemDraw(r.ledger, { caller: MERCHANT_A_SK, note: r.note });
    if (!redeemed.ok) throw new Error("redeem");
    assert.equal(redeemed.ledger.pendingFeeReserve, 0);
    assert.equal(redeemed.ledger.feeReserve, 5);
    const w = withdrawFees(redeemed.ledger, { caller: ISSUER_SK });
    assert.equal(w.ok, true);
    if (!w.ok) throw new Error("withdrawFees");
    assert.equal(w.fees, 5);
    assert.equal(w.ledger.feeReserve, 0);
    assert.equal(w.ledger.totalReserve, 995); // 1000 - 5
    assert.equal(w.ledger.encumberedReserve, 0);
    assert.equal(w.ledger.redeemedReserve, 40);
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

  it("withdrawUnencumberedReserve locks pending fees", () => {
    const { r } = drawWithFee(5);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("draw");
    // total 1000, encumbered 40, pending fees 5 -> withdrawable = 955
    const w = withdrawUnencumberedReserve(r.ledger, { caller: ISSUER_SK, amount: 956 });
    assert.equal(w.ok, false);
    assert.equal(w.code, "RESERVE_WITHDRAW");
    const w2 = withdrawUnencumberedReserve(r.ledger, { caller: ISSUER_SK, amount: 955 });
    assert.equal(w2.ok, true);
    if (!w2.ok) throw new Error("withdraw");
    assert.equal(w2.ledger.feeReserve, 0);
    assert.equal(w2.ledger.pendingFeeReserve, 5);
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
        receiptExpiry: 0, // exact injected Unix-seconds boundary
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

  it("openLine and postQuote use strict absolute Unix-seconds boundaries", () => {
    const ledger = createTestLedger(() => 1_000);
    const badOpen = openLine(
      ledger,
      { caller: ISSUER_SK, agentSecret: AGENT_SK, salt: "s", expiry: 1_000 },
      { limit: 150 },
    );
    assert.equal(badOpen.ok, false);
    assert.equal(badOpen.code, "EXPIRY");
    const okOpen = openLine(
      ledger,
      { caller: ISSUER_SK, agentSecret: AGENT_SK, salt: "s", expiry: 1_001 },
      { limit: 150 },
    );
    assert.equal(okOpen.ok, true);

    const o = opened(() => 1_000);
    assert.equal(o.ledger.actionClock, 2);
    const badQuote = postQuote(
      o.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "i", expiry: 1_000, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(badQuote.ok, false);
    assert.equal(badQuote.code, "EXPIRY");
    const okQuote = postQuote(
      o.ledger,
      { caller: MERCHANT_A_SK, invoiceId: "i", expiry: 1_001, nonce: "n" },
      { amount: 40 },
    );
    assert.equal(okQuote.ok, true);
  });

  it("agent cannot shorten or extend the merchant-authenticated note deadline", () => {
    const o = opened(() => 1_000);
    const q = quote(o.ledger, 40, "inv-40");
    assert.equal(q.ledger.actionClock, 3);
    for (const noteExpiry of [9_999, 10_001]) {
      const bad = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "s", noteExpiry },
        { books: o.agent.witness!, quote: q.quote });
      assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.code, "NOTE_EXPIRY");
      assert.equal(q.ledger.actionClock, 3);
    }
    const ok = draw(
      q.ledger,
      { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "s", noteExpiry: 10_000 },
      { books: o.agent.witness!, quote: q.quote },
    );
    assert.equal(ok.ok, true);
  });
});

describe("reference model trusted time and traffic-independent validity", () => {
  function purchase(clock: () => number, deadline = 1_001) {
    const o = opened(clock);
    const q = postQuote(o.ledger, { caller: MERCHANT_A_SK, invoiceId: "timed", nonce: "timed", expiry: deadline }, { amount: 40 });
    assert.equal(q.ok, true); if (!q.ok) throw new Error("quote");
    const d = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "timed-draw", noteExpiry: deadline }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(d.ok, true); if (!d.ok) throw new Error("draw");
    return { o, q, d };
  }

  it("issuer traffic cannot expire a claim, while elapsed time permits one cancellation", () => {
    let now = 1_000;
    const { d } = purchase(() => now);
    let ledger = d.ledger;
    for (let i = 0; i < 1_100; i++) {
      const funding = fundReserve(ledger, { caller: ISSUER_SK, amount: 1 });
      assert.equal(funding.ok, true); if (!funding.ok) throw new Error("fund"); ledger = funding.ledger;
    }
    assert.ok(ledger.actionClock > 1_001);
    const premature = cancelOrExpireNote(ledger, { note: d.note });
    assert.equal(premature.ok, false); if (!premature.ok) assert.equal(premature.code, "NOTE_NOT_EXPIRED");
    assert.equal(redeemDraw(ledger, { caller: MERCHANT_A_SK, note: d.note }).ok, true);
    now = 1_001;
    const expired = redeemDraw(ledger, { caller: MERCHANT_A_SK, note: d.note });
    assert.equal(expired.ok, false); if (!expired.ok) assert.equal(expired.code, "NOTE_EXPIRED");
    const cancelled = cancelOrExpireNote(ledger, { note: d.note });
    assert.equal(cancelled.ok, true); if (!cancelled.ok) throw new Error("cancel");
    assert.equal(cancelled.ledger.encumberedReserve, 0);
    assert.equal(cancelled.ledger.redeemedReserve, 0);
    assert.equal(d.agent.witness!.B, 40); // Expiry alone does not promise a refund.
    const repeated = cancelOrExpireNote(cancelled.ledger, { note: d.note });
    assert.equal(repeated.ok, false); if (!repeated.ok) assert.equal(repeated.code, "NOTE_CANCELLED");
  });

  it("quote and line expire without any intervening actions", () => {
    let now = 1_000;
    const { o, q } = purchase(() => now);
    now = 1_001;
    let untrustedClockCalls = 0;
    const spoofedInput = { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "expired", now: 0,
      clock: () => { untrustedClockCalls++; return 0; } };
    const expiredQuote = draw(q.ledger, spoofedInput, { books: o.agent.witness!, quote: q.quote });
    assert.equal(expiredQuote.ok, false); if (!expiredQuote.ok) assert.equal(expiredQuote.code, "QUOTE_EXPIRED");
    assert.equal(untrustedClockCalls, 0);
    now = 10_000;
    const expiredLine = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "expired" }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(expiredLine.ok, false); if (!expiredLine.ok) assert.equal(expiredLine.code, "LINE_EXPIRED");
    assert.equal(q.ledger.actionClock, 3);
  });

  it("repayment receipt validity follows its own timestamp boundary", () => {
    let now = 1_000;
    const { d } = purchase(() => now);
    const rcpt = receipt(d.agent.witness!, d.ledger.lineCommitment!, 20, "timed-repayment", d.ledger.contractDomain);
    const apply = () => acknowledgeRepayment(d.ledger, { caller: ISSUER_SK, newSalt: "timed-repayment", receiptExpiry: 1_001 }, { books: d.agent.witness!, receipt: rcpt });
    assert.equal(apply().ok, true);
    now = 1_001;
    const expired = apply(); assert.equal(expired.ok, false); if (!expired.ok) assert.equal(expired.code, "EXPIRY");
  });

  it("clock stays out of public state, survives clones and cannot be restored from ledger JSON", () => {
    let now = 1_000;
    const ledger = cloneLedger(createTestLedger(() => now));
    assert.equal("clock" in ledger, false); assert.equal("now" in ledger, false);
    assert.equal(Object.getOwnPropertySymbols(ledger).length, 0);
    now = 1_001;
    const expired = openLine(ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 1_001 }, { limit: 150 });
    assert.equal(expired.ok, false);
    const parsed = JSON.parse(JSON.stringify(ledger)) as Ledger;
    const legacy = openLine(parsed, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000 }, { limit: 150 });
    assert.equal(legacy.ok, false); if (!legacy.ok) assert.equal(legacy.code, "EXPIRY");
    assert.equal(Object.keys(publicLedgerView(ledger)).includes("clock"), false);
  });

  it("draw samples time once and invalid trusted clocks fail closed", () => {
    let samples = 0;
    const { o, q } = purchase(() => { samples++; return 1_000; });
    samples = 0;
    const result = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "single-time" }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(result.ok, true); assert.equal(samples, 1);
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const ledger = createTestLedger(() => invalid);
      assert.throws(() => openLine(ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000 }, { limit: 150 }), /trusted model Unix-seconds clock/);
    }
  });
});

describe("issuer-authorized immutable fee policy", () => {
  it("enforces exact fee for underpayment, overpayment and omitted fee with unchanged state", () => {
    const o = opened(undefined, { feeFlat: 2, feeBps: 125 });
    const q = quote(o.ledger, 81, "policy-price"); // 2 + ceil(81*125/10000) = 4.
    assert.equal(q.quote.feeFlat, 2); assert.equal(q.quote.feeBps, 125);
    const before = JSON.stringify(q.ledger);
    for (const fee of [undefined, 0, 2, 3, 5]) {
      const result = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "priced", fee }, { books: o.agent.witness!, quote: q.quote });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "FEE_POLICY");
      assert.equal(JSON.stringify(q.ledger), before);
      assert.equal(result.message, "Clearance could not be proven.");
    }
    const paid = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "priced", fee: 4 }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(paid.ok, true); if (!paid.ok) throw new Error("draw");
    assert.equal(paid.agent.witness!.B, 85); assert.equal(paid.ledger.pendingFeeReserve, 4); assert.equal(paid.ledger.feeReserve, 0);
    assert.equal(paid.ledger.feeFlat, 2); assert.equal(paid.ledger.feeBps, 125);
    const publicState = publicLedgerView(paid.ledger);
    assert.equal(publicState.feeFlat, 2); assert.equal(publicState.feeBps, 125);

    const free = opened(), freeQuote = quote(free.ledger, 1, "approved-zero-fee");
    const overcharged = draw(freeQuote.ledger, { agentSecret: AGENT_SK, quoteCommit: freeQuote.Q, newSalt: "free-policy", fee: 1 }, { books: free.agent.witness!, quote: freeQuote.quote });
    assert.equal(overcharged.ok, false); if (!overcharged.ok) assert.equal(overcharged.code, "FEE_POLICY");
    assert.equal(overcharged.message, "Clearance could not be proven.");
    assert.equal(freeQuote.ledger.feeReserve, 0);
  });

  it("issuer controls opening policy and cannot change a live generation retroactively", () => {
    const genesis = createTestLedger();
    const forged = openLine(genesis, { caller: AGENT_SK, agentSecret: AGENT_SK, expiry: 10_000, feeFlat: 4, feeBps: 100 }, { limit: 150 });
    assert.equal(forged.ok, false); if (!forged.ok) assert.equal(forged.code, "AUTH_ISSUER");
    assert.equal(genesis.feeFlat, 0); assert.equal(genesis.feeBps, 0);
    const o = opened(undefined, { feeFlat: 3, feeBps: 250 });
    const q = quote(o.ledger, 40, "immutable-price");
    const changed = openLine(q.ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000, feeFlat: 9, feeBps: 900 }, { limit: 150 });
    assert.equal(changed.ok, false); if (!changed.ok) assert.equal(changed.code, "LINE_EXISTS");
    assert.equal(q.ledger.feeFlat, 3); assert.equal(q.ledger.feeBps, 250);
    const def = setStatus(q.ledger, { caller: ISSUER_SK, status: "defaulted" }); if (!def.ok) throw new Error("default");
    const resumed = setStatus(def.ledger, { caller: ISSUER_SK, status: "open" }); if (!resumed.ok) throw new Error("resume");
    assert.equal(resumed.ledger.feeFlat, 3); assert.equal(resumed.ledger.feeBps, 250);
    const priced = draw(resumed.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "policy-resume", fee: 4 }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(priced.ok, true);
  });

  it("a debt-free new generation adopts new pricing without reviving an old quote", () => {
    const old = opened(undefined, { feeFlat: 3, feeBps: 250 });
    const oldQuote = quote(old.ledger, 40, "old-generation-price");
    const closed = setStatus(oldQuote.ledger, { caller: ISSUER_SK, status: "closed", witness: old.agent.witness! });
    if (!closed.ok) throw new Error("close");
    const next = openLine(closed.ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000, feeFlat: 2, feeBps: 125 }, { limit: 150 });
    if (!next.ok) throw new Error("reopen");
    assert.equal(next.ledger.lineGeneration, old.ledger.lineGeneration + 1);
    assert.equal(next.ledger.feeFlat, 2); assert.equal(next.ledger.feeBps, 125);
    const stale = draw(next.ledger, { agentSecret: AGENT_SK, quoteCommit: oldQuote.Q, newSalt: "old-price", fee: 3 }, { books: next.agent.witness!, quote: oldQuote.quote });
    assert.equal(stale.ok, false);
    assert.equal(stale.message, "Clearance could not be proven.");
    const current = quote(next.ledger, 40, "new-generation-price");
    const paid = draw(current.ledger, { agentSecret: AGENT_SK, quoteCommit: current.Q, newSalt: "new-price", fee: 3 }, { books: next.agent.witness!, quote: current.quote });
    assert.equal(paid.ok, true);
    if (!paid.ok) throw new Error("draw");
    assert.equal(paid.agent.witness!.B, 43);
    assert.equal(paid.ledger.pendingFeeReserve, 3);
  });

  it("rejects invalid opening policy without changing issuer state", () => {
    for (const policy of [{ feeFlat: -1, feeBps: 0 }, { feeFlat: 0.1, feeBps: 0 }, { feeFlat: Number.MAX_SAFE_INTEGER + 1, feeBps: 0 },
      { feeFlat: 0, feeBps: -1 }, { feeFlat: 0, feeBps: 0.5 }, { feeFlat: 0, feeBps: 10_001 }]) {
      const ledger = createTestLedger(), before = JSON.stringify(ledger);
      const result = openLine(ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000, ...policy }, { limit: 150 });
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "FEE_POLICY");
      assert.equal(JSON.stringify(ledger), before);
    }
  });

  it("fee terms bind the quote and a changed policy cannot reinterpret an existing Q", () => {
    const o = opened(undefined, { feeFlat: 2, feeBps: 100 });
    const q = quote(o.ledger, 40, "bound-policy");
    assert.notEqual(quoteCommitment({ ...q.quote, feeFlat: 3 }, q.ledger.contractDomain), q.Q);
    assert.notEqual(quoteCommitment({ ...q.quote, feeBps: 101 }, q.ledger.contractDomain), q.Q);
    const corrupted = cloneLedger(q.ledger); corrupted.feeFlat = 3;
    const result = draw(corrupted, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "changed-policy", fee: 4 }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "QUOTE");
    const legacy = cloneLedger(q.ledger); delete (legacy as Partial<Ledger>).feeFlat;
    const missing = draw(legacy, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "legacy-policy", fee: 3 }, { books: o.agent.witness!, quote: q.quote });
    assert.equal(missing.ok, false); if (!missing.ok) assert.equal(missing.code, "FEE_POLICY");
  });

  it("model rejects fee-inclusive arithmetic exceeding safe integer range", () => {
    const ledger = createTestLedger();
    const funded = fundReserve(ledger, { caller: ISSUER_SK, amount: Number.MAX_SAFE_INTEGER }); if (!funded.ok) throw new Error("fund");
    const opening = openLine(funded.ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 10_000, feeFlat: Number.MAX_SAFE_INTEGER, feeBps: 10_000 }, { limit: Number.MAX_SAFE_INTEGER });
    if (!opening.ok || !opening.agent.witness) throw new Error("open");
    const q = quote(opening.ledger, 1, "too-large-price");
    const result = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, newSalt: "overflow-policy", fee: Number.MAX_SAFE_INTEGER }, { books: opening.agent.witness, quote: q.quote });
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "OVERFLOW");
    assert.equal(q.ledger.feeReserve, 0);
  });

  it("computes exact ceiling using full bigint intermediates and rejects u64 result overflow", () => {
    const max = (1n << 64n) - 1n;
    for (const [amount, flat, bps, expected] of [[1n, 0n, 1n, 1n], [10_000n, 2n, 1n, 3n], [10_001n, 2n, 1n, 4n],
      [81n, 2n, 125n, 4n], [0n, 2n, 100n, 2n], [max, 0n, 10_000n, max], [max, 0n, 1n, (max + 9_999n) / 10_000n]] as const) {
      assert.equal(requiredDrawFee(amount, flat, bps), expected);
    }
    for (const [amount, flat, bps] of [[-1n, 0n, 0n], [max + 1n, 0n, 0n], [1n, -1n, 0n], [1n, max + 1n, 0n],
      [1n, 0n, -1n], [1n, 0n, 10_001n], [1n, max, 1n]] as const) {
      assert.throws(() => requiredDrawFee(amount, flat, bps), /fee|Uint|basis|u64|rate/i);
    }
  });

  it("v3 quote packages and vault quotes require explicit exact issuer pricing", () => {
    const o = opened(undefined, { feeFlat: 2, feeBps: 125 }), q = quote(o.ledger, 81, "transfer-fee");
    const pkg: QuoteTransferPackage = { format: "line:quote-package:v3", deadlineUnits: "unix-seconds", feePolicy: FEE_POLICY,
      networkId: "test", contractAddress: "contract", contractDomain: q.ledger.contractDomain, lineGeneration: 1,
      quoteCommitment: q.Q, merchantPublicKey: q.quote.merchantCommitment, invoiceIdBytes: q.quote.invoiceId,
      displayInvoiceId: "transfer-fee", amount: 81, expiry: 10_000, quoteNonce: q.quote.nonce,
      feeFlat: 2, feeBps: 125, fee: 4, issuedAt: 1 };
    assert.equal(validateQuoteTransferPackage(pkg, "test", "contract").fee, 4);
    const record = { ...pkg, version: 1, status: "open", updatedAt: 1 };
    assert.equal(validateMerchantQuoteRecord(record).fee, 4);
    for (const patch of [{ feePolicy: undefined }, { feePolicy: "legacy" }, { feeFlat: undefined }, { feeBps: undefined },
      { fee: undefined }, { fee: 0 }, { fee: 3 }, { fee: 5 }, { feeBps: 10_001 }, { feeFlat: -1 }, { feeBps: 0.5 },
      { fee: Number.MAX_SAFE_INTEGER + 1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: 0 }]) {
      assert.throws(() => validateQuoteTransferPackage({ ...pkg, ...patch }), /fee|policy|amount|rate/i);
      assert.throws(() => validateMerchantQuoteRecord({ ...record, ...patch }), /fee|policy|amount|rate/i);
    }
    assert.throws(() => validateQuoteTransferPackage({ ...pkg, format: "line:quote-package:v2" }), /legacy|v3|format/i);
    assert.throws(() => validateQuoteTransferPackage({ ...pkg, deadlineUnits: "actions" }), /legacy|Unix|format/i);
  });

  it("private opening records require explicit public pricing for recovery", () => {
    const o = opened(undefined, { feeFlat: 2, feeBps: 125 });
    const book = o.agent.witness!;
    const record = { version: 1, networkId: "test", contractAddress: "contract", contractDomain: o.ledger.contractDomain,
      agentSecret: AGENT_SK, identityCommitment: book.I, lineCommitment: o.ledger.lineCommitment!, limit: book.L,
      outstanding: book.B, epoch: book.e, salt: book.s, lineGeneration: 1, feeFlat: 2, feeBps: 125, updatedAt: 1 };
    assert.equal(validateAgentLineRecord(record).feeBps, 125);
    for (const patch of [{ feeFlat: undefined }, { feeBps: undefined }, { feeFlat: -1 }, { feeBps: 10_001 },
      { feeFlat: Number.MAX_SAFE_INTEGER + 1 }, { feeBps: NaN }]) {
      assert.throws(() => validateAgentLineRecord({ ...record, ...patch }), /feeFlat|feeBps/);
    }
  });
});

describe("expiry compensation and pending versus earned fees", () => {
  function purchase(repaid = 0) {
    const time = { now: 0 };
    const opening = opened(() => time.now, { feeFlat: 5 });
    const q = quote(opening.ledger, 40, "compensated-purchase");
    const paid = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, fee: 5, newSalt: "comp-draw", noteSalt: "comp-note", noteNonce: "comp-nonce" }, { books: opening.agent.witness!, quote: q.quote });
    if (!paid.ok) throw new Error("draw");
    let ledger = paid.ledger, books = paid.agent.witness!;
    if (repaid) {
      const ack = acknowledgeRepayment(ledger, { caller: ISSUER_SK, newSalt: "comp-repayment" }, { books, receipt: receipt(books, ledger.lineCommitment!, repaid, "paid-before-refund", ledger.contractDomain) });
      if (!ack.ok) throw new Error("repay");
      ledger = ack.ledger; books = ack.witness;
    }
    time.now = 10_000;
    return { time, ledger, books, note: paid.note };
  }
  function allocate(p: ReturnType<typeof purchase>, caller = AGENT_SK) {
    return cancelOrExpireNote(p.ledger, { caller, action: 1, note: p.note, compensation: { note: p.note.preimage, noteSalt: p.note.salt, newSalt: "private-refund-salt", books: p.books } });
  }
  function ackInput(refund: NonNullable<Extract<ReturnType<typeof cancelOrExpireNote>, { ok: true }>["refund"]>, paymentRef = "external-refund-unique") {
    return { identity: refund.identity, amount: refund.amount, salt: refund.salt, paymentRef, receiptExpiry: 20_000 };
  }
  function locks(ledger: Ledger) {
    return ledger.encumberedReserve + ledger.redeemedReserve + ledger.feeReserve + ledger.pendingFeeReserve + ledger.refundReserve + ledger.reportedRefundReserve;
  }

  it("permissionless expiry preserves full principal and fee backing until allocation", () => {
    const p = purchase(), before = JSON.stringify(p.ledger);
    const expired = cancelOrExpireNote(p.ledger, { note: p.note });
    if (!expired.ok) throw new Error("expire");
    assert.equal(expired.ledger.encumberedReserve, 0); assert.equal(expired.ledger.pendingFeeReserve, 0);
    assert.equal(expired.ledger.feeReserve, 0); assert.equal(expired.ledger.refundReserve, 45);
    assert.equal(locks(expired.ledger), 45);
    assert.equal(expired.ledger.lineCommitment, p.ledger.lineCommitment);
    assert.equal(expired.witness, undefined); assert.equal(expired.refund, undefined);
    assert.equal(JSON.stringify(p.ledger), before);
    assert.equal(expired.ledger.notes[0]!.compensationAllocated, false);
    assert.equal(expired.ledger.notes[0]!.refundPaymentNullifier, "0".repeat(64));
    const attempted = withdrawUnencumberedReserve(expired.ledger, { caller: ISSUER_SK, amount: 956 });
    assert.equal(attempted.ok, false); if (!attempted.ok) assert.equal(attempted.code, "RESERVE_WITHDRAW");
    assert.equal(withdrawFees(expired.ledger, { caller: ISSUER_SK }).ok, false);
  });

  it("issuer or original agent can atomically expire and credit exactly once", () => {
    for (const caller of [AGENT_SK, ISSUER_SK]) {
      const p = purchase(), result = allocate(p, caller);
      if (!result.ok || !result.witness || !result.refund) throw new Error("allocate");
      assert.equal(result.witness.B, 0); assert.equal(result.witness.e, p.books.e + 1);
      assert.equal(result.refund.allocatedCredit, 45); assert.equal(result.refund.amount, 0);
      assert.equal(result.ledger.refundReserve, 0); assert.equal(result.ledger.pendingFeeReserve, 0);
      assert.equal(result.ledger.notes[0]!.cashRefundOwed, false);
      assert.equal(result.ledger.notes[0]!.refundPaymentNullifier, "0".repeat(64));
      assert.equal(result.ledger.notes[0]!.refundCommitment, result.refund.commitment);
      assert.equal(result.ledger.nullifiers.length, p.ledger.nullifiers.length);
      const repeated = allocate({ ...p, ledger: result.ledger, books: result.witness }, caller);
      assert.equal(repeated.ok, false); if (!repeated.ok) assert.equal(repeated.code, "COMPENSATION_USED");
      assert.equal(cancelOrExpireNote(result.ledger, { note: p.note }).ok, false);
      assert.equal(cancelOrExpireNote(result.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: ackInput(result.refund) }).ok, false);
      assert.equal(redeemDraw(result.ledger, { caller: MERCHANT_A_SK, note: p.note }).ok, false);
    }
  });

  it("a previously permissionlessly expired note remains allocatable without double moving reserve", () => {
    const p = purchase(), expired = cancelOrExpireNote(p.ledger, { note: p.note });
    if (!expired.ok) throw new Error("expire");
    const result = allocate({ ...p, ledger: expired.ledger });
    if (!result.ok || !result.witness) throw new Error("allocate");
    assert.equal(result.witness.B, 0); assert.equal(locks(result.ledger), 0);
    assert.equal(result.ledger.encumberedReserve, 0); assert.equal(result.ledger.pendingFeeReserve, 0);
  });

  it("partial and full repayment become private owed cash while retaining identical full-cost escrow", () => {
    for (const repaid of [15, 25, 45]) {
      const p = purchase(repaid), result = allocate(p);
      if (!result.ok || !result.witness || !result.refund) throw new Error("allocate");
      assert.equal(result.witness.B, 0); assert.equal(result.refund.amount, repaid);
      assert.equal(result.refund.allocatedCredit, 45 - repaid);
      assert.equal(result.ledger.refundReserve, 45); assert.equal(result.ledger.totalReserve, 1000);
      assert.equal(result.ledger.notes[0]!.cashRefundOwed, true);
      assert.equal(locks(result.ledger), 45);
      assert.equal("amount" in (result.ledger.notes[0] as object), true); // Principal remains public.
      assert.equal("refundDue" in result.ledger.notes[0]!, false);
      assert.equal("allocatedCredit" in result.ledger.notes[0]!, false);
    }
  });

  it("compensation may offset the same borrower's other debt, and cannot be replayed after a fresh draw", () => {
    const p = purchase(15); p.time.now = 0;
    const q = quote(p.ledger, 20, "another-purchase");
    const other = draw(q.ledger, { agentSecret: AGENT_SK, quoteCommit: q.Q, fee: 5, newSalt: "other-draw" }, { books: p.books, quote: q.quote });
    if (!other.ok) throw new Error("draw");
    p.time.now = 10_000;
    const result = allocate({ ...p, ledger: other.ledger, books: other.agent.witness! });
    if (!result.ok || !result.witness || !result.refund) throw new Error("allocate");
    assert.equal(result.witness.B, 10); assert.equal(result.refund.amount, 0);
    assert.equal(result.refund.allocatedCredit, 45); assert.equal(result.ledger.refundReserve, 0);
    assert.equal(result.ledger.encumberedReserve, 20); assert.equal(result.ledger.pendingFeeReserve, 5);
    assert.equal(allocate({ ...p, ledger: result.ledger, books: result.witness }).ok, false);
  });

  it("rejects wrong authority, forged original note and stale books atomically", () => {
    const p = purchase(), before = JSON.stringify(p.ledger);
    const proof = { note: p.note.preimage, noteSalt: p.note.salt, newSalt: "failed-refund", books: p.books };
    const trials = [
      { caller: MERCHANT_A_SK, compensation: proof },
      { caller: MERCHANT_B_SK, compensation: proof },
      { caller: AGENT_SK, compensation: { ...proof, note: { ...proof.note, merchantPk: merchantPublicKey(MERCHANT_B_SK) } } },
      { caller: AGENT_SK, compensation: { ...proof, note: { ...proof.note, identity: identityCommitment(MERCHANT_B_SK) } } },
      { caller: ISSUER_SK, compensation: { ...proof, noteSalt: "wrong-salt" } },
      { caller: AGENT_SK, compensation: { ...proof, books: { ...p.books, B: 0 } } },
      { caller: AGENT_SK, compensation: { ...proof, books: undefined } },
    ];
    for (const trial of trials) {
      const result = cancelOrExpireNote(p.ledger, { ...trial, action: 1, note: p.note });
      assert.equal(result.ok, false); assert.equal(JSON.stringify(p.ledger), before);
    }
    p.time.now = 9_999;
    assert.equal(allocate(p).ok, false); assert.equal(JSON.stringify(p.ledger), before);
    assert.equal(cancelOrExpireNote(p.ledger, { action: 3 as 0, note: p.note }).ok, false);
  });

  it("default and closed current generations retain authenticated compensation", () => {
    for (const status of ["defaulted", "closed"] as const) {
      const p = purchase(status === "closed" ? 45 : 0);
      const changed = setStatus(p.ledger, { caller: ISSUER_SK, status, witness: p.books });
      if (!changed.ok) throw new Error("status");
      const result = allocate({ ...p, ledger: changed.ledger });
      if (!result.ok || !result.witness || !result.refund) throw new Error("allocate");
      assert.equal(result.ledger.status, status); assert.equal(result.witness.B, 0);
      assert.equal(result.refund.amount, status === "closed" ? 45 : 0);
    }
  });

  it("an original holder can claim old-generation cash without touching a new holder's book", () => {
    for (const caller of [AGENT_SK, ISSUER_SK]) {
      const p = purchase(45), closed = setStatus(p.ledger, { caller: ISSUER_SK, status: "closed", witness: p.books });
      if (!closed.ok) throw new Error("close");
      const next = openLine(closed.ledger, { caller: ISSUER_SK, agentSecret: MERCHANT_B_SK, expiry: 20_000, feeFlat: 7 }, { limit: 150 });
      if (!next.ok) throw new Error("open");
      const result = cancelOrExpireNote(next.ledger, { caller, action: 1, note: p.note, compensation: { note: p.note.preimage, noteSalt: p.note.salt, newSalt: "old-refund" } });
      if (!result.ok || !result.refund) throw new Error("allocate");
      assert.equal(result.witness, undefined); assert.equal(result.ledger.lineCommitment, next.ledger.lineCommitment);
      assert.equal(result.ledger.identityCommitment, next.ledger.identityCommitment);
      assert.equal(result.refund.amount, 45); assert.equal(result.refund.allocatedCredit, 0);
      assert.equal(result.refund.identity, p.books.I); assert.equal(result.ledger.refundReserve, 45);
      const wrongHolder = cancelOrExpireNote(next.ledger, { caller: MERCHANT_B_SK, action: 1, note: p.note, compensation: { note: p.note.preimage, noteSalt: p.note.salt, newSalt: "wrong-holder" } });
      assert.equal(wrongHolder.ok, false);
    }
  });

  it("issuer refund reporting opens the exact private obligation and preserves full-cost locked backing", () => {
    const p = purchase(15), allocated = allocate(p);
    if (!allocated.ok || !allocated.refund) throw new Error("allocate");
    const before = JSON.stringify(allocated.ledger), valid = ackInput(allocated.refund);
    assert.equal(allocated.ledger.notes[0]!.refundPaymentNullifier, "0".repeat(64));
    for (const patch of [{ amount: 0 }, { amount: 14 }, { amount: 16 }, { amount: 46 }, { identity: identityCommitment(MERCHANT_B_SK) }, { salt: "wrong-refund-salt" }, { receiptExpiry: 10_000 }, { paymentRef: "" }]) {
      const result = cancelOrExpireNote(allocated.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: { ...valid, ...patch } });
      assert.equal(result.ok, false); assert.equal(JSON.stringify(allocated.ledger), before);
    }
    assert.equal(cancelOrExpireNote(allocated.ledger, { caller: AGENT_SK, action: 2, note: p.note, refundAck: valid }).ok, false);
    const reported = cancelOrExpireNote(allocated.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: valid });
    if (!reported.ok) throw new Error("report");
    assert.equal(reported.ledger.refundReserve, 0); assert.equal(reported.ledger.reportedRefundReserve, 45);
    assert.equal(reported.ledger.totalReserve, 1000); assert.equal(locks(reported.ledger), 45);
    assert.equal(reported.ledger.lineCommitment, allocated.ledger.lineCommitment);
    assert.equal(reported.ledger.notes[0]!.refundAcknowledged, true);
    const expectedPaymentN = toHex(paymentNullifier(asBytes32(ISSUER_SK), canonicalPaymentReferenceBytes(valid.paymentRef), asBytes32(reported.ledger.contractDomain)));
    assert.equal(reported.ledger.notes[0]!.refundPaymentNullifier, expectedPaymentN);
    assert.equal(publicLedgerView(reported.ledger).notes[0]!.refundPaymentNullifier, expectedPaymentN);
    assert.ok(reported.ledger.nullifiers.includes(expectedPaymentN));
    assert.equal(reported.ledger.nullifiers.length, allocated.ledger.nullifiers.length + 1);
    assert.equal(withdrawUnencumberedReserve(reported.ledger, { caller: ISSUER_SK, amount: 956 }).ok, false);
    assert.equal(cancelOrExpireNote(reported.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: { ...valid, paymentRef: "different-repeat-reference" } }).ok, false);
  });

  it("refund and repayment share stable payment-reference replay protection in both directions", () => {
    const p = purchase(15), allocated = allocate(p);
    if (!allocated.ok || !allocated.refund) throw new Error("allocate");
    const repaidRef = receipt(p.books, p.ledger.lineCommitment!, 15, "paid-before-refund", p.ledger.contractDomain).paymentRef;
    const reusedInbound = cancelOrExpireNote(allocated.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: ackInput(allocated.refund, repaidRef) });
    assert.equal(reusedInbound.ok, false); if (!reusedInbound.ok) assert.equal(reusedInbound.code, "RECEIPT_USED");
    const reported = cancelOrExpireNote(allocated.ledger, { caller: ISSUER_SK, action: 2, note: p.note, refundAck: ackInput(allocated.refund, "shared-refund-reference") });
    if (!reported.ok || !allocated.witness) throw new Error("report");
    p.time.now = 10_001;
    const q = postQuote(reported.ledger, { caller: MERCHANT_A_SK, invoiceId: "post-refund", nonce: "post-refund", expiry: 20_000 }, { amount: 20 });
    if (!q.ok) throw new Error("quote");
    // The facility itself expired, so reopen from its zero-debt book first.
    const closed = setStatus(q.ledger, { caller: ISSUER_SK, status: "closed", witness: allocated.witness });
    if (!closed.ok) throw new Error("close");
    const next = openLine(closed.ledger, { caller: ISSUER_SK, agentSecret: AGENT_SK, expiry: 20_000, feeFlat: 5 }, { limit: 150 });
    if (!next.ok) throw new Error("open");
    const current = postQuote(next.ledger, { caller: MERCHANT_A_SK, invoiceId: "new-after-refund", nonce: "new-after-refund", expiry: 20_000 }, { amount: 20 });
    if (!current.ok) throw new Error("quote");
    const debt = draw(current.ledger, { agentSecret: AGENT_SK, quoteCommit: current.Q, fee: 5, newSalt: "new-debt" }, { books: next.agent.witness!, quote: current.quote });
    if (!debt.ok) throw new Error("draw");
    const cashReceipt = { ...receipt(debt.agent.witness!, debt.ledger.lineCommitment!, 5, "fresh-repayment-receipt", debt.ledger.contractDomain), paymentRef: "shared-refund-reference", expiry: 20_000 };
    const reusedOutbound = acknowledgeRepayment(debt.ledger, { caller: ISSUER_SK, newSalt: "reused-event" }, { books: debt.agent.witness!, receipt: cashReceipt });
    assert.equal(reusedOutbound.ok, false); if (!reusedOutbound.ok) assert.equal(reusedOutbound.code, "RECEIPT_USED");
  });

  it("redeemed purchases cannot enter automatic expiry compensation", () => {
    const p = purchase(); p.time.now = 9_999;
    const redeemed = redeemDraw(p.ledger, { caller: MERCHANT_A_SK, note: p.note });
    if (!redeemed.ok) throw new Error("redeem");
    assert.equal(redeemed.ledger.pendingFeeReserve, 0); assert.equal(redeemed.ledger.feeReserve, 5);
    p.time.now = 10_000;
    assert.equal(allocate({ ...p, ledger: redeemed.ledger }).ok, false);
    assert.equal(cancelOrExpireNote(redeemed.ledger, { note: p.note }).ok, false);
    assert.equal(redeemed.ledger.refundReserve, 0);
  });

  it("fee-bound v3 note transfers and private refund records reject missing or unsafe terms", () => {
    const p = purchase(15), np = p.note.preimage;
    const pkg = { format: "line:note-package:v3", deadlineUnits: "unix-seconds", networkId: "test", contractAddress: "address", contractDomain: np.domain,
      lineGeneration: np.lineGeneration, noteCommitment: p.note.D, quoteCommitment: np.quoteCommit, identityCommitment: np.identity,
      merchantPublicKey: np.merchantPk, amount: np.amount, fee: np.fee, noteNonce: np.noteNonce, noteSalt: p.note.salt, expiry: np.expiry, issuedAt: 1 };
    assert.equal(validateDrawNoteTransferPackage(pkg).fee, 5);
    const record = { ...pkg, version: 1, status: "active", updatedAt: 1 };
    assert.equal(validateDrawNoteRecord(record).fee, 5);
    for (const patch of [{ fee: undefined }, { fee: -1 }, { fee: 0.5 }, { fee: Number.MAX_SAFE_INTEGER }, { amount: 0 }, { amount: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.throws(() => validateDrawNoteTransferPackage({ ...pkg, ...patch }));
      assert.throws(() => validateDrawNoteRecord({ ...record, ...patch }));
    }
    assert.throws(() => validateDrawNoteTransferPackage({ ...pkg, format: "line:note-package:v2" }), /legacy|v3|fee/);
    assert.notEqual(drawNoteCommitment({ ...np, fee: 6 }, p.note.salt), p.note.D);
    const allocated = allocate(p);
    if (!allocated.ok || !allocated.refund) throw new Error("allocate");
    const refund = allocated.refund;
    const privateRecord = { version: 1, networkId: "test", contractAddress: "address", contractDomain: refund.domain, lineGeneration: refund.lineGeneration,
      identityCommitment: refund.identity, noteCommitment: refund.noteCommit, refundCommitment: refund.commitment, amount: refund.amount,
      allocatedCredit: refund.allocatedCredit, salt: refund.salt, status: "allocated", updatedAt: 1 };
    assert.equal(validateRefundRecord(privateRecord).amount, 15);
    for (const observed of [false, true]) {
      const recovered = validateRefundRecord({ ...privateRecord, issuerReportObserved: observed });
      assert.equal(recovered.issuerReportObserved, observed);
      assert.equal(recovered.status, "allocated");
      assert.equal(recovered.paymentReference, undefined);
    }
    for (const observed of [undefined, null, 0, 1, "true", {}, []]) assert.throws(() => validateRefundRecord({ ...privateRecord, issuerReportObserved: observed }), /issuerReportObserved/);
    for (const patch of [{ amount: undefined }, { amount: -1 }, { amount: 0.5 }, { allocatedCredit: Number.MAX_SAFE_INTEGER }, { salt: undefined }, { status: "paid" }, { status: "issuer-reported" }]) assert.throws(() => validateRefundRecord({ ...privateRecord, ...patch }));
    assert.equal(validateRefundRecord({ ...privateRecord, status: "issuer-reported", paymentReference: "refund-report", receiptExpiry: 20_000 }).status, "issuer-reported");
  });
});
