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
import { snapshotAt } from "./demo.ts";
import { AGENT, ISSUER, MERCHANT } from "./keys.ts";
import type {
  AgentStore,
  Ledger,
  LineWitness,
  MerchantInvoice,
  RepayReceipt,
} from "./types.ts";
import { CONTRACT_ID } from "./types.ts";

export { AGENT, ISSUER, MERCHANT } from "./keys.ts";
export type { MerchantInvoice } from "./types.ts";

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

type LineState = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  pendingRepay: number;
  lastAcked: number;
  flash: Flash | null;
  demoStep: number;
  dual: DualNote | null;
  staleWitness: LineWitness | null;
  receipts: IssuedReceipt[];
  reset: () => void;
  setFlash: (flash: Flash | null) => void;
  doOpen: (limit?: number) => void;
  doQuote: (amount: number, invoiceId?: string) => void;
  doDraw: (Q: string) => void;
  doAck: (amount?: number) => void;
  doStatus: (status: "open" | "defaulted" | "closed") => void;
  runDemo: () => void;
  setDemoStep: (step: number) => void;
  attackReplay: () => void;
  attackFakeRepay: () => void;
  attackOverLimit: () => void;
  attackStale: () => void;
  attackWrongAgent: () => void;
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
  dual: null as DualNote | null,
  staleWitness: null as LineWitness | null,
  receipts: [] as IssuedReceipt[],
});

export const useLine = create<LineState>()(
  persist(
    (set, get) => ({
      ...empty(),
      setFlash: (flash) => set({ flash }),
      reset: () => set({ ...empty(), flash: { tone: "info", text: "Ledger reset." } }),
      setDemoStep: (step) => {
        const snap = snapshotAt(step);
        const meta = [
          "Genesis",
          "openLine",
          "postQuote 40",
          "draw 40",
          "Replay",
          "Blocked 120",
          "Issuer ack 40",
          "draw 120",
          "Defaulted",
        ][snap.step];
        set({
          ledger: snap.ledger,
          agent: snap.agent,
          invoices: snap.invoices,
          pendingRepay: snap.pendingRepay,
          lastAcked: snap.lastAcked,
          demoStep: snap.step,
          staleWitness: snap.agent?.witness ?? null,
          flash: {
            tone: snap.lastFail ? "info" : "ok",
            text: snap.lastFail ? `${meta}: ${snap.lastFail}` : `${meta} applied.`,
          },
          dual: {
            circuit: meta ?? "demo",
            ok: !snap.lastFail,
            publicView: [
              "Empty public ledger.",
              "C0 + open. No limit.",
              "Opaque Q40.",
              "C0 → C1. Nullifier set.",
              "No new public transition.",
              "No new public transition.",
              "C1 → C2. Issuer ack.",
              "C2 → C3.",
              "Status defaulted.",
            ][snap.step]!,
            privateView: [
              "Keys only.",
              "L=150 B=0.",
              "Merchant holds 40.",
              "B=40 available=110.",
              "Replay rejected privately.",
              "40+120>150. Generic fail.",
              "B=0 available=150.",
              "B=120 available=30.",
              "Draws frozen.",
            ][snap.step]!,
          },
        });
      },
      doOpen: (limit = 150) => {
        const r = openLine(get().ledger, {
          caller: ISSUER,
          agentSecret: AGENT,
          limit,
          salt: `s-${nonce()}`,
          expiry: get().ledger.clock + 10_000,
        });
        if (!r.ok) {
          set({
            flash: { tone: "fail", text: r.message },
            dual: {
              circuit: "openLine",
              ok: false,
              publicView: "No state change.",
              privateView: r.reason,
            },
          });
          return;
        }
        set({
          ledger: r.ledger,
          agent: r.agent,
          flash: { tone: "ok", text: "Line opened. Limit stays in the agent store." },
          demoStep: 1,
          dual: {
            circuit: "openLine",
            ok: true,
            publicView: "C0 published. Status open. Limit not on the ledger.",
            privateView: `L=${limit} B=0 available=${limit}.`,
          },
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
          dual: {
            circuit: "postQuote",
            ok: true,
            publicView: "Opaque Q stored. Amount and merchant are not fields.",
            privateView: `Merchant invoice ${id} = ${amount}.`,
          },
        });
      },
      doDraw: (Q) => {
        const inv = get().invoices.find((i) => i.Q === Q);
        const agent = get().agent;
        if (!inv || !agent?.witness) {
          set({ flash: { tone: "fail", text: "Clearance could not be proven." } });
          return;
        }
        const prev = agent.witness;
        const r = draw(get().ledger, {
          agentSecret: agent.secret,
          witness: agent.witness,
          quote: inv.preimage,
          newSalt: `s-${nonce()}`,
        });
        if (!r.ok) {
          set({
            flash: { tone: "fail", text: r.message },
            dual: {
              circuit: "draw",
              ok: false,
              publicView: "No accepted transition.",
              privateView: "Clearance could not be proven.",
            },
          });
          return;
        }
        set({
          ledger: r.ledger,
          agent: r.agent,
          staleWitness: prev,
          invoices: get().invoices.map((i) => (i.Q === Q ? { ...i, used: true } : i)),
          pendingRepay: get().pendingRepay + inv.amount,
          flash: {
            tone: "ok",
            text: `Draw authorized. Available ${available(r.agent.witness!)} (private).`,
          },
          dual: {
            circuit: "draw",
            ok: true,
            publicView: "C rotated. Nullifier consumed. Amount hidden.",
            privateView: `B=${r.agent.witness!.B} available=${available(r.agent.witness!)}.`,
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
        const n = nonce();
        const receipt: RepayReceipt = {
          identity: agent.witness.I,
          currentC: C,
          amount: R,
          paymentRef: `desk-${n}`,
          nonce: n,
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
          receipts: [...get().receipts, { nonce: n, amount: R, paymentRef: receipt.paymentRef, C }],
          flash: { tone: "ok", text: "Issuer acknowledged repayment. Capacity restored privately." },
          dual: {
            circuit: "acknowledgeRepayment",
            ok: true,
            publicView: "C rotated under issuer authentication.",
            privateView: `B=${r.witness.B} available=${available(r.witness)}.`,
          },
        });
      },
      doStatus: (status) => {
        const r = setStatus(get().ledger, { caller: ISSUER, status });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.message } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: `Status → ${status}.` },
          dual: {
            circuit: "setStatus",
            ok: true,
            publicView: `Status is ${status}.`,
            privateView: "Books unchanged. Draws allowed only if open.",
          },
        });
      },
      runDemo: () => get().setDemoStep(8),
      attackReplay: () => {
        const used = get().invoices.find((i) => i.used);
        const agent = get().agent;
        if (!used || !agent?.witness) {
          set({ flash: { tone: "info", text: "Run a successful draw first." } });
          return;
        }
        const r = draw(get().ledger, {
          agentSecret: agent.secret,
          witness: agent.witness,
          quote: used.preimage,
          newSalt: "atk-replay",
        });
        set({
          flash: { tone: r.ok ? "fail" : "ok", text: r.ok ? "Replay unexpectedly succeeded." : r.message },
          dual: {
            circuit: "draw (replay)",
            ok: r.ok,
            publicView: r.ok ? "BUG: ledger moved." : "Ledger unchanged.",
            privateView: r.ok ? "Invariant broken." : "Nullifier / used quote rejected.",
          },
        });
      },
      attackFakeRepay: () => {
        const agent = get().agent;
        const C = get().ledger.lineCommitment;
        if (!agent?.witness || !C) {
          set({ flash: { tone: "info", text: "Open a line with outstanding first." } });
          return;
        }
        const r = acknowledgeRepayment(get().ledger, {
          caller: AGENT,
          witness: agent.witness,
          receipt: {
            identity: agent.witness.I,
            currentC: C,
            amount: Math.max(1, agent.witness.B || 1),
            paymentRef: "fake",
            nonce: "fake",
            expiry: get().ledger.clock + 10_000,
            contractId: CONTRACT_ID,
          },
          newSalt: "atk-fake",
        });
        set({
          flash: {
            tone: r.ok ? "fail" : "ok",
            text: r.ok ? "Fake repay succeeded — bug." : "Agent cannot authorize repayment.",
          },
          dual: {
            circuit: "acknowledgeRepayment (forged)",
            ok: r.ok,
            publicView: r.ok ? "BUG" : "No transition.",
            privateView: r.ok ? "Free credit" : "Issuer authentication required.",
          },
        });
      },
      attackOverLimit: () => {
        const agent = get().agent;
        if (!agent?.witness) {
          set({ flash: { tone: "info", text: "Open a line first." } });
          return;
        }
        const amount = agent.witness.L + 1;
        const q = postQuote(get().ledger, {
          caller: MERCHANT,
          amount,
          invoiceId: `atk-over-${nonce()}`,
          expiry: get().ledger.clock + 10_000,
          nonce: nonce(),
        });
        if (!q.ok) {
          set({ flash: { tone: "fail", text: q.message } });
          return;
        }
        const r = draw(q.ledger, {
          agentSecret: agent.secret,
          witness: agent.witness,
          quote: q.quote,
          newSalt: "atk-over",
        });
        set({
          ledger: q.ledger,
          invoices: [
            ...get().invoices,
            {
              invoiceId: q.quote.invoiceId,
              amount,
              Q: q.Q,
              used: false,
              preimage: q.quote,
            },
          ],
          flash: { tone: r.ok ? "fail" : "ok", text: r.ok ? "Over-limit passed — bug." : r.message },
          dual: {
            circuit: "draw (over-limit)",
            ok: r.ok,
            publicView: r.ok ? "BUG: C moved." : "No draw transition. Reason not published.",
            privateView: r.ok ? "Overspent." : "B + A > L rejected in-circuit.",
          },
        });
      },
      attackStale: () => {
        const stale = get().staleWitness;
        const agent = get().agent;
        const openInv = get().invoices.find((i) => !i.used);
        if (!stale || !agent || !openInv) {
          set({
            flash: {
              tone: "info",
              text: "Need a prior witness and a fresh quote. Draw once, then post another quote.",
            },
          });
          return;
        }
        const r = draw(get().ledger, {
          agentSecret: agent.secret,
          witness: stale,
          quote: openInv.preimage,
          newSalt: "atk-stale",
        });
        set({
          flash: { tone: r.ok ? "fail" : "ok", text: r.ok ? "Stale C accepted — bug." : r.message },
          dual: {
            circuit: "draw (stale C)",
            ok: r.ok,
            publicView: r.ok ? "BUG" : "No transition. Concurrent double-draw blocked.",
            privateView: r.ok ? "Two proofs spent one C." : "Witness does not open current C.",
          },
        });
      },
      attackWrongAgent: () => {
        const inv = get().invoices.find((i) => !i.used) ?? get().invoices[0];
        const agent = get().agent;
        if (!inv || !agent?.witness) {
          set({ flash: { tone: "info", text: "Need a quote and a line." } });
          return;
        }
        const r = draw(get().ledger, {
          agentSecret: "intruder-key",
          witness: agent.witness,
          quote: inv.preimage,
          newSalt: "atk-agent",
        });
        set({
          flash: { tone: r.ok ? "fail" : "ok", text: r.ok ? "Wrong agent passed — bug." : r.message },
          dual: {
            circuit: "draw (wrong agent)",
            ok: r.ok,
            publicView: r.ok ? "BUG" : "No transition.",
            privateView: r.ok ? "Identity broken." : "Secret does not own I.",
          },
        });
      },
    }),
    {
      name: "line.protocol.v2",
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
