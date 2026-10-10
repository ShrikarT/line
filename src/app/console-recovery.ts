import { validateRefundRecord, type AgentLineRecord, type DrawNoteRecord, type MerchantQuoteRecord, type RepaymentRecord, type RefundRecord } from "../lib/line/types.ts";
import type { LineRuntime, LedgerPublicStatus, RuntimeOperationOptions, RuntimeTransactionResult } from "../lib/runtime/types.ts";
import type { PrivateAgentRecord, PrivateIssuerRecord, PrivateMerchantRecord } from "./store.ts";
import { agentId, canonicalInvoiceIdBytes, canonicalPaymentReferenceBytes, drawNoteCommit, hexToBytes, lineStateCommit, merchantPublicKey, paymentNullifier, quoteCommit, refundCommit, requiredDrawFee, toHex } from "../lib/line/encoding.ts";
import { decodeVaultJson, encodeVaultJson } from "../lib/security/vault.ts";
import { fingerprintOperationIntent, type JournalOperationKind, type JournalOperation, type JournalScope, type OperationJournalLease, type JournalExpectedEffect } from "../lib/security/operation-journal.ts";

/** File provenance only. Never used as a Compact hash or commitment. */
export const LINE_SOURCE_FINGERPRINT = "35ebd14e19ce682230b685f6f3729923a9c56b0719eb17a684e44e4a39c73eff";
export interface ConsolePrivateState {
  agentLineRecord: AgentLineRecord | null;
  agentRecord: PrivateAgentRecord | null;
  issuerRecord: PrivateIssuerRecord | null;
  merchantRecord: PrivateMerchantRecord | null;
  merchantQuotes: MerchantQuoteRecord[];
  drawNotes: DrawNoteRecord[];
  repayments: RepaymentRecord[];
  refunds?: RefundRecord[];
  historicalAgentKeys?: Array<{ identityCommitment: string; agentSecret: string }>;
}
export interface ConsoleSnapshot {
  schema: "line:console-recovery/v1";
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  privateState: ConsolePrivateState;
  intent: { kind: JournalOperationKind; arguments: unknown[] } | null;
}
export interface ConsoleMutationContext {
  runtime: LineRuntime;
  address: string;
  ledger: LedgerPublicStatus;
  scope: JournalScope;
  lease: OperationJournalLease;
  before: ConsoleSnapshot;
  assertCurrent: () => void;
  operation: JournalOperation | null;
}
export function normalizeCommitment(value: string | null): string | null {
  if (value === null) return null;
  if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(value)) throw new Error("Invalid public commitment evidence.");
  return value.replace(/^0x/, "").toLowerCase();
}
const copy = <T,>(value: T): T => decodeVaultJson(encodeVaultJson(value)) as T;
export function snapshotConsole(state: ConsolePrivateState, ledger: LedgerPublicStatus, address: string): ConsoleSnapshot {
  return copy({ schema: "line:console-recovery/v1", networkId: ledger.networkId, contractAddress: address,
    contractDomain: normalizeCommitment(ledger.contractDomain)!, privateState: {
      agentLineRecord: state.agentLineRecord, agentRecord: state.agentRecord,
      issuerRecord: state.issuerRecord, merchantRecord: state.merchantRecord,
      merchantQuotes: state.merchantQuotes, drawNotes: state.drawNotes, repayments: state.repayments,
      refunds: state.refunds ?? [],
      historicalAgentKeys: state.historicalAgentKeys ?? [],
    }, intent: null });
}
export function consoleJournalScope(runtime: LineRuntime, ledger: LedgerPublicStatus): JournalScope {
  const address = runtime.getContractAddress();
  if (!address) throw new Error("Configure a contract before creating operation intents.");
  return { networkId: runtime.networkId, contractAddress: runtime.mode === "network"
    ? normalizeCommitment(address)! : normalizeCommitment(ledger.contractDomain)!, sourceFingerprint: LINE_SOURCE_FINGERPRINT };
}
function safeUnits(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Recovery requires bounded integer accounting values.");
  return value;
}
const bytes32 = (value: string) => hexToBytes(normalizeCommitment(value)!);
/** Retire a previous generation's book while preserving only its original key. */
export function retireHistoricalBook(state: ConsolePrivateState, currentGeneration: string): ConsolePrivateState {
  const retired = copy(state);
  const line = retired.agentLineRecord;
  if (!line || BigInt(safeUnits(line.lineGeneration)) >= BigInt(currentGeneration)) return retired;
  const identity = toHex(agentId(bytes32(line.agentSecret)));
  if (identity !== normalizeCommitment(line.identityCommitment)) throw new Error("Historical agent key does not match its identity.");
  const keys = retired.historicalAgentKeys ?? [];
  if (!keys.some(key => normalizeCommitment(key.identityCommitment) === identity)) keys.push({ identityCommitment: identity, agentSecret: line.agentSecret });
  retired.historicalAgentKeys = keys;
  retired.agentLineRecord = null;
  retired.agentRecord = null;
  return retired;
}
/** Pure preparation shared by the console action and its durable journal. */
export function buildCompensationCandidate(before: ConsolePrivateState, ledger: LedgerPublicStatus, address: string,
  compensation: NonNullable<RuntimeOperationOptions["compensation"]>, noteCommitment: string):
  { line: AgentLineRecord | null; note: DrawNoteRecord; refund: RefundRecord } {
  const terms = compensation.note;
  const D = normalizeCommitment(noteCommitment)!;
  const identity = normalizeCommitment(terms.identity)!;
  const domain = normalizeCommitment(ledger.contractDomain)!;
  const amount = safeUnits(terms.amount), fee = safeUnits(terms.fee), cost = safeUnits(amount + fee);
  if (!amount) throw new Error("Invalid compensation purchase amount.");
  const generation = safeUnits(terms.lineGeneration);
  const expiry = safeUnits(terms.expiry);
  const currentGeneration = safeUnits(ledger.lineGeneration);
  const opened = toHex(drawNoteCommit({ domain: bytes32(domain), lineGeneration: BigInt(generation), identity: bytes32(identity),
    quoteCommit: bytes32(terms.quoteCommit), merchantPk: bytes32(terms.merchantPk), amount: BigInt(amount), fee: BigInt(fee),
    noteNonce: bytes32(terms.noteNonce), expiry: BigInt(expiry) }, bytes32(compensation.noteSalt)));
  if (opened !== D || generation > currentGeneration || generation === 0) throw new Error("Invalid compensation note opening or generation.");
  if ((before.refunds ?? []).some(refund => normalizeCommitment(refund.noteCommitment) === D)) throw new Error("Compensation already has a private allocation; reconcile its original operation.");
  let line = before.agentLineRecord ? copy(before.agentLineRecord) : null;
  let allocatedCredit = 0;
  if (generation === currentGeneration) {
    const book = compensation.book;
    if (!book || !line || normalizeCommitment(ledger.identityCommitment) !== identity ||
        line.networkId !== ledger.networkId || line.contractAddress !== address || normalizeCommitment(line.contractDomain) !== domain ||
        line.lineGeneration !== generation || toHex(agentId(bytes32(line.agentSecret))) !== identity) throw new Error("Current compensation requires the authentic private line opening.");
    const limit = safeUnits(book.limit), outstanding = safeUnits(book.outstanding), epoch = safeUnits(book.epoch);
    if (outstanding > limit) throw new Error("Invalid compensation private accounting.");
    const current = toHex(lineStateCommit({ domain: bytes32(domain), identity: bytes32(identity), limit: BigInt(limit), outstanding: BigInt(outstanding), epoch: BigInt(epoch) }, bytes32(book.salt)));
    if (current !== normalizeCommitment(ledger.lineCommitment) || current !== normalizeCommitment(line.lineCommitment) ||
        line.limit !== limit || line.outstanding !== outstanding || line.epoch !== epoch || normalizeCommitment(line.salt) !== normalizeCommitment(book.salt) ||
        line.feeFlat !== safeUnits(ledger.feeFlat) || line.feeBps !== safeUnits(ledger.feeBps)) throw new Error("Stale compensation book.");
    allocatedCredit = Math.min(outstanding, cost);
    const nextOutstanding = outstanding - allocatedCredit;
    const nextEpoch = safeUnits(epoch + 1);
    const nextC = toHex(lineStateCommit({ domain: bytes32(domain), identity: bytes32(identity), limit: BigInt(limit), outstanding: BigInt(nextOutstanding), epoch: BigInt(nextEpoch) }, bytes32(compensation.newSalt)));
    line = { ...line, outstanding: nextOutstanding, epoch: nextEpoch, salt: compensation.newSalt, lineCommitment: nextC, updatedAt: Date.now() };
  }
  const owed = cost - allocatedCredit;
  const commitment = toHex(refundCommit({ domain: bytes32(domain), lineGeneration: BigInt(generation), identity: bytes32(identity), noteCommit: bytes32(D), amount: BigInt(owed) }, bytes32(compensation.newSalt)));
  const existing = before.drawNotes.find(note => normalizeCommitment(note.noteCommitment) === D);
  const note: DrawNoteRecord = { ...(existing ?? {}), version: 1, networkId: ledger.networkId, contractAddress: address,
    contractDomain: domain, lineGeneration: generation, identityCommitment: identity, quoteCommitment: terms.quoteCommit,
    merchantPublicKey: terms.merchantPk, amount, fee, noteNonce: terms.noteNonce, noteSalt: compensation.noteSalt,
    expiry, noteCommitment: D, status: "expired", updatedAt: Date.now() };
  const refund: RefundRecord = { version: 1, networkId: ledger.networkId, contractAddress: address, contractDomain: domain,
    lineGeneration: generation, identityCommitment: identity, noteCommitment: D, refundCommitment: commitment,
    amount: owed, allocatedCredit, salt: compensation.newSalt, status: "allocated", updatedAt: Date.now() };
  return { line, note, refund };
}
function candidateLine(params: any, context: ConsoleMutationContext, kind: JournalOperationKind): AgentLineRecord {
  const identity = agentId(hexToBytes(params.agentSecret));
  const limit = safeUnits(params.limit);
  const outstanding = kind === "openLine" ? 0 : kind === "draw"
    ? safeUnits(safeUnits(params.outstanding) + safeUnits(params.amount) + safeUnits(Number(params.fee ?? 0)))
    : safeUnits(safeUnits(params.outstanding) - safeUnits(params.amount));
  const epoch = kind === "openLine" ? 0 : safeUnits(safeUnits(params.epoch) + 1);
  const salt = kind === "openLine" ? params.salt : params.newSalt;
  const commitment = lineStateCommit({ domain: hexToBytes(context.ledger.contractDomain), identity, limit: BigInt(limit), outstanding: BigInt(outstanding), epoch: BigInt(epoch) }, hexToBytes(salt));
  return { version: 1, networkId: context.runtime.networkId, contractAddress: context.address,
    feeFlat: kind === "openLine" ? safeUnits(params.feeFlat ?? 0) : safeUnits(context.ledger.feeFlat),
    feeBps: kind === "openLine" ? safeUnits(params.feeBps ?? 0) : safeUnits(context.ledger.feeBps),
    contractDomain: context.ledger.contractDomain, agentSecret: params.agentSecret,
    identityCommitment: toHex(identity), lineCommitment: toHex(commitment), limit, outstanding, epoch, salt,
    lineGeneration: kind === "openLine" ? safeUnits(context.ledger.lineGeneration + 1) : context.ledger.lineGeneration,
    updatedAt: Date.now() };
}
/** Compute and save the actual opening, note and terms before any execution can occur. */
export function candidateConsole(context: ConsoleMutationContext, kind: JournalOperationKind, args: unknown[]): ConsoleSnapshot {
  const candidate = copy(context.before);
  candidate.intent = { kind, arguments: copy(args) };
  const state = candidate.privateState;
  const params = args[0] as any;
  if (kind === "openLine" || kind === "draw" || kind === "acknowledgeRepayment") {
    if (kind === "acknowledgeRepayment") canonicalPaymentReferenceBytes(params.paymentRef);
    const line = candidateLine(params, context, kind);
    state.agentLineRecord = line;
    state.agentRecord = { agentSecret: line.agentSecret, identityCommitment: line.identityCommitment,
      lineCommitment: line.lineCommitment, L: line.limit, B: line.outstanding, epoch: line.epoch, salt: line.salt };
    if (kind === "draw") {
      const expiry = safeUnits(Number(params.noteExpiry ?? params.expiry));
      const note: DrawNoteRecord = { version: 1, networkId: context.runtime.networkId, contractAddress: context.address,
        contractDomain: context.ledger.contractDomain, lineGeneration: context.ledger.lineGeneration,
        identityCommitment: line.identityCommitment, quoteCommitment: params.quoteCommit, merchantPublicKey: params.merchantPk,
        amount: safeUnits(params.amount), fee: safeUnits(Number(params.fee ?? 0)), noteNonce: params.noteNonce, noteSalt: params.noteSalt, expiry, status: "active",
        noteCommitment: toHex(drawNoteCommit({ domain: hexToBytes(context.ledger.contractDomain), lineGeneration: BigInt(context.ledger.lineGeneration),
          identity: hexToBytes(line.identityCommitment), quoteCommit: hexToBytes(params.quoteCommit), merchantPk: hexToBytes(params.merchantPk),
          amount: BigInt(params.amount), fee: BigInt(params.fee ?? 0), noteNonce: hexToBytes(params.noteNonce), expiry: BigInt(expiry) }, hexToBytes(params.noteSalt))), updatedAt: Date.now() };
      state.drawNotes.push(note);
      state.merchantQuotes = state.merchantQuotes.map(q => q.quoteCommitment === params.quoteCommit ? { ...q, status: "consumed" } : q);
    } else if (kind === "acknowledgeRepayment") {
      state.repayments.push({ version: 1, networkId: context.runtime.networkId, contractAddress: context.address,
        identityCommitment: line.identityCommitment, currentLineCommitment: line.lineCommitment, amount: params.amount,
        receiptNonce: params.receiptNonce, paymentReference: params.paymentRef, expiry: params.receiptExpiry,
        status: "acknowledged", updatedAt: Date.now() });
    }
  } else if (kind === "postQuote") {
    const merchantPk = toHex(merchantPublicKey(hexToBytes(params.merchantSk)));
    const invoiceId = canonicalInvoiceIdBytes(params.invoiceId);
    state.merchantQuotes.push({ version: 1, networkId: context.runtime.networkId, contractAddress: context.address,
      merchantPublicKey: merchantPk, invoiceIdBytes: toHex(invoiceId), displayInvoiceId: params.invoiceId, amount: params.amount,
      expiry: params.expiry, quoteNonce: params.nonce, lineGeneration: context.ledger.lineGeneration, status: "open", updatedAt: Date.now(),
      feePolicy: "flat-plus-ceil-bps-v1", feeFlat: safeUnits(context.ledger.feeFlat), feeBps: safeUnits(context.ledger.feeBps),
      fee: safeUnits(Number(requiredDrawFee(BigInt(params.amount), BigInt(safeUnits(context.ledger.feeFlat)), BigInt(safeUnits(context.ledger.feeBps))))),
      quoteCommitment: toHex(quoteCommit({ merchantPk: hexToBytes(merchantPk), invoiceId, amount: BigInt(params.amount), expiry: BigInt(params.expiry),
        feeFlat: BigInt(safeUnits(context.ledger.feeFlat)), feeBps: BigInt(safeUnits(context.ledger.feeBps)),
        nonce: hexToBytes(params.nonce), generation: BigInt(context.ledger.lineGeneration), domain: hexToBytes(context.ledger.contractDomain) })) });
  } else if (kind === "redeemDraw") {
    if (!state.drawNotes.some(note => note.noteCommitment === params.noteCommit)) {
      state.drawNotes.push({ version: 1, networkId: context.runtime.networkId, contractAddress: context.address,
        contractDomain: context.ledger.contractDomain, lineGeneration: safeUnits(params.noteGeneration ?? context.ledger.lineGeneration),
        identityCommitment: params.noteIdentity, quoteCommitment: params.noteQuoteCommit,
        merchantPublicKey: toHex(merchantPublicKey(hexToBytes(params.merchantSk))), amount: params.amount, fee: safeUnits(params.fee),
        noteNonce: params.noteNonce, noteSalt: params.noteSalt, expiry: params.noteExpiry ?? params.expiry,
        noteCommitment: params.noteCommit, status: "active", updatedAt: Date.now() });
    }
    state.drawNotes = state.drawNotes.map(note => note.noteCommitment === params.noteCommit ? { ...note, status: "redeemed" } : note);
  } else if (kind === "cancelOrExpireNote") {
    state.drawNotes = state.drawNotes.map(note => note.noteCommitment === params ? { ...note, status: "expired" } : note);
    const options = args[2] as RuntimeOperationOptions | undefined;
    if (options?.compensation && options.refundAck) throw new Error("Choose one compensation action.");
    if (options?.compensation) {
      if (options.compensation.note.lineGeneration < context.ledger.lineGeneration) Object.assign(state, retireHistoricalBook(state, String(context.ledger.lineGeneration)));
      const prepared = buildCompensationCandidate(state, context.ledger, context.address, options.compensation, params);
      state.agentLineRecord = prepared.line;
      if (prepared.line && options.compensation.note.lineGeneration === context.ledger.lineGeneration) {
        const line = prepared.line;
        state.agentRecord = { agentSecret: line.agentSecret, identityCommitment: line.identityCommitment, lineCommitment: line.lineCommitment,
          L: line.limit, B: line.outstanding, epoch: line.epoch, salt: line.salt };
      }
      state.drawNotes = [...state.drawNotes.filter(note => normalizeCommitment(note.noteCommitment) !== normalizeCommitment(params)), prepared.note];
      state.refunds = [...(state.refunds ?? []), prepared.refund];
    } else if (options?.refundAck) {
      const ack = options.refundAck;
      canonicalPaymentReferenceBytes(ack.paymentRef);
      safeUnits(ack.receiptExpiry);
      const refund = (state.refunds ?? []).find(record => normalizeCommitment(record.noteCommitment) === normalizeCommitment(params));
      if (!refund || refund.status !== "allocated" || safeUnits(ack.amount) === 0 || refund.amount !== ack.amount ||
          normalizeCommitment(ack.identity) !== normalizeCommitment(refund.identityCommitment) || normalizeCommitment(ack.salt) !== normalizeCommitment(refund.salt)) throw new Error("Reported refund does not open the stored private allocation.");
      state.refunds = state.refunds!.map(record => record === refund ? { ...record, status: "issuer-reported", paymentReference: ack.paymentRef,
        receiptExpiry: ack.receiptExpiry, updatedAt: Date.now() } : record);
    }
  }
  return candidate;
}
export function recoveredConsole(operation: JournalOperation, runtime: LineRuntime, domain: string): ConsolePrivateState {
  const snapshot = copy(operation.candidateSnapshot) as ConsoleSnapshot;
  if (!snapshot || snapshot.schema !== "line:console-recovery/v1" || snapshot.networkId !== runtime.networkId ||
      snapshot.contractAddress !== runtime.getContractAddress() || snapshot.contractDomain !== normalizeCommitment(domain)) throw new Error("Recovery snapshot belongs to another contract instance.");
  const state = snapshot.privateState;
  if (!state || !Array.isArray(state.merchantQuotes) || !Array.isArray(state.drawNotes) || !Array.isArray(state.repayments)) throw new Error("Malformed recovery snapshot.");
  if (state.refunds !== undefined && !Array.isArray(state.refunds)) throw new Error("Malformed refund recovery snapshot.");
  state.refunds ??= [];
  state.historicalAgentKeys ??= [];
  if (!Array.isArray(state.historicalAgentKeys) || state.historicalAgentKeys.some(key => !key ||
      toHex(agentId(bytes32(key.agentSecret))) !== normalizeCommitment(key.identityCommitment))) throw new Error("Invalid recovered historical agent keys.");
  for (const value of state.refunds) {
    const refund = validateRefundRecord(value);
    if (refund.networkId !== runtime.networkId || refund.contractAddress !== runtime.getContractAddress() ||
        normalizeCommitment(refund.contractDomain) !== normalizeCommitment(domain) ||
        toHex(refundCommit({ domain: bytes32(refund.contractDomain), lineGeneration: BigInt(safeUnits(refund.lineGeneration)),
          identity: bytes32(refund.identityCommitment), noteCommit: bytes32(refund.noteCommitment), amount: BigInt(safeUnits(refund.amount)) }, bytes32(refund.salt))) !== normalizeCommitment(refund.refundCommitment)) throw new Error("Recovered private refund opening does not match its commitment or instance.");
  }
  const line = state.agentLineRecord;
  if (line) {
    const identity = agentId(hexToBytes(line.agentSecret));
    const computed = toHex(lineStateCommit({ domain: hexToBytes(line.contractDomain), identity, limit: BigInt(safeUnits(line.limit)), outstanding: BigInt(safeUnits(line.outstanding)),
      epoch: BigInt(safeUnits(line.epoch)) }, hexToBytes(line.salt)));
    if (computed !== normalizeCommitment(line.lineCommitment) || toHex(identity) !== normalizeCommitment(line.identityCommitment)) throw new Error("Recovered credit opening does not match its commitment.");
  }
  const transaction = operation.receipt?.txHash ?? operation.transactionId ?? undefined;
  const args = snapshot.intent?.arguments as any[] | undefined;
  if (operation.kind === "draw" && transaction && args) {
    const quote = (args[0] as any).quoteCommit;
    state.drawNotes = state.drawNotes.map(note => note.quoteCommitment === quote ? { ...note, drawTransactionId: transaction } : note);
  } else if (operation.kind === "redeemDraw" && transaction && args) {
    const note = (args[0] as any).noteCommit;
    state.drawNotes = state.drawNotes.map(item => item.noteCommitment === note ? { ...item, redemptionTransactionId: transaction } : item);
  } else if (operation.kind === "acknowledgeRepayment" && transaction && args) {
    const reference = (args[0] as any).paymentRef;
    state.repayments = state.repayments.map(item => item.paymentReference === reference ? { ...item, transactionId: transaction } : item);
  } else if (operation.kind === "cancelOrExpireNote" && transaction && args) {
    state.refunds = state.refunds.map(item => item.noteCommitment === args[0] ? { ...item, transactionId: transaction } : item);
  }
  return state;
}
const runtimeCircuits: Record<string, { kind: JournalOperationKind; optionsIndex: number }> = {
  fundReserve: { kind: "fundReserve", optionsIndex: 2 }, withdrawReserve: { kind: "withdrawUnencumberedReserve", optionsIndex: 2 },
  withdrawFees: { kind: "withdrawFees", optionsIndex: 1 }, registerMerchant: { kind: "registerMerchant", optionsIndex: 2 },
  disableMerchant: { kind: "disableMerchant", optionsIndex: 2 }, openLine: { kind: "openLine", optionsIndex: 1 },
  postQuote: { kind: "postQuote", optionsIndex: 1 }, draw: { kind: "draw", optionsIndex: 1 }, redeemDraw: { kind: "redeemDraw", optionsIndex: 1 },
  cancelOrExpireNote: { kind: "cancelOrExpireNote", optionsIndex: 2 }, acknowledgeRepayment: { kind: "acknowledgeRepayment", optionsIndex: 1 },
  setStatus: { kind: "setStatus", optionsIndex: 2 },
};
/** Only the existing twelve runtime mutation methods are mediated; no additional Compact circuit. */
export function journaledRuntime(context: ConsoleMutationContext): LineRuntime {
  return new Proxy(context.runtime, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    const spec = runtimeCircuits[String(property)];
    if (!spec) return value.bind(target);
    return async (...args: unknown[]): Promise<RuntimeTransactionResult> => {
      context.assertCurrent();
      const actualArgs = args.slice(0, spec.optionsIndex);
      const priorOptions = args[spec.optionsIndex] as RuntimeOperationOptions | undefined;
      const witnessOptions = { ...(priorOptions?.closingBook ? { closingBook: priorOptions.closingBook } : {}),
        ...(priorOptions?.compensation ? { compensation: priorOptions.compensation } : {}), ...(priorOptions?.refundAck ? { refundAck: priorOptions.refundAck } : {}) };
      const intentArgs = Object.keys(witnessOptions).length ? [...actualArgs, witnessOptions] : actualArgs;
      if (priorOptions?.closingBook) {
        safeUnits(priorOptions.closingBook.limit); safeUnits(priorOptions.closingBook.outstanding); safeUnits(priorOptions.closingBook.epoch);
        if (hexToBytes(priorOptions.closingBook.salt).length !== 32) throw new Error("Invalid closing opening salt.");
      }
      // Console numbers are bounded integers. The Compact runtime supports full
      // Uint64, but silently rounded JavaScript input cannot be authorized here.
      for (const argument of actualArgs) {
        if (typeof argument === "number") safeUnits(argument);
        if (argument && typeof argument === "object") {
          for (const value of Object.values(argument)) {
            if (typeof value === "number") safeUnits(value);
            if (typeof value === "bigint" && (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)))
              throw new Error("Console accounting exceeds exact integer limits.");
          }
        }
      }
      safeUnits(context.ledger.lineGeneration);
      safeUnits(context.ledger.actionClock);
      const candidate = candidateConsole(context, spec.kind, intentArgs);
      const id = globalThis.crypto.randomUUID();
      const fingerprint = await fingerprintOperationIntent({ kind: spec.kind, arguments: intentArgs, domain: context.before.contractDomain });
      let effect: Omit<JournalExpectedEffect, "contractDomain" | "lineGeneration"> | null = spec.kind === "postQuote" ? { circuit: "postQuote" as const,
        targetCommitment: candidate.privateState.merchantQuotes.at(-1)!.quoteCommitment, effect: "quote-present" as const }
        : spec.kind === "redeemDraw" ? { circuit: "redeemDraw" as const,
          targetCommitment: (actualArgs[0] as any).noteCommit, effect: "note-redeemed" as const }
        : spec.kind === "cancelOrExpireNote" ? { circuit: "cancelOrExpireNote" as const,
          targetCommitment: actualArgs[0] as string, effect: "note-cancelled" as const } : null;
      let effectGeneration = String(context.ledger.lineGeneration);
      let candidateCommitment = ["openLine", "draw", "acknowledgeRepayment"].includes(spec.kind)
        ? normalizeCommitment(candidate.privateState.agentLineRecord!.lineCommitment) : null;
      if (spec.kind === "cancelOrExpireNote" && (priorOptions?.compensation || priorOptions?.refundAck)) {
        const refund = candidate.privateState.refunds!.find(record => normalizeCommitment(record.noteCommitment) === normalizeCommitment(actualArgs[0] as string))!;
        effectGeneration = String(refund.lineGeneration);
        if (priorOptions.compensation) {
          candidateCommitment = priorOptions.compensation.note.lineGeneration === context.ledger.lineGeneration
            ? normalizeCommitment(candidate.privateState.agentLineRecord!.lineCommitment) : null;
          effect = { circuit: "cancelOrExpireNote", targetCommitment: actualArgs[0] as string, effect: "note-compensation-allocated",
            refundCommitment: refund.refundCommitment, cashRefundOwed: refund.amount > 0, lineCommitment: candidateCommitment };
        } else {
          effect = { circuit: "cancelOrExpireNote", targetCommitment: actualArgs[0] as string, effect: "note-refund-acknowledged",
            refundCommitment: refund.refundCommitment, cashRefundOwed: true,
            paymentNullifier: toHex(paymentNullifier(bytes32(actualArgs[1] as string), canonicalPaymentReferenceBytes(priorOptions.refundAck!.paymentRef), bytes32(context.before.contractDomain))) };
        }
      }
      if (effect && context.runtime.getRecoveryEvidence) {
        const observed = await context.runtime.getRecoveryEvidence(effect.circuit === "postQuote"
          ? { quoteCommit: effect.targetCommitment } : { noteCommit: effect.targetCommitment,
            ...(effect.paymentNullifier ? { nullifier: effect.paymentNullifier } : {}) });
        if (effect.circuit !== "postQuote" && observed.note?.lineGeneration) effectGeneration = observed.note.lineGeneration;
        if ((effect.circuit === "postQuote" && observed.quote?.present) ||
            (effect.circuit === "redeemDraw" && observed.note?.redeemed) ||
            (effect.effect === "note-cancelled" && observed.note?.cancelled) ||
            (effect.effect === "note-compensation-allocated" && observed.note?.compensationAllocated) ||
            (effect.effect === "note-refund-acknowledged" && observed.note?.refundAcknowledged)) {
          throw new Error("This public effect already exists; reconcile its original operation.");
        }
        if (effect.effect === "note-compensation-allocated") {
          const terms = priorOptions!.compensation!.note;
          if (!observed.note?.present || observed.note.amount !== String(terms.amount) || observed.note.fee !== String(terms.fee) ||
              observed.note.expiry !== String(terms.expiry) || observed.note.lineGeneration !== String(terms.lineGeneration)) throw new Error("Compensation terms do not match the original public note.");
        } else if (effect.effect === "note-refund-acknowledged") {
          if (!observed.note?.present || !observed.note.compensationAllocated || !observed.note.cashRefundOwed ||
              normalizeCommitment(observed.note.refundCommitment!) !== normalizeCommitment(effect.refundCommitment!) || observed.nullifier?.present) throw new Error("Reported refund requires its unacknowledged exact allocation and unused payment reference.");
        }
      }
      context.assertCurrent();
      context.operation = await context.lease.prepare({ id, kind: spec.kind, fingerprint,
        beforeCommitment: normalizeCommitment(context.ledger.lineCommitment), candidateCommitment,
        beforeSnapshot: context.before, candidateSnapshot: candidate, expectedEffect: effect ? { ...effect,
          targetCommitment: normalizeCommitment(effect.targetCommitment)!, contractDomain: context.before.contractDomain,
          lineGeneration: effectGeneration } : null });
      await context.lease.markSubmitting(id);
      try { context.assertCurrent(); } catch (error) {
        context.operation = await context.lease.reject(id, { ...context.scope, kind: "definiteRejection" });
        throw error;
      }
      const options: RuntimeOperationOptions = { ...priorOptions, beforeSubmit: async submission => {
        context.assertCurrent();
        await context.lease.markSubmitting(id, { transactionId: submission.txId });
        await priorOptions?.beforeSubmit?.(submission);
        context.assertCurrent();
      } };
      const invoke = [...actualArgs];
      while (invoke.length < spec.optionsIndex) invoke.push(undefined);
      invoke.push(options);
      let result: RuntimeTransactionResult;
      try { result = await value.apply(target, invoke); }
      catch (error) {
        // A thrown compatibility adapter error does not prove non-submission.
        context.operation = await context.lease.markUncertain(id);
        throw error;
      }
      if (result.ok && (context.runtime.mode !== "network" || result.disposition === "confirmed-success")) {
        context.operation = await context.lease.confirm(id, { ...context.scope, kind: "definiteReceipt",
          receipt: { executionMode: context.runtime.mode, txHash: result.txHash, txId: result.txId, blockHeight: result.blockHeight } });
      } else if (!result.ok && result.disposition === "definitive-rejection") {
        context.operation = await context.lease.reject(id, { ...context.scope, kind: "definiteRejection", transactionId: result.txId });
      } else {
        context.operation = await context.lease.markUncertain(id);
        return { ...result, ok: false, disposition: "unresolved", code: "OPERATION_REQUIRES_RECOVERY" };
      }
      return result;
    };
  } });
}
