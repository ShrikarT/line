import {
  decodeVaultJson, encodeVaultJson, getVaultSessionPassphrase,
  getVaultSessionRevision, loadEncryptedJson, saveEncryptedJson,
} from "./vault.ts";
import { VaultLockedError, VaultTamperedError } from "../runtime/errors.ts";

/** Off-chain recovery metadata. These hashes are not Compact commitments or nullifiers. */
export const OPERATION_JOURNAL_SCHEMA = "line:operation-journal/v2";
export const MAX_JOURNAL_OPERATIONS = 1_000;
export const OPERATION_KINDS = [
  "registerMerchant", "disableMerchant", "fundReserve", "withdrawUnencumberedReserve",
  "withdrawFees", "openLine", "postQuote", "draw", "redeemDraw", "cancelOrExpireNote",
  "acknowledgeRepayment", "setStatus",
] as const;
export type JournalOperationKind = typeof OPERATION_KINDS[number];
export type JournalOperationStatus = "prepared" | "submitting" | "uncertain" | "confirmed" | "rejected";
export interface JournalScope { networkId: string; contractAddress: string; sourceFingerprint: string; }
export interface PreparedOperation {
  id: string;
  kind: JournalOperationKind;
  fingerprint: string;
  beforeCommitment: string | null;
  candidateCommitment: string | null;
  beforeSnapshot: unknown;
  candidateSnapshot: unknown;
  expectedEffect?: JournalExpectedEffect | null;
}
export interface JournalExpectedEffect {
  circuit: "postQuote" | "redeemDraw" | "cancelOrExpireNote";
  targetCommitment: string;
  contractDomain: string;
  lineGeneration: string;
  effect: "quote-present" | "note-redeemed" | "note-cancelled" | "note-compensation-allocated" | "note-refund-acknowledged";
  /** Compound effects bind the private allocation without exposing amounts. */
  refundCommitment?: string;
  cashRefundOwed?: boolean;
  lineCommitment?: string | null;
  paymentNullifier?: string;
}
export interface JournalOperation extends PreparedOperation {
  sequence: number;
  status: JournalOperationStatus;
  createdAt: number;
  updatedAt: number;
  acknowledged: boolean;
  transactionId: string | null;
  receipt: JournalReceipt | null;
  snapshotsCompacted: boolean;
}
export interface JournalReceipt { txHash?: string; txId?: string; blockHeight?: number; executionMode: "local" | "network" | "test"; }
export interface OperationJournalRecord {
  schema: typeof OPERATION_JOURNAL_SCHEMA;
  scope: JournalScope;
  revision: number;
  operations: JournalOperation[];
}
/** Evidence must come from the connected runtime/public provider, never from a saved template. */
export type JournalConfirmationEvidence = JournalScope & (
  | { kind: "definiteReceipt"; transactionId?: string; receipt: JournalReceipt }
  | { kind: "observedCandidate"; lineCommitment: string; transactionId?: string }
  | ({ kind: "observedEffect"; transactionId?: string } & JournalExpectedEffect)
);
export type JournalRejectionEvidence = JournalScope & {
  kind: "definiteRejection"; transactionId?: string; lineCommitment?: string | null;
};
export class OperationJournalConflictError extends Error {
  constructor(message: string) { super(message); this.name = "OperationJournalConflictError"; }
}
export class OperationJournalUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "OperationJournalUnavailableError"; }
}

function hex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(value)) throw new TypeError(`Invalid ${label}.`);
  return value.replace(/^0x/, "").toLowerCase();
}
function commitment(value: unknown, label: string): string | null { return value === null ? null : hex(value, label); }
function normalizeScope(scope: JournalScope): JournalScope {
  if (!scope || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(scope.networkId)) throw new TypeError("Invalid journal network scope.");
  return { networkId: scope.networkId, contractAddress: hex(scope.contractAddress, "journal contract scope"), sourceFingerprint: hex(scope.sourceFingerprint, "journal source fingerprint") };
}
function sameScope(a: JournalScope, b: JournalScope): boolean {
  return a.networkId === b.networkId && a.contractAddress === b.contractAddress && a.sourceFingerprint === b.sourceFingerprint;
}
function clone<T>(value: T): T { return decodeVaultJson(encodeVaultJson(value)) as T; }
function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === [...keys].sort()[i]);
}
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value); }
function validTx(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value); }
function normalizeReceipt(receipt: JournalReceipt): JournalReceipt {
  if (!receipt || !["local", "network", "test"].includes(receipt.executionMode) ||
      Object.keys(receipt).some(key => !["txHash", "txId", "blockHeight", "executionMode"].includes(key)) ||
      (receipt.txHash !== undefined && !validTx(receipt.txHash)) || (receipt.txId !== undefined && !validTx(receipt.txId)) ||
      (!receipt.txHash && !receipt.txId) || (receipt.blockHeight !== undefined && (!Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight < 0)) ||
      (receipt.executionMode === "network" && (!Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight! <= 0))) {
    throw new TypeError("Invalid confirmed runtime receipt.");
  }
  return clone(receipt);
}
function normalizeEffect(effect: JournalExpectedEffect): JournalExpectedEffect {
  const expected = { postQuote: ["quote-present"], redeemDraw: ["note-redeemed"], cancelOrExpireNote: ["note-cancelled", "note-compensation-allocated", "note-refund-acknowledged"] };
  if (!effect || !Object.prototype.hasOwnProperty.call(expected, effect.circuit) || !expected[effect.circuit].includes(effect.effect) ||
      typeof effect.lineGeneration !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(effect.lineGeneration) || BigInt(effect.lineGeneration) > 18_446_744_073_709_551_615n) {
    throw new TypeError("Invalid unique public effect specification.");
  }
  const normalized: JournalExpectedEffect = { circuit: effect.circuit, targetCommitment: hex(effect.targetCommitment, "effect target commitment"),
    contractDomain: hex(effect.contractDomain, "effect contract domain"), lineGeneration: effect.lineGeneration, effect: effect.effect };
  if (effect.effect === "note-compensation-allocated" || effect.effect === "note-refund-acknowledged") {
    normalized.refundCommitment = hex(effect.refundCommitment, "refund commitment");
    if (typeof effect.cashRefundOwed !== "boolean") throw new TypeError("Invalid cash refund marker.");
    normalized.cashRefundOwed = effect.cashRefundOwed;
    if (effect.effect === "note-compensation-allocated") normalized.lineCommitment = commitment(effect.lineCommitment, "compensation book commitment");
    else {
      if (!effect.cashRefundOwed) throw new TypeError("A reported refund requires a cash obligation.");
      normalized.paymentNullifier = hex(effect.paymentNullifier, "reported refund payment nullifier");
    }
  }
  return normalized;
}
function normalizePrepared(input: PreparedOperation): PreparedOperation {
  if (!input || !validId(input.id) || !OPERATION_KINDS.includes(input.kind)) throw new TypeError("Invalid operation identity or circuit.");
  const prepared = { id: input.id, kind: input.kind, fingerprint: hex(input.fingerprint, "operation fingerprint"),
    beforeCommitment: commitment(input.beforeCommitment, "before commitment"), candidateCommitment: commitment(input.candidateCommitment, "candidate commitment"),
    beforeSnapshot: clone(input.beforeSnapshot), candidateSnapshot: clone(input.candidateSnapshot),
    expectedEffect: input.expectedEffect == null ? null : normalizeEffect(input.expectedEffect) };
  if (prepared.expectedEffect && prepared.expectedEffect.circuit !== input.kind) throw new TypeError("Expected effect does not belong to this circuit.");
  if (prepared.expectedEffect?.effect === "note-compensation-allocated" && prepared.expectedEffect.lineCommitment !== prepared.candidateCommitment) throw new TypeError("Compensation effect must bind the prepared book candidate.");
  if (prepared.expectedEffect?.effect === "note-compensation-allocated" && prepared.candidateCommitment === prepared.beforeCommitment && prepared.candidateCommitment !== null) throw new TypeError("A compensation book transition requires a distinct candidate commitment.");
  if (["openLine", "draw", "acknowledgeRepayment"].includes(input.kind) &&
      (!prepared.candidateCommitment || prepared.candidateCommitment === prepared.beforeCommitment)) {
    throw new TypeError("A book transition requires a distinct candidate commitment.");
  }
  return prepared;
}
function validateRecord(value: unknown, scope: JournalScope): OperationJournalRecord {
  try {
    if (!value || typeof value !== "object" || !exactKeys(value, ["schema", "scope", "revision", "operations"])) throw new Error();
    const record = value as OperationJournalRecord;
    if (record.schema !== OPERATION_JOURNAL_SCHEMA || !sameScope(normalizeScope(record.scope), scope) ||
        !exactKeys(record.scope, ["networkId", "contractAddress", "sourceFingerprint"]) ||
        !Number.isSafeInteger(record.revision) || record.revision < 0 || !Array.isArray(record.operations) || record.operations.length > MAX_JOURNAL_OPERATIONS) throw new Error();
    let sequence = 0;
    const ids = new Set<string>();
    let pending = 0;
    for (const op of record.operations) {
      if (!op || !exactKeys(op, ["id", "kind", "fingerprint", "beforeCommitment", "candidateCommitment", "beforeSnapshot", "candidateSnapshot", "expectedEffect", "sequence", "status", "createdAt", "updatedAt", "acknowledged", "transactionId", "receipt", "snapshotsCompacted"])) throw new Error();
      normalizePrepared(op);
      if (op.expectedEffect !== null && (!op.expectedEffect || !exactKeys(op.expectedEffect, Object.keys(normalizeEffect(op.expectedEffect))) ||
          encodeVaultJson(normalizeEffect(op.expectedEffect)) !== encodeVaultJson(op.expectedEffect))) throw new Error();
      if (op.receipt !== null) normalizeReceipt(op.receipt);
      if (ids.has(op.id) || !Number.isSafeInteger(op.sequence) || op.sequence <= sequence || op.sequence > record.revision ||
          !["prepared", "submitting", "uncertain", "confirmed", "rejected"].includes(op.status) ||
          !Number.isSafeInteger(op.createdAt) || !Number.isSafeInteger(op.updatedAt) || op.createdAt < 0 || op.updatedAt < op.createdAt ||
          typeof op.acknowledged !== "boolean" || (op.transactionId !== null && !validTx(op.transactionId)) ||
          (op.acknowledged && op.status !== "confirmed") || (op.receipt !== null && op.status !== "confirmed") ||
          typeof op.snapshotsCompacted !== "boolean" ||
          (op.snapshotsCompacted && (!(op.status === "rejected" || (op.status === "confirmed" && op.acknowledged)) || op.beforeSnapshot !== null || op.candidateSnapshot !== null))) throw new Error();
      if (op.status === "prepared" || op.status === "submitting" || op.status === "uncertain" || (op.status === "confirmed" && !op.acknowledged)) pending++;
      ids.add(op.id); sequence = op.sequence;
    }
    if (pending > 1) throw new Error();
    if (latestConfirmedOperation(record)?.snapshotsCompacted) throw new Error();
    return record;
  } catch { throw new VaultTamperedError("Invalid or mismatched encrypted operation journal."); }
}

export function operationJournalStorageKey(scopeInput: JournalScope): string {
  const scope = normalizeScope(scopeInput);
  // Source is inside the authenticated document, not its key: upgrading code must detect old pending work.
  return `line:journal:v1:${scope.networkId}:${scope.contractAddress}`;
}
export async function fingerprintOperationIntent(intent: unknown): Promise<string> {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  const encoded = new TextEncoder().encode(`line:journal-intent/v1\n${encodeVaultJson(canonicalize(clone(intent)))}`);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

const nodeTails = new Map<string, Promise<void>>();
async function nodeExclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
  const preceding = nodeTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  nodeTails.set(key, current);
  await preceding;
  try { return await action(); }
  finally { release(); if (nodeTails.get(key) === current) nodeTails.delete(key); }
}

export interface OperationJournalLease {
  read(): Promise<OperationJournalRecord>;
  prepare(input: PreparedOperation): Promise<JournalOperation>;
  markSubmitting(id: string, options?: { transactionId?: string }): Promise<JournalOperation>;
  markUncertain(id: string): Promise<JournalOperation>;
  confirm(id: string, evidence: JournalConfirmationEvidence): Promise<JournalOperation>;
  reject(id: string, evidence: JournalRejectionEvidence): Promise<JournalOperation>;
  abandonPrepared(id: string): Promise<JournalOperation>;
  acknowledgeConfirmed(id: string): Promise<JournalOperation>;
}
export interface OperationJournal {
  readonly scope: JournalScope;
  readonly storageKey: string;
  withExclusive<T>(action: (lease: OperationJournalLease) => Promise<T>): Promise<T>;
}
export function latestConfirmedOperation(record: OperationJournalRecord): JournalOperation | null {
  return [...record.operations].reverse().find(operation => operation.status === "confirmed") ?? null;
}

/**
 * Own the exclusive lease across preparation, submission and durable confirmation. No method submits
 * a transaction. A submitting/uncertain record always blocks another intent; callers must reconcile
 * it against real public state/receipt before proceeding. Browser Web Locks are mandatory so a
 * process crash releases ownership without pretending a timestamp proves a transaction failed.
 */
export function createOperationJournal(
  scopeInput: JournalScope, passphrase: string, options?: { assertSession?: () => void },
): OperationJournal {
  const scope = Object.freeze(normalizeScope(scopeInput));
  const storageKey = operationJournalStorageKey(scope);
  const sessionRevision = getVaultSessionRevision();
  const assertSession = () => {
    if (getVaultSessionPassphrase() !== passphrase || getVaultSessionRevision() !== sessionRevision) throw new VaultLockedError("Vault session was revoked before operation submission.");
    options?.assertSession?.();
  };
  assertSession();
  const run = async <T>(action: (lease: OperationJournalLease) => Promise<T>): Promise<T> => {
    assertSession();
    let active = true;
    const assertLease = () => { if (!active) throw new OperationJournalConflictError("Operation journal lease has ended."); };
    const read = async (): Promise<OperationJournalRecord> => {
      assertLease(); assertSession();
      const loaded = await loadEncryptedJson<unknown>(storageKey, passphrase);
      assertLease(); assertSession();
      return loaded === null ? { schema: OPERATION_JOURNAL_SCHEMA, scope: { ...scope }, revision: 0, operations: [] } : validateRecord(loaded, scope);
    };
    // Recovery writes use the passphrase captured by this authorized lease. They contain only the
    // already prepared candidate, and can finish after lock without reauthorizing a new submission.
    let cached: OperationJournalRecord | null = null;
    const submittedInLease = new Set<string>();
    const getRecord = async () => { assertLease(); if (!cached) cached = await read(); return clone(cached); };
    const write = async (record: OperationJournalRecord, requireSession: boolean) => {
      assertLease(); if (requireSession) assertSession();
      const latestConfirmed = latestConfirmedOperation(record);
      // Retain immutable intent metadata for duplicate detection, but only the latest confirmed
      // full recovery snapshot and active candidate(s). Historical whole-book snapshots grow quadratically.
      for (const operation of record.operations) {
        if (operation !== latestConfirmed && (operation.status === "rejected" || (operation.status === "confirmed" && operation.acknowledged))) {
          operation.beforeSnapshot = null; operation.candidateSnapshot = null; operation.snapshotsCompacted = true;
        }
      }
      validateRecord(record, scope);
      await saveEncryptedJson(storageKey, record, passphrase, { beforeWrite: () => { assertLease(); if (requireSession) assertSession(); } });
      assertLease(); cached = clone(record);
    };
    const mutate = async (id: string, requireSession: boolean, update: (op: JournalOperation) => void) => {
      const record = await getRecord();
      const op = record.operations.find(item => item.id === id);
      if (!op) throw new OperationJournalConflictError("Operation was not prepared in this journal.");
      update(op); op.updatedAt = Math.max(op.createdAt, Date.now());
      if (record.revision === Number.MAX_SAFE_INTEGER) throw new OperationJournalConflictError("Journal revision exhausted.");
      record.revision++;
      await write(record, requireSession);
      return clone(op);
    };
    const assertEvidenceScope = (evidence: JournalScope) => {
      if (!sameScope(normalizeScope(evidence), scope)) throw new OperationJournalConflictError("Confirmation evidence belongs to another scope.");
    };
    const lease: OperationJournalLease = {
      read: async () => { const record = await read(); cached = clone(record); return clone(record); },
      prepare: async input => {
        assertSession();
        const prepared = normalizePrepared(input);
        const record = await getRecord();
        const existing = record.operations.find(op => op.id === prepared.id);
        if (existing) {
          const existingIntent = { id: existing.id, kind: existing.kind, fingerprint: existing.fingerprint,
            beforeCommitment: existing.beforeCommitment, candidateCommitment: existing.candidateCommitment,
            beforeSnapshot: existing.beforeSnapshot, candidateSnapshot: existing.candidateSnapshot, expectedEffect: existing.expectedEffect };
          const preparedComparison = existing.snapshotsCompacted ? { ...prepared, beforeSnapshot: null, candidateSnapshot: null } : prepared;
          if (encodeVaultJson(existingIntent) !== encodeVaultJson(preparedComparison)) throw new OperationJournalConflictError("Operation ID was already used for a different intent.");
          return clone(existing);
        }
        if (record.operations.some(op => ["prepared", "submitting", "uncertain"].includes(op.status) || (op.status === "confirmed" && !op.acknowledged))) {
          throw new OperationJournalConflictError("An earlier operation requires reconciliation before a new intent can be prepared.");
        }
        if (record.revision === Number.MAX_SAFE_INTEGER || record.operations.length >= MAX_JOURNAL_OPERATIONS) throw new OperationJournalConflictError("Journal capacity exhausted; export and migrate verified history before proceeding.");
        const now = Date.now();
        const op: JournalOperation = { ...prepared, sequence: ++record.revision, status: "prepared", createdAt: now,
          updatedAt: now, acknowledged: false, transactionId: null, receipt: null, snapshotsCompacted: false };
        record.operations.push(op); await write(record, true); return clone(op);
      },
      markSubmitting: async (id, submission) => {
        const result = await mutate(id, true, op => {
        if (op.status !== "prepared" && op.status !== "submitting") throw new OperationJournalConflictError("Only a prepared operation can enter submission; ambiguous operations cannot be retried.");
        if (op.status === "submitting" && !submittedInLease.has(id)) throw new OperationJournalConflictError("A prior submitting operation is ambiguous and cannot be retried from another lease.");
        if (submission?.transactionId !== undefined) {
          if (!validTx(submission.transactionId) || (op.transactionId !== null && op.transactionId !== submission.transactionId)) throw new OperationJournalConflictError("Conflicting submission transaction ID.");
          op.transactionId = submission.transactionId;
        }
        op.status = "submitting";
        });
        submittedInLease.add(id);
        return result;
      },
      markUncertain: id => mutate(id, false, op => {
        if (op.status !== "submitting" && op.status !== "uncertain") throw new OperationJournalConflictError("Only submitted operations can become uncertain.");
        op.status = "uncertain";
      }),
      confirm: (id, evidence) => mutate(id, false, op => {
        assertEvidenceScope(evidence);
        if (op.status !== "submitting" && op.status !== "uncertain" && op.status !== "confirmed") throw new OperationJournalConflictError("A saved candidate is not a confirmed submission.");
        if (evidence.kind === "observedCandidate") {
          if (op.expectedEffect?.effect === "note-compensation-allocated" || op.expectedEffect?.effect === "note-refund-acknowledged") throw new OperationJournalConflictError("Compensation requires its complete public effect, not a book commitment alone.");
          if (!op.candidateCommitment || hex(evidence.lineCommitment, "observed commitment") !== op.candidateCommitment) throw new OperationJournalConflictError("Observed public commitment does not match the prepared candidate.");
        } else if (evidence.kind === "observedEffect") {
          if (!op.expectedEffect || encodeVaultJson(normalizeEffect(evidence)) !== encodeVaultJson(op.expectedEffect)) throw new OperationJournalConflictError("Observed public effect does not match the prepared unique effect.");
        } else {
          if (evidence.kind !== "definiteReceipt") throw new TypeError("A confirmed runtime receipt is required.");
          if (evidence.receipt !== undefined) {
            const receipt = normalizeReceipt(evidence.receipt);
            if (receipt.txId !== undefined && op.transactionId !== null && op.transactionId !== receipt.txId) throw new OperationJournalConflictError("Receipt transaction ID differs from prepared submission.");
            if (op.receipt !== null && encodeVaultJson(op.receipt) !== encodeVaultJson(receipt)) throw new OperationJournalConflictError("Conflicting confirmed receipt metadata.");
            op.receipt = receipt;
            if (op.transactionId === null) op.transactionId = receipt.txId ?? receipt.txHash ?? null;
          } else throw new TypeError("A confirmed runtime receipt is required.");
        }
        if (evidence.transactionId !== undefined) {
          if (!validTx(evidence.transactionId) || (op.transactionId !== null && op.transactionId !== evidence.transactionId)) throw new OperationJournalConflictError("Conflicting transaction receipt.");
          op.transactionId = evidence.transactionId;
        }
        op.status = "confirmed";
      }),
      reject: (id, evidence) => mutate(id, false, op => {
        assertEvidenceScope(evidence);
        if (evidence.kind !== "definiteRejection" || (evidence.transactionId !== undefined && !validTx(evidence.transactionId)) ||
            (evidence.lineCommitment !== undefined && commitment(evidence.lineCommitment, "observed commitment") !== op.beforeCommitment)) throw new OperationJournalConflictError("A definite runtime rejection is required.");
        if (op.status !== "submitting" && op.status !== "uncertain") throw new OperationJournalConflictError("Only a submitted operation can be rejected by transaction evidence.");
        if (evidence.transactionId !== undefined && op.transactionId !== null && op.transactionId !== evidence.transactionId) throw new OperationJournalConflictError("Conflicting rejected transaction ID.");
        op.status = "rejected"; if (evidence.transactionId !== undefined) op.transactionId = evidence.transactionId;
      }),
      abandonPrepared: id => mutate(id, true, op => {
        if (op.status !== "prepared") throw new OperationJournalConflictError("A submitted operation cannot be abandoned from an unchanged public commitment alone.");
        op.status = "rejected";
      }),
      acknowledgeConfirmed: id => mutate(id, true, op => {
        if (op.status !== "confirmed") throw new OperationJournalConflictError("Only a confirmed recovery snapshot can be acknowledged.");
        op.acknowledged = true;
      }),
    };
    let methodTail: Promise<unknown> = Promise.resolve();
    let acceptingMethods = true;
    const serial = <R>(invoke: () => Promise<R>): Promise<R> => {
      if (!acceptingMethods) return Promise.reject(new OperationJournalConflictError("Operation journal lease has ended."));
      const next = methodTail.then(invoke); methodTail = next.catch(() => undefined); return next;
    };
    const serializedLease: OperationJournalLease = {
      read: () => serial(lease.read), prepare: input => serial(() => lease.prepare(input)),
      markSubmitting: (id, submission) => serial(() => lease.markSubmitting(id, submission)),
      markUncertain: id => serial(() => lease.markUncertain(id)), confirm: (id, evidence) => serial(() => lease.confirm(id, evidence)),
      reject: (id, evidence) => serial(() => lease.reject(id, evidence)), abandonPrepared: id => serial(() => lease.abandonPrepared(id)),
      acknowledgeConfirmed: id => serial(() => lease.acknowledgeConfirmed(id)),
    };
    try { return await action(serializedLease); }
    finally {
      acceptingMethods = false;
      // A caller forgetting to await a journal mutation must not release cross-tab ownership while
      // its IndexedDB transaction is still able to commit. Drain already-issued methods first.
      await methodTail;
      active = false; cached = null;
    }
  };
  return {
    scope, storageKey,
    withExclusive: async action => {
      assertSession();
      if (typeof window !== "undefined") {
        if (typeof navigator === "undefined" || !navigator.locks?.request) throw new OperationJournalUnavailableError("Browser Web Locks are required for durable operation ownership.");
        return navigator.locks.request(storageKey, { mode: "exclusive" }, () => run(action));
      }
      return nodeExclusive(storageKey, () => run(action));
    },
  };
}
