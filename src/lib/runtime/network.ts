import type {
  LineRuntime,
  RuntimeMode,
  LedgerPublicStatus,
  ReserveStatus,
  RuntimeTransactionResult,
} from "./types.ts";
import type { LineStatus } from "../line/types.ts";
import {
  LineRuntimeError,
  WalletNotConnectedError,
  ContractNotConfiguredError,
  ContractNotFoundError,
  ContractIncompatibleError,
  NetworkUnreachableError,
  CircuitExecutionError,
} from "./errors.ts";
import { connectWallet, isWalletInjected, type WalletInfo, getAvailableWallets } from "./wallet.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

import type { DeployedContract, ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import type { PublicDataProvider, ZKConfigProvider } from "@midnight-ntwrk/midnight-js-types";

// Official managed contract bindings
import { Contract, ledger, Status } from "../../../contracts/managed/line/contract/index.js";

export interface MidnightNetworkConfig {
  networkId: string;
  indexerUri?: string;
  indexerWsUri?: string;
  nodeUri?: string;
  proofServerUri?: string;
  zkConfigBaseUrl?: string;
  contractAddress?: string;
  privateStoragePassword?: string;
  accountId?: string;
}

export class MidnightNetworkRuntime implements LineRuntime {
  readonly mode: RuntimeMode = "network";
  readonly networkId: string;
  readonly indexerUri: string | null;
  readonly indexerWsUri: string | null;
  readonly nodeUri: string | null;
  readonly proofServerUri: string | null;
  readonly zkConfigBaseUrl: string;

  private contractAddress: string | null;
  private connectedWallet: ConnectedAPI | null = null;
  private cachedProviders: ContractProviders<any> | null = null;
  private boundContract: any = null;
  private privateStoragePassword: string = "LineVault123!SecureStoragePassword";
  private accountId: string = "line-default-account";

  constructor(config?: Partial<MidnightNetworkConfig>) {
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
    const viteEnv = ((typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env : undefined) ?? {}) as Record<string, string | undefined>;

    this.networkId =
      config?.networkId ??
      viteEnv.VITE_MIDNIGHT_NETWORK_ID ??
      env.MIDNIGHT_NETWORK_ID ??
      "midnight-testnet";

    this.indexerUri =
      config?.indexerUri ??
      viteEnv.VITE_MIDNIGHT_INDEXER_URI ??
      env.MIDNIGHT_INDEXER_URI ??
      "https://indexer.testnet-02.midnight.network/api/v1/graphql";

    this.indexerWsUri =
      config?.indexerWsUri ??
      viteEnv.VITE_MIDNIGHT_INDEXER_WS_URI ??
      env.MIDNIGHT_INDEXER_WS_URI ??
      "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";

    this.nodeUri =
      config?.nodeUri ??
      viteEnv.VITE_MIDNIGHT_NODE_URI ??
      env.MIDNIGHT_NODE_URI ??
      "https://rpc.testnet-02.midnight.network";

    this.proofServerUri =
      config?.proofServerUri ??
      viteEnv.VITE_MIDNIGHT_PROOF_SERVER_URI ??
      env.MIDNIGHT_PROOF_SERVER_URI ??
      "http://127.0.0.1:6300";

    this.zkConfigBaseUrl =
      config?.zkConfigBaseUrl ??
      viteEnv.VITE_MIDNIGHT_ZK_CONFIG_URL ??
      "/zkir";

    this.contractAddress =
      config?.contractAddress ??
      viteEnv.VITE_MIDNIGHT_CONTRACT_ADDRESS ??
      env.MIDNIGHT_CONTRACT_ADDRESS ??
      null;

    if (config?.privateStoragePassword) {
      this.privateStoragePassword = config.privateStoragePassword;
    }
    if (config?.accountId) {
      this.accountId = config.accountId;
    }
  }

  isConnected(): boolean {
    if (typeof window !== "undefined") {
      return Boolean(this.connectedWallet) && Boolean(this.contractAddress);
    }
    return Boolean(this.contractAddress && this.indexerUri);
  }

  isWalletConnected(): boolean {
    return Boolean(this.connectedWallet);
  }

  getContractAddress(): string | null {
    return this.contractAddress;
  }

  setContractAddress(address: string | null): void {
    this.contractAddress = address;
    this.boundContract = null;
  }

  async attachWallet(preferredRdns?: string): Promise<ConnectedAPI> {
    this.connectedWallet = await connectWallet(preferredRdns);
    this.cachedProviders = null;
    this.boundContract = null;
    return this.connectedWallet;
  }

  getDiscoveredWallets(): WalletInfo[] {
    return getAvailableWallets();
  }

  private createPublicDataProvider(): PublicDataProvider {
    if (!this.indexerUri) {
      throw new NetworkUnreachableError("Indexer URI is not configured.");
    }
    return indexerPublicDataProvider(this.indexerUri, this.indexerWsUri ?? this.indexerUri.replace(/^http/, "ws"));
  }

  private async createZkConfigProvider(): Promise<ZKConfigProvider<string>> {
    if (typeof window !== "undefined") {
      const { FetchZkConfigProvider } = await import("@midnight-ntwrk/midnight-js-fetch-zk-config-provider");
      return new FetchZkConfigProvider(this.zkConfigBaseUrl);
    }
    const { NodeZkConfigProvider } = await import("@midnight-ntwrk/midnight-js-node-zk-config-provider");
    return new NodeZkConfigProvider("contracts/managed/line");
  }

  async getProviders(): Promise<ContractProviders<any>> {
    if (this.cachedProviders) {
      return this.cachedProviders;
    }

    const publicDataProvider = this.createPublicDataProvider();
    const zkConfigProvider = await this.createZkConfigProvider();
    const { httpClientProofProvider } = await import("@midnight-ntwrk/midnight-js-http-client-proof-provider");
    const proofProvider = httpClientProofProvider(this.proofServerUri ?? "http://127.0.0.1:6300", zkConfigProvider);

    let privateStateProvider: any;
    if (typeof window === "undefined") {
      const { levelPrivateStateProvider } = await import("@midnight-ntwrk/midnight-js-level-private-state-provider");
      privateStateProvider = levelPrivateStateProvider({
        privateStoragePasswordProvider: () => this.privateStoragePassword,
        accountId: this.accountId,
      });
    } else {
      privateStateProvider = {
        get: async () => null,
        set: async () => {},
        remove: async () => {},
        clear: async () => {},
      };
    }

    let walletProvider: any;
    let midnightProvider: any;

    if (this.connectedWallet) {
      walletProvider = (this.connectedWallet as any).walletProvider ?? this.connectedWallet;
      midnightProvider = (this.connectedWallet as any).midnightProvider ?? this.connectedWallet;
    } else {
      // Stub provider for read-only queries or Node scripts with custom keys
      walletProvider = {
        balanceTx: async () => { throw new WalletNotConnectedError(); },
        getCoinPublicKey: () => "0x00",
        getEncryptionPublicKey: () => "0x00",
      };
      midnightProvider = {
        submitTx: async () => { throw new WalletNotConnectedError(); },
      };
    }

    this.cachedProviders = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    };

    return this.cachedProviders;
  }

  async getStatus(): Promise<LedgerPublicStatus> {
    if (!this.contractAddress) {
      return {
        contractDomain: "0x0000000000000000000000000000000000000000000000000000000000000000",
        contractAddress: null,
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
      const publicDataProvider = this.createPublicDataProvider();
      const state = await publicDataProvider.queryContractState(this.contractAddress);
      if (!state) {
        throw new ContractNotFoundError(this.contractAddress, this.networkId);
      }

      const l = ledger(state.data);
      const toHex32 = (u: Uint8Array | null | undefined): string | null => {
        if (!u || u.length === 0) return null;
        return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
      };

      const statusFromCompact = (st: Status): LineStatus => {
        switch (st) {
          case Status.OPEN: return "open";
          case Status.DEFAULTED: return "defaulted";
          case Status.CLOSED: return "closed";
          case Status.NONE:
          default:
            return "none";
        }
      };

      const totalReserve = Number(l.totalReserve);
      const encumberedReserve = Number(l.encumberedReserve);
      const redeemedReserve = Number(l.redeemedReserve);
      const withdrawable = Math.max(0, totalReserve - (encumberedReserve + redeemedReserve));

      return {
        contractDomain: toHex32(l.contractDomain) ?? "0x00",
        contractAddress: this.contractAddress,
        networkId: this.networkId,
        status: statusFromCompact(l.status),
        actionClock: Number(l.actionClock),
        lineGeneration: Number(l.lineGeneration),
        identityCommitment: toHex32(l.identityCommit),
        lineCommitment: toHex32(l.lineCommit),
        totalReserve,
        encumberedReserve,
        redeemedReserve,
        withdrawableReserve: withdrawable,
        quoteCount: Number(l.quotes?.size?.() ?? 0),
        noteCount: Number(l.notes?.size?.() ?? 0),
        nullifierCount: 0,
        runtime: "network",
      };
    } catch (err) {
      if (err instanceof LineRuntimeError) throw err;
      throw new NetworkUnreachableError(this.indexerUri ?? "indexer", err);
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

  async joinContract(address: string): Promise<LedgerPublicStatus> {
    if (!address || address.trim().length === 0) {
      throw new ContractNotConfiguredError("Cannot join empty contract address.");
    }

    const publicDataProvider = this.createPublicDataProvider();
    let state;
    try {
      state = await publicDataProvider.queryContractState(address);
    } catch (err) {
      if (err instanceof LineRuntimeError) throw err;
      throw new NetworkUnreachableError(this.indexerUri ?? "indexer", err);
    }
    if (!state) {
      throw new ContractNotFoundError(address, this.networkId);
    }

    try {
      // Validate that ledger decodes cleanly as a Line contract
      const l = ledger(state.data);
      if (!l.contractDomain || l.contractDomain.length !== 32) {
        throw new Error("Missing 32-byte contractDomain in decoded ledger.");
      }
    } catch (err) {
      throw new ContractIncompatibleError(address, err instanceof Error ? err.message : String(err));
    }

    this.contractAddress = address;
    this.boundContract = null;
    return this.getStatus();
  }

  private async getBoundContract(): Promise<any> {
    if (this.boundContract) return this.boundContract;
    if (!this.contractAddress) {
      throw new ContractNotConfiguredError();
    }
    if (!this.connectedWallet) {
      throw new WalletNotConnectedError();
    }

    const providers = await this.getProviders();
    const witnesses = {
      callerSecret: () => [undefined, new Uint8Array(32)],
      agentSecret: () => [undefined, new Uint8Array(32)],
      salt: () => [undefined, new Uint8Array(32)],
      newSalt: () => [undefined, new Uint8Array(32)],
      invoiceId: () => [undefined, new Uint8Array(32)],
      quoteNonce: () => [undefined, new Uint8Array(32)],
      receiptNonce: () => [undefined, new Uint8Array(32)],
      paymentRef: () => [undefined, new Uint8Array(32)],
      noteNonce: () => [undefined, new Uint8Array(32)],
      noteSalt: () => [undefined, new Uint8Array(32)],
      noteIdentity: () => [undefined, new Uint8Array(32)],
      noteQuoteCommit: () => [undefined, new Uint8Array(32)],
    };
    const contract = new Contract(witnesses as any);

    try {
      const { findDeployedContract } = await import("@midnight-ntwrk/midnight-js-contracts");
      this.boundContract = (await (findDeployedContract as any)(providers, {
        contract,
        contractAddress: this.contractAddress,
      })) as any;
      return this.boundContract;
    } catch (err) {
      throw new CircuitExecutionError("findDeployedContract", err instanceof Error ? err.message : String(err));
    }
  }

  async fundReserve(amount: number, _callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const tx = await bound.callTx.fundReserve(BigInt(amount));
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "FUND_RESERVE_FAILED" };
    }
  }

  async withdrawReserve(amount: number, _callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const tx = await bound.callTx.withdrawUnencumberedReserve(BigInt(amount));
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "WITHDRAW_RESERVE_FAILED" };
    }
  }

  async registerMerchant(merchantPk: string, _callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const cleanPk = merchantPk.startsWith("0x") ? merchantPk.slice(2) : merchantPk;
      const bytes = new Uint8Array(Buffer.from(cleanPk, "hex"));
      const tx = await bound.callTx.registerMerchant(bytes);
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "REGISTER_MERCHANT_FAILED" };
    }
  }

  async openLine(params: {
    limit: number;
    expiry: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const tx = await bound.callTx.openLine(BigInt(params.limit), BigInt(params.expiry));
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "OPEN_LINE_FAILED" };
    }
  }

  async postQuote(params: {
    amount: number;
    expiry: number;
    merchantSk: string;
    invoiceId: string;
    nonce: string;
  }): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const tx = await bound.callTx.postQuote(BigInt(params.amount), BigInt(params.expiry));
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "POST_QUOTE_FAILED" };
    }
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
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const cleanQ = params.quoteCommit.startsWith("0x") ? params.quoteCommit.slice(2) : params.quoteCommit;
      const qBytes = new Uint8Array(Buffer.from(cleanQ, "hex"));
      const tx = await bound.callTx.draw(
        qBytes,
        BigInt(params.limit),
        BigInt(params.outstanding),
        BigInt(params.epoch),
        BigInt(params.amount),
        BigInt(params.expiry)
      );
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: "Clearance could not be proven.", code: "DRAW_FAILED" };
    }
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
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const cleanD = params.noteCommit.startsWith("0x") ? params.noteCommit.slice(2) : params.noteCommit;
      const dBytes = new Uint8Array(Buffer.from(cleanD, "hex"));
      const tx = await bound.callTx.redeemDraw(dBytes, BigInt(params.amount), BigInt(params.expiry));
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "REDEEM_DRAW_FAILED" };
    }
  }

  async cancelOrExpireNote(noteCommit: string, _callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const cleanD = noteCommit.startsWith("0x") ? noteCommit.slice(2) : noteCommit;
      const dBytes = new Uint8Array(Buffer.from(cleanD, "hex"));
      const tx = await bound.callTx.cancelOrExpireNote(dBytes);
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "CANCEL_NOTE_FAILED" };
    }
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
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const tx = await bound.callTx.acknowledgeRepayment(
        BigInt(params.limit),
        BigInt(params.outstanding),
        BigInt(params.epoch),
        BigInt(params.amount),
        BigInt(params.receiptExpiry)
      );
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "ACK_REPAYMENT_FAILED" };
    }
  }

  async setStatus(status: Exclude<LineStatus, "none">, _callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    try {
      const bound = await this.getBoundContract();
      const compactStatus = status === "open" ? Status.OPEN : status === "defaulted" ? Status.DEFAULTED : Status.CLOSED;
      const tx = await bound.callTx.setStatus(compactStatus);
      const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? "0x0";
      const blockHeight = tx?.public?.blockHeight ?? 0;
      return { ok: true, txHash, blockHeight };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), code: "SET_STATUS_FAILED" };
    }
  }
}
