export type LineStatus = "none" | "open" | "defaulted" | "closed";

export type QuoteRecord = {
  commitment: string;
  merchantPk: string;
  expiry: number;
  lineGeneration: number;
  used: boolean;
};

export type NoteRecord = {
  commitment: string;
  amount: number;
  redeemed: boolean;
  cancelled: boolean;
  expiry: number;
  lineGeneration: number;
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
  noteNonce: string;
  expiry: number;
};

export type DrawNote = {
  D: string;
  preimage: DrawNotePreimage;
  salt: string;
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
  noteNonce: string;
  noteSalt: string;
  expiry: number;
  status: "active" | "redeemed" | "expired" | "cancelled";
  drawTransactionId?: string;
  redemptionTransactionId?: string;
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
  format: "line:quote-package:v1";
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
  issuedAt: number;
}

export interface DrawNoteTransferPackage {
  format: "line:note-package:v1";
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  lineGeneration: number;
  noteCommitment: string;
  quoteCommitment: string;
  identityCommitment: string;
  merchantPublicKey: string;
  amount: number;
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
  return r as unknown as MerchantQuoteRecord;
}

export function validateDrawNoteRecord(rec: unknown): DrawNoteRecord {
  if (!rec || typeof rec !== "object") throw new Error("Invalid DrawNoteRecord: expected object");
  const r = rec as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`Invalid DrawNoteRecord version: ${r.version}`);
  if (!r.noteCommitment || typeof r.noteCommitment !== "string") throw new Error("Missing noteCommitment in DrawNoteRecord");
  if (!r.merchantPublicKey || typeof r.merchantPublicKey !== "string") throw new Error("Missing merchantPublicKey in DrawNoteRecord");
  if (typeof r.amount !== "number" || r.amount <= 0) throw new Error("Invalid amount in DrawNoteRecord");
  if (!r.noteNonce || typeof r.noteNonce !== "string") throw new Error("Missing noteNonce in DrawNoteRecord");
  if (!r.noteSalt || typeof r.noteSalt !== "string") throw new Error("Missing noteSalt in DrawNoteRecord");
  return r as unknown as DrawNoteRecord;
}

export function validateQuoteTransferPackage(pkg: unknown, expectedNetwork?: string, expectedContract?: string): QuoteTransferPackage {
  if (!pkg || typeof pkg !== "object") throw new Error("Invalid QuoteTransferPackage: expected object");
  const p = pkg as Record<string, unknown>;
  if (p.format !== "line:quote-package:v1") throw new Error(`Invalid QuoteTransferPackage format: ${p.format}`);
  if (expectedNetwork && p.networkId !== expectedNetwork) {
    throw new Error(`Quote network mismatch: package targets ${p.networkId}, current network is ${expectedNetwork}`);
  }
  if (expectedContract && p.contractAddress !== expectedContract) {
    throw new Error(`Quote contract mismatch: package targets ${p.contractAddress}, current contract is ${expectedContract}`);
  }
  if (!p.quoteCommitment || typeof p.quoteCommitment !== "string") throw new Error("Missing quoteCommitment in QuoteTransferPackage");
  if (typeof p.amount !== "number" || p.amount <= 0) throw new Error("Invalid quote amount");
  if (!p.quoteNonce || typeof p.quoteNonce !== "string") throw new Error("Missing quoteNonce in package");
  return p as unknown as QuoteTransferPackage;
}

export function validateDrawNoteTransferPackage(pkg: unknown, expectedNetwork?: string, expectedContract?: string): DrawNoteTransferPackage {
  if (!pkg || typeof pkg !== "object") throw new Error("Invalid DrawNoteTransferPackage: expected object");
  const p = pkg as Record<string, unknown>;
  if (p.format !== "line:note-package:v1") throw new Error(`Invalid DrawNoteTransferPackage format: ${p.format}`);
  if (expectedNetwork && p.networkId !== expectedNetwork) {
    throw new Error(`DrawNote network mismatch: package targets ${p.networkId}, current network is ${expectedNetwork}`);
  }
  if (expectedContract && p.contractAddress !== expectedContract) {
    throw new Error(`DrawNote contract mismatch: package targets ${p.contractAddress}, current contract is ${expectedContract}`);
  }
  if (!p.noteCommitment || typeof p.noteCommitment !== "string") throw new Error("Missing noteCommitment in DrawNoteTransferPackage");
  if (!p.merchantPublicKey || typeof p.merchantPublicKey !== "string") throw new Error("Missing merchantPublicKey in package");
  if (typeof p.amount !== "number" || p.amount <= 0) throw new Error("Invalid note amount in package");
  if (!p.noteNonce || typeof p.noteNonce !== "string") throw new Error("Missing noteNonce in package");
  if (!p.noteSalt || typeof p.noteSalt !== "string") throw new Error("Missing noteSalt in package");
  return p as unknown as DrawNoteTransferPackage;
}


