import type {
  LineRuntime,
  RuntimeMode,
  LedgerPublicStatus,
  ReserveStatus,
  RuntimeTransactionResult,
  RuntimeOperationOptions,
  RuntimeRecoveryEvidence,
  RuntimeRecoveryQuery,
} from "./types.ts";
import type { Ledger, LineStatus } from "../line/types.ts";
import {
  createLedger,
  fundReserve,
  withdrawUnencumberedReserve,
  withdrawFees,
  registerMerchant,
  disableMerchant,
  openLine,
  postQuote,
  draw,
  redeemDraw,
  cancelOrExpireNote,
  acknowledgeRepayment,
  setStatus,
  issuerPublicKey,
  merchantPublicKey,
  quoteCommitment,
} from "../line/protocol.ts";

export class LocalDevelopmentRuntime implements LineRuntime {
  readonly mode: RuntimeMode = "local";
  readonly networkId: string = "local-simulator";
  private ledger: Ledger;
  private txCounter: number = 0;
  private unboundGenesis: boolean = false;

  constructor(initialLedger?: Ledger, options?: { clock?: () => number }) {
    if (initialLedger) {
      this.ledger = initialLedger;
      this.unboundGenesis = false;
    } else {
      this.ledger = createLedger({ clock: options?.clock });
      this.unboundGenesis = true;
    }
  }

  private bindGenesisIssuer(callerSk?: string): void {
    if (this.unboundGenesis && callerSk) {
      this.ledger.issuerPubKey = issuerPublicKey(callerSk);
      this.unboundGenesis = false;
    }
  }

  isConnected(): boolean {
    return true;
  }

  getContractAddress(): string {
    return "0xlocal_compact_simulator_instance";
  }

  private nextTxHash(): string {
    this.txCounter++;
    return `0xdev_tx_${Date.now().toString(16)}_${this.txCounter}`;
  }

  async getStatus(): Promise<LedgerPublicStatus> {
    const total = this.ledger.totalReserve ?? 0;
    const encumbered = this.ledger.encumberedReserve ?? 0;
    const redeemed = this.ledger.redeemedReserve ?? 0;
    const fee = this.ledger.feeReserve ?? 0;
    const withdrawable = Math.max(0, total - (encumbered + redeemed + fee + this.ledger.pendingFeeReserve + this.ledger.refundReserve + this.ledger.reportedRefundReserve));

    return {
      contractDomain: this.ledger.contractDomain,
      contractAddress: this.getContractAddress(),
      networkId: this.networkId,
      status: this.ledger.status,
      actionClock: this.ledger.actionClock,
      lineGeneration: this.ledger.lineGeneration,
      identityCommitment: this.ledger.identityCommitment,
      lineCommitment: this.ledger.lineCommitment,
      totalReserve: total,
      encumberedReserve: encumbered,
      redeemedReserve: redeemed,
      feeReserve: fee,
      feeFlat: this.ledger.feeFlat,
      feeBps: this.ledger.feeBps,
      pendingFeeReserve: this.ledger.pendingFeeReserve,
      refundReserve: this.ledger.refundReserve,
      reportedRefundReserve: this.ledger.reportedRefundReserve,
      withdrawableReserve: withdrawable,
      quoteCount: this.ledger.quotes.length,
      noteCount: this.ledger.notes.length,
      nullifierCount: this.ledger.nullifiers.length,
      runtime: this.mode,
    };
  }

  async getReserveStatus(): Promise<ReserveStatus> {
    const total = this.ledger.totalReserve ?? 0;
    const encumbered = this.ledger.encumberedReserve ?? 0;
    const redeemed = this.ledger.redeemedReserve ?? 0;
    const fee = this.ledger.feeReserve ?? 0;
    const withdrawable = Math.max(0, total - (encumbered + redeemed + fee + this.ledger.pendingFeeReserve + this.ledger.refundReserve + this.ledger.reportedRefundReserve));

    return {
      totalReserve: total,
      encumberedReserve: encumbered,
      redeemedReserve: redeemed,
      feeReserve: fee,
      pendingFeeReserve: this.ledger.pendingFeeReserve,
      refundReserve: this.ledger.refundReserve,
      reportedRefundReserve: this.ledger.reportedRefundReserve,
      withdrawableReserve: withdrawable,
      contractDomain: this.ledger.contractDomain,
    };
  }

  /** Local observations are process-memory simulator evidence, not network finality
   * or durable ledger restoration. No external submission occurs, so beforeSubmit
   * hooks are deliberately not invoked by this runtime. */
  async getRecoveryEvidence(query: RuntimeRecoveryQuery = {}): Promise<RuntimeRecoveryEvidence> {
    const l = this.ledger;
    const result: RuntimeRecoveryEvidence = {
      runtime: this.mode, networkId: this.networkId, contractAddress: this.getContractAddress(),
      contractDomain: l.contractDomain, identityCommitment: l.identityCommitment,
      lineCommitment: l.lineCommitment, lineGeneration: String(l.lineGeneration), actionClock: String(l.actionClock),
      feeFlat: String(l.feeFlat), feeBps: String(l.feeBps),
    };
    if (query.quoteCommit) {
      const q = l.quotes.find(q => q.commitment === query.quoteCommit);
      result.quote = { commitment: query.quoteCommit, present: Boolean(q), ...(q ? { expiry: String(q.expiry), lineGeneration: String(q.lineGeneration), used: q.used } : {}) };
    }
    if (query.noteCommit) {
      const n = l.notes.find(n => n.commitment === query.noteCommit);
      result.note = { commitment: query.noteCommit, present: Boolean(n), ...(n ? { amount: String(n.amount), fee: String(n.fee), expiry: String(n.expiry), lineGeneration: String(n.lineGeneration), redeemed: n.redeemed, cancelled: n.cancelled,
        compensationAllocated: n.compensationAllocated, refundCommitment: n.refundCommitment, cashRefundOwed: n.cashRefundOwed, refundAcknowledged: n.refundAcknowledged, refundPaymentNullifier: n.refundPaymentNullifier } : {}) };
    }
    if (query.nullifier) result.nullifier = { value: query.nullifier, present: l.nullifiers.includes(query.nullifier) };
    return result;
  }

  async fundReserve(amount: number, callerSk: string, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = fundReserve(this.ledger, { caller: callerSk, amount });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async withdrawReserve(amount: number, callerSk: string, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = withdrawUnencumberedReserve(this.ledger, { caller: callerSk, amount });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async withdrawFees(callerSk?: string, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const caller = callerSk ?? this.ledger.issuerPubKey ?? "";
    this.bindGenesisIssuer(caller);
    const res = withdrawFees(this.ledger, { caller });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock, output: { fees: res.fees } };
  }

  async registerMerchant(merchantPk: string, callerSk: string, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = registerMerchant(this.ledger, { caller: callerSk, merchantPk });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async disableMerchant(merchantPk: string, callerSk?: string, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const caller = callerSk ?? this.ledger.issuerPubKey ?? "";
    this.bindGenesisIssuer(caller);
    const res = disableMerchant(this.ledger, { caller, merchantPk });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async openLine(params: {
    limit: number;
    expiry: number;
    feeFlat?: number;
    feeBps?: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(params.callerSk);
    const res = openLine(this.ledger, {
      caller: params.callerSk,
      agentSecret: params.agentSecret,
      limit: params.limit,
      salt: params.salt,
      expiry: params.expiry,
      feeFlat: params.feeFlat ?? 0,
      feeBps: params.feeBps ?? 0,
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true, disposition: "confirmed-success",
      txHash: this.nextTxHash(),
      blockHeight: this.ledger.actionClock,
      output: { identityCommitment: res.agent.witness?.I, lineCommitment: this.ledger.lineCommitment },
    };
  }

  async postQuote(params: {
    amount: number;
    expiry: number;
    invoiceId: string;
    nonce: string;
    merchantSk: string;
  }, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const res = postQuote(this.ledger, {
      caller: params.merchantSk,
      amount: params.amount,
      invoiceId: params.invoiceId,
      expiry: params.expiry,
      nonce: params.nonce,
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true, disposition: "confirmed-success",
      txHash: this.nextTxHash(),
      blockHeight: this.ledger.actionClock,
      output: { Q: res.Q },
    };
  }

  async draw(params: {
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
  }, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const rawExp = params.noteExpiry ?? params.expiry;
    if (rawExp === undefined || rawExp === null || Number(rawExp) <= 0) {
      throw new Error("Draw refused: noteExpiry is required");
    }
    const exp = Number(rawExp);
    const feeNum = Number(params.fee ?? 0);

    const quoteRec = this.ledger.quotes.find((q) => q.commitment === params.quoteCommit);
    if (!quoteRec) return { ok: false, disposition: "definitive-rejection", error: "Clearance could not be proven.", code: "QUOTE_NOT_FOUND" };

    const merchantCommitment = params.merchantPk;
    if (!merchantCommitment) {
      return {
        ok: false, disposition: "definitive-rejection",
        error: "Missing merchant public key witness for draw.",
        code: "MISSING_MERCHANT_PK",
      };
    }

    const quotePreimage = {
      merchantCommitment,
      amount: params.amount,
      invoiceId: params.invoiceId,
      expiry: params.expiry ?? exp,
      nonce: params.quoteNonce,
      generation: quoteRec.lineGeneration,
      feeFlat: this.ledger.feeFlat,
      feeBps: this.ledger.feeBps,
    };

    const witness = {
      domain: this.ledger.contractDomain,
      I: this.ledger.identityCommitment ?? "",
      L: params.limit,
      B: params.outstanding,
      e: params.epoch,
      s: params.salt,
    };

    const res = draw(this.ledger, {
      agentSecret: params.agentSecret,
      witness,
      quote: quotePreimage,
      newSalt: params.newSalt,
      noteNonce: params.noteNonce,
      noteSalt: params.noteSalt,
      noteExpiry: exp,
      fee: feeNum,
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true, disposition: "confirmed-success",
      txHash: this.nextTxHash(),
      blockHeight: this.ledger.actionClock,
      output: { noteCommitment: res.note.D, nextCommitment: this.ledger.lineCommitment },
    };
  }

  async redeemDraw(params: {
    noteCommit: string;
    amount: number;
    expiry?: number;
    noteExpiry?: number | bigint;
    merchantSk: string;
    noteIdentity: string;
    noteQuoteCommit: string;
    noteNonce: string;
    noteSalt: string;
  }, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const noteRec = this.ledger.notes.find((n) => n.commitment === params.noteCommit);
    if (!noteRec) return { ok: false, disposition: "definitive-rejection", error: "Note not found", code: "NOTE_NOT_FOUND" };

    const exp = Number(params.noteExpiry ?? params.expiry ?? noteRec.expiry);
    const preimage = {
      domain: this.ledger.contractDomain,
      lineGeneration: noteRec.lineGeneration,
      identity: params.noteIdentity,
      quoteCommit: params.noteQuoteCommit,
      merchantPk: merchantPublicKey(params.merchantSk),
      amount: params.amount,
      noteNonce: params.noteNonce,
      fee: noteRec.fee,
      expiry: exp,
    };

    const res = redeemDraw(this.ledger, {
      caller: params.merchantSk,
      noteCommitment: params.noteCommit,
      notePreimage: preimage,
      noteSalt: params.noteSalt,
      noteExpiry: exp,
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async cancelOrExpireNote(noteCommit: string, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (options?.compensation && options.refundAck) return { ok: false, disposition: "definitive-rejection", error: "Choose one compensation action.", code: "COMPENSATION_ACTION" };
    const comp = options?.compensation;
    const book = comp?.book;
    const res = cancelOrExpireNote(this.ledger, { noteCommitment: noteCommit, callerSk,
      action: options?.refundAck ? 2 : comp ? 1 : 0,
      ...(comp ? { compensation: { note: { ...comp.note, domain: this.ledger.contractDomain }, noteSalt: comp.noteSalt,
        newSalt: comp.newSalt, ...(book ? { books: { I: this.ledger.identityCommitment ?? "", domain: this.ledger.contractDomain,
          L: book.limit, B: book.outstanding, e: book.epoch, s: book.salt } } : {}) } } : {}),
      ...(options?.refundAck ? { refundAck: options.refundAck } : {}),
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock,
      output: { ...(res.refund ? { refund: res.refund } : {}), ...(res.witness ? { witness: res.witness } : {}) } };
  }

  async acknowledgeRepayment(params: {
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
  }, _options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const receipt = {
      identity: this.ledger.identityCommitment ?? "",
      currentC: this.ledger.lineCommitment ?? "",
      amount: params.amount,
      paymentRef: params.paymentRef,
      nonce: params.receiptNonce,
      expiry: params.receiptExpiry,
      contractDomain: this.ledger.contractDomain,
    };

    const res = acknowledgeRepayment(this.ledger, {
      caller: params.callerSk,
      witness: {
        domain: this.ledger.contractDomain,
        I: this.ledger.identityCommitment ?? "",
        L: params.limit,
        B: params.outstanding,
        e: params.epoch,
        s: params.salt,
      },
      receipt,
      newSalt: params.newSalt,
    });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async setStatus(status: Exclude<LineStatus, "none">, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    const closing = options?.closingBook;
    const res = setStatus(this.ledger, { caller: callerSk, status, ...(closing ? { witness: {
      I: this.ledger.identityCommitment ?? "", domain: this.ledger.contractDomain,
      L: closing.limit, B: closing.outstanding, e: closing.epoch, s: closing.salt,
    } } : {}) });
    if (!res.ok) return { ok: false, disposition: "definitive-rejection", error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, disposition: "confirmed-success", txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  getRawLedger(): Ledger {
    return this.ledger;
  }
}
