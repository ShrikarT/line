import type { LineStatus } from "../line/types.ts";

export type RuntimeMode = "network" | "local" | "test";

export type LedgerPublicStatus = {
  contractDomain: string;
  contractAddress: string | null;
  networkId: string;
  status: LineStatus;
  actionClock: number;
  lineGeneration: number;
  identityCommitment: string | null;
  lineCommitment: string | null;
  totalReserve: number;
  encumberedReserve: number;
  redeemedReserve: number;
  feeReserve?: number;
  /** Issuer-approved public policy, immutable for this line generation. */
  feeFlat?: number;
  feeBps?: number;
  pendingFeeReserve?: number;
  refundReserve?: number;
  reportedRefundReserve?: number;
  withdrawableReserve: number;
  quoteCount: number;
  noteCount: number;
  nullifierCount: number;
  runtime: RuntimeMode;
};

export type ReserveStatus = {
  totalReserve: number;
  encumberedReserve: number;
  redeemedReserve: number;
  feeReserve?: number;
  pendingFeeReserve?: number;
  refundReserve?: number;
  reportedRefundReserve?: number;
  withdrawableReserve: number;
  contractDomain: string;
};

/** Disposition describes execution evidence, not delivery or token settlement. */
export type RuntimeTransactionDisposition = "confirmed-success" | "definitive-rejection" | "unresolved";

export type RuntimeOperationOptions = {
  /** Must resolve only once the transaction ID is durably recorded. A rejection
   * prevents this runtime from invoking the external submission provider. */
  beforeSubmit?: (submission: { txId: string }) => Promise<void> | void;
  /** Private witness opening required only for proving a zero-debt close. */
  closingBook?: { limit: number; outstanding: number; epoch: number; salt: string };
  /** Presence requests authenticated compensation; never silently downgraded to expiry. */
  compensation?: {
    note: { identity: string; quoteCommit: string; merchantPk: string; amount: number; fee: number;
      noteNonce: string; expiry: number; lineGeneration: number };
    noteSalt: string;
    newSalt: string;
    book?: { limit: number; outstanding: number; epoch: number; salt: string };
  };
  /** Issuer attestation of a cash refund, not independent rail verification. */
  refundAck?: { identity: string; amount: number; salt: string; paymentRef: string; receiptExpiry: number };
};

export type RuntimeRecoveryQuery = { quoteCommit?: string; noteCommit?: string; nullifier?: string };
export type RuntimeRecoveryEvidence = {
  runtime: RuntimeMode;
  networkId: string;
  contractAddress: string;
  contractDomain: string;
  identityCommitment: string | null;
  lineCommitment: string | null;
  lineGeneration: string;
  actionClock: string;
  feeFlat?: string;
  feeBps?: string;
  /** One latest state observation. Absence never establishes failed execution. */
  quote?: { commitment: string; present: boolean; expiry?: string; lineGeneration?: string; used?: boolean };
  note?: { commitment: string; present: boolean; amount?: string; fee?: string; expiry?: string; lineGeneration?: string; redeemed?: boolean; cancelled?: boolean;
    compensationAllocated?: boolean; refundCommitment?: string; cashRefundOwed?: boolean; refundAcknowledged?: boolean; refundPaymentNullifier?: string };
  nullifier?: { value: string; present: boolean };
};

export type RuntimeTransactionResult = {
  disposition?: RuntimeTransactionDisposition;
  txId?: string;
  ok: boolean;
  txHash?: string;
  blockHeight?: number;
  error?: string;
  code?: string;
  output?: Record<string, unknown>;
};

export type LineTransactionResult = RuntimeTransactionResult;

export interface LineRuntime {
  readonly mode: RuntimeMode;
  readonly networkId: string;
  isConnected(): boolean;
  getContractAddress(): string | null;
  getStatus(): Promise<LedgerPublicStatus>;
  getReserveStatus(): Promise<ReserveStatus>;
  getRecoveryEvidence?(query?: RuntimeRecoveryQuery): Promise<RuntimeRecoveryEvidence>;
  /** Bounded application observation of a previously journaled transaction ID.
   * null/unresolved never proves that a transaction failed or permits retry. */
  getTransactionReceipt?(transactionId: string): Promise<RuntimeTransactionResult | null>;
  fundReserve(amount: number, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  withdrawReserve(amount: number, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  withdrawFees(callerSk?: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  registerMerchant(merchantPk: string, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  disableMerchant(merchantPk: string, callerSk?: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  openLine(params: {
    limit: number;
    expiry: number;
    feeFlat?: number;
    feeBps?: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  postQuote(params: {
    amount: number;
    expiry: number;
    invoiceId: string;
    nonce: string;
    merchantSk: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  draw(params: {
    quoteCommit: string;
    limit: number;
    outstanding: number;
    epoch: number;
    amount: number;
    expiry?: number;
    noteExpiry?: number | bigint;
    fee?: number | bigint;
    callerSk: string;
    agentSecret: string;
    salt: string;
    newSalt: string;
    invoiceId: string;
    quoteNonce: string;
    noteNonce: string;
    noteSalt: string;
    merchantPk?: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  redeemDraw(params: {
    noteCommit: string;
    amount: number;
    fee?: number;
    noteGeneration?: number;
    expiry?: number;
    noteExpiry?: number | bigint;
    merchantSk: string;
    noteIdentity: string;
    noteQuoteCommit: string;
    noteNonce: string;
    noteSalt: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  cancelOrExpireNote(noteCommit: string, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  acknowledgeRepayment(params: {
    limit: number;
    outstanding: number;
    epoch: number;
    amount: number;
    receiptExpiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
    newSalt: string;
    receiptNonce: string;
    paymentRef: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
  setStatus(status: Exclude<LineStatus, "none">, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult>;
}
