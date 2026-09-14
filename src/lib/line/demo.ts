import {
  acknowledgeRepayment,
  createLedger,
  draw,
  openLine,
  postQuote,
  setStatus,
} from "./protocol.ts";
import type { AgentStore, Ledger, MerchantInvoice, QuotePreimage } from "./types.ts";
import { AGENT_SK, ISSUER_SK, MERCHANT_SK } from "./keys.ts";

export const DEMO_STEPS = [
  {
    id: 0,
    title: "Genesis",
    publicView: "Empty ledger. No line, no quotes, no nullifiers.",
    privateView: "Issuer, merchant, and agent secrets exist off-chain.",
  },
  {
    id: 1,
    title: "openLine 150",
    publicView: "Status open. Identity commitment and C0 published. Limit is absent.",
    privateView: "Agent store: L = 150, B = 0, available = 150.",
  },
  {
    id: 2,
    title: "Explorer check",
    publicView: "Public fields are I, C, status, clock. The digit 150 is not a ledger field.",
    privateView: "Same private books. Explorer cannot read L or B.",
  },
  {
    id: 3,
    title: "postQuote 40",
    publicView: "Opaque quote commitment Q40. No amount, no merchant name.",
    privateView: "Merchant invoice 40 is in the merchant store only.",
  },
  {
    id: 4,
    title: "draw 40",
    publicView: "C0 → C1. Nullifier inserted. Amount not disclosed.",
    privateView: "B = 40, available = 110. Issuer sees a pending off-chain 40.",
  },
  {
    id: 5,
    title: "Replay draw",
    publicView: "No new transition. Failed proofs write nothing.",
    privateView: "Clearance could not be proven. Quote already consumed.",
  },
  {
    id: 6,
    title: "draw 120 blocked",
    publicView: "Still C1. Explorer does not learn why.",
    privateView: "40 + 120 > 150. Generic failure only.",
  },
  {
    id: 7,
    title: "acknowledgeRepayment 40",
    publicView: "C1 → C2. Issuer-authenticated. Amount hidden.",
    privateView: "B = 0, available = 150. Receipt bound to C1.",
  },
  {
    id: 8,
    title: "draw 120",
    publicView: "C2 → C3. Second authorization for a new Q.",
    privateView: "B = 120, available = 30.",
  },
  {
    id: 9,
    title: "setStatus defaulted",
    publicView: "Status defaulted. Further draws rejected.",
    privateView: "Books still private. Capacity is frozen, not published.",
  },
  {
    id: 10,
    title: "draw after default",
    publicView: "No new transition. Status remains defaulted.",
    privateView: "Clearance could not be proven.",
  },
] as const;

export type DemoSnapshot = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  pendingRepay: number;
  lastAcked: number;
  lastFail: string | null;
  lastFailReason: string | null;
  step: number;
  replayRan: boolean;
  overLimitRan: boolean;
  postDefaultRan: boolean;
};

function expiry(ledger: Ledger) {
  return ledger.clock + 10_000;
}

export function snapshotAt(step: number): DemoSnapshot {
  const n = Math.max(0, Math.min(step, 10));
  let ledger = createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_SK });
  let agent: AgentStore | null = null;
  const invoices: MerchantInvoice[] = [];
  let pendingRepay = 0;
  let lastAcked = 0;
  let lastFail: string | null = null;
  let lastFailReason: string | null = null;
  let replayRan = false;
  let overLimitRan = false;
  let postDefaultRan = false;
  let q40: { quote: QuotePreimage; Q: string } | null = null;

  if (n >= 1) {
    const open = openLine(ledger, {
      caller: ISSUER_SK,
      agentSecret: AGENT_SK,
      limit: 150,
      salt: "demo-salt-0",
      expiry: expiry(ledger),
    });
    if (!open.ok) throw new Error("demo open");
    ledger = open.ledger;
    agent = open.agent;
  }
  if (n >= 3 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT_SK,
      amount: 40,
      invoiceId: "demo-40",
      expiry: expiry(ledger),
      nonce: "n40",
    });
    if (!q.ok) throw new Error("demo q40");
    ledger = q.ledger;
    q40 = { quote: q.quote, Q: q.Q };
    invoices.push({ invoiceId: "demo-40", amount: 40, Q: q.Q, used: false, preimage: q.quote });
  }
  if (n >= 4 && agent && q40) {
    const d = draw(ledger, {
      agentSecret: AGENT_SK,
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
  if (n >= 5 && agent && q40) {
    replayRan = true;
    const replay = draw(ledger, {
      agentSecret: AGENT_SK,
      witness: agent.witness!,
      quote: q40.quote,
      newSalt: "demo-salt-replay",
    });
    if (replay.ok) throw new Error("demo replay unexpectedly succeeded");
    lastFail = replay.message;
    lastFailReason = replay.reason;
  }
  if (n >= 6 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT_SK,
      amount: 120,
      invoiceId: "demo-120a",
      expiry: expiry(ledger),
      nonce: "n120a",
    });
    if (!q.ok) throw new Error("demo q120a");
    ledger = q.ledger;
    invoices.push({
      invoiceId: "demo-120a",
      amount: 120,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
    overLimitRan = true;
    const blocked = draw(ledger, {
      agentSecret: AGENT_SK,
      witness: agent.witness!,
      quote: q.quote,
      newSalt: "demo-salt-fail",
    });
    if (blocked.ok) throw new Error("demo over-limit unexpectedly succeeded");
    lastFail = blocked.message;
    lastFailReason = blocked.reason;
  }
  if (n >= 7 && agent) {
    const ack = acknowledgeRepayment(ledger, {
      caller: ISSUER_SK,
      witness: agent.witness!,
      receipt: {
        identity: agent.witness!.I,
        currentC: ledger.lineCommitment!,
        amount: 40,
        paymentRef: "demo-pay",
        nonce: "demo-r1",
        expiry: expiry(ledger),
        contractDomain: ledger.contractDomain,
      },
      newSalt: "demo-salt-2",
    });
    if (!ack.ok) throw new Error("demo ack");
    ledger = ack.ledger;
    agent = { secret: AGENT_SK, witness: ack.witness };
    pendingRepay = 0;
    lastAcked = 40;
  }
  if (n >= 8 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT_SK,
      amount: 120,
      invoiceId: "demo-120b",
      expiry: expiry(ledger),
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
      agentSecret: AGENT_SK,
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
  if (n >= 9) {
    const frozen = setStatus(ledger, { caller: ISSUER_SK, status: "defaulted" });
    if (!frozen.ok) throw new Error("demo status");
    ledger = frozen.ledger;
  }
  if (n >= 10 && agent) {
    const q = postQuote(ledger, {
      caller: MERCHANT_SK,
      amount: 10,
      invoiceId: "demo-after-default",
      expiry: expiry(ledger),
      nonce: "n-default",
    });
    if (!q.ok) throw new Error("demo q-default");
    ledger = q.ledger;
    invoices.push({
      invoiceId: "demo-after-default",
      amount: 10,
      Q: q.Q,
      used: false,
      preimage: q.quote,
    });
    postDefaultRan = true;
    const blocked = draw(ledger, {
      agentSecret: AGENT_SK,
      witness: agent.witness!,
      quote: q.quote,
      newSalt: "demo-salt-default",
    });
    if (blocked.ok) throw new Error("demo post-default unexpectedly succeeded");
    lastFail = blocked.message;
    lastFailReason = blocked.reason;
  }
  return {
    ledger,
    agent,
    invoices,
    pendingRepay,
    lastAcked,
    lastFail,
    lastFailReason,
    step: n,
    replayRan,
    overLimitRan,
    postDefaultRan,
  };
}
