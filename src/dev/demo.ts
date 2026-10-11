import {
  acknowledgeRepayment,
  createLedger,
  draw,
  fundReserve,
  openLine,
  postQuote,
  quoteCommitment,
  redeemDraw,
  registerMerchant,
  setStatus,
  withdrawUnencumberedReserve,
} from "../lib/line/protocol.ts";
import type { AgentStore, DrawNote, Ledger, MerchantInvoice, QuotePreimage } from "../lib/line/types.ts";
import { requiredDrawFee } from "../lib/line/encoding.ts";
import {
  AGENT_SK,
  INSTANCE_NONCE,
  ISSUER_SK,
  MERCHANT_A_PK,
  MERCHANT_A_SK,
  MERCHANT_B_PK,
  MERCHANT_B_SK,
} from "../test/fixtures/keys.ts";

export const DEMO_STEPS = [
  {
    id: 0,
    title: "Genesis",
    publicView: "Empty ledger. No line, no quotes, no nullifiers.",
    privateView: "Issuer, merchant, and agent secrets exist off-chain.",
  },
  {
    id: 1,
    title: "Register Merchant B",
    publicView: "Merchant B public key added to registered merchants.",
    privateView: "Issuer enables second merchant for multi-merchant settlement.",
  },
  {
    id: 2,
    title: "Fund Reserve (500)",
    publicView: "Issuer deposits 500 into settlement reserve. Total reserve = 500.",
    privateView: "Issuer capital backs autonomous agent purchases.",
  },
  {
    id: 3,
    title: "openLine 150",
    publicView: "Status open. Identity commitment and C0 published. Limit is absent.",
    privateView: "Agent store: L = 150, B = 0, available = 150.",
  },
  {
    id: 4,
    title: "Merchant A: postQuote 40",
    publicView: "Opaque quote commitment Q40 from Merchant A.",
    privateView: "Invoice 40 stored in Merchant A private store.",
  },
  {
    id: 5,
    title: "Agent: draw 40 -> Issue Note D1",
    publicView: "C0 -> C1. Draw note D1 issued. Reserve encumbered by 40; any agreed fee remains pending until redemption.",
    privateView: "Agent store: B = 40, available = 110. Note D1 delivered to Merchant A.",
  },
  {
    id: 6,
    title: "Attack: Merchant B tries to redeem D1",
    publicView: "Redemption rejected: caller is not the designated merchant. Ledger unchanged.",
    privateView: "Merchant B cannot steal Merchant A's claim.",
  },
  {
    id: 7,
    title: "Merchant A: redeem D1 (40)",
    publicView: "Redemption nullifier spent. Encumbered reserve -> Redeemed reserve (40).",
    privateView: "Merchant A claims 40 settlement against issuer reserve.",
  },
  {
    id: 8,
    title: "Attack: Merchant A tries to redeem D1 again",
    publicView: "Redemption rejected: note already redeemed. Double-spend blocked.",
    privateView: "Merchant A cannot double-claim.",
  },
  {
    id: 9,
    title: "Merchant B: postQuote 120",
    publicView: "Opaque quote commitment Q120 from Merchant B.",
    privateView: "Invoice 120 stored in Merchant B private store.",
  },
  {
    id: 10,
    title: "Over-limit failure (40 + 120 > 150)",
    publicView: "Clearance could not be proven.",
    privateView: "Agent capacity is 110; invoice is 120.",
  },
  {
    id: 11,
    title: "Issuer: acknowledgeRepayment (40)",
    publicView: "C1 -> C2. Repayment nullifier spent. B decreases.",
    privateView: "Issuer confirms off-chain cash. Capacity restored to 150.",
  },
  {
    id: 12,
    title: "Merchant B: post fresh quote 120",
    publicView: "Opaque quote commitment Q120b posted.",
    privateView: "Merchant B re-issues invoice.",
  },
  {
    id: 13,
    title: "Agent: draw 120 -> Issue Note D2",
    publicView: "C2 -> C3. Draw note D2 issued. Encumbered reserve + 120.",
    privateView: "Agent store: B = 120, available = 30.",
  },
  {
    id: 14,
    title: "Attack: Issuer tries to withdraw encumbered reserve",
    publicView: "Withdrawal rejected: funds backing D2 are locked.",
    privateView: "Issuer cannot rug merchant claims.",
  },
  {
    id: 15,
    title: "Merchant B: redeem D2 (120)",
    publicView: "D2 redeemed. Total redeemed = 160. Encumbered = 0.",
    privateView: "Merchant B claims 120 from issuer reserve.",
  },
  {
    id: 16,
    title: "Issuer: setStatus(DEFAULTED)",
    publicView: "Status set to defaulted.",
    privateView: "Line frozen due to nonpayment or policy.",
  },
  {
    id: 17,
    title: "Post-default draw fails",
    publicView: "Clearance could not be proven.",
    privateView: "Draw circuit asserts status == open.",
  },
  {
    id: 18,
    title: "Public Explorer Review",
    publicView: "Explorer shows commitments, nullifiers, reserves, timing. Zero private books.",
    privateView: "Full privacy maintained across complete lifecycle.",
  },
];

export type DemoSnapshot = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  notes: DrawNote[];
  pendingRepay: number;
  lastAcked: number;
  lastFail: string | null;
  lastFailReason: string | null;
  step: number;
  overLimitRan: boolean;
  postDefaultRan: boolean;
  wrongMerchantRan: boolean;
  doubleRedeemRan: boolean;
  withdrawBlockedRan: boolean;
  staleWitness?: any;
};

export function snapshotAt(step: number, options?: { clock?: () => number; feeFlat?: number; feeBps?: number }): DemoSnapshot {
  const clock = options?.clock ?? (() => Math.floor(Date.now() / 1_000));
  const deadline = clock() + 10_000;
  const expiry = (_ledger: Ledger) => deadline;
  const feeFor = (amount: number) => {
    const fee = requiredDrawFee(BigInt(amount), BigInt(options?.feeFlat ?? 0), BigInt(options?.feeBps ?? 0));
    if (fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Demo fee exceeds safe integer range");
    return Number(fee);
  };
  const n = Math.max(0, Math.min(step, 18));
  let ledger = createLedger({
    clock,
    issuerSecret: ISSUER_SK,
    merchantSecret: MERCHANT_A_SK,
    instanceNonce: INSTANCE_NONCE,
  });
  let agent: AgentStore | null = null;
  const invoices: MerchantInvoice[] = [];
  const notes: DrawNote[] = [];
  let pendingRepay = 0;
  let lastAcked = 0;
  let lastFail: string | null = null;
  let lastFailReason: string | null = null;
  let overLimitRan = false;
  let postDefaultRan = false;
  let wrongMerchantRan = false;
  let doubleRedeemRan = false;
  let withdrawBlockedRan = false;
  let staleWitness: any = null;

  let q40: { quote: QuotePreimage; Q: string } | null = null;
  let note1: DrawNote | null = null;
  let note2: DrawNote | null = null;

  // Step 1: Register Merchant B
  if (n >= 1) {
    const reg = registerMerchant(ledger, {
      caller: ISSUER_SK,
      merchantPk: MERCHANT_B_PK,
    });
    if (!reg.ok) throw new Error("demo reg B");
    ledger = reg.ledger;
  }

  // Step 2: Fund reserve 500
  if (n >= 2) {
    const fund = fundReserve(ledger, { caller: ISSUER_SK, amount: 500 });
    if (!fund.ok) throw new Error("demo fund");
    ledger = fund.ledger;
  }

  // Step 3: Open line 150 — the limit is a private witness, never a public param.
  if (n >= 3) {
    const open = openLine(
      ledger,
      {
        caller: ISSUER_SK,
        agentSecret: AGENT_SK,
        salt: "demo-salt-0",
        expiry: expiry(ledger),
        feeFlat: options?.feeFlat ?? 0,
        feeBps: options?.feeBps ?? 0,
      },
      { limit: 150 },
    );
    if (!open.ok) throw new Error("demo open");
    ledger = open.ledger;
    agent = open.agent;
  }

  // Step 4: Merchant A posts quote 40 — the amount is a private witness.
  if (n >= 4 && agent) {
    const q = postQuote(
      ledger,
      {
        caller: MERCHANT_A_SK,
        invoiceId: "demo-inv-40",
        expiry: expiry(ledger),
        nonce: "n40",
      },
      { amount: 40 },
    );
    if (!q.ok) throw new Error("demo q40");
    ledger = q.ledger;
    q40 = { quote: q.quote, Q: q.Q };
    invoices.push({ invoiceId: "demo-inv-40", amount: 40, Q: q.Q, used: false, preimage: q.quote });
  }

  // Step 5: Agent draws 40 -> note D1. Q is the public commitment; the books
  // and the invoice preimage are private witnesses.
  if (n >= 5 && agent && q40) {
    staleWitness = agent.witness;
    const d = draw(
      ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q40.Q,
        fee: feeFor(40),
        newSalt: "demo-salt-1",
        noteNonce: "nn-40",
        noteSalt: "ns-40",
      },
      { books: agent.witness!, quote: q40.quote },
    );
    if (!d.ok) throw new Error("demo d40");
    ledger = d.ledger;
    agent = d.agent;
    note1 = d.note;
    notes.push(d.note);
    pendingRepay = agent.witness!.B;
    invoices[0] = { ...invoices[0], used: true };
  }

  // Step 6: Merchant B attempts to redeem D1 and fails
  if (n >= 6 && note1) {
    wrongMerchantRan = true;
    const r = redeemDraw(
      ledger,
      {
        caller: MERCHANT_B_SK,
        noteCommitment: note1.D,
        noteExpiry: note1.preimage.expiry,
        noteSalt: note1.salt,
      },
      { note: note1.preimage },
    );
    if (r.ok) throw new Error("Merchant B unexpectedly redeemed Merchant A note");
    lastFail = r.message;
    lastFailReason = r.reason;
  }

  // Step 7: Merchant A redeems D1 successfully
  if (n >= 7 && note1) {
    const r = redeemDraw(
      ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: note1.D,
        noteExpiry: note1.preimage.expiry,
        noteSalt: note1.salt,
      },
      { note: note1.preimage },
    );
    if (!r.ok) throw new Error("demo redeem D1 failed");
    ledger = r.ledger;
  }

  // Step 8: Merchant A tries to redeem D1 again and fails
  if (n >= 8 && note1) {
    doubleRedeemRan = true;
    const r = redeemDraw(
      ledger,
      {
        caller: MERCHANT_A_SK,
        noteCommitment: note1.D,
        noteExpiry: note1.preimage.expiry,
        noteSalt: note1.salt,
      },
      { note: note1.preimage },
    );
    if (r.ok) throw new Error("Double redemption unexpectedly succeeded");
    lastFail = r.message;
    lastFailReason = r.reason;
  }

  // Step 9: Merchant B posts quote 120
  let q120a: { quote: QuotePreimage; Q: string } | null = null;
  if (n >= 9) {
    const q = postQuote(
      ledger,
      {
        caller: MERCHANT_B_SK,
        invoiceId: "demo-inv-120a",
        expiry: expiry(ledger),
        nonce: "n120a",
      },
      { amount: 120 },
    );
    if (!q.ok) throw new Error("demo q120a");
    ledger = q.ledger;
    q120a = { quote: q.quote, Q: q.Q };
    invoices.push({
      invoiceId: "demo-inv-120a",
      amount: 120,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
  }

  // Step 10: Agent draw fails (over-limit)
  if (n >= 10 && agent && q120a) {
    overLimitRan = true;
    const blocked = draw(
      ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q120a.Q,
        fee: feeFor(120),
        newSalt: "demo-salt-fail",
      },
      { books: agent.witness!, quote: q120a.quote },
    );
    if (blocked.ok) throw new Error("Over-limit draw unexpectedly succeeded");
    lastFail = blocked.message;
    lastFailReason = blocked.reason;
  }

  // Step 11: Repayment ack 40 — books and receipt amount are witnesses.
  if (n >= 11 && agent) {
    const receipt = {
      identity: agent.witness!.I,
      currentC: ledger.lineCommitment!,
      amount: agent.witness!.B,
      paymentRef: "demo-pay-40",
      nonce: "demo-r1",
      expiry: expiry(ledger),
      contractDomain: ledger.contractDomain,
    };
    const ack = acknowledgeRepayment(
      ledger,
      {
        caller: ISSUER_SK,
        newSalt: "demo-salt-2",
        receiptExpiry: receipt.expiry,
      },
      { books: agent.witness!, receipt },
    );
    if (!ack.ok) throw new Error("demo ack 40");
    ledger = ack.ledger;
    agent = { secret: AGENT_SK, witness: ack.witness };
    pendingRepay = 0;
    lastAcked = receipt.amount;
  }

  // Step 12: Merchant B posts fresh quote 120
  let q120b: { quote: QuotePreimage; Q: string } | null = null;
  if (n >= 12) {
    const q = postQuote(
      ledger,
      {
        caller: MERCHANT_B_SK,
        invoiceId: "demo-inv-120b",
        expiry: expiry(ledger),
        nonce: "n120b",
      },
      { amount: 120 },
    );
    if (!q.ok) throw new Error("demo q120b");
    ledger = q.ledger;
    q120b = { quote: q.quote, Q: q.Q };
    invoices.push({
      invoiceId: "demo-inv-120b",
      amount: 120,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
  }

  // Step 13: Agent draws 120 -> note D2
  if (n >= 13 && agent && q120b) {
    const d = draw(
      ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: q120b.Q,
        fee: feeFor(120),
        newSalt: "demo-salt-3",
        noteNonce: "nn-120",
        noteSalt: "ns-120",
      },
      { books: agent.witness!, quote: q120b.quote },
    );
    if (!d.ok) throw new Error("demo d120");
    ledger = d.ledger;
    agent = d.agent;
    note2 = d.note;
    notes.push(d.note);
    pendingRepay = agent.witness!.B;
    const last = invoices.length - 1;
    invoices[last] = { ...invoices[last], used: true };
  }

  // Step 14: Issuer tries to withdraw funds backing D2 and fails
  if (n >= 14) {
    withdrawBlockedRan = true;
    // Total is 500, redeemed is 40, encumbered is 120. Withdrawable is 340.
    // Attempting to withdraw 400 fails.
    const w = withdrawUnencumberedReserve(ledger, { caller: ISSUER_SK, amount: 400 });
    if (w.ok) throw new Error("Withdrawal of encumbered reserve unexpectedly succeeded");
    lastFail = w.message;
    lastFailReason = w.reason;
  }

  // Step 15: Merchant B redeems D2
  if (n >= 15 && note2) {
    const r = redeemDraw(
      ledger,
      {
        caller: MERCHANT_B_SK,
        noteCommitment: note2.D,
        noteExpiry: note2.preimage.expiry,
        noteSalt: note2.salt,
      },
      { note: note2.preimage },
    );
    if (!r.ok) throw new Error("demo redeem D2 failed");
    ledger = r.ledger;
  }

  // Step 16: Default line
  if (n >= 16) {
    const def = setStatus(ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!def.ok) throw new Error("demo default");
    ledger = def.ledger;
  }

  // Step 17: Post-default draw fails on the status check (line is defaulted);
  // the ad-hoc quote commitment is public input the ledger never saw.
  if (n >= 17 && agent) {
    postDefaultRan = true;
    const adHocQuote = {
      merchantCommitment: MERCHANT_A_PK,
      amount: 10,
      invoiceId: "post-def",
      expiry: expiry(ledger),
      nonce: "nd",
      generation: ledger.lineGeneration,
      feeFlat: ledger.feeFlat,
      feeBps: ledger.feeBps,
    };
    const blocked = draw(
      ledger,
      {
        agentSecret: AGENT_SK,
        quoteCommit: quoteCommitment(adHocQuote, ledger.contractDomain),
        fee: feeFor(10),
        newSalt: "salt-def-fail",
      },
      { books: agent.witness!, quote: adHocQuote },
    );
    if (blocked.ok) throw new Error("Post-default draw unexpectedly succeeded");
    lastFail = blocked.message;
    lastFailReason = blocked.reason;
  }

  return {
    ledger,
    agent,
    invoices,
    notes,
    pendingRepay,
    lastAcked,
    lastFail,
    lastFailReason,
    step: n,
    overLimitRan,
    postDefaultRan,
    wrongMerchantRan,
    doubleRedeemRan,
    withdrawBlockedRan,
    staleWitness,
  };
}
