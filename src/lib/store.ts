import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  acknowledgeRepayment,
  available,
  createLedger,
  draw,
  openLine,
  postQuote,
  setStatus,
} from "./protocol.ts";
import type {
  AgentStore,
  Ledger,
  QuotePreimage,
  RepayReceipt,
} from "./types.ts";
import { CONTRACT_ID } from "./types.ts";

export const ISSUER = "issuer-demo-key";
export const MERCHANT = "merchant-demo-key";
export const AGENT = "agent-demo-key";

export type MerchantInvoice = {
  invoiceId: string;
  amount: number;
  Q: string;
  used: boolean;
  preimage: QuotePreimage;
};

export type Flash = {
  tone: "ok" | "fail" | "info";
  text: string;
};

type LineState = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  pendingRepay: number;
  lastAcked: number;
  flash: Flash | null;
  demoStep: number;
  reset: () => void;
  setFlash: (flash: Flash | null) => void;
  doOpen: (limit?: number) => void;
  doQuote: (amount: number, invoiceId?: string) => void;
  doDraw: (Q: string) => void;
  doAck: (amount?: number) => void;
  doStatus: (status: "open" | "defaulted" | "closed") => void;
  runDemo: () => void;
};

function nonce() {
  return Math.random().toString(36).slice(2, 10);
}

const empty = () => ({
  ledger: createLedger({ issuerPubKey: ISSUER, merchantPubKey: MERCHANT }),
  agent: null as AgentStore | null,
  invoices: [] as MerchantInvoice[],
  pendingRepay: 0,
  lastAcked: 0,
  flash: null as Flash | null,
  demoStep: 0,
});

export const useLine = create<LineState>()(
  persist(
    (set, get) => ({
      ...empty(),
      setFlash: (flash) => set({ flash }),
      reset: () => set({ ...empty(), flash: { tone: "info", text: "Ledger reset." } }),
      doOpen: (limit = 150) => {
        const r = openLine(get().ledger, {
          caller: ISSUER,
          agentSecret: AGENT,
          limit,
          salt: `s-${nonce()}`,
          expiry: get().ledger.clock + 10_000,
        });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({
          ledger: r.ledger,
          agent: r.agent,
          flash: { tone: "ok", text: "Line opened. Limit stays in the agent store." },
          demoStep: 1,
        });
      },
      doQuote: (amount, invoiceId) => {
        const id = invoiceId ?? `inv-${amount}-${nonce()}`;
        const r = postQuote(get().ledger, {
          caller: MERCHANT,
          amount,
          invoiceId: id,
          expiry: get().ledger.clock + 10_000,
          nonce: nonce(),
        });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({
          ledger: r.ledger,
          invoices: [
            ...get().invoices,
            { invoiceId: id, amount, Q: r.Q, used: false, preimage: r.quote },
          ],
          flash: { tone: "ok", text: `Quote ${amount} posted as an opaque commitment.` },
        });
      },
      doDraw: (Q) => {
        const inv = get().invoices.find((i) => i.Q === Q);
        const agent = get().agent;
        if (!inv || !agent?.witness) {
          set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
          return;
        }
        const r = draw(get().ledger, {
          agentSecret: agent.secret,
          witness: agent.witness,
          quote: inv.preimage,
          newSalt: `s-${nonce()}`,
        });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({
          ledger: r.ledger,
          agent: r.agent,
          invoices: get().invoices.map((i) => (i.Q === Q ? { ...i, used: true } : i)),
          pendingRepay: get().pendingRepay + inv.amount,
          flash: {
            tone: "ok",
            text: `Draw authorized. Available ${available(r.agent.witness!)} (private).`,
          },
        });
      },
      doAck: (amount) => {
        const agent = get().agent;
        const C = get().ledger.lineCommitment;
        if (!agent?.witness || !C) {
          set({ flash: { tone: "fail", text: "No open line." } });
          return;
        }
        const R = amount ?? get().pendingRepay;
        const receipt: RepayReceipt = {
          identity: agent.witness.I,
          currentC: C,
          amount: R,
          paymentRef: `desk-${nonce()}`,
          nonce: nonce(),
          expiry: get().ledger.clock + 10_000,
          contractId: CONTRACT_ID,
        };
        const r = acknowledgeRepayment(get().ledger, {
          caller: ISSUER,
          witness: agent.witness,
          receipt,
          newSalt: `s-${nonce()}`,
        });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({
          ledger: r.ledger,
          agent: { ...agent, witness: r.witness },
          pendingRepay: Math.max(0, get().pendingRepay - R),
          lastAcked: R,
          flash: { tone: "ok", text: "Issuer acknowledged repayment. Capacity restored privately." },
        });
      },
      doStatus: (status) => {
        const r = setStatus(get().ledger, { caller: ISSUER, status });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({ ledger: r.ledger, flash: { tone: "ok", text: `Status → ${status}.` } });
      },
      runDemo: () => {
        const base = createLedger({ issuerPubKey: ISSUER, merchantPubKey: MERCHANT });
        const open = openLine(base, {
          caller: ISSUER,
          agentSecret: AGENT,
          limit: 150,
          salt: "demo-salt-0",
          expiry: 10_000,
        });
        if (!open.ok) return;
        const q40 = postQuote(open.ledger, {
          caller: MERCHANT,
          amount: 40,
          invoiceId: "demo-40",
          expiry: 10_000,
          nonce: "n40",
        });
        if (!q40.ok) return;
        const d40 = draw(q40.ledger, {
          agentSecret: AGENT,
          witness: open.agent.witness!,
          quote: q40.quote,
          newSalt: "demo-salt-1",
        });
        if (!d40.ok) return;
        const q120a = postQuote(d40.ledger, {
          caller: MERCHANT,
          amount: 120,
          invoiceId: "demo-120a",
          expiry: 10_000,
          nonce: "n120a",
        });
        if (!q120a.ok) return;
        const fail120 = draw(q120a.ledger, {
          agentSecret: AGENT,
          witness: d40.agent.witness!,
          quote: q120a.quote,
          newSalt: "demo-salt-fail",
        });
        const ack = acknowledgeRepayment(q120a.ledger, {
          caller: ISSUER,
          witness: d40.agent.witness!,
          receipt: {
            identity: d40.agent.witness!.I,
            currentC: d40.ledger.lineCommitment!,
            amount: 40,
            paymentRef: "demo-pay",
            nonce: "demo-r1",
            expiry: 10_000,
            contractId: CONTRACT_ID,
          },
          newSalt: "demo-salt-2",
        });
        if (!ack.ok) return;
        const q120b = postQuote(ack.ledger, {
          caller: MERCHANT,
          amount: 120,
          invoiceId: "demo-120b",
          expiry: 10_000,
          nonce: "n120b",
        });
        if (!q120b.ok) return;
        const d120 = draw(q120b.ledger, {
          agentSecret: AGENT,
          witness: ack.witness,
          quote: q120b.quote,
          newSalt: "demo-salt-3",
        });
        if (!d120.ok) return;
        const frozen = setStatus(d120.ledger, { caller: ISSUER, status: "defaulted" });
        if (!frozen.ok) return;
        set({
          ledger: frozen.ledger,
          agent: d120.agent,
          invoices: [
            { invoiceId: "demo-40", amount: 40, Q: q40.Q, used: true, preimage: q40.quote },
            {
              invoiceId: "demo-120a",
              amount: 120,
              Q: q120a.Q,
              used: false,
              preimage: q120a.quote,
            },
            {
              invoiceId: "demo-120b",
              amount: 120,
              Q: q120b.Q,
              used: true,
              preimage: q120b.quote,
            },
          ],
          pendingRepay: 120,
          lastAcked: 40,
          demoStep: 9,
          flash: {
            tone: fail120.ok ? "ok" : "info",
            text: "Scripted demo complete. 40 cleared, 120 blocked, issuer ack, 120 cleared, then defaulted.",
          },
        });
      },
    }),
    {
      name: "line.protocol.v1",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
    },
  ),
);
