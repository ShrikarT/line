import type {
  LineRuntime,
  RuntimeMode,
  LedgerPublicStatus,
  ReserveStatus,
  RuntimeTransactionResult,
} from "./types.ts";
import type { LineStatus } from "../line/types.ts";

export interface MidnightNetworkConfig {
  networkId: string;
  indexerUri?: string;
  nodeUri?: string;
  contractAddress?: string;
}

export class MidnightNetworkRuntime implements LineRuntime {
  readonly mode: RuntimeMode = "network";
  readonly networkId: string;
  private indexerUri: string | null;
  private nodeUri: string | null;
  private contractAddress: string | null;

  constructor(config?: Partial<MidnightNetworkConfig>) {
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
    const viteEnv = ((typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env : undefined) ?? {}) as Record<string, string | undefined>;

    this.networkId =
      config?.networkId ??
      viteEnv.VITE_MIDNIGHT_NETWORK_ID ??
      env.MIDNIGHT_NETWORK_ID ??
      "midnight-preprod";

    this.indexerUri =
      config?.indexerUri ??
      viteEnv.VITE_MIDNIGHT_INDEXER_URI ??
      env.MIDNIGHT_INDEXER_URI ??
      null;

    this.nodeUri =
      config?.nodeUri ??
      viteEnv.VITE_MIDNIGHT_NODE_URI ??
      env.MIDNIGHT_NODE_URI ??
      null;

    this.contractAddress =
      config?.contractAddress ??
      viteEnv.VITE_MIDNIGHT_CONTRACT_ADDRESS ??
      env.MIDNIGHT_CONTRACT_ADDRESS ??
      null;
  }

  isConnected(): boolean {
    // In production browser, requires window.midnight or configured node & contract
    if (typeof window !== "undefined") {
      const hasWallet = Boolean((window as unknown as { midnight?: unknown }).midnight);
      return hasWallet && Boolean(this.contractAddress);
    }
    return Boolean(this.nodeUri && this.contractAddress);
  }

  getContractAddress(): string | null {
    return this.contractAddress;
  }

  private assertConfigured(action: string): void {
    if (!this.contractAddress) {
      throw new Error(
        `MidnightNetworkRuntime: Cannot ${action}. MIDNIGHT_CONTRACT_ADDRESS is not set. Deploy or join a contract before submitting network transactions.`
      );
    }
    if (!this.isConnected()) {
      throw new Error(
        `MidnightNetworkRuntime: Cannot ${action}. No active Midnight network connection or wallet detected. Connect a Midnight wallet to proceed.`
      );
    }
  }

  async getStatus(): Promise<LedgerPublicStatus> {
    if (!this.contractAddress || !this.indexerUri) {
      return {
        contractDomain: "0x0000000000000000000000000000000000000000000000000000000000000000",
        contractAddress: this.contractAddress,
        networkId: this.networkId,
        status: "none",
        actionClock: 0,
        lineGeneration: 0,
        identityCommitment: null,
        lineCommitment: null,
        totalReserve: 0,
        encumberedReserve: 0,
        redeemedReserve: 0,
        withdrawableReserve: 0,
        quoteCount: 0,
        noteCount: 0,
        nullifierCount: 0,
        runtime: "network",
      };
    }

    try {
      const resp = await fetch(`${this.indexerUri}/contracts/${this.contractAddress}/state`);
      if (!resp.ok) {
        throw new Error(`Indexer returned HTTP ${resp.status}`);
      }
      const data = await resp.json();
      return {
        contractDomain: data.contractDomain,
        contractAddress: this.contractAddress,
        networkId: this.networkId,
        status: data.status ?? "none",
        actionClock: data.actionClock ?? 0,
        lineGeneration: data.lineGeneration ?? 0,
        identityCommitment: data.identityCommitment ?? null,
        lineCommitment: data.lineCommitment ?? null,
        totalReserve: data.totalReserve ?? 0,
        encumberedReserve: data.encumberedReserve ?? 0,
        redeemedReserve: data.redeemedReserve ?? 0,
        withdrawableReserve: Math.max(0, (data.totalReserve ?? 0) - ((data.encumberedReserve ?? 0) + (data.redeemedReserve ?? 0))),
        quoteCount: data.quoteCount ?? 0,
        noteCount: data.noteCount ?? 0,
        nullifierCount: data.nullifierCount ?? 0,
        runtime: "network",
      };
    } catch (err) {
      throw new Error(`MidnightNetworkRuntime: Failed to query indexer at ${this.indexerUri}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getReserveStatus(): Promise<ReserveStatus> {
    const status = await this.getStatus();
    return {
      totalReserve: status.totalReserve,
      encumberedReserve: status.encumberedReserve,
      redeemedReserve: status.redeemedReserve,
      withdrawableReserve: status.withdrawableReserve,
      contractDomain: status.contractDomain,
    };
  }

  async fundReserve(amount: number, _callerSk: string): Promise<RuntimeTransactionResult> {
    this.assertConfigured("fund reserve");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async withdrawReserve(amount: number, _callerSk: string): Promise<RuntimeTransactionResult> {
    this.assertConfigured("withdraw reserve");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async registerMerchant(merchantPk: string, _callerSk: string): Promise<RuntimeTransactionResult> {
    this.assertConfigured("register merchant");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async openLine(_params: {
    limit: number;
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }): Promise<RuntimeTransactionResult> {
    this.assertConfigured("open line");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async postQuote(_params: {
    amount: number;
    expiry: number;
    invoiceId: string;
    nonce: string;
    merchantSk: string;
  }): Promise<RuntimeTransactionResult> {
    this.assertConfigured("post quote");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async draw(_params: {
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
    this.assertConfigured("submit draw");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async redeemDraw(_params: {
    noteCommit: string;
    amount: number;
    expiry: number;
    merchantSk: string;
    noteIdentity: string;
    noteQuoteCommit: string;
    noteNonce: string;
    noteSalt: string;
  }): Promise<RuntimeTransactionResult> {
    this.assertConfigured("redeem draw note");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async acknowledgeRepayment(_params: {
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
    this.assertConfigured("acknowledge repayment");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }

  async setStatus(_status: Exclude<LineStatus, "none">, _callerSk: string): Promise<RuntimeTransactionResult> {
    this.assertConfigured("set line status");
    return { ok: false, error: "Network transaction submission requires external wallet confirmation." };
  }
}
