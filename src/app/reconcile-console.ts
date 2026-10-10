import type { LineRuntime, LedgerPublicStatus, RuntimeRecoveryEvidence } from "../lib/runtime/types.ts";
import type { JournalOperation, JournalScope, OperationJournalLease } from "../lib/security/operation-journal.ts";
import { latestConfirmedOperation } from "../lib/security/operation-journal.ts";
import { agentId, drawNoteCommit, hexToBytes, lineStateCommit, toHex } from "../lib/line/encoding.ts";
import { consoleJournalScope, normalizeCommitment, recoveredConsole, retireHistoricalBook, type ConsolePrivateState } from "./console-recovery.ts";

export interface ConsoleReconciliation {
  privateState: ConsolePrivateState | null;
  blocked: boolean;
  /** Acknowledge only after the returned private state has been safely persisted/published. */
  confirmedId?: string;
}
const blocked = (): ConsoleReconciliation => ({ privateState: null, blocked: true });
function sameScope(a: JournalScope, b: JournalScope): boolean {
  return a.networkId === b.networkId && normalizeCommitment(a.contractAddress) === normalizeCommitment(b.contractAddress) &&
    normalizeCommitment(a.sourceFingerprint) === normalizeCommitment(b.sourceFingerprint);
}
function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > (1n << 64n) - 1n) throw new Error("Invalid exact generation evidence.");
  return value;
}
function safe(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Unsafe recovered private accounting.");
  return value;
}
function observationMatches(evidence: RuntimeRecoveryEvidence, runtime: LineRuntime, ledger: LedgerPublicStatus): boolean {
  const sameAddress = runtime.mode === "network"
    ? normalizeCommitment(evidence.contractAddress) === normalizeCommitment(runtime.getContractAddress())
    : evidence.contractAddress === runtime.getContractAddress();
  return evidence.runtime === runtime.mode && evidence.networkId === runtime.networkId && sameAddress &&
    normalizeCommitment(evidence.contractDomain) === normalizeCommitment(ledger.contractDomain) && Boolean(decimal(evidence.lineGeneration));
}
function ledgerObservation(runtime: LineRuntime, ledger: LedgerPublicStatus): RuntimeRecoveryEvidence {
  const address = runtime.getContractAddress();
  if (!address) throw new Error("No runtime contract configured.");
  return { runtime: runtime.mode, networkId: ledger.networkId, contractAddress: address, contractDomain: ledger.contractDomain,
    identityCommitment: ledger.identityCommitment, lineCommitment: ledger.lineCommitment,
    feeFlat: String(safe(ledger.feeFlat)), feeBps: String(safe(ledger.feeBps)),
    lineGeneration: String(safe(ledger.lineGeneration)), actionClock: String(safe(ledger.actionClock)) };
}
/** Match cryptographic openings AND instance metadata: the commitment binds
 * contract domain, while generation and runtime scope remain public metadata. */
function openingMatches(state: ConsolePrivateState, evidence: RuntimeRecoveryEvidence, runtime: LineRuntime, allowMissingBook = false): boolean {
  const line = state.agentLineRecord;
  const publicCommitment = normalizeCommitment(evidence.lineCommitment);
  const active = evidence.lineGeneration !== "0" && publicCommitment !== null && publicCommitment !== "0".repeat(64);
  if (!line) return !active || (allowMissingBook && state.agentRecord === null);
  if (line.networkId !== runtime.networkId || line.contractAddress !== runtime.getContractAddress() ||
      normalizeCommitment(line.contractDomain) !== normalizeCommitment(evidence.contractDomain) ||
      String(safe(line.lineGeneration)) !== decimal(evidence.lineGeneration) ||
      normalizeCommitment(line.identityCommitment) !== normalizeCommitment(evidence.identityCommitment) ||
      normalizeCommitment(line.lineCommitment) !== publicCommitment) return false;
  if (String(safe(line.feeFlat)) !== decimal(evidence.feeFlat) ||
      String(safe(line.feeBps)) !== decimal(evidence.feeBps) || safe(line.feeBps) > 10_000) return false;
  if (state.agentRecord) {
    const record = state.agentRecord;
    const identity = agentId(hexToBytes(record.agentSecret));
    const commitment = toHex(lineStateCommit({ domain: hexToBytes(line.contractDomain), identity, limit: BigInt(safe(record.L)), outstanding: BigInt(safe(record.B)), epoch: BigInt(safe(record.epoch)) }, hexToBytes(record.salt)));
    if (commitment !== publicCommitment || toHex(identity) !== normalizeCommitment(evidence.identityCommitment) ||
        normalizeCommitment(record.lineCommitment) !== publicCommitment || normalizeCommitment(record.identityCommitment) !== toHex(identity)) return false;
  }
  return true;
}
function effectMatches(operation: JournalOperation, evidence: RuntimeRecoveryEvidence): boolean {
  const effect = operation.expectedEffect;
  if (!effect || effect.circuit !== operation.kind || normalizeCommitment(effect.contractDomain) !== normalizeCommitment(evidence.contractDomain)) return false;
  if (effect.effect === "quote-present") {
    return Boolean(evidence.quote?.present && normalizeCommitment(evidence.quote.commitment) === normalizeCommitment(effect.targetCommitment) &&
      decimal(evidence.quote.lineGeneration) === decimal(effect.lineGeneration));
  }
  const note = evidence.note;
  if (!note?.present || normalizeCommitment(note.commitment) !== normalizeCommitment(effect.targetCommitment) ||
      decimal(note.lineGeneration) !== decimal(effect.lineGeneration)) return false;
  if (effect.effect === "note-redeemed") return note.redeemed === true;
  if (effect.effect === "note-cancelled") return note.cancelled === true;
  if (!note.cancelled || note.redeemed || note.compensationAllocated !== true ||
      normalizeCommitment(note.refundCommitment!) !== normalizeCommitment(effect.refundCommitment!) || note.cashRefundOwed !== effect.cashRefundOwed) return false;
  if (effect.effect === "note-compensation-allocated") {
    return typeof note.refundAcknowledged === "boolean" && (effect.lineCommitment === null
      ? BigInt(decimal(effect.lineGeneration)) < BigInt(decimal(evidence.lineGeneration))
      : normalizeCommitment(effect.lineCommitment!) === normalizeCommitment(evidence.lineCommitment));
  }
  return note.refundAcknowledged === true && evidence.nullifier?.present === true &&
    normalizeCommitment(note.refundPaymentNullifier!) === normalizeCommitment(effect.paymentNullifier!) &&
    normalizeCommitment(evidence.nullifier.value) === normalizeCommitment(effect.paymentNullifier!);
}
function compound(operation: JournalOperation): boolean {
  return operation.expectedEffect?.effect === "note-compensation-allocated" || operation.expectedEffect?.effect === "note-refund-acknowledged";
}
function recoveryQuery(operation: JournalOperation) {
  const effect = operation.expectedEffect;
  return effect?.circuit === "postQuote" ? { quoteCommit: effect.targetCommitment }
    : effect ? { noteCommit: effect.targetCommitment, ...(effect.paymentNullifier ? { nullifier: effect.paymentNullifier } : {}) } : {};
}
function mayRestoreWithoutBook(operation: JournalOperation): boolean {
  const effect = operation.expectedEffect;
  return effect?.effect === "note-refund-acknowledged" || (effect?.effect === "note-compensation-allocated" && effect.lineCommitment === null);
}
function retireForHistoricalNote(state: ConsolePrivateState, target: string, evidence: RuntimeRecoveryEvidence, runtime: LineRuntime): ConsolePrivateState {
  const D = normalizeCommitment(target);
  const note = state.drawNotes.find(note => normalizeCommitment(note.noteCommitment) === D);
  const line = state.agentLineRecord;
  if (!note || !line || note.networkId !== runtime.networkId || note.contractAddress !== runtime.getContractAddress() ||
      normalizeCommitment(note.contractDomain) !== normalizeCommitment(evidence.contractDomain) ||
      normalizeCommitment(line.contractDomain) !== normalizeCommitment(evidence.contractDomain) ||
      line.networkId !== runtime.networkId || line.contractAddress !== runtime.getContractAddress() ||
      BigInt(safe(note.lineGeneration)) >= BigInt(decimal(evidence.lineGeneration)) ||
      BigInt(safe(line.lineGeneration)) >= BigInt(decimal(evidence.lineGeneration))) throw new Error("Historical recovery requires an original note from a previous generation.");
  const opened = toHex(drawNoteCommit({ domain: hexToBytes(note.contractDomain), lineGeneration: BigInt(safe(note.lineGeneration)),
    identity: hexToBytes(note.identityCommitment), quoteCommit: hexToBytes(note.quoteCommitment), merchantPk: hexToBytes(note.merchantPublicKey),
    amount: BigInt(safe(note.amount)), fee: BigInt(safe(note.fee)), noteNonce: hexToBytes(note.noteNonce), expiry: BigInt(safe(note.expiry)) }, hexToBytes(note.noteSalt)));
  const originalIdentity = normalizeCommitment(note.identityCommitment);
  const hasOriginalKey = toHex(agentId(hexToBytes(line.agentSecret))) === originalIdentity ||
    (state.historicalAgentKeys ?? []).some(key => normalizeCommitment(key.identityCommitment) === originalIdentity && toHex(agentId(hexToBytes(key.agentSecret))) === originalIdentity);
  if (opened !== D || !hasOriginalKey) throw new Error("Historical recovery requires the verified original note and original owner key.");
  return retireHistoricalBook(state, evidence.lineGeneration);
}

/** Reconciliation never submits or retries. Unchanged/absent public state cannot
 * prove rejection. A full snapshot whose credit opening has become stale blocks
 * automatic restoration, including snapshots that were previously acknowledged. */
export async function reconcileConsole(
  lease: OperationJournalLease, scope: JournalScope, runtime: LineRuntime, ledger: LedgerPublicStatus,
  assertCurrent: () => void, options: { restoreAcknowledged?: boolean; historicalNoteCommitment?: string } = {},
): Promise<ConsoleReconciliation> {
  assertCurrent();
  const record = await lease.read();
  assertCurrent();
  try {
    if (!sameScope(scope, record.scope) || !sameScope(scope, consoleJournalScope(runtime, ledger)) ||
        runtime.networkId !== ledger.networkId || runtime.mode !== ledger.runtime) return blocked();
  } catch { return blocked(); }
  for (const operation of record.operations) {
    if (operation.status === "prepared") {
      assertCurrent(); await lease.abandonPrepared(operation.id); assertCurrent();
    } else if (operation.status === "submitting" || operation.status === "uncertain") {
      // Aggregate reserve/status changes cannot identify an operation. A saved
      // transaction ID permits exact finalized receipt observation instead.
      if (operation.transactionId && runtime.getTransactionReceipt) {
        const receipt = await runtime.getTransactionReceipt(operation.transactionId);
        assertCurrent();
        if (receipt?.txId === operation.transactionId && receipt.disposition === "confirmed-success" && receipt.ok) {
          await lease.confirm(operation.id, { ...scope, kind: "definiteReceipt", transactionId: operation.transactionId,
            receipt: { executionMode: runtime.mode, txId: receipt.txId,
              ...(receipt.txHash ? { txHash: receipt.txHash } : {}), ...(receipt.blockHeight !== undefined ? { blockHeight: receipt.blockHeight } : {}) } });
          assertCurrent();
          continue;
        }
        if (receipt?.txId === operation.transactionId && receipt.disposition === "definitive-rejection" && !receipt.ok) {
          await lease.reject(operation.id, { ...scope, kind: "definiteRejection", transactionId: operation.transactionId });
          assertCurrent();
          continue;
        }
      }
      if (!runtime.getRecoveryEvidence) return blocked();
      let evidence: RuntimeRecoveryEvidence;
      try {
        evidence = await runtime.getRecoveryEvidence(recoveryQuery(operation));
      } catch { assertCurrent(); return blocked(); }
      assertCurrent();
      let candidateObserved = false, effectObserved = false;
      try {
        if (!observationMatches(evidence, runtime, ledger)) return blocked();
        const state = recoveredConsole(operation, runtime, evidence.contractDomain);
        if (!openingMatches(state, evidence, runtime, mayRestoreWithoutBook(operation))) return blocked();
        candidateObserved = !compound(operation) && Boolean(operation.candidateCommitment && normalizeCommitment(operation.candidateCommitment) === normalizeCommitment(evidence.lineCommitment));
        effectObserved = effectMatches(operation, evidence);
      } catch { return blocked(); }
      if (!candidateObserved && !effectObserved) return blocked();
      assertCurrent();
      if (candidateObserved) {
        await lease.confirm(operation.id, { ...scope, kind: "observedCandidate", lineCommitment: evidence.lineCommitment!,
          ...(operation.transactionId ? { transactionId: operation.transactionId } : {}) });
      } else {
        await lease.confirm(operation.id, { ...scope, kind: "observedEffect", ...operation.expectedEffect!,
          ...(operation.transactionId ? { transactionId: operation.transactionId } : {}) });
      }
      assertCurrent();
    }
  }
  const current = await lease.read();
  assertCurrent();
  const latest = latestConfirmedOperation(current);
  if (!latest) return { privateState: null, blocked: false };
  let evidence: RuntimeRecoveryEvidence;
  try {
    evidence = runtime.getRecoveryEvidence ? await runtime.getRecoveryEvidence(compound(latest) ? recoveryQuery(latest) : {}) : ledgerObservation(runtime, ledger);
  } catch { assertCurrent(); return blocked(); }
  assertCurrent();
  let state: ConsolePrivateState;
  try {
    if (!observationMatches(evidence, runtime, ledger)) return blocked();
    state = recoveredConsole(latest, runtime, evidence.contractDomain);
    if (!openingMatches(state, evidence, runtime, mayRestoreWithoutBook(latest))) {
      // Only acknowledged history may retire an obsolete opening. Every pending
      // operation above still requires its own exact public execution evidence.
      if (!latest.acknowledged || !options.historicalNoteCommitment) return blocked();
      state = retireForHistoricalNote(state, options.historicalNoteCommitment, evidence, runtime);
      if (!openingMatches(state, evidence, runtime, true)) return blocked();
      return { privateState: state, blocked: false };
    }
    if (compound(latest) && !effectMatches(latest, evidence)) return blocked();
  } catch { return blocked(); }
  if (latest.expectedEffect?.effect === "note-compensation-allocated" && evidence.note?.refundAcknowledged === true) {
    const target = normalizeCommitment(latest.expectedEffect.targetCommitment);
    state.refunds = (state.refunds ?? []).map(refund => normalizeCommitment(refund.noteCommitment) === target
      ? { ...refund, issuerReportObserved: true } : refund);
    // Publish the newly observed terminal marker even for an already
    // acknowledged local allocation; no payment reference is inferred.
    return { privateState: state, blocked: false, confirmedId: latest.id };
  }
  if (latest.acknowledged && !options.restoreAcknowledged) return { privateState: null, blocked: false };
  return { privateState: state, blocked: false, confirmedId: latest.id };
}
