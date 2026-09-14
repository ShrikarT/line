export const CONTRACT_ID = "line.v1";

export const DOMAIN = {
  id: "line:id",
  state: "line:state",
  quote: "line:quote",
  merchant: "line:merchant",
  draw: "line:draw",
  repay: "line:repay",
  receipt: "line:receipt",
} as const;

export type LineStatus = "none" | "open" | "defaulted" | "closed";

export type QuoteRecord = {
  commitment: string;
  expiry: number;
  used: boolean;
};

export type LedgerEvent = {
  t: number;
  circuit: string;
  ok: boolean;
  publicNote: string;
  commitment?: string;
  quote?: string;
  nullifier?: string;
};

export type Ledger = {
  contractId: string;
  issuerPubKey: string;
  merchantPubKey: string;
  identityCommitment: string | null;
  lineCommitment: string | null;
  status: LineStatus;
  quotes: QuoteRecord[];
  nullifiers: string[];
  events: LedgerEvent[];
  clock: number;
};

export type LineWitness = {
  I: string;
  L: number;
  B: number;
  e: number;
  s: string;
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
};

export type RepayReceipt = {
  identity: string;
  currentC: string;
  amount: number;
  paymentRef: string;
  nonce: string;
  expiry: number;
  contractId: string;
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
