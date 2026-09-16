/**
 * MidnightNetworkRuntime
 *
 * Official Midnight DApp Network Runtime for Line.
 * Connects to Midnight network services (GraphQL Indexer, Proof Server, Node RPC)
 * and dispatches transactions through Compact-generated bindings and Midnight DApp Connector.
 *
 * Implements operation-scoped private witness context, Vault-backed PrivateStateProvider,
 * browser-safe hex encodings (zero Node Buffer), and strict transaction confirmation validation.
 */
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
  MissingPrivateWitnessError,
  InvalidWitnessError,
  VaultLockedError,
} from "./errors.ts";
import {
  connectWallet,
  type WalletInfo,
  getAvailableWallets,
  getConnectedWallet,
  disconnectWallet,
} from "./wallet.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import type { PublicDataProvider, ZKConfigProvider } from "@midnight-ntwrk/midnight-js-types";
import { VaultPrivateStateProvider } from "./vault-provider.ts";
import { hexToBytes, toHex, canonicalInvoiceIdBytes } from "../line/encoding.ts";
import { Contract, ledger, Status } from "../../../contracts/managed/line/contract/index.js";

export interface MidnightNetworkConfig {
  networkId: string;
  indexerUri?: string;
  indexerWsUri?: string;
  nodeUri?: string;
  proofServerUri?: string;
  zkConfigBaseUrl?: string;
  contractAddress?: string;
  privateStoragePasswordProvider?: () => string | Promise<string>;
}

export interface LinePrivateWitnessContext {
  callerSecret?: Uint8Array;
  agentSecret?: Uint8Array;
  salt?: Uint8Array;
  newSalt?: Uint8Array;
  invoiceId?: Uint8Array;
  quoteNonce?: Uint8Array;
  receiptNonce?: Uint8Array;
  paymentRef?: Uint8Array;
  noteNonce?: Uint8Array;
  noteSalt?: Uint8Array;
  noteIdentity?: Uint8Array;
  noteQuoteCommit?: Uint8Array;
}

class AsyncMutex {
  private queue: Array<(release: () => void) => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(() => this.release());
    } else {
      this.locked = false;
    }
  }
}

export function validateWitnessBytes32(
  val: string | Uint8Array | undefined | null,
  witnessName: string
): Uint8Array {
  if (!val) {
    throw new MissingPrivateWitnessError(witnessName);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      throw new MissingPrivateWitnessError(witnessName);
    }
    const cleanHex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
    if (cleanHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
      throw new InvalidWitnessError(
        witnessName,
        `Expected 32-byte hex string (64 characters), received '${trimmed}'`
      );
    }
    return hexToBytes(cleanHex);
  }
  if (val instanceof Uint8Array) {
    if (val.length !== 32) {
      throw new InvalidWitnessError(
        witnessName,
        `Expected 32 bytes, received ${val.length} bytes`
      );
    }
    return val;
  }
  throw new InvalidWitnessError(witnessName, "Expected 32-byte hex string or Uint8Array");
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
  private passwordProvider?: () => string | Promise<string>;
  private activeWitnessContext: LinePrivateWitnessContext | null = null;
  private readonly mutex = new AsyncMutex();

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

    this.passwordProvider = config?.privateStoragePasswordProvider;
    this.connectedWallet = getConnectedWallet();
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
    if (this.cachedProviders?.privateStateProvider && address) {
      this.cachedProviders.privateStateProvider.setContractAddress(address);
    }
  }

  async attachWallet(preferredRdns?: string): Promise<ConnectedAPI> {
    this.connectedWallet = await connectWallet(preferredRdns, this.networkId);
    this.cachedProviders = null;
    this.boundContract = null;
    return this.connectedWallet;
  }

  async detachWallet(): Promise<void> {
    await disconnectWallet();
    this.connectedWallet = null;
    this.cachedProviders = null;
    this.boundContract = null;
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
      if (!this.passwordProvider) {
        throw new VaultLockedError("Private storage passwordProvider must be configured for Node environment private state.");
      }
      const { levelPrivateStateProvider } = await import("@midnight-ntwrk/midnight-js-level-private-state-provider");
      privateStateProvider = levelPrivateStateProvider({
        privateStoragePasswordProvider: this.passwordProvider,
        accountId: this.contractAddress ? `line-${this.contractAddress.slice(0, 10)}` : "line-session",
      });
    } else {
      privateStateProvider = new VaultPrivateStateProvider({
        passwordProvider: this.passwordProvider,
        networkId: this.networkId,
      });
      if (this.contractAddress) {
        privateStateProvider.setContractAddress(this.contractAddress);
      }
    }

    let walletProvider: any;
    let midnightProvider: any;

    if (this.connectedWallet) {
      walletProvider = (this.connectedWallet as any).walletProvider ?? this.connectedWallet;
      midnightProvider = (this.connectedWallet as any).midnightProvider ?? this.connectedWallet;
    } else {
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
        return toHex(u);
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
        nullifierCount: Number(l.nullifiers?.size?.() ?? 0),
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
      const l = ledger(state.data);
      if (!l.contractDomain || l.contractDomain.length !== 32) {
        throw new Error("Missing 32-byte contractDomain in decoded ledger.");
      }
    } catch (err) {
      throw new ContractIncompatibleError(address, err instanceof Error ? err.message : String(err));
    }

    this.setContractAddress(address);
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

    // Typed witnesses read from active operation context or private state provider
    const witnesses = {
      callerSecret: (ctx: any) => {
        const val = this.activeWitnessContext?.callerSecret ?? ctx.privateState?.callerSecret;
        if (!val) throw new Error("Witness error: missing callerSecret in active witness context");
        return [ctx.privateState, val];
      },
      agentSecret: (ctx: any) => {
        const val = this.activeWitnessContext?.agentSecret ?? ctx.privateState?.agentSecret;
        if (!val) throw new Error("Witness error: missing agentSecret in active witness context");
        return [ctx.privateState, val];
      },
      salt: (ctx: any) => {
        const val = this.activeWitnessContext?.salt ?? ctx.privateState?.salt;
        if (!val) throw new Error("Witness error: missing salt in active witness context");
        return [ctx.privateState, val];
      },
      newSalt: (ctx: any) => {
        const val = this.activeWitnessContext?.newSalt ?? ctx.privateState?.newSalt;
        if (!val) throw new Error("Witness error: missing newSalt in active witness context");
        return [ctx.privateState, val];
      },
      invoiceId: (ctx: any) => {
        const val = this.activeWitnessContext?.invoiceId ?? ctx.privateState?.invoiceId;
        if (!val) throw new Error("Witness error: missing invoiceId in active witness context");
        return [ctx.privateState, val];
      },
      quoteNonce: (ctx: any) => {
        const val = this.activeWitnessContext?.quoteNonce ?? ctx.privateState?.quoteNonce;
        if (!val) throw new Error("Witness error: missing quoteNonce in active witness context");
        return [ctx.privateState, val];
      },
      receiptNonce: (ctx: any) => {
        const val = this.activeWitnessContext?.receiptNonce ?? ctx.privateState?.receiptNonce;
        if (!val) throw new Error("Witness error: missing receiptNonce in active witness context");
        return [ctx.privateState, val];
      },
      paymentRef: (ctx: any) => {
        const val = this.activeWitnessContext?.paymentRef ?? ctx.privateState?.paymentRef;
        if (!val) throw new Error("Witness error: missing paymentRef in active witness context");
        return [ctx.privateState, val];
      },
      noteNonce: (ctx: any) => {
        const val = this.activeWitnessContext?.noteNonce ?? ctx.privateState?.noteNonce;
        if (!val) throw new Error("Witness error: missing noteNonce in active witness context");
        return [ctx.privateState, val];
      },
      noteSalt: (ctx: any) => {
        const val = this.activeWitnessContext?.noteSalt ?? ctx.privateState?.noteSalt;
        if (!val) throw new Error("Witness error: missing noteSalt in active witness context");
        return [ctx.privateState, val];
      },
      noteIdentity: (ctx: any) => {
        const val = this.activeWitnessContext?.noteIdentity ?? ctx.privateState?.noteIdentity;
        if (!val) throw new Error("Witness error: missing noteIdentity in active witness context");
        return [ctx.privateState, val];
      },
      noteQuoteCommit: (ctx: any) => {
        const val = this.activeWitnessContext?.noteQuoteCommit ?? ctx.privateState?.noteQuoteCommit;
        if (!val) throw new Error("Witness error: missing noteQuoteCommit in active witness context");
        return [ctx.privateState, val];
      },
    };

    const contract = new Contract(witnesses as any);

    try {
      const { findDeployedContract } = await import("@midnight-ntwrk/midnight-js-contracts");
      this.boundContract = (await (findDeployedContract as any)(providers, {
        contract,
        contractAddress: this.contractAddress,
        privateStateId: `line-state:${this.contractAddress}`,
      })) as any;
      return this.boundContract;
    } catch (err) {
      throw new CircuitExecutionError("findDeployedContract", err instanceof Error ? err.message : String(err));
    }
  }

  private validateTxResult(
    tx: any,
    operationName: string
  ): { ok: true; txHash: string; blockHeight: number } | { ok: false; error: string; code: string } {
    const txHash = tx?.public?.txHash ?? tx?.public?.txId ?? tx?.txHash ?? tx?.txId;
    if (!txHash || typeof txHash !== "string" || txHash === "0x0" || txHash.trim().length === 0) {
      return {
        ok: false,
        error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: Transaction receipt missing finalization evidence.`,
        code: "TRANSACTION_FINALIZATION_FAILED",
      };
    }
    const blockHeight = Number(tx?.public?.blockHeight ?? tx?.blockHeight ?? 0);
    if (!Number.isFinite(blockHeight) || blockHeight <= 0) {
      return {
        ok: false,
        error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: Transaction receipt unconfirmed or invalid block height (${blockHeight}).`,
        code: "TRANSACTION_NOT_CONFIRMED",
      };
    }
    return { ok: true, txHash, blockHeight };
  }

  private async withOperationLock<T>(
    witnessContext: LinePrivateWitnessContext,
    action: () => Promise<T>
  ): Promise<T> {
    const release = await this.mutex.acquire();
    this.activeWitnessContext = witnessContext;
    try {
      return await action();
    } finally {
      this.activeWitnessContext = null;
      release();
    }
  }

  async fundReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.fundReserve(BigInt(amount));
        return this.validateTxResult(tx, "fundReserve");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "FUND_RESERVE_FAILED" };
      }
    });
  }

  async withdrawReserve(amount: number, callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.withdrawUnencumberedReserve(BigInt(amount));
        return this.validateTxResult(tx, "withdrawReserve");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "WITHDRAW_RESERVE_FAILED" };
      }
    });
  }

  async registerMerchant(merchantPk: string, callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    const merchantBytes = validateWitnessBytes32(merchantPk, "merchantPublicKey");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.registerMerchant(merchantBytes);
        return this.validateTxResult(tx, "registerMerchant");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "REGISTER_MERCHANT_FAILED" };
      }
    });
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

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.openLine(BigInt(params.limit), BigInt(params.expiry));
        return this.validateTxResult(tx, "openLine");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "OPEN_LINE_FAILED" };
      }
    });
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

    if (!params.invoiceId || params.invoiceId.trim().length === 0) {
      throw new MissingPrivateWitnessError("invoiceId");
    }

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.merchantSk, "merchantSecret"),
      invoiceId: canonicalInvoiceIdBytes(params.invoiceId),
      quoteNonce: validateWitnessBytes32(params.nonce, "quoteNonce"),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.postQuote(BigInt(params.amount), BigInt(params.expiry));
        return this.validateTxResult(tx, "postQuote");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "POST_QUOTE_FAILED" };
      }
    });
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

    if (!params.invoiceId || params.invoiceId.trim().length === 0) {
      throw new MissingPrivateWitnessError("invoiceId");
    }

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
      newSalt: validateWitnessBytes32(params.newSalt, "newSalt"),
      invoiceId: canonicalInvoiceIdBytes(params.invoiceId),
      quoteNonce: validateWitnessBytes32(params.quoteNonce, "quoteNonce"),
      noteNonce: validateWitnessBytes32(params.noteNonce, "noteNonce"),
      noteSalt: validateWitnessBytes32(params.noteSalt, "noteSalt"),
    };

    const qBytes = validateWitnessBytes32(params.quoteCommit, "quoteCommit");

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.draw(
          qBytes,
          BigInt(params.limit),
          BigInt(params.outstanding),
          BigInt(params.epoch),
          BigInt(params.amount),
          BigInt(params.expiry)
        );
        return this.validateTxResult(tx, "draw");
      } catch {
        return { ok: false, error: "Clearance could not be proven.", code: "DRAW_FAILED" };
      }
    });
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

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.merchantSk, "merchantSecret"),
      noteIdentity: validateWitnessBytes32(params.noteIdentity, "noteIdentity"),
      noteQuoteCommit: validateWitnessBytes32(params.noteQuoteCommit, "noteQuoteCommit"),
      noteNonce: validateWitnessBytes32(params.noteNonce, "noteNonce"),
      noteSalt: validateWitnessBytes32(params.noteSalt, "noteSalt"),
    };

    const dBytes = validateWitnessBytes32(params.noteCommit, "noteCommit");

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.redeemDraw(dBytes, BigInt(params.amount), BigInt(params.expiry));
        return this.validateTxResult(tx, "redeemDraw");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "REDEEM_DRAW_FAILED" };
      }
    });
  }

  async cancelOrExpireNote(noteCommit: string, callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    const dBytes = validateWitnessBytes32(noteCommit, "noteCommit");

    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.cancelOrExpireNote(dBytes);
        return this.validateTxResult(tx, "cancelOrExpireNote");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "CANCEL_NOTE_FAILED" };
      }
    });
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

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
      newSalt: validateWitnessBytes32(params.newSalt, "newSalt"),
      receiptNonce: validateWitnessBytes32(params.receiptNonce, "receiptNonce"),
      paymentRef: validateWitnessBytes32(params.paymentRef, "paymentRef"),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.acknowledgeRepayment(
          BigInt(params.limit),
          BigInt(params.outstanding),
          BigInt(params.epoch),
          BigInt(params.amount),
          BigInt(params.receiptExpiry)
        );
        return this.validateTxResult(tx, "acknowledgeRepayment");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "ACK_REPAYMENT_FAILED" };
      }
    });
  }

  async setStatus(status: Exclude<LineStatus, "none">, callerSk: string): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const compactStatus = status === "open" ? Status.OPEN : status === "defaulted" ? Status.DEFAULTED : Status.CLOSED;
        const tx = await bound.callTx.setStatus(compactStatus);
        return this.validateTxResult(tx, "setStatus");
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), code: "SET_STATUS_FAILED" };
      }
    });
  }
}
