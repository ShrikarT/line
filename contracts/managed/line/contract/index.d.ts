import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Status { NONE = 0, OPEN = 1, DEFAULTED = 2, CLOSED = 3 }

export type QuoteMeta = { expiry: bigint; used: boolean };

export type LinePreimage = { identity: Uint8Array;
                             limit: bigint;
                             outstanding: bigint;
                             epoch: bigint
                           };

export type Witnesses<PS> = {
  callerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  agentSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  salt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  newSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  invoiceId(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  quoteNonce(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  receiptNonce(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  paymentRef(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  openLine(context: __compactRuntime.CircuitContext<PS>,
           limit_0: bigint,
           expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  postQuote(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       limit_0: bigint,
       outstanding_0: bigint,
       epoch_0: bigint,
       amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       limit_0: bigint,
                       outstanding_0: bigint,
                       epoch_0: bigint,
                       amount_0: bigint,
                       receiptExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  openLine(context: __compactRuntime.CircuitContext<PS>,
           limit_0: bigint,
           expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  postQuote(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       limit_0: bigint,
       outstanding_0: bigint,
       epoch_0: bigint,
       amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       limit_0: bigint,
                       outstanding_0: bigint,
                       epoch_0: bigint,
                       amount_0: bigint,
                       receiptExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  openLine(context: __compactRuntime.CircuitContext<PS>,
           limit_0: bigint,
           expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  postQuote(context: __compactRuntime.CircuitContext<PS>,
            amount_0: bigint,
            expiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       limit_0: bigint,
       outstanding_0: bigint,
       epoch_0: bigint,
       amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       limit_0: bigint,
                       outstanding_0: bigint,
                       epoch_0: bigint,
                       amount_0: bigint,
                       receiptExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type Ledger = {
  readonly issuer: Uint8Array;
  readonly merchant: Uint8Array;
  readonly contractDomain: Uint8Array;
  readonly identityCommit: Uint8Array;
  readonly lineCommit: Uint8Array;
  readonly lineExpiry: bigint;
  readonly status: Status;
  quotes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): QuoteMeta;
    [Symbol.iterator](): Iterator<[Uint8Array, QuoteMeta]>
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly clock: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               issuerSk_0: Uint8Array,
               merchantSk_0: Uint8Array): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
