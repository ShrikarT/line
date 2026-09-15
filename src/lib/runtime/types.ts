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
  withdrawableReserve: number;
  contractDomain: string;
};

export type RuntimeTransactionResult = {
  ok: boolean;
  txHash?: string;
  blockHeight?: number;
  error?: string;
  code?: string;
  output?: Record<string, unknown>;
};

export interface LineRuntime {
  readonly mode: RuntimeMode;
  readonly networkId: string;
  isConnected(): boolean;
  getContractAddress(): string | null;
  getStatus(): Promise<LedgerPublicStatus>;
  getReserveStatus(): Promise<ReserveStatus>;
  fundReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult>;
  withdrawReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult>;
  registerMerchant(merchantPk: string, callerSk: string): Promise<RuntimeTransactionResult>;
  openLine(params: {
    limit: number;
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }): Promise<RuntimeTransactionResult>;
  postQuote(params: {
    amount: number;
    expiry: number;
    invoiceId: string;
    nonce: string;
    merchantSk: string;
  }): Promise<RuntimeTransactionResult>;
  draw(params: {
    quoteCommit: string;
    limit: number;
    outstanding: number;
    epoch: number;
    amount: number;
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
    newSalt: string;
    invoiceId: string;
    quoteNonce: string;
    noteNonce: string;
    noteSalt: string;
  }): Promise<RuntimeTransactionResult>;
  redeemDraw(params: {
    noteCommit: string;
    amount: number;
    expiry: number;
    merchantSk: string;
    noteIdentity: string;
    noteQuoteCommit: string;
    noteNonce: string;
    noteSalt: string;
  }): Promise<RuntimeTransactionResult>;
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
  }): Promise<RuntimeTransactionResult>;
  setStatus(status: Exclude<LineStatus, "none">, callerSk: string): Promise<RuntimeTransactionResult>;
}
