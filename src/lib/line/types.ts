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

