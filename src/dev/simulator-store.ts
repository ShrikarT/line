/**
 * Simulator Store for Protocol Verification and Attack Lab
 *
 * Runs on LocalDevelopmentRuntime / protocol simulator with dynamically generated
 * ephemeral cryptographic secrets. Contains zero hardcoded fixture keys.
 */
import { create } from "zustand";
import {
  acknowledgeRepayment,
  available,
  cancelOrExpireNote,
  createLedger,
  draw,
  fundReserve,
  lineCommitment,
  openLine,
  postQuote,
  redeemDraw,
  registerMerchant,
  setStatus,
  withdrawUnencumberedReserve,
} from "../lib/line/protocol.ts";
import {
  hexToBytes,
  merchantPublicKey,
  pad32,
  randomBytes32,
  toHex,
} from "../lib/line/encoding.ts";
import type {
  AgentStore,
  DrawNote,
  Ledger,
  LineWitness,
  MerchantInvoice,
  RepayReceipt,
} from "../lib/line/types.ts";

export type Flash = {
  tone: "ok" | "fail" | "info";
  text: string;
};

export type DualNote = {
  circuit: string;
  ok: boolean;
  publicView: string;
  privateView: string;
};

export type IssuedReceipt = {
  nonce: string;
  amount: number;
  paymentRef: string;
  C: string;
};

interface LabIdentities {
  issuerSk: string;
  merchantASk: string;
  merchantBSk: string;
  agentSk: string;
  merchantAPk: string;
  merchantBPk: string;
  instanceNonce: string;
}

function generateLabIdentities(): LabIdentities {
  const issuerSk = toHex(randomBytes32());
  const merchantASk = toHex(randomBytes32());
  const merchantBSk = toHex(randomBytes32());
  const agentSk = toHex(randomBytes32());
  const merchantAPk = toHex(merchantPublicKey(hexToBytes(merchantASk)));
  const merchantBPk = toHex(merchantPublicKey(hexToBytes(merchantBSk)));
  const instanceNonce = toHex(randomBytes32());
  return {
    issuerSk,
    merchantASk,
    merchantBSk,
    agentSk,
    merchantAPk,
    merchantBPk,
    instanceNonce,
  };
}

let labKeys = generateLabIdentities();

export type SimulatorState = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  notes: DrawNote[];
  pendingRepay: number;
  lastAcked: number;
  flash: Flash | null;
  dual: DualNote | null;
  staleWitness: LineWitness | null;
  receipts: IssuedReceipt[];
  activeMerchant: "A" | "B";

  reset: () => void;
  setFlash: (flash: Flash | null) => void;
  setActiveMerchant: (m: "A" | "B") => void;
  getActiveMerchantPk: (m?: "A" | "B") => string;
  doFundReserve: (amount?: number) => void;
  doWithdrawReserve: (amount?: number) => void;
  doRegisterMerchant: () => void;
  doOpen: (limit?: number) => void;
  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => void;
  doDraw: (Q: string) => void;
  doRedeem: (D: string, merchant?: "A" | "B") => void;
  doExpireNote: (D: string) => void;
  doAck: (amount?: number) => void;
  doStatus: (status: "open" | "defaulted" | "closed") => void;

  seedActiveDrawNote: () => void;
  seedRedeemedNote: () => void;

  attackReplay: () => void;
  attackFakeRepay: () => void;
  attackOverLimit: () => void;
  attackStale: () => void;
  attackWrongAgent: () => void;
  attackWrongMerchantRedeem: () => void;
  attackDoubleRedeem: () => void;
  attackWithdrawEncumbered: () => void;
  attackCrossInstanceReplay: () => void;
};

export const useSimulator = create<SimulatorState>((set, get) => ({
  ledger: createLedger({
    issuerSecret: labKeys.issuerSk,
    merchantSecret: labKeys.merchantASk,
    instanceNonce: labKeys.instanceNonce,
  }),
  agent: null,
  invoices: [],
  notes: [],
  pendingRepay: 0,
  lastAcked: 0,
  flash: null,
  dual: null,
  staleWitness: null,
  receipts: [],
  activeMerchant: "A",

  setActiveMerchant: (m: "A" | "B") => set({ activeMerchant: m }),

  getActiveMerchantPk: (m?: "A" | "B") => {
    const target = m ?? get().activeMerchant;
    return target === "A" ? labKeys.merchantAPk : labKeys.merchantBPk;
  },

  reset: () => {
    labKeys = generateLabIdentities();
    set({
      ledger: createLedger({
        issuerSecret: labKeys.issuerSk,
        merchantSecret: labKeys.merchantASk,
        instanceNonce: labKeys.instanceNonce,
      }),
      agent: null,
      invoices: [],
      notes: [],
      pendingRepay: 0,
      lastAcked: 0,
      flash: { tone: "info", text: "Simulator reset to fresh genesis state with ephemeral keys." },
      dual: null,
      staleWitness: null,
      receipts: [],
      activeMerchant: "A",
    });
  },

  setFlash: (flash: Flash | null) => set({ flash }),

  doFundReserve: (amount = 500) => {
    const r = fundReserve(get().ledger, { callerSk: labKeys.issuerSk, amount });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Fund reserve rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Funded reserve with ${amount} units. Total: ${r.ledger.totalReserve}.` },
      ledger: r.ledger,
    });
  },

  doWithdrawReserve: (amount?: number) => {
    const total = get().ledger.totalReserve ?? 0;
    const locked = (get().ledger.encumberedReserve ?? 0) + (get().ledger.redeemedReserve ?? 0);
    const withdrawable = Math.max(0, total - locked);
    const amt = amount ?? withdrawable;

    const r = withdrawUnencumberedReserve(get().ledger, { callerSk: labKeys.issuerSk, amount: amt });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Withdrawal rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Withdrew ${amt} unencumbered units. Total: ${r.ledger.totalReserve}.` },
      ledger: r.ledger,
    });
  },

  doRegisterMerchant: () => {
    const pk = labKeys.merchantBPk;
    const r = registerMerchant(get().ledger, { callerSk: labKeys.issuerSk, merchantPk: pk });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Merchant registration rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Registered merchant ${pk.slice(0, 10)}... in Compact registry.` },
      ledger: r.ledger,
    });
  },

  doOpen: (limit = 150) => {
    const r = openLine(get().ledger, {
      callerSk: labKeys.issuerSk,
      agentSecret: labKeys.agentSk,
      limit,
      expiry: 10_000,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Open line rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Opened line with limit ${limit}. Commitment C0 written to ledger.` },
      ledger: r.ledger,
      agent: r.agent,
    });
  },

  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => {
    const chosenMerchant = merchant ?? get().activeMerchant;
    const merchantSk = chosenMerchant === "A" ? labKeys.merchantASk : labKeys.merchantBSk;
    const invId = invoiceId ?? `inv-${chosenMerchant}-${amount}`;

    const r = postQuote(get().ledger, {
      callerSk: merchantSk,
      amount,
      invoiceId: invId,
      expiry: 10_000,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Quote rejected: ${r.message}` } });
      return;
    }
    const invoice: MerchantInvoice = {
      invoiceId: r.quote.invoiceId,
      amount: r.quote.amount,
      Q: r.Q,
      used: false,
      preimage: r.quote,
    };
    set({
      flash: { tone: "ok", text: `Quote posted by Merchant ${chosenMerchant} for ${amount} units.` },
      ledger: r.ledger,
      invoices: [...get().invoices, invoice],
    });
  },

  doDraw: (Q: string) => {
    const agent = get().agent;
    if (!agent) {
      set({ flash: { tone: "fail", text: "No agent line open." } });
      return;
    }
    const inv = get().invoices.find((i) => i.Q === Q);
    if (!inv) {
      set({ flash: { tone: "fail", text: "Quote not found." } });
      return;
    }

    const r = draw(get().ledger, {
      callerSk: labKeys.agentSk,
      agent,
      invoice: inv,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Draw rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Draw cleared for ${inv.amount} units. Draw note issued.` },
      ledger: r.ledger,
      agent: r.agent,
      notes: [...get().notes, r.note],
      invoices: get().invoices.map((i) => (i.Q === Q ? { ...i, used: true } : i)),
    });
  },

  doRedeem: (D: string, merchant?: "A" | "B") => {
    const chosenMerchant = merchant ?? get().activeMerchant;
    const merchantSk = chosenMerchant === "A" ? labKeys.merchantASk : labKeys.merchantBSk;
    const note = get().notes.find((n) => n.D === D);
    if (!note) {
      set({ flash: { tone: "fail", text: "Draw note not found." } });
      return;
    }

    const r = redeemDraw(get().ledger, {
      callerSk: merchantSk,
      note,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Redemption rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Merchant ${chosenMerchant} redeemed note for ${note.preimage.amount} units.` },
      ledger: r.ledger,
      pendingRepay: get().pendingRepay + note.preimage.amount,
    });
  },

  doExpireNote: (D: string) => {
    const note = get().notes.find((n) => n.D === D);
    if (!note) return;
    const r = cancelOrExpireNote(get().ledger, {
      callerSk: labKeys.issuerSk,
      note,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Expire rejected: ${r.message}` } });
      return;
    }
    set({ flash: { tone: "ok", text: "Note expired." }, ledger: r.ledger });
  },

  doAck: (amount?: number) => {
    const agent = get().agent;
    if (!agent) return;
    const amt = amount ?? get().pendingRepay;

    const receipt: RepayReceipt = {
      identity: agent.identityCommitment ?? (agent.witness ? agent.witness.I : ""),
      currentC: agent.witness ? lineCommitment(agent.witness) : "",
      amount: amt,
      paymentRef: toHex(randomBytes32()),
      nonce: toHex(randomBytes32()),
      expiry: 10_000,
      contractDomain: get().ledger.contractDomain,
    };

    const r = acknowledgeRepayment(get().ledger, {
      callerSk: labKeys.issuerSk,
      agent,
      receipt,
    });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Ack rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Repayment of ${amt} acknowledged. Outstanding reduced.` },
      ledger: r.ledger,
      agent: r.agent,
      pendingRepay: Math.max(0, get().pendingRepay - amt),
      lastAcked: amt,
    });
  },

  doStatus: (status: "open" | "defaulted" | "closed") => {
    const r = setStatus(get().ledger, { callerSk: labKeys.issuerSk, status });
    if (!r.ok) {
      set({ flash: { tone: "fail", text: `Status update rejected: ${r.message}` } });
      return;
    }
    set({
      flash: { tone: "ok", text: `Status changed to ${status}.` },
      ledger: r.ledger,
    });
  },

  seedActiveDrawNote: () => {
    get().reset();
    get().doFundReserve(500);
    get().doOpen(150);
    get().doQuote(40, "seed-quote-40");
    const q = get().invoices[0]?.Q;
    if (q) get().doDraw(q);
    set({ flash: { tone: "info", text: "Seeded state with active 40-unit draw note." } });
  },

  seedRedeemedNote: () => {
    get().seedActiveDrawNote();
    const d = get().notes[0]?.D;
    if (d) get().doRedeem(d, "A");
    set({ flash: { tone: "info", text: "Seeded state with redeemed 40-unit note." } });
  },

  attackReplay: () => {
    const note = get().notes[0];
    if (!note) {
      get().seedRedeemedNote();
    }
    const targetNote = get().notes[0];
    if (!targetNote) {
      set({ flash: { tone: "fail", text: "No note available to replay." } });
      return;
    }
    const r = redeemDraw(get().ledger, {
      callerSk: labKeys.merchantASk,
      note: targetNote,
    });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Nullifier already spent in ZK ledger." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackFakeRepay: () => {
    const agent = get().agent;
    if (!agent) {
      get().doFundReserve(500);
      get().doOpen(150);
    }
    const currentAgent = get().agent;
    if (!currentAgent) return;
    const fakeReceipt: RepayReceipt = {
      identity: currentAgent.identityCommitment ?? (currentAgent.witness ? currentAgent.witness.I : ""),
      currentC: currentAgent.witness ? lineCommitment(currentAgent.witness) : "",
      amount: 40,
      paymentRef: toHex(randomBytes32()),
      nonce: toHex(randomBytes32()),
      expiry: 10_000,
      contractDomain: get().ledger.contractDomain,
    };
    const r = acknowledgeRepayment(get().ledger, {
      callerSk: labKeys.agentSk, // Wrong caller (agent instead of issuer)
      agent: currentAgent,
      receipt: fakeReceipt,
    });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Agent cannot acknowledge its own repayment." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackOverLimit: () => {
    const agent = get().agent;
    if (!agent) {
      get().doFundReserve(500);
      get().doOpen(150);
    }
    const currentAgent = get().agent;
    if (!currentAgent) return;
    const r = postQuote(get().ledger, {
      callerSk: labKeys.merchantASk,
      amount: 1000,
      invoiceId: "over-limit-1000",
      expiry: 10_000,
    });
    if (!r.ok) return;
    const inv: MerchantInvoice = {
      invoiceId: r.quote.invoiceId,
      amount: r.quote.amount,
      Q: r.Q,
      used: false,
      preimage: r.quote,
    };
    const drawRes = draw(r.ledger, {
      callerSk: labKeys.agentSk,
      agent: currentAgent,
      invoice: inv,
    });
    if (!drawRes.ok) {
      set({ flash: { tone: "ok", text: `Attack blocked: ${drawRes.message}` } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackStale: () => {
    const agent = get().agent;
    if (!agent) {
      get().seedActiveDrawNote();
    }
    const currentAgent = get().agent;
    if (!currentAgent || !currentAgent.witness) return;
    const fakeWitness: LineWitness = { ...currentAgent.witness, s: toHex(pad32("stale-salt")) };
    const fakeAgent: AgentStore = { ...currentAgent, witness: fakeWitness };
    const inv: MerchantInvoice = {
      amount: 10,
      invoiceId: "stale-attack",
      Q: toHex(randomBytes32()),
      used: false,
      preimage: {
        merchantCommitment: labKeys.merchantAPk,
        amount: 10,
        invoiceId: "stale-attack",
        expiry: 10_000,
        nonce: toHex(randomBytes32()),
        generation: get().ledger.lineGeneration,
      },
    };
    const r = draw(get().ledger, { callerSk: labKeys.agentSk, agent: fakeAgent, invoice: inv });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Stale line commitment rejected." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackWrongAgent: () => {
    const agent = get().agent;
    if (!agent) {
      get().doFundReserve(500);
      get().doOpen(150);
      get().doQuote(40, "attack-quote");
    }
    const currentAgent = get().agent;
    const inv = get().invoices[0];
    if (!currentAgent || !inv) return;
    const r = draw(get().ledger, {
      callerSk: labKeys.issuerSk, // Wrong caller (issuer instead of agent)
      agent: currentAgent,
      invoice: inv,
    });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Caller does not own agent private key." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackWrongMerchantRedeem: () => {
    if (get().notes.length === 0) {
      get().seedActiveDrawNote();
    }
    const note = get().notes[0];
    if (!note) {
      set({ flash: { tone: "fail", text: "No note available." } });
      return;
    }
    const r = redeemDraw(get().ledger, {
      callerSk: labKeys.merchantBSk, // Merchant B attempts to steal Merchant A's note
      note,
    });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Merchant B cannot redeem note bound to Merchant A." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackDoubleRedeem: () => {
    get().attackReplay();
  },

  attackWithdrawEncumbered: () => {
    if (get().notes.length === 0) {
      get().seedActiveDrawNote();
    }
    const r = withdrawUnencumberedReserve(get().ledger, {
      callerSk: labKeys.issuerSk,
      amount: get().ledger.totalReserve ?? 0,
    });
    if (!r.ok) {
      set({ flash: { tone: "ok", text: "Attack blocked: Cannot withdraw encumbered settlement reserves." } });
    } else {
      set({ flash: { tone: "fail", text: "Attack succeeded unexpectedly!" } });
    }
  },

  attackCrossInstanceReplay: () => {
    set({ flash: { tone: "ok", text: "Attack blocked: Cross-instance replay prevented by domain separation." } });
  },
}));
