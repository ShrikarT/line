import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  acknowledgeRepayment,
  available,
  cancelOrExpireNote,
  createLedger,
  draw,
  fundReserve,
  openLine,
  postQuote,
  redeemDraw,
  registerMerchant,
  setStatus,
  withdrawUnencumberedReserve,
} from "./protocol.ts";
import { snapshotAt, DEMO_STEPS } from "./demo.ts";
import {
  AGENT_SK,
  ISSUER_SK,
  MERCHANT_A_PK,
  MERCHANT_A_SK,
  MERCHANT_B_PK,
  MERCHANT_B_SK,
  MERCHANT_SK,
} from "./keys.ts";
import { randomBytes32, toHex } from "./encoding.ts";
import type {
  AgentStore,
  DrawNote,
  Ledger,
  LineWitness,
  MerchantInvoice,
  RepayReceipt,
} from "./types.ts";

export { AGENT_SK as AGENT, ISSUER_SK as ISSUER, MERCHANT_SK as MERCHANT } from "./keys.ts";
export type { MerchantInvoice, DrawNote } from "./types.ts";

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

export type LineState = {
  ledger: Ledger;
  agent: AgentStore | null;
  invoices: MerchantInvoice[];
  notes: DrawNote[];
  pendingRepay: number;
  lastAcked: number;
  flash: Flash | null;
  demoStep: number;
  dual: DualNote | null;
  staleWitness: LineWitness | null;
  receipts: IssuedReceipt[];
  activeMerchant: "A" | "B";

  reset: () => void;
  setFlash: (flash: Flash | null) => void;
  setActiveMerchant: (m: "A" | "B") => void;
  doFundReserve: (amount?: number) => void;
  doWithdrawReserve: (amount?: number) => void;
  doRegisterMerchant: (merchantPkOrSecret?: string) => void;
  doOpen: (limit?: number) => void;
  doQuote: (amount: number, invoiceId?: string, merchant?: "A" | "B") => void;
  doDraw: (Q: string) => void;
  doRedeem: (D: string, merchant?: "A" | "B") => void;
  doExpireNote: (D: string) => void;
  doAck: (amount?: number) => void;
  doStatus: (status: "open" | "defaulted" | "closed") => void;
  runDemo: () => void;
  setDemoStep: (step: number) => void;

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

function freshSalt() {
  return toHex(randomBytes32());
}

const empty = () => ({
  ledger: createLedger({ issuerSecret: ISSUER_SK, merchantSecret: MERCHANT_A_SK }),
  agent: null as AgentStore | null,
  invoices: [] as MerchantInvoice[],
  notes: [] as DrawNote[],
  pendingRepay: 0,
  lastAcked: 0,
  flash: null as Flash | null,
  demoStep: 0,
  dual: null as DualNote | null,
  staleWitness: null as LineWitness | null,
  receipts: [] as IssuedReceipt[],
  activeMerchant: "A" as const,
});

export const useLine = create<LineState>()(
  persist(
    (set, get) => ({
      ...empty(),
      setFlash: (flash) => set({ flash }),
      setActiveMerchant: (activeMerchant) => set({ activeMerchant }),
      reset: () => set({ ...empty(), flash: { tone: "info", text: "Ledger reset." } }),

      setDemoStep: (step) => {
        const snap = snapshotAt(step);
        const stepInfo = DEMO_STEPS[snap.step] ?? {
          title: `Step ${snap.step}`,
          publicView: "Public state updated.",
          privateView: "Private state updated.",
        };
        set({
          ledger: snap.ledger,
          agent: snap.agent,
          invoices: snap.invoices,
          notes: snap.notes,
          pendingRepay: snap.pendingRepay,
          lastAcked: snap.lastAcked,
          demoStep: snap.step,
          staleWitness: snap.agent?.witness ?? null,
          flash: {
            tone: snap.lastFail ? "info" : "ok",
            text: snap.lastFail ? `${stepInfo.title}: ${snap.lastFail}` : `${stepInfo.title} applied.`,
          },
          dual: {
            circuit: stepInfo.title,
            ok: !snap.lastFail,
            publicView: stepInfo.publicView,
            privateView: stepInfo.privateView,
          },
        });
      },

      doFundReserve: (amount = 500) => {
        const r = fundReserve(get().ledger, { caller: ISSUER_SK, amount });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.reason } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: `Funded reserve with ${amount}. Total reserve: ${r.ledger.totalReserve}.` },
          dual: {
            circuit: "fundReserve",
            ok: true,
            publicView: `Total reserve increased by ${amount}. Total reserve = ${r.ledger.totalReserve}.`,
            privateView: `Issuer liquidity deposited to back agent purchases.`,
          },
        });
      },

      doWithdrawReserve: (amount) => {
        const locked = (get().ledger.encumberedReserve ?? 0) + (get().ledger.redeemedReserve ?? 0);
        const withdrawable = Math.max(0, (get().ledger.totalReserve ?? 0) - locked);
        const toWithdraw = amount ?? withdrawable;
        const r = withdrawUnencumberedReserve(get().ledger, { caller: ISSUER_SK, amount: toWithdraw });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.reason } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: `Withdrew ${toWithdraw} unencumbered reserve.` },
          dual: {
            circuit: "withdrawUnencumberedReserve",
            ok: true,
            publicView: `Total reserve decreased by ${toWithdraw}.`,
            privateView: `Issuer withdrew unencumbered reserve capital.`,
          },
        });
      },

      doRegisterMerchant: (merchantPk = MERCHANT_B_PK) => {
        const r = registerMerchant(get().ledger, { caller: ISSUER_SK, merchantPk });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.reason } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: `Registered merchant ${merchantPk.slice(0, 10)}...` },
          dual: {
            circuit: "registerMerchant",
            ok: true,
            publicView: `Merchant public key registered for settlement.`,
            privateView: `Issuer onboarded merchant.`,
          },
        });
      },

      doOpen: (limit = 150) => {
        const r = openLine(get().ledger, {
          caller: ISSUER_SK,
          agentSecret: AGENT_SK,
          limit,
          salt: freshSalt(),
          expiry: get().ledger.actionClock + 10_000,
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
          demoStep: 3,
          dual: {
            circuit: "openLine",
            ok: true,
            publicView: "C0 published. Status open. Limit not on the ledger.",
            privateView: `L=${limit} B=0 available=${limit}.`,
          },
        });
      },

      doQuote: (amount, invoiceId, merchant) => {
        const m = merchant ?? get().activeMerchant;
        const caller = m === "B" ? MERCHANT_B_SK : MERCHANT_A_SK;
        const id = invoiceId ?? `inv-${m}-${amount}-${freshSalt().slice(0, 8)}`;
        const r = postQuote(get().ledger, {
          caller,
          amount,
          invoiceId: id,
          expiry: get().ledger.actionClock + 10_000,
          nonce: freshSalt(),
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
          flash: { tone: "ok", text: `Merchant ${m}: Quote ${amount} posted as opaque commitment.` },
          dual: {
            circuit: "postQuote",
            ok: true,
            publicView: "Opaque Q stored. Amount and merchant identity are confidential.",
            privateView: `Merchant ${m} invoice ${id} = ${amount}.`,
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
          newSalt: freshSalt(),
          noteNonce: freshSalt(),
          noteSalt: freshSalt(),
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
          notes: [...get().notes, r.note],
          pendingRepay: get().pendingRepay + inv.amount,
          flash: {
            tone: "ok",
            text: `Draw authorized. Note D created. Reserve encumbered. Available ${available(r.agent.witness!)} (private).`,
          },
          dual: {
            circuit: "draw",
            ok: true,
            publicView: `C rotated. Draw note D issued. Encumbered reserve + ${r.note.preimage.amount}.`,
            privateView: `B=${r.agent.witness!.B} available=${available(r.agent.witness!)}. Note delivered to merchant.`,
          },
        });
      },

      doRedeem: (D, merchant) => {
        const note = get().notes.find((n) => n.D === D);
        if (!note) {
          set({ flash: { tone: "fail", text: "Note opening not found in merchant store." } });
          return;
        }
        const m = merchant ?? (note.preimage.merchantPk === MERCHANT_B_PK ? "B" : "A");
        const caller = m === "B" ? MERCHANT_B_SK : MERCHANT_A_SK;
        const r = redeemDraw(get().ledger, {
          caller,
          noteCommitment: note.D,
          notePreimage: note.preimage,
          noteSalt: note.salt,
        });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.reason } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: `Merchant ${m} redeemed note for ${note.preimage.amount}. Reserve claimed.` },
          dual: {
            circuit: "redeemDraw",
            ok: true,
            publicView: `Redemption nullifier spent. Encumbered -> Redeemed reserve (${note.preimage.amount}).`,
            privateView: `Merchant ${m} claims settlement against issuer reserve.`,
          },
        });
      },

      doExpireNote: (D) => {
        const r = cancelOrExpireNote(get().ledger, { noteCommitment: D });
        if (!r.ok) {
          set({ flash: { tone: "fail", text: r.reason } });
          return;
        }
        set({
          ledger: r.ledger,
          flash: { tone: "ok", text: "Expired note cancelled and encumbered reserve released." },
          dual: {
            circuit: "cancelOrExpireNote",
            ok: true,
            publicView: "Note cancelled. Encumbered reserve returned to withdrawable.",
            privateView: "Expired credit claim reclaimed by issuer.",
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
        const n = freshSalt();
        const receipt: RepayReceipt = {
          identity: agent.witness.I,
          currentC: C,
          amount: R,
          paymentRef: `desk-${n.slice(0, 12)}`,
          nonce: n,
          expiry: get().ledger.actionClock + 10_000,
          contractDomain: get().ledger.contractDomain,
        };
        const r = acknowledgeRepayment(get().ledger, {
          caller: ISSUER_SK,
          witness: agent.witness,
          receipt,
          newSalt: freshSalt(),
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
        const r = setStatus(get().ledger, { caller: ISSUER_SK, status });
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

      runDemo: () => get().setDemoStep(DEMO_STEPS.length - 1),

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
          newSalt: freshSalt(),
          noteNonce: freshSalt(),
          noteSalt: freshSalt(),
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
          caller: AGENT_SK,
          witness: agent.witness,
          receipt: {
            identity: agent.witness.I,
            currentC: C,
            amount: Math.max(1, agent.witness.B || 1),
            paymentRef: "fake",
            nonce: freshSalt(),
            expiry: get().ledger.actionClock + 10_000,
            contractDomain: get().ledger.contractDomain,
          },
          newSalt: freshSalt(),
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
          caller: MERCHANT_A_SK,
          amount,
          invoiceId: `atk-over-${freshSalt().slice(0, 8)}`,
          expiry: get().ledger.actionClock + 10_000,
          nonce: freshSalt(),
        });
        if (!q.ok) {
          set({ flash: { tone: "fail", text: q.message } });
          return;
        }
        const r = draw(q.ledger, {
          agentSecret: agent.secret,
          witness: agent.witness,
          quote: q.quote,
          newSalt: freshSalt(),
          noteNonce: freshSalt(),
          noteSalt: freshSalt(),
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
          newSalt: freshSalt(),
          noteNonce: freshSalt(),
          noteSalt: freshSalt(),
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
          newSalt: freshSalt(),
          noteNonce: freshSalt(),
          noteSalt: freshSalt(),
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

      attackWrongMerchantRedeem: () => {
        const note = get().notes.find((n) => n.preimage.merchantPk === MERCHANT_A_PK && !get().ledger.notes.find((ln) => ln.commitment === n.D)?.redeemed);
        if (!note) {
          set({ flash: { tone: "info", text: "Create an active draw note for Merchant A first (or seed step 5)." } });
          return;
        }
        const r = redeemDraw(get().ledger, {
          caller: MERCHANT_B_SK, // Wrong merchant!
          noteCommitment: note.D,
          notePreimage: note.preimage,
          noteSalt: note.salt,
        });
        set({
          flash: {
            tone: r.ok ? "fail" : "ok",
            text: r.ok ? "Wrong merchant redeemed note — BUG!" : "Attack defeated: Merchant B cannot open Merchant A note.",
          },
          dual: {
            circuit: "redeemDraw (wrong merchant)",
            ok: r.ok,
            publicView: r.ok ? "BUG: Encumbered reserve claimed." : "Redemption rejected: note opening invalid.",
            privateView: r.ok ? "Theft" : "Merchant B secret does not match committed merchantPk.",
          },
        });
      },

      attackDoubleRedeem: () => {
        const redeemedNote = get().notes.find((n) => get().ledger.notes.find((ln) => ln.commitment === n.D)?.redeemed);
        if (!redeemedNote) {
          set({ flash: { tone: "info", text: "Redeem a note legitimately first (or seed step 7)." } });
          return;
        }
        const caller = redeemedNote.preimage.merchantPk === MERCHANT_B_PK ? MERCHANT_B_SK : MERCHANT_A_SK;
        const r = redeemDraw(get().ledger, {
          caller,
          noteCommitment: redeemedNote.D,
          notePreimage: redeemedNote.preimage,
          noteSalt: redeemedNote.salt,
        });
        set({
          flash: {
            tone: r.ok ? "fail" : "ok",
            text: r.ok ? "Double-redeem succeeded — BUG!" : "Attack defeated: Note already redeemed. Double-spend blocked.",
          },
          dual: {
            circuit: "redeemDraw (double-spend)",
            ok: r.ok,
            publicView: r.ok ? "BUG: Double reserve claim." : "Redemption rejected: note already redeemed.",
            privateView: r.ok ? "Double spend" : "Redemption nullifier already recorded.",
          },
        });
      },

      attackWithdrawEncumbered: () => {
        const ledger = get().ledger;
        if (ledger.encumberedReserve <= 0) {
          set({ flash: { tone: "info", text: "Encumber reserve first by drawing a note (or seed step 5)." } });
          return;
        }
        const r = withdrawUnencumberedReserve(ledger, {
          caller: ISSUER_SK,
          amount: ledger.totalReserve, // tries to withdraw everything including encumbered
        });
        set({
          flash: {
            tone: r.ok ? "fail" : "ok",
            text: r.ok ? "Encumbered withdrawal passed — BUG!" : "Attack defeated: Cannot withdraw encumbered reserve funds.",
          },
          dual: {
            circuit: "withdrawUnencumberedReserve (over-withdraw)",
            ok: r.ok,
            publicView: r.ok ? "BUG: Reserve drained." : "Withdrawal rejected: reserve is encumbered.",
            privateView: r.ok ? "Issuer rug" : "Total reserve minus locked must remain >= amount.",
          },
        });
      },

      attackCrossInstanceReplay: () => {
        const note = get().notes[0];
        if (!note) {
          set({ flash: { tone: "info", text: "Issue a note first (or seed step 5)." } });
          return;
        }
        const foreignLedger = createLedger({ instanceNonce: "99".repeat(32) });
        const caller = note.preimage.merchantPk === MERCHANT_B_PK ? MERCHANT_B_SK : MERCHANT_A_SK;
        const r = redeemDraw(foreignLedger, {
          caller,
          noteCommitment: note.D,
          notePreimage: note.preimage,
          noteSalt: note.salt,
        });
        set({
          flash: {
            tone: r.ok ? "fail" : "ok",
            text: r.ok ? "Cross-instance replay succeeded — BUG!" : "Attack defeated: Note not registered on foreign instance.",
          },
          dual: {
            circuit: "redeemDraw (cross-instance)",
            ok: r.ok,
            publicView: r.ok ? "BUG: Cross-instance note accepted." : "Rejection: note not present on target contract instance.",
            privateView: r.ok ? "Domain separation failed" : "contractDomain binding ensures instance isolation.",
          },
        });
      },
    }),
    {
      name: "line.protocol.v3",
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

