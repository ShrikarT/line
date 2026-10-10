import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Status { NONE = 0, OPEN = 1, DEFAULTED = 2, CLOSED = 3 }

export type QuoteMeta = { expiry: bigint; lineGeneration: bigint; used: boolean
                        };

export type LinePreimage = { domain: Uint8Array;
                             identity: Uint8Array;
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
                                 fee: bigint;
                                 noteNonce: Uint8Array;
                                 expiry: bigint
                               };

export type RefundPreimage = { domain: Uint8Array;
                               lineGeneration: bigint;
                               identity: Uint8Array;
                               noteCommit: Uint8Array;
                               amount: bigint
                             };

export type NoteMeta = { amount: bigint;
                         fee: bigint;
                         redeemed: boolean;
                         cancelled: boolean;
                         expiry: bigint;
                         lineGeneration: bigint;
                         compensationAllocated: boolean;
                         refundCommitment: Uint8Array;
                         cashRefundOwed: boolean;
                         refundAcknowledged: boolean;
                         refundPaymentNullifier: Uint8Array
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
  lineLimit(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  lineOutstanding(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  lineEpoch(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  quoteAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  drawAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  redeemAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  repayAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  quoteMerchantPk(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  disableMerchant(context: __compactRuntime.CircuitContext<PS>,
                  merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawFees(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openLine(context: __compactRuntime.CircuitContext<PS>,
           expiry_0: bigint,
           flatFee_0: bigint,
           basisPoints_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postQuote(context: __compactRuntime.CircuitContext<PS>, expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       noteExpiry_0: bigint,
       fee_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             noteExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array,
                     action_0: bigint,
                     receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  disableMerchant(context: __compactRuntime.CircuitContext<PS>,
                  merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawFees(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openLine(context: __compactRuntime.CircuitContext<PS>,
           expiry_0: bigint,
           flatFee_0: bigint,
           basisPoints_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postQuote(context: __compactRuntime.CircuitContext<PS>, expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       noteExpiry_0: bigint,
       fee_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             noteExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array,
                     action_0: bigint,
                     receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerMerchant(context: __compactRuntime.CircuitContext<PS>,
                   merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  disableMerchant(context: __compactRuntime.CircuitContext<PS>,
                  merchantPk_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  fundReserve(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawUnencumberedReserve(context: __compactRuntime.CircuitContext<PS>,
                              amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdrawFees(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  openLine(context: __compactRuntime.CircuitContext<PS>,
           expiry_0: bigint,
           flatFee_0: bigint,
           basisPoints_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  postQuote(context: __compactRuntime.CircuitContext<PS>, expiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  draw(context: __compactRuntime.CircuitContext<PS>,
       quoteCommitPublic_0: Uint8Array,
       noteExpiry_0: bigint,
       fee_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  redeemDraw(context: __compactRuntime.CircuitContext<PS>,
             noteCommitPublic_0: Uint8Array,
             noteExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelOrExpireNote(context: __compactRuntime.CircuitContext<PS>,
                     noteCommitPublic_0: Uint8Array,
                     action_0: bigint,
                     receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  acknowledgeRepayment(context: __compactRuntime.CircuitContext<PS>,
                       receiptExpiry_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  setStatus(context: __compactRuntime.CircuitContext<PS>, next_0: Status): __compactRuntime.CircuitResults<PS, []>;
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
  readonly feeReserve: bigint;
  readonly pendingFeeReserve: bigint;
  readonly refundReserve: bigint;
  readonly reportedRefundReserve: bigint;
  readonly feeFlat: bigint;
  readonly feeBps: bigint;
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
               instanceNonce_0: Uint8Array): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
