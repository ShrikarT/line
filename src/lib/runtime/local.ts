import type {
  LineRuntime,
  RuntimeMode,
  LedgerPublicStatus,
  ReserveStatus,
  RuntimeTransactionResult,
} from "./types.ts";
import type { Ledger, LineStatus } from "../line/types.ts";
import {
  createLedger,
  fundReserve,
  withdrawUnencumberedReserve,
  registerMerchant,
  openLine,
  postQuote,
  draw,
  redeemDraw,
  cancelOrExpireNote,
  acknowledgeRepayment,
  setStatus,
  issuerPublicKey,
} from "../line/protocol.ts";

export class LocalDevelopmentRuntime implements LineRuntime {
  readonly mode: RuntimeMode = "local";
  readonly networkId: string = "local-simulator";
  private ledger: Ledger;
  private txCounter: number = 0;
  private unboundGenesis: boolean = false;

  constructor(initialLedger?: Ledger) {
    if (initialLedger) {
      this.ledger = initialLedger;
      this.unboundGenesis = false;
    } else {
      this.ledger = createLedger();
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
    const withdrawable = Math.max(0, total - (encumbered + redeemed));

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
    const withdrawable = Math.max(0, total - (encumbered + redeemed));

    return {
      totalReserve: total,
      encumberedReserve: encumbered,
      redeemedReserve: redeemed,
      withdrawableReserve: withdrawable,
      contractDomain: this.ledger.contractDomain,
    };
  }

  async fundReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = fundReserve(this.ledger, { caller: callerSk, amount });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async withdrawReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = withdrawUnencumberedReserve(this.ledger, { caller: callerSk, amount });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async registerMerchant(merchantPk: string, callerSk: string): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(callerSk);
    const res = registerMerchant(this.ledger, { caller: callerSk, merchantPk });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async openLine(params: {
    limit: number;
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }): Promise<RuntimeTransactionResult> {
    this.bindGenesisIssuer(params.callerSk);
    const res = openLine(this.ledger, {
      caller: params.callerSk,
      agentSecret: params.agentSecret,
      limit: params.limit,
      salt: params.salt,
      expiry: params.expiry,
    });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true,
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
  }): Promise<RuntimeTransactionResult> {
    const res = postQuote(this.ledger, {
      caller: params.merchantSk,
      amount: params.amount,
      invoiceId: params.invoiceId,
      expiry: params.expiry,
      nonce: params.nonce,
    });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true,
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
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
    newSalt: string;
    invoiceId: string;
    quoteNonce: string;
    noteNonce: string;
    noteSalt: string;
  }): Promise<RuntimeTransactionResult> {
    const quoteRec = this.ledger.quotes.find((q) => q.commitment === params.quoteCommit);
    if (!quoteRec) return { ok: false, error: "Clearance could not be proven.", code: "QUOTE_NOT_FOUND" };

    const quotePreimage = {
      merchantCommitment: quoteRec.merchantPk,
      amount: params.amount,
      invoiceId: params.invoiceId,
      expiry: params.expiry,
      nonce: params.quoteNonce,
      generation: quoteRec.lineGeneration,
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
    });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return {
      ok: true,
      txHash: this.nextTxHash(),
      blockHeight: this.ledger.actionClock,
      output: { noteCommitment: res.note.D, nextCommitment: this.ledger.lineCommitment },
    };
  }

  async redeemDraw(params: {
    noteCommit: string;
    amount: number;
    expiry: number;
    merchantSk: string;
    noteIdentity: string;
    noteQuoteCommit: string;
    noteNonce: string;
    noteSalt: string;
  }): Promise<RuntimeTransactionResult> {
    const noteRec = this.ledger.notes.find((n) => n.commitment === params.noteCommit);
    if (!noteRec) return { ok: false, error: "Note not found", code: "NOTE_NOT_FOUND" };

    const preimage = {
      domain: this.ledger.contractDomain,
      lineGeneration: noteRec.lineGeneration,
      identity: params.noteIdentity,
      quoteCommit: params.noteQuoteCommit,
      merchantPk: "",
      amount: params.amount,
      noteNonce: params.noteNonce,
      expiry: params.expiry,
    };

    const res = redeemDraw(this.ledger, {
      caller: params.merchantSk,
      noteCommitment: params.noteCommit,
      notePreimage: preimage,
      noteSalt: params.noteSalt,
    });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async cancelOrExpireNote(noteCommit: string, _callerSk: string): Promise<RuntimeTransactionResult> {
    const res = cancelOrExpireNote(this.ledger, { noteCommitment: noteCommit });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
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
  }): Promise<RuntimeTransactionResult> {
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
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  async setStatus(status: Exclude<LineStatus, "none">, callerSk: string): Promise<RuntimeTransactionResult> {
    const res = setStatus(this.ledger, { caller: callerSk, status });
    if (!res.ok) return { ok: false, error: res.message, code: res.code };
    this.ledger = res.ledger;
    return { ok: true, txHash: this.nextTxHash(), blockHeight: this.ledger.actionClock };
  }

  getRawLedger(): Ledger {
    return this.ledger;
  }
}
