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
  /** Issuer fee accrual (FEE_SPEC §1). Part of the reserve conservation invariant:
      encumberedReserve + redeemedReserve + feeReserve <= totalReserve. */
  feeReserve: number;
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
