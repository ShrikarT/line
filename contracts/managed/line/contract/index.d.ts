import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Status { NONE = 0, OPEN = 1, DEFAULTED = 2, CLOSED = 3 }

export type QuoteMeta = { merchantPk: Uint8Array;
                          expiry: bigint;
                          lineGeneration: bigint;
                          used: boolean
                        };

export type LinePreimage = { identity: Uint8Array;
                             limit: bigint;
                             outstanding: bigint;
                             epoch: bigint
                           };

export type DrawNotePreimage = { domain: Uint8Array;
                                 lineGeneration: bigint;
                                 identity: Uint8Array;
                                 quoteCommit: Uint8Array;
                                 merchantPk: Uint8Array;
                                 amount: bigint;
                                 noteNonce: Uint8Array;
                                 expiry: bigint
                               };

export type NoteMeta = { amount: bigint;
                         redeemed: boolean;
                         cancelled: boolean;
                         expiry: bigint;
                         lineGeneration: bigint
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
  noteNonce(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  noteSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  noteIdentity(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  noteQuoteCommit(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
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
       amount_0: bigint,
       noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             amount_0: bigint,
             noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       limit_0: bigint,
                       outstanding_0: bigint,
                       epoch_0: bigint,
                       amount_0: bigint,
                       receiptExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
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
       amount_0: bigint,
       noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             amount_0: bigint,
             noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
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
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
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
       amount_0: bigint,
       noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             amount_0: bigint,
             noteExpiry_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
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
  readonly contractDomain: Uint8Array;
  registeredMerchants: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  readonly totalReserve: bigint;
  readonly encumberedReserve: bigint;
  readonly redeemedReserve: bigint;
  readonly identityCommit: Uint8Array;
  readonly lineCommit: Uint8Array;
  readonly lineExpiry: bigint;
  readonly status: Status;
  readonly lineGeneration: bigint;
  quotes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): QuoteMeta;
    [Symbol.iterator](): Iterator<[Uint8Array, QuoteMeta]>
  };
  notes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): NoteMeta;
    [Symbol.iterator](): Iterator<[Uint8Array, NoteMeta]>
  };
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly actionClock: bigint;
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
               issuerPk_0: Uint8Array,
               initialMerchantPk_0: Uint8Array,
               instanceNonce_0: Uint8Array): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
