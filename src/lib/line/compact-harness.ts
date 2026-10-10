/**
 * Compact simulator harness.
 * Instantiates the compiler-generated Contract and runs circuits through
 * compact-runtime. This is not a TypeScript reimplementation of the VM.
 */
import * as RT from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  ledger as compactLedger,
  Status,
  type Ledger as CompactLedger,
} from "../../../contracts/managed/line/contract/index.js";
import { issuerPublicKey, merchantPublicKey, pad32, randomBytes32 } from "./encoding.ts";

export { Status };

export type PrivateState = {
  callerSecret: Uint8Array;
  agentSecret: Uint8Array;
  salt: Uint8Array;
  newSalt: Uint8Array;
  invoiceId: Uint8Array;
  quoteNonce: Uint8Array;
  receiptNonce: Uint8Array;
  paymentRef: Uint8Array;
  noteNonce: Uint8Array;
  noteSalt: Uint8Array;
  noteIdentity: Uint8Array;
  noteQuoteCommit: Uint8Array;
  // Private witnesses (audit H1/H2/H3): the credit books, per-quote amounts,
  // and the quote's merchant travel as witnesses, never as public parameters.
  lineLimit: bigint;
  lineOutstanding: bigint;
  lineEpoch: bigint;
  quoteAmount: bigint;
  drawAmount: bigint;
  redeemAmount: bigint;
  repayAmount: bigint;
  quoteMerchantPk: Uint8Array;
};

export const COIN_PK = "0".repeat(64);
export const CONTRACT_ADDR = RT.dummyContractAddress();

export const WITNESSES = {
  callerSecret: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.callerSecret] as const,
  agentSecret: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.agentSecret] as const,
  salt: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.salt] as const,
  newSalt: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.newSalt] as const,
  invoiceId: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.invoiceId] as const,
  quoteNonce: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.quoteNonce] as const,
  receiptNonce: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.receiptNonce] as const,
  paymentRef: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.paymentRef] as const,
  noteNonce: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.noteNonce] as const,
  noteSalt: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.noteSalt] as const,
  noteIdentity: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.noteIdentity] as const,
  noteQuoteCommit: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.noteQuoteCommit] as const,
  lineLimit: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.lineLimit] as const,
  lineOutstanding: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.lineOutstanding] as const,
  lineEpoch: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.lineEpoch] as const,
  quoteAmount: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.quoteAmount] as const,
  drawAmount: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.drawAmount] as const,
  redeemAmount: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.redeemAmount] as const,
  repayAmount: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.repayAmount] as const,
  quoteMerchantPk: (ctx: { privateState: PrivateState }) => [ctx.privateState, ctx.privateState.quoteMerchantPk] as const,
};

export function blankPrivate(overrides: Partial<PrivateState> = {}): PrivateState {
  const z = new Uint8Array(32);
  return {
    callerSecret: z,
    agentSecret: z,
    salt: z,
    newSalt: z,
    invoiceId: z,
    quoteNonce: z,
    receiptNonce: z,
    paymentRef: z,
    noteNonce: z,
    noteSalt: z,
    noteIdentity: z,
    noteQuoteCommit: z,
    lineLimit: 0n,
    lineOutstanding: 0n,
    lineEpoch: 0n,
    quoteAmount: 0n,
    drawAmount: 0n,
    redeemAmount: 0n,
    repayAmount: 0n,
    quoteMerchantPk: z,
    ...overrides,
  };
}

export type Session = {
  contract: Contract<PrivateState>;
  state: RT.ContractState | RT.StateValue | RT.ChargedState;
  privateState: PrivateState;
  /** Trusted execution context for deterministic tests; never a circuit witness. */
  clock?: () => number;
};

export async function bootWithPk(
  issuerPk: Uint8Array,
  merchantPk: Uint8Array,
  instanceNonce?: Uint8Array,
  ps?: PrivateState,
  clock?: () => number,
): Promise<Session> {
  const privateState = ps ?? blankPrivate();
  const contract = new Contract(WITNESSES as never);
  const nonce = instanceNonce ?? randomBytes32();
  const init = await contract.initialState(
    RT.createConstructorContext(privateState, COIN_PK),
    issuerPk,
    merchantPk,
    nonce,
  );
  return {
    contract,
    state: init.currentContractState,
    privateState: init.currentPrivateState,
    clock,
  };
}

export async function boot(
  issuerSk: Uint8Array,
  merchantSk: Uint8Array,
  instanceNonce?: Uint8Array,
  ps?: PrivateState,
  clock?: () => number,
): Promise<Session> {
  const privateState = ps ?? blankPrivate({ callerSecret: issuerSk });
  const ipk = issuerPublicKey(issuerSk);
  const mpk = merchantPublicKey(merchantSk);
  return bootWithPk(ipk, mpk, instanceNonce, privateState, clock);
}

export function readLedger(session: Session): CompactLedger {
  const state = session.state as { data?: RT.ChargedState };
  if (state && "data" in state && state.data) return compactLedger(state.data);
  return compactLedger(session.state as RT.StateValue | RT.ChargedState);
}

function snapshotState(session: Session) {
  return session.state;
}

export type CircuitCall =
  | { name: "registerMerchant"; args: [Uint8Array] }
  | { name: "fundReserve"; args: [bigint] }
  | { name: "withdrawUnencumberedReserve"; args: [bigint] }
  | { name: "openLine"; args: [bigint, bigint?, bigint?] }
  | { name: "postQuote"; args: [bigint] }
  | { name: "draw"; args: [Uint8Array, bigint, bigint] }
  | { name: "redeemDraw"; args: [Uint8Array, bigint] }
  | { name: "cancelOrExpireNote"; args: [Uint8Array, bigint?, bigint?] }
  | { name: "disableMerchant"; args: [Uint8Array] }
  | { name: "withdrawFees"; args: [] }
  | { name: "acknowledgeRepayment"; args: [bigint] }
  | { name: "setStatus"; args: [Status] };

export type CallResult =
  | { ok: true; session: Session; ledger: CompactLedger }
  | { ok: false; session: Session; ledger: CompactLedger; error: string };

export async function call(session: Session, ps: PrivateState, op: CircuitCall): Promise<CallResult> {
  const before = snapshotState(session);
  const time = session.clock?.();
  if (time !== undefined && (!Number.isSafeInteger(time) || time < 0)) throw new Error("Invalid trusted execution time.");
  const ctx = RT.createCircuitContext(CONTRACT_ADDR, COIN_PK, before, ps, undefined, undefined, time);
  try {
    const circuits = session.contract.circuits;
    let result;
    if (op.name === "registerMerchant") result = await circuits.registerMerchant(ctx, ...op.args);
    else if (op.name === "fundReserve") result = await circuits.fundReserve(ctx, ...op.args);
    else if (op.name === "withdrawUnencumberedReserve") {
      result = await circuits.withdrawUnencumberedReserve(ctx, ...op.args);
    } else if (op.name === "openLine") result = await circuits.openLine(ctx, op.args[0], op.args[1] ?? 0n, op.args[2] ?? 0n);
    else if (op.name === "postQuote") result = await circuits.postQuote(ctx, ...op.args);
    else if (op.name === "draw") result = await circuits.draw(ctx, ...op.args);
    else if (op.name === "redeemDraw") result = await circuits.redeemDraw(ctx, ...op.args);
    else if (op.name === "cancelOrExpireNote") result = await circuits.cancelOrExpireNote(ctx, op.args[0], op.args[1] ?? 0n, op.args[2] ?? 0n);
    else if (op.name === "disableMerchant") result = await circuits.disableMerchant(ctx, ...op.args);
    else if (op.name === "withdrawFees") result = await circuits.withdrawFees(ctx, ...op.args);
    else if (op.name === "acknowledgeRepayment") {
      result = await circuits.acknowledgeRepayment(ctx, ...op.args);
    } else result = await circuits.setStatus(ctx, ...op.args);

    const next: Session = {
      contract: session.contract,
      state: result.context.currentQueryContext.state,
      privateState: result.context.currentPrivateState ?? ps,
      clock: session.clock,
    };
    return { ok: true, session: next, ledger: readLedger(next) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      session,
      ledger: readLedger(session),
      error: message,
    };
  }
}

export function firstQuote(ledger: CompactLedger): { Q: Uint8Array; expiry: bigint; lineGeneration: bigint; used: boolean } | null {
  for (const [Q, meta] of ledger.quotes) {
    return { Q, expiry: meta.expiry, lineGeneration: meta.lineGeneration, used: meta.used };
  }
  return null;
}

export function quotesOf(ledger: CompactLedger) {
  return [...ledger.quotes].map(([Q, meta]) => ({
    Q,
    expiry: meta.expiry,
    lineGeneration: meta.lineGeneration,
    used: meta.used,
  }));
}

export function notesOf(ledger: CompactLedger) {
  return [...ledger.notes].map(([D, meta]) => ({
    D,
    amount: meta.amount,
    fee: meta.fee,
    redeemed: meta.redeemed,
    cancelled: meta.cancelled,
    expiry: meta.expiry,
    lineGeneration: meta.lineGeneration,
    compensationAllocated: meta.compensationAllocated,
    refundCommitment: meta.refundCommitment,
    cashRefundOwed: meta.cashRefundOwed,
    refundAcknowledged: meta.refundAcknowledged,
    refundPaymentNullifier: meta.refundPaymentNullifier,
  }));
}

export function nullifiersOf(ledger: CompactLedger) {
  return [...ledger.nullifiers];
}
