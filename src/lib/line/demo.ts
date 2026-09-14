import {
  acknowledgeRepayment,
  createLedger,
  draw,
  openLine,
  postQuote,
  setStatus,
} from "./protocol.ts";
import type { AgentStore, Ledger, MerchantInvoice, QuotePreimage } from "./types.ts";
import { CONTRACT_ID } from "./types.ts";
import { AGENT, ISSUER, MERCHANT } from "./keys.ts";

export const DEMO_STEPS = [
  {
    id: 0,
    title: "Genesis",
    publicView: "Empty ledger. No line, no quotes, no nullifiers.",
    privateView: "Issuer, merchant, and agent keys exist off-chain.",
  },
  {
    id: 1,
    title: "openLine",
    publicView: "Status open. Identity commitment and C0 published. Limit is absent.",
    privateView: "Agent store: L = 150, B = 0, available = 150.",
  },
  {
    id: 2,
    title: "postQuote 40",
    publicView: "Opaque quote commitment Q40. No amount, no merchant name.",
    privateView: "Merchant invoice 40 is in the merchant store only.",
  },
  {
    id: 3,
    title: "draw 40",
    publicView: "C0 → C1. Nullifier inserted. Amount not disclosed.",
    privateView: "B = 40, available = 110. Issuer sees a pending off-chain 40.",
  },
  {
    id: 4,
    title: "Replay draw",
    publicView: "No new transition. Failed proofs write nothing.",
    privateView: "Clearance could not be proven. Quote already consumed.",
  },
  {
    id: 5,
    title: "draw 120 (blocked)",
    publicView: "Still C1. Explorer does not learn why.",
    privateView: "40 + 120 > 150. Generic failure only.",
  },
  {
    id: 6,
    title: "acknowledgeRepayment 40",
    publicView: "C1 → C2. Issuer-authenticated. Amount hidden.",
    privateView: "B = 0, available = 150. Receipt bound to C1.",
  },
  {
    id: 7,
    title: "draw 120",
    publicView: "C2 → C3. Second authorization for a new Q.",
    privateView: "B = 120, available = 30.",
  },
  {
    id: 8,
    title: "setStatus defaulted",
    publicView: "Status defaulted. Further draws rejected.",
    privateView: "Books still private. Capacity is frozen, not published.",
  },
] as const;

export type DemoSnapshot = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  pendingRepay: number;
  lastAcked: number;
  lastFail: string | null;
  step: number;
};

export function snapshotAt(step: number): DemoSnapshot {
  const n = Math.max(0, Math.min(step, 8));
  let ledger = createLedger({ issuerPubKey: ISSUER, merchantPubKey: MERCHANT });
  let agent: AgentStore | null = null;
  const invoices: MerchantInvoice[] = [];
  let pendingRepay = 0;
  let lastAcked = 0;
  let lastFail: string | null = null;
  let q40: { quote: QuotePreimage; Q: string } | null = null;
  let q120a: { quote: QuotePreimage; Q: string } | null = null;

  if (n >= 1) {
    const open = openLine(ledger, {
      caller: ISSUER,
      agentSecret: AGENT,
      limit: 150,
      salt: "demo-salt-0",
      expiry: 10_000,
    });
    if (!open.ok) throw new Error("demo open");
    ledger = open.ledger;
    agent = open.agent;
  }
  if (n >= 2 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT,
      amount: 40,
      invoiceId: "demo-40",
      expiry: 10_000,
      nonce: "n40",
    });
    if (!q.ok) throw new Error("demo q40");
    ledger = q.ledger;
    q40 = { quote: q.quote, Q: q.Q };
    invoices.push({ invoiceId: "demo-40", amount: 40, Q: q.Q, used: false, preimage: q.quote });
  }
  if (n >= 3 && agent && q40) {
    const d = draw(ledger, {
      agentSecret: AGENT,
      witness: agent.witness!,
      quote: q40.quote,
      newSalt: "demo-salt-1",
    });
    if (!d.ok) throw new Error("demo d40");
    ledger = d.ledger;
    agent = d.agent;
    pendingRepay = 40;
    invoices[0] = { ...invoices[0], used: true };
  }
  if (n >= 4 && agent && q40) {
    const replay = draw(ledger, {
      agentSecret: AGENT,
      witness: agent.witness!,
      quote: q40.quote,
      newSalt: "demo-salt-replay",
    });
    if (!replay.ok) lastFail = replay.message;
  }
  if (n >= 5 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT,
      amount: 120,
      invoiceId: "demo-120a",
      expiry: 10_000,
      nonce: "n120a",
    });
    if (!q.ok) throw new Error("demo q120a");
    ledger = q.ledger;
    q120a = { quote: q.quote, Q: q.Q };
    invoices.push({
      invoiceId: "demo-120a",
      amount: 120,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
    const fail = draw(ledger, {
      agentSecret: AGENT,
      witness: agent.witness!,
      quote: q.quote,
      newSalt: "demo-salt-fail",
    });
    if (!fail.ok) lastFail = fail.message;
  }
  if (n >= 6 && agent) {
    const ack = acknowledgeRepayment(ledger, {
      caller: ISSUER,
      witness: agent.witness!,
      receipt: {
        identity: agent.witness!.I,
        currentC: ledger.lineCommitment!,
        amount: 40,
        paymentRef: "demo-pay",
        nonce: "demo-r1",
        expiry: 10_000,
        contractId: CONTRACT_ID,
      },
      newSalt: "demo-salt-2",
    });
    if (!ack.ok) throw new Error("demo ack");
    ledger = ack.ledger;
    agent = { secret: AGENT, witness: ack.witness };
    pendingRepay = 0;
    lastAcked = 40;
  }
  if (n >= 7 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT,
      amount: 120,
      invoiceId: "demo-120b",
      expiry: 10_000,
      nonce: "n120b",
    });
    if (!q.ok) throw new Error("demo q120b");
    ledger = q.ledger;
    invoices.push({
      invoiceId: "demo-120b",
      amount: 120,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
    const d = draw(ledger, {
      agentSecret: AGENT,
      witness: agent.witness!,
      quote: q.quote,
      newSalt: "demo-salt-3",
    });
    if (!d.ok) throw new Error("demo d120");
    ledger = d.ledger;
    agent = d.agent;
    pendingRepay = 120;
    const last = invoices.length - 1;
    invoices[last] = { ...invoices[last], used: true };
  }
  if (n >= 8) {
    const frozen = setStatus(ledger, { caller: ISSUER, status: "defaulted" });
    if (!frozen.ok) throw new Error("demo status");
    ledger = frozen.ledger;
  }
  return { ledger, agent, invoices, pendingRepay, lastAcked, lastFail, step: n };
}
