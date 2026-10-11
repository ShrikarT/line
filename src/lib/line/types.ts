import { requiredDrawFee } from "./encoding.ts";

export const FEE_POLICY = "flat-plus-ceil-bps-v1" as const;
export type LineStatus = "none" | "open" | "defaulted" | "closed";

export type QuoteRecord = {
  commitment: string;
  // NOTE (audit H3): no merchantPk — mirrors Compact's QuoteMeta
  // {expiry, lineGeneration, used}. The quote's merchant is a private witness
  // inside draw; the public ledger carries only the opaque commitment.
  expiry: number;
  lineGeneration: number;
  used: boolean;
};

export type NoteRecord = {
  commitment: string;
  amount: number;
  fee: number;
  redeemed: boolean;
  cancelled: boolean;
  expiry: number;
  lineGeneration: number;
  compensationAllocated: boolean;
  refundCommitment: string;
  cashRefundOwed: boolean;
  refundAcknowledged: boolean;
  /** Exact stable payment reference nullifier attributed to this reported refund. */
  refundPaymentNullifier: string;
};

export type LedgerEvent = {
  t: number;
  circuit: string;
  ok: boolean;
  publicNote: string;
  commitment?: string;
  quote?: string;
  note?: string;
  nullifier?: string;
  amount?: number;
};

export type Ledger = {
  /** Compact contractDomain (hex). */
  contractDomain: string;
  issuerPubKey: string;
  initialMerchantPubKey: string;
  instanceNonce: string;
  registeredMerchants: Record<string, boolean>;
  totalReserve: number;
  encumberedReserve: number;
  redeemedReserve: number;
  /** Fees earned on claim redemption in accounting; not collected cash. */
  feeReserve: number;
  pendingFeeReserve: number;
  refundReserve: number;
  /** Full-cost budgets locked after issuer-reported refunds; not actual cash paid. */
  reportedRefundReserve: number;
  /** Issuer-approved public pricing, immutable within a line generation. */
  feeFlat: number;
  feeBps: number;
  identityCommitment: string | null;
  lineCommitment: string | null;
  lineExpiry: number;
  status: LineStatus;
  lineGeneration: number;
  quotes: QuoteRecord[];
  notes: NoteRecord[];
  nullifiers: string[];
  events: LedgerEvent[];
  actionClock: number;
};

export type LineWitness = {
  domain: string;
  I: string;
  L: number;
  B: number;
  e: number;
  s: string;
};

/**
 * Private witness bundles — the TypeScript mirror of the Compact `witness`
 * declarations (audit H1/H2/H3). Each bundle is passed as a separate function
 * argument alongside the public circuit parameters, exactly like the harness
 * `call(session, privateState, { name, args })` split: public params travel in
 * `input`, private values travel in `witness`.
 *
 * These values are NEVER logged, NEVER stored on the public ledger, and NEVER
 * included in public views. The stale-commitment check and the capacity check
 * evaluate over them exactly as the on-chain circuits do.
 *
 * Honest boundary: settled amounts ARE public escrow accounting
 * (NoteMeta.amount and the public reserve-counter deltas). What the witness
 * model truly hides: L, B, per-quote invoice amounts, and merchant<->quote/note
 * unlinkability.
 */
export type OpenLineWitness = {
  /** lineLimit() witness — the credit limit, never a public parameter. */
  limit: number;
};

export type PostQuoteWitness = {
  /** quoteAmount() witness — the invoice amount, committed to by Q. */
  amount: number;
};

export type DrawWitness = {
  /** lineLimit()/lineOutstanding()/lineEpoch() witnesses (+ identity & salt). */
  books: LineWitness;
  /**
   * The merchant's private invoice preimage. Its invoiceId/amount/nonce/
   * merchantCommitment are the invoiceId()/drawAmount()/quoteNonce()/
   * quoteMerchantPk() witnesses; draw recomputes Q from them plus the PUBLIC
   * quote meta (expiry, lineGeneration) exactly as the circuit does. The
   * preimage's own expiry/generation copies are the merchant's record and are
   * not consulted — the circuit uses the ledger meta's values.
   */
  quote: QuotePreimage;
};

export type RedeemWitness = {
  /**
   * The merchant's private note preimage. note.amount is the redeemAmount()
   * witness: the circuit asserts it equals the PUBLIC NoteMeta.amount
   * ("amount mismatch") — settled amounts are public escrow accounting.
   * noteIdentity()/noteQuoteCommit()/noteNonce() witnesses live here too.
   */
  note: DrawNotePreimage;
};

export type RepayWitness = {
  /** lineLimit()/lineOutstanding()/lineEpoch() witnesses (+ identity & salt). */
  books: LineWitness;
  /**
   * The issuer's off-chain repayment receipt. receipt.amount is the
   * repayAmount() witness; receipt.nonce/paymentRef are the receiptNonce()/
   * paymentRef() witnesses. The expiry is carried separately as the PUBLIC
   * receiptExpiry circuit parameter (see acknowledgeRepayment).
   */
  receipt: RepayReceipt;
};

export type AgentStore = {
  secret: string;
  witness: LineWitness | null;
  identityCommitment?: string;
};

export type QuotePreimage = {
  merchantCommitment: string;
  amount: number;
  invoiceId: string;
  expiry: number;
  nonce: string;
  generation: number;
  feeFlat: number;
  feeBps: number;
};

export type MerchantInvoice = {
  invoiceId: string;
  amount: number;
  Q: string;
  used: boolean;
  preimage: QuotePreimage;
};

export type DrawNotePreimage = {
  domain: string;
  lineGeneration: number;
  identity: string;
  quoteCommit: string;
  merchantPk: string;
  amount: number;
  fee: number;
  noteNonce: string;
  expiry: number;
};

export type DrawNote = {
  D: string;
  preimage: DrawNotePreimage;
  salt: string;
};

/** Private allocation output. Never serialize into the public ledger. */
export type RefundAllocation = {
  domain: string;
  lineGeneration: number;
  identity: string;
  noteCommit: string;
  amount: number;
  allocatedCredit: number;
  salt: string;
  commitment: string;
};

export type RepayReceipt = {
  identity: string;
  currentC: string;
  amount: number;
  paymentRef: string;
  nonce: string;
  expiry: number;
  contractDomain: string;
};

export type CircuitFail = {
  ok: false;
  code: string;
  /** Safe for any UI, including public explorer */
  message: string;
  /** Tests / issuer logs only */
  reason: string;
};

export type CircuitOk<T extends object = object> = { ok: true } & T;

export type CircuitResult<T extends object = object> = CircuitOk<T> | CircuitFail;

export const GENERIC_DRAW_FAIL = "Clearance could not be proven.";

export const STATUS_FROM_COMPACT = ["none", "open", "defaulted", "closed"] as const;

export function availableCredit(w: { L: number; B: number } | null | undefined): number {
  if (!w) return 0;
  return Math.max(0, w.L - w.B);
}

/**
 * Typed, Versioned Vault Record Schemas
 */
export interface AgentLineRecord {
  version: 1;
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  agentSecret: string;
  identityCommitment: string;
  lineCommitment: string;
  limit: number;
  feeFlat: number;
  feeBps: number;
  outstanding: number;
  epoch: number;
  salt: string;
  lineGeneration: number;
  updatedAt: number;
}

export interface MerchantQuoteRecord {
  version: 1;
  networkId: string;
  contractAddress: string;
  merchantPublicKey: string;
  invoiceIdBytes: string;
  displayInvoiceId: string;
  amount: number;
  expiry: number;
  quoteNonce: string;
  quoteCommitment: string;
  lineGeneration: number;
  feePolicy: typeof FEE_POLICY;
  feeFlat: number;
  feeBps: number;
  fee: number;
  status: "open" | "consumed" | "expired";
  transactionId?: string;
  updatedAt: number;
}

export interface DrawNoteRecord {
  version: 1;
  networkId: string;
  contractAddress: string;
  noteCommitment: string;
  contractDomain: string;
  lineGeneration: number;
  identityCommitment: string;
  quoteCommitment: string;
  merchantPublicKey: string;
  amount: number;
  fee: number;
  noteNonce: string;
  noteSalt: string;
  expiry: number;
  status: "active" | "redeemed" | "expired" | "cancelled";
  drawTransactionId?: string;
  redemptionTransactionId?: string;
  updatedAt: number;
}

export interface RefundRecord {
  version: 1;
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  lineGeneration: number;
  identityCommitment: string;
  noteCommitment: string;
  refundCommitment: string;
  amount: number;
  allocatedCredit: number;
  salt: string;
  status: "allocated" | "issuer-reported";
  /** Public report observed without recovering the reporting issuer's private receipt. */
  issuerReportObserved?: boolean;
  paymentReference?: string;
  receiptExpiry?: number;
  transactionId?: string;
  updatedAt: number;
}

export interface RepaymentRecord {
  version: 1;
  networkId: string;
  contractAddress: string;
  identityCommitment: string;
  currentLineCommitment: string;
  amount: number;
  receiptNonce: string;
  paymentReference: string;
  expiry: number;
  status: "pending" | "acknowledged";
  transactionId?: string;
  updatedAt: number;
}

/**
 * Cross-Role Private Transfer Packages
 */
export interface QuoteTransferPackage {
  format: "line:quote-package:v3";
  deadlineUnits: "unix-seconds";
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  lineGeneration: number;
  quoteCommitment: string;
  merchantPublicKey: string;
  invoiceIdBytes: string;
  displayInvoiceId: string;
  amount: number;
  expiry: number;
  quoteNonce: string;
  feePolicy: typeof FEE_POLICY;
  feeFlat: number;
  feeBps: number;
  fee: number;
  issuedAt: number;
}

export interface DrawNoteTransferPackage {
  format: "line:note-package:v3";
  deadlineUnits: "unix-seconds";
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  lineGeneration: number;
  noteCommitment: string;
  quoteCommitment: string;
  identityCommitment: string;
  merchantPublicKey: string;
  amount: number;
  fee: number;
  noteNonce: string;
  noteSalt: string;
  expiry: number;
  issuedAt: number;
}

export function validateAgentLineRecord(rec: unknown): AgentLineRecord {
  if (!rec || typeof rec !== "object") throw new Error("Invalid AgentLineRecord: expected object");
  const r = rec as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`Invalid AgentLineRecord version: ${r.version}`);
  if (!r.networkId || typeof r.networkId !== "string") throw new Error("Missing networkId in AgentLineRecord");
  if (!r.contractAddress || typeof r.contractAddress !== "string") throw new Error("Missing contractAddress in AgentLineRecord");
  if (!r.contractDomain || typeof r.contractDomain !== "string") throw new Error("Missing contractDomain in AgentLineRecord");
  if (!r.agentSecret || typeof r.agentSecret !== "string") throw new Error("Missing agentSecret in AgentLineRecord");
  if (!r.lineCommitment || typeof r.lineCommitment !== "string") throw new Error("Missing lineCommitment in AgentLineRecord");
  if (typeof r.limit !== "number" || r.limit <= 0) throw new Error("Invalid limit in AgentLineRecord");
  if (typeof r.feeFlat !== "number" || !Number.isSafeInteger(r.feeFlat) || r.feeFlat < 0) throw new Error("Missing or invalid feeFlat in AgentLineRecord");
  if (typeof r.feeBps !== "number" || !Number.isSafeInteger(r.feeBps) || r.feeBps < 0 || r.feeBps > 10_000) throw new Error("Missing or invalid feeBps in AgentLineRecord");
  if (typeof r.outstanding !== "number" || r.outstanding < 0) throw new Error("Invalid outstanding balance in AgentLineRecord");
  if (typeof r.epoch !== "number" || r.epoch < 0) throw new Error("Invalid epoch in AgentLineRecord");
  if (!r.salt || typeof r.salt !== "string") throw new Error("Missing salt in AgentLineRecord");
  return r as unknown as AgentLineRecord;
}

export function validateMerchantQuoteRecord(rec: unknown): MerchantQuoteRecord {
  if (!rec || typeof rec !== "object") throw new Error("Invalid MerchantQuoteRecord: expected object");
  const r = rec as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`Invalid MerchantQuoteRecord version: ${r.version}`);
  if (!r.quoteCommitment || typeof r.quoteCommitment !== "string") throw new Error("Missing quoteCommitment in MerchantQuoteRecord");
  if (typeof r.amount !== "number" || r.amount <= 0) throw new Error("Invalid amount in MerchantQuoteRecord");
  if (!r.quoteNonce || typeof r.quoteNonce !== "string") throw new Error("Missing quoteNonce in MerchantQuoteRecord");
  if (!r.merchantPublicKey || typeof r.merchantPublicKey !== "string") throw new Error("Missing merchantPublicKey in MerchantQuoteRecord");
  validateQuoteFeeTerms(r);
  return r as unknown as MerchantQuoteRecord;
}

export function validateDrawNoteRecord(rec: unknown): DrawNoteRecord {
  if (!rec || typeof rec !== "object") throw new Error("Invalid DrawNoteRecord: expected object");
  const r = rec as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`Invalid DrawNoteRecord version: ${r.version}`);
  if (!r.noteCommitment || typeof r.noteCommitment !== "string") throw new Error("Missing noteCommitment in DrawNoteRecord");
  if (!r.merchantPublicKey || typeof r.merchantPublicKey !== "string") throw new Error("Missing merchantPublicKey in DrawNoteRecord");
  validateNoteAmounts(r);
  if (!r.noteNonce || typeof r.noteNonce !== "string") throw new Error("Missing noteNonce in DrawNoteRecord");
  if (!r.noteSalt || typeof r.noteSalt !== "string") throw new Error("Missing noteSalt in DrawNoteRecord");
  return r as unknown as DrawNoteRecord;
}

export function validateQuoteTransferPackage(pkg: unknown, expectedNetwork?: string, expectedContract?: string): QuoteTransferPackage {
  if (!pkg || typeof pkg !== "object") throw new Error("Invalid QuoteTransferPackage: expected object");
  const p = pkg as Record<string, unknown>;
  if (p.format !== "line:quote-package:v3" || p.deadlineUnits !== "unix-seconds") throw new Error("Unsupported quote fee/deadline format. Obtain a new v3 issuer-priced Unix-seconds quote package; legacy terms cannot be migrated automatically.");
  if (typeof p.expiry !== "number" || !Number.isSafeInteger(p.expiry) || p.expiry < 0) throw new Error("Invalid Unix-seconds quote deadline");
  if (expectedNetwork && p.networkId !== expectedNetwork) {
    throw new Error(`Quote network mismatch: package targets ${p.networkId}, current network is ${expectedNetwork}`);
  }
  if (expectedContract && p.contractAddress !== expectedContract) {
    throw new Error(`Quote contract mismatch: package targets ${p.contractAddress}, current contract is ${expectedContract}`);
  }
  if (!p.quoteCommitment || typeof p.quoteCommitment !== "string") throw new Error("Missing quoteCommitment in QuoteTransferPackage");
  if (typeof p.amount !== "number" || p.amount <= 0) throw new Error("Invalid quote amount");
  if (!p.quoteNonce || typeof p.quoteNonce !== "string") throw new Error("Missing quoteNonce in package");
  validateQuoteFeeTerms(p);
  return p as unknown as QuoteTransferPackage;
}

function validateQuoteFeeTerms(value: Record<string, unknown>): void {
  if (value.feePolicy !== FEE_POLICY) throw new Error("Missing or unsupported issuer fee policy. Obtain a newly priced quote.");
  for (const key of ["amount", "feeFlat", "feeBps", "fee"] as const) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || (value[key] as number) < 0) throw new Error(`Invalid quote ${key}`);
  }
  if ((value.amount as number) <= 0) throw new Error("Invalid quote amount");
  const expected = requiredDrawFee(BigInt(value.amount as number), BigInt(value.feeFlat as number), BigInt(value.feeBps as number));
  if (BigInt(value.fee as number) !== expected) throw new Error("Agreed quote fee does not match issuer policy");
}

export function validateDrawNoteTransferPackage(pkg: unknown, expectedNetwork?: string, expectedContract?: string): DrawNoteTransferPackage {
  if (!pkg || typeof pkg !== "object") throw new Error("Invalid DrawNoteTransferPackage: expected object");
  const p = pkg as Record<string, unknown>;
  if (p.format !== "line:note-package:v3" || p.deadlineUnits !== "unix-seconds") throw new Error("Unsupported note fee/deadline format. Obtain a matching v3 fee-bound Unix-seconds note package; legacy notes cannot be relabelled.");
  if (typeof p.expiry !== "number" || !Number.isSafeInteger(p.expiry) || p.expiry < 0) throw new Error("Invalid Unix-seconds note deadline");
  if (expectedNetwork && p.networkId !== expectedNetwork) {
    throw new Error(`DrawNote network mismatch: package targets ${p.networkId}, current network is ${expectedNetwork}`);
  }
  if (expectedContract && p.contractAddress !== expectedContract) {
    throw new Error(`DrawNote contract mismatch: package targets ${p.contractAddress}, current contract is ${expectedContract}`);
  }
  if (!p.noteCommitment || typeof p.noteCommitment !== "string") throw new Error("Missing noteCommitment in DrawNoteTransferPackage");
  if (!p.merchantPublicKey || typeof p.merchantPublicKey !== "string") throw new Error("Missing merchantPublicKey in package");
  validateNoteAmounts(p);
  if (!p.noteNonce || typeof p.noteNonce !== "string") throw new Error("Missing noteNonce in package");
  if (!p.noteSalt || typeof p.noteSalt !== "string") throw new Error("Missing noteSalt in package");
  return p as unknown as DrawNoteTransferPackage;
}

function validateNoteAmounts(value: Record<string, unknown>): void {
  if (typeof value.amount !== "number" || !Number.isSafeInteger(value.amount) || value.amount <= 0) throw new Error("Invalid note amount");
  if (typeof value.fee !== "number" || !Number.isSafeInteger(value.fee) || value.fee < 0) throw new Error("Missing or invalid note fee");
  if (!Number.isSafeInteger(value.amount + value.fee)) throw new Error("Note cost exceeds safe integer range");
}

export function validateRefundRecord(rec: unknown): RefundRecord {
  if (!rec || typeof rec !== "object") throw new Error("Invalid RefundRecord: expected object");
  const r = rec as Record<string, unknown>;
  if (r.version !== 1) throw new Error("Invalid RefundRecord version");
  for (const key of ["networkId", "contractAddress", "contractDomain", "identityCommitment", "noteCommitment", "refundCommitment", "salt"] as const) {
    if (typeof r[key] !== "string" || !r[key]) throw new Error(`Missing ${key} in RefundRecord`);
  }
  for (const key of ["lineGeneration", "amount", "allocatedCredit", "updatedAt"] as const) {
    if (typeof r[key] !== "number" || !Number.isSafeInteger(r[key]) || r[key] < 0) throw new Error(`Invalid ${key} in RefundRecord`);
  }
  if (!Number.isSafeInteger((r.amount as number) + (r.allocatedCredit as number))) throw new Error("Invalid refund cost");
  if (r.status !== "allocated" && r.status !== "issuer-reported") throw new Error("Invalid RefundRecord status");
  if ("issuerReportObserved" in r && typeof r.issuerReportObserved !== "boolean") throw new Error("Invalid issuerReportObserved in RefundRecord");
  if (r.status === "issuer-reported" && (typeof r.paymentReference !== "string" || !r.paymentReference.trim() || typeof r.receiptExpiry !== "number" || !Number.isSafeInteger(r.receiptExpiry) || r.receiptExpiry < 0 || r.amount === 0)) throw new Error("Missing issuer refund report terms");
  return r as unknown as RefundRecord;
}


