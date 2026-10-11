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
  RuntimeOperationOptions,
  RuntimeRecoveryEvidence,
  RuntimeRecoveryQuery,
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
  createWalletProviders,
  getWalletConfiguration,
} from "./wallet.ts";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { resolveMidnightEndpoints, assertEndpointCredentials, sanitizeServiceError, redactEndpoint } from "./endpoints.ts";
import { TxFailedError, findDeployedContract, type ContractProviders, type FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract, type Contract as CompactContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FailEntirely, SucceedEntirely, type PublicDataProvider, type ZKConfigProvider, type PrivateStateProvider, type FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { getVaultSessionRevision, isVaultSessionUnlocked } from "../security/vault.ts";
import { VaultPrivateStateProvider } from "./vault-provider.ts";
import { hexToBytes, toHex, canonicalInvoiceIdBytes, canonicalPaymentReferenceBytes } from "../line/encoding.ts";
import {
  Contract,
  ledger,
  Status,
  type Witnesses,
} from "../../../contracts/managed/line/contract/index.js";

export type BoundLineContract = FoundContract<Contract<LinePrivateWitnessContext>>;
export type BoundCircuitFunctions = BoundLineContract["callTx"];
export type LineProviders = ContractProviders<Contract<LinePrivateWitnessContext>>;
export type LineCircuitId = CompactContract.ProvableCircuitId<Contract<LinePrivateWitnessContext>>;

export interface MidnightNetworkConfig {
  networkId: string;
  blockfrostProjectId?: string;
  indexerUri?: string;
  indexerWsUri?: string;
  nodeUri?: string;
  proofServerUri?: string;
  zkConfigBaseUrl?: string;
  zkArtifactDir?: string;
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
  lineLimit?: bigint | number;
  lineOutstanding?: bigint | number;
  lineEpoch?: bigint | number;
  quoteAmount?: bigint | number;
  drawAmount?: bigint | number;
  redeemAmount?: bigint | number;
  repayAmount?: bigint | number;
  quoteMerchantPk?: Uint8Array | string;
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
        "Expected a 32-byte hex string (64 characters)."
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
  indexerUri: string | null;
  indexerWsUri: string | null;
  nodeUri: string | null;
  proofServerUri: string | null;
  readonly zkConfigBaseUrl: string;
  private readonly zkArtifactDir?: string;

  private contractAddress: string | null;
  private connectedWallet: ConnectedAPI | null = null;
  private cachedProviders: LineProviders | null = null;
  // SDK watchers wait indefinitely. Reuse one watcher per journaled ID and bound
  // their count; application observation timeout is not transaction rejection.
  private receiptWatches = new Map<string, Promise<FinalizedTxData | null>>();
  private boundContract: BoundLineContract | null = null;
  private passwordProvider?: () => string | Promise<string>;
  private activeSubmission: { attempted: boolean; txId?: string; options?: RuntimeOperationOptions; contractAddress: string | null; wallet: ConnectedAPI | null; vaultRevision?: number } | null = null;
  private activeWitnessContext: LinePrivateWitnessContext | null = null;
  private readonly mutex = new AsyncMutex();
  private readonly endpointOverrides: Partial<Pick<MidnightNetworkConfig, "indexerUri" | "indexerWsUri" | "nodeUri" | "proofServerUri">>;
  private readonly blockfrostProjectId?: string;

  constructor(config?: Partial<MidnightNetworkConfig>) {
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
    const viteEnv = ((typeof import.meta !== "undefined" ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env : undefined) ?? {}) as Record<string, string | undefined>;
    this.endpointOverrides = {
      indexerUri: config?.indexerUri ?? viteEnv.VITE_MIDNIGHT_INDEXER_URI ?? env.MIDNIGHT_INDEXER_URI,
      indexerWsUri: config?.indexerWsUri ?? viteEnv.VITE_MIDNIGHT_INDEXER_WS_URI ?? env.MIDNIGHT_INDEXER_WS_URI,
      nodeUri: config?.nodeUri ?? viteEnv.VITE_MIDNIGHT_NODE_URI ?? env.MIDNIGHT_NODE_URI,
      proofServerUri: config?.proofServerUri ?? viteEnv.VITE_MIDNIGHT_PROOF_SERVER_URI ?? env.MIDNIGHT_PROOF_SERVER_URI,
    };

    this.blockfrostProjectId = config?.blockfrostProjectId ?? env.MIDNIGHT_BLOCKFROST_PROJECT_ID;
    const endpoints = resolveMidnightEndpoints({ ...this.endpointOverrides, blockfrostProjectId: this.blockfrostProjectId,
      networkId: config?.networkId ?? viteEnv.VITE_MIDNIGHT_NETWORK_ID ?? env.MIDNIGHT_NETWORK_ID });
    this.networkId = endpoints.networkId;
    this.indexerUri = endpoints.indexerUri;
    this.indexerWsUri = endpoints.indexerWsUri;
    this.nodeUri = endpoints.nodeUri;
    this.proofServerUri = endpoints.proofServerUri;

    this.zkConfigBaseUrl =
      config?.zkConfigBaseUrl ??
      viteEnv.VITE_MIDNIGHT_ZK_CONFIG_URL ??
      "/line-zk";

    this.contractAddress =
      config?.contractAddress ??
      viteEnv.VITE_MIDNIGHT_CONTRACT_ADDRESS ??
      env.MIDNIGHT_CONTRACT_ADDRESS ??
      null;

    this.passwordProvider = config?.privateStoragePasswordProvider;
    this.zkArtifactDir = config?.zkArtifactDir;
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
    if (!address) this.discardProviders();
    if (this.cachedProviders?.privateStateProvider && address) {
      this.cachedProviders.privateStateProvider.setContractAddress(address);
    }
  }

  private discardProviders(): void {
    const provider = this.cachedProviders?.privateStateProvider;
    if (provider instanceof VaultPrivateStateProvider) provider.dispose();
    this.cachedProviders = null;
    this.boundContract = null;
  }

  async attachWallet(preferredRdns?: string): Promise<ConnectedAPI> {
    this.discardProviders();
    this.connectedWallet = null;
    this.connectedWallet = await connectWallet(preferredRdns, this.networkId);
    const configuration = await getWalletConfiguration(this.connectedWallet, this.networkId);
    const endpoints = resolveMidnightEndpoints({ networkId: this.networkId, blockfrostProjectId: this.blockfrostProjectId,
      indexerUri: this.endpointOverrides.indexerUri ?? configuration.indexerUri,
      indexerWsUri: this.endpointOverrides.indexerWsUri ?? configuration.indexerWsUri,
      nodeUri: this.endpointOverrides.nodeUri ?? configuration.substrateNodeUri,
      proofServerUri: this.endpointOverrides.proofServerUri ?? configuration.proverServerUri ?? this.proofServerUri ?? undefined });
    assertEndpointCredentials(endpoints);
    this.indexerUri = endpoints.indexerUri;
    this.indexerWsUri = endpoints.indexerWsUri;
    this.nodeUri = endpoints.nodeUri;
    this.proofServerUri = endpoints.proofServerUri;
    return this.connectedWallet;
  }

  async detachWallet(): Promise<void> {
    this.connectedWallet = null;
    this.discardProviders();
    await disconnectWallet();
  }

  getDiscoveredWallets(): WalletInfo[] {
    return getAvailableWallets();
  }

  private createPublicDataProvider(): PublicDataProvider {
    if (!this.indexerUri) {
      throw new NetworkUnreachableError("Indexer URI is not configured.");
    }
    assertEndpointCredentials(resolveMidnightEndpoints({ networkId: this.networkId, indexerUri: this.indexerUri,
      indexerWsUri: this.indexerWsUri ?? undefined, nodeUri: this.nodeUri ?? undefined, blockfrostProjectId: this.blockfrostProjectId }));
    return indexerPublicDataProvider(this.indexerUri, this.indexerWsUri ?? this.indexerUri.replace(/^http/, "ws"), typeof window !== "undefined" ? globalThis.WebSocket : undefined);
  }

  private async createZkConfigProvider(): Promise<ZKConfigProvider<LineCircuitId>> {
    if (typeof window !== "undefined") {
      const { FetchZkConfigProvider } = await import("@midnight-ntwrk/midnight-js-fetch-zk-config-provider");
      return new FetchZkConfigProvider<LineCircuitId>(new URL(this.zkConfigBaseUrl, window.location.origin).href);
    }
    const nodeModule = "./network-node.ts";
    const { createNodeZkProvider } = await import(/* @vite-ignore */ nodeModule) as typeof import("./network-node.ts");
    return createNodeZkProvider(this.zkArtifactDir);
  }

  async getProviders(): Promise<LineProviders> {
    if (this.cachedProviders) {
      return this.cachedProviders;
    }

    if (!this.connectedWallet) throw new WalletNotConnectedError();
    const walletConfiguration = await getWalletConfiguration(this.connectedWallet, this.networkId);
    const endpoints = resolveMidnightEndpoints({ networkId: this.networkId, blockfrostProjectId: this.blockfrostProjectId,
      indexerUri: this.endpointOverrides.indexerUri ?? walletConfiguration.indexerUri,
      indexerWsUri: this.endpointOverrides.indexerWsUri ?? walletConfiguration.indexerWsUri,
      nodeUri: this.endpointOverrides.nodeUri ?? walletConfiguration.substrateNodeUri,
      proofServerUri: this.endpointOverrides.proofServerUri ?? walletConfiguration.proverServerUri ?? this.proofServerUri ?? undefined });
    assertEndpointCredentials(endpoints);
    this.indexerUri = endpoints.indexerUri;
    this.indexerWsUri = endpoints.indexerWsUri;
    this.nodeUri = endpoints.nodeUri;
    this.proofServerUri = endpoints.proofServerUri;
    setNetworkId(this.networkId);
    const publicDataProvider = this.createPublicDataProvider();
    const zkConfigProvider = await this.createZkConfigProvider();
    const { httpClientProofProvider } = await import("@midnight-ntwrk/midnight-js-http-client-proof-provider");
    const proofProvider = httpClientProofProvider(this.proofServerUri ?? "http://127.0.0.1:6300", zkConfigProvider);
    const { walletProvider, midnightProvider } = await createWalletProviders(this.connectedWallet, this.networkId);
    // Public wallet identity scopes encrypted state; another connected account must
    // never inherit the previous account's signing keys or commitment openings.
    const accountId = walletProvider.getCoinPublicKey();

    let privateStateProvider: PrivateStateProvider<string, LinePrivateWitnessContext>;
    if (typeof window === "undefined") {
      if (!this.passwordProvider) {
        throw new VaultLockedError("Private storage passwordProvider must be configured for Node environment private state.");
      }
      const nodeModule = "./network-node.ts";
      const { createNodePrivateStateProvider } = await import(/* @vite-ignore */ nodeModule) as typeof import("./network-node.ts");
      privateStateProvider = createNodePrivateStateProvider(this.passwordProvider, `line-${this.networkId}-${accountId}-${this.contractAddress ?? "session"}`);
    } else {
      privateStateProvider = new VaultPrivateStateProvider<LinePrivateWitnessContext>({
        passwordProvider: this.passwordProvider,
        networkId: this.networkId,
        accountId,
      });
      if (this.contractAddress) {
        privateStateProvider.setContractAddress(this.contractAddress);
      }
    }

    const providers: LineProviders = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    };

    this.cachedProviders = providers;
    return providers;
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
      const withdrawable = Math.max(0, totalReserve - (encumberedReserve + redeemedReserve + Number(l.feeReserve) + Number(l.pendingFeeReserve) + Number(l.refundReserve) + Number(l.reportedRefundReserve)));

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
        feeReserve: Number(l.feeReserve),
        feeFlat: Number(l.feeFlat),
        feeBps: Number(l.feeBps),
        pendingFeeReserve: Number(l.pendingFeeReserve), refundReserve: Number(l.refundReserve), reportedRefundReserve: Number(l.reportedRefundReserve),
        withdrawableReserve: withdrawable,
        quoteCount: Number(l.quotes?.size?.() ?? 0),
        noteCount: Number(l.notes?.size?.() ?? 0),
        nullifierCount: Number(l.nullifiers?.size?.() ?? 0),
        runtime: "network",
      };
    } catch (err) {
      if (err instanceof LineRuntimeError) throw err;
      throw new NetworkUnreachableError(redactEndpoint(this.indexerUri ?? "indexer"), new Error(sanitizeServiceError(err instanceof Error ? err.message : String(err))));
    }
  }

  async getReserveStatus(): Promise<ReserveStatus> {
    const status = await this.getStatus();
    return {
      totalReserve: status.totalReserve,
      encumberedReserve: status.encumberedReserve,
      redeemedReserve: status.redeemedReserve,
      feeReserve: status.feeReserve,
      pendingFeeReserve: status.pendingFeeReserve, refundReserve: status.refundReserve, reportedRefundReserve: status.reportedRefundReserve,
      withdrawableReserve: status.withdrawableReserve,
      contractDomain: status.contractDomain,
    };
  }

  async joinContract(address: string): Promise<LedgerPublicStatus> {
    if (!address || address.trim().length === 0) {
      throw new ContractNotConfiguredError("Cannot join empty contract address.");
    }
    address = address.trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(address)) throw new ContractNotConfiguredError("Contract address must contain exactly 32 hex bytes.");

    const publicDataProvider = this.createPublicDataProvider();
    let state;
    try {
      state = await publicDataProvider.queryContractState(address);
    } catch (err) {
      if (err instanceof LineRuntimeError) throw err;
      throw new NetworkUnreachableError(redactEndpoint(this.indexerUri ?? "indexer"), new Error(sanitizeServiceError(err instanceof Error ? err.message : String(err))));
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

  private async getBoundContract(): Promise<BoundLineContract> {
    if (this.boundContract) return this.boundContract;
    if (!this.contractAddress) {
      throw new ContractNotConfiguredError();
    }
    if (!this.connectedWallet) {
      throw new WalletNotConnectedError();
    }

    const baseProviders = await this.getProviders();
    const providers: LineProviders = { ...baseProviders,
      midnightProvider: {
        submitTx: async (finalizedTx) => {
          const submission = this.activeSubmission;
          if (!submission) throw new Error("Transaction submission requires an active operation.");
          const txId = finalizedTx.identifiers().at(-1);
          if (!txId) throw new Error("Finalized transaction has no identifier.");
          submission.txId = txId;
          await submission.options?.beforeSubmit?.({ txId });
          if (submission.vaultRevision !== undefined && (!isVaultSessionUnlocked() || submission.vaultRevision !== getVaultSessionRevision())) {
            throw new VaultLockedError("Vault session changed before transaction submission.");
          }
          if (submission.contractAddress !== this.contractAddress || submission.wallet !== this.connectedWallet) {
            throw new Error("Wallet or contract changed before transaction submission.");
          }
          // Set before calling out: a rejected promise can mean an accepted
          // transaction whose response was lost. Never classify it as rejected.
          submission.attempted = true;
          return baseProviders.midnightProvider.submitTx(finalizedTx);
        },
      },
    };

    // Typed witnesses read from active operation context or private state provider
    const witnesses: Witnesses<LinePrivateWitnessContext> = {
      callerSecret: (ctx) => {
        const val = this.activeWitnessContext?.callerSecret ?? ctx.privateState?.callerSecret;
        if (!val) throw new Error("Witness error: missing callerSecret in active witness context");
        return [ctx.privateState, val];
      },
      agentSecret: (ctx) => {
        const val = this.activeWitnessContext?.agentSecret ?? ctx.privateState?.agentSecret;
        if (!val) throw new Error("Witness error: missing agentSecret in active witness context");
        return [ctx.privateState, val];
      },
      salt: (ctx) => {
        const val = this.activeWitnessContext?.salt ?? ctx.privateState?.salt;
        if (!val) throw new Error("Witness error: missing salt in active witness context");
        return [ctx.privateState, val];
      },
      newSalt: (ctx) => {
        const val = this.activeWitnessContext?.newSalt ?? ctx.privateState?.newSalt;
        if (!val) throw new Error("Witness error: missing newSalt in active witness context");
        return [ctx.privateState, val];
      },
      invoiceId: (ctx) => {
        const val = this.activeWitnessContext?.invoiceId ?? ctx.privateState?.invoiceId;
        if (!val) throw new Error("Witness error: missing invoiceId in active witness context");
        return [ctx.privateState, val];
      },
      quoteNonce: (ctx) => {
        const val = this.activeWitnessContext?.quoteNonce ?? ctx.privateState?.quoteNonce;
        if (!val) throw new Error("Witness error: missing quoteNonce in active witness context");
        return [ctx.privateState, val];
      },
      receiptNonce: (ctx) => {
        const val = this.activeWitnessContext?.receiptNonce ?? ctx.privateState?.receiptNonce;
        if (!val) throw new Error("Witness error: missing receiptNonce in active witness context");
        return [ctx.privateState, val];
      },
      paymentRef: (ctx) => {
        const val = this.activeWitnessContext?.paymentRef ?? ctx.privateState?.paymentRef;
        if (!val) throw new Error("Witness error: missing paymentRef in active witness context");
        return [ctx.privateState, val];
      },
      noteNonce: (ctx) => {
        const val = this.activeWitnessContext?.noteNonce ?? ctx.privateState?.noteNonce;
        if (!val) throw new Error("Witness error: missing noteNonce in active witness context");
        return [ctx.privateState, val];
      },
      noteSalt: (ctx) => {
        const val = this.activeWitnessContext?.noteSalt ?? ctx.privateState?.noteSalt;
        if (!val) throw new Error("Witness error: missing noteSalt in active witness context");
        return [ctx.privateState, val];
      },
      noteIdentity: (ctx) => {
        const val = this.activeWitnessContext?.noteIdentity ?? ctx.privateState?.noteIdentity;
        if (!val) throw new Error("Witness error: missing noteIdentity in active witness context");
        return [ctx.privateState, val];
      },
      noteQuoteCommit: (ctx) => {
        const val = this.activeWitnessContext?.noteQuoteCommit ?? ctx.privateState?.noteQuoteCommit;
        if (!val) throw new Error("Witness error: missing noteQuoteCommit in active witness context");
        return [ctx.privateState, val];
      },
      lineLimit: (ctx) => {
        const val = this.activeWitnessContext?.lineLimit ?? ctx.privateState?.lineLimit;
        if (val === undefined || val === null) throw new Error("Witness error: missing lineLimit in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      lineOutstanding: (ctx) => {
        const val = this.activeWitnessContext?.lineOutstanding ?? ctx.privateState?.lineOutstanding;
        if (val === undefined || val === null) throw new Error("Witness error: missing lineOutstanding in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      lineEpoch: (ctx) => {
        const val = this.activeWitnessContext?.lineEpoch ?? ctx.privateState?.lineEpoch;
        if (val === undefined || val === null) throw new Error("Witness error: missing lineEpoch in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      quoteAmount: (ctx) => {
        const val = this.activeWitnessContext?.quoteAmount ?? ctx.privateState?.quoteAmount;
        if (val === undefined || val === null) throw new Error("Witness error: missing quoteAmount in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      drawAmount: (ctx) => {
        const val = this.activeWitnessContext?.drawAmount ?? ctx.privateState?.drawAmount;
        if (val === undefined || val === null) throw new Error("Witness error: missing drawAmount in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      redeemAmount: (ctx) => {
        const val = this.activeWitnessContext?.redeemAmount ?? ctx.privateState?.redeemAmount;
        if (val === undefined || val === null) throw new Error("Witness error: missing redeemAmount in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      repayAmount: (ctx) => {
        const val = this.activeWitnessContext?.repayAmount ?? ctx.privateState?.repayAmount;
        if (val === undefined || val === null) throw new Error("Witness error: missing repayAmount in active witness context");
        return [ctx.privateState, BigInt(val)];
      },
      quoteMerchantPk: (ctx) => {
        const val = this.activeWitnessContext?.quoteMerchantPk ?? ctx.privateState?.quoteMerchantPk;
        if (!val) throw new Error("Witness error: missing quoteMerchantPk in active witness context");
        const bytes = validateWitnessBytes32(val, "quoteMerchantPk");
        return [ctx.privateState, bytes];
      },
    };

    const compiledContract = CompiledContract.make<Contract<LinePrivateWitnessContext>>("line", Contract).pipe(
      CompiledContract.withWitnesses(witnesses),
      CompiledContract.withCompiledFileAssets(this.zkConfigBaseUrl),
    );
    const privateStateId = `line-state:${this.contractAddress}`;
    providers.privateStateProvider.setContractAddress(this.contractAddress);
    // Witnesses use the operation-scoped context. Seed only absent SDK state;
    // binding must never overwrite a recovered private opening.
    if (await providers.privateStateProvider.get(privateStateId) == null) {
      await providers.privateStateProvider.set(privateStateId, {});
    }
    setNetworkId(this.networkId);

    try {
      this.boundContract = await findDeployedContract(providers, {
        compiledContract,
        contractAddress: this.contractAddress,
        privateStateId,
      });
      return this.boundContract;
    } catch (err) {
      throw new CircuitExecutionError("findDeployedContract", err instanceof Error ? err.message : String(err));
    }
  }

  private hasReceiptEvidence(receipt: Pick<FinalizedTxData, "txHash" | "txId" | "blockHeight"> & Partial<Pick<FinalizedTxData, "identifiers">>): boolean {
    const identifier = receipt.txHash || receipt.txId;
    const submittedId = this.activeSubmission?.attempted ? this.activeSubmission.txId : undefined;
    const belongsToSubmission = !submittedId || receipt.txId === submittedId || receipt.identifiers?.includes(submittedId);
    return Boolean(belongsToSubmission && typeof identifier === "string" && identifier.trim() && identifier !== "0x0" && Number.isSafeInteger(receipt.blockHeight) && receipt.blockHeight > 0);
  }

  private failedOperation(err: unknown, code: string, genericDraw = false): RuntimeTransactionResult {
    const receipt = err instanceof TxFailedError ? err.finalizedTxData : undefined;
    const definiteReceipt = receipt?.status === FailEntirely && this.hasReceiptEvidence(receipt);
    return {
      ok: false, code,
      error: genericDraw ? "Clearance could not be proven." : sanitizeServiceError(err instanceof Error ? err.message : String(err)),
      disposition: definiteReceipt || !this.activeSubmission?.attempted ? "definitive-rejection" : "unresolved",
      txId: this.activeSubmission?.txId ?? receipt?.txId,
      ...(receipt && this.hasReceiptEvidence(receipt) ? { txHash: receipt.txHash, blockHeight: receipt.blockHeight } : {}),
    };
  }

  async getTransactionReceipt(transactionId: string): Promise<RuntimeTransactionResult | null> {
    if (!/^[a-fA-F0-9]{64}$/.test(transactionId)) throw new Error("Invalid journaled transaction ID.");
    const address = this.contractAddress;
    if (!address) throw new ContractNotConfiguredError();
    const key = `${address}:${transactionId}`;
    let watch = this.receiptWatches.get(key);
    if (!watch) {
      if (this.receiptWatches.size >= 32) return null;
      const provider = this.cachedProviders?.publicDataProvider ?? this.createPublicDataProvider();
      watch = Promise.resolve().then(() => provider.watchForTxData(transactionId)).then(receipt => {
        this.receiptWatches.delete(key); return receipt;
      }, () => { this.receiptWatches.delete(key); return null; });
      this.receiptWatches.set(key, watch);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 6_000); });
    let receipt: FinalizedTxData | null;
    try { receipt = await Promise.race([watch, timeout]); }
    finally { if (timer) clearTimeout(timer); }
    if (!receipt || address !== this.contractAddress) return null;
    if (!(receipt.txId === transactionId || receipt.identifiers?.includes(transactionId)) ||
        !Number.isSafeInteger(receipt.blockHeight) || receipt.blockHeight <= 0 ||
        !(receipt.txHash || receipt.txId)) return null;
    if (receipt.status === SucceedEntirely) return { ok: true, disposition: "confirmed-success", txId: transactionId,
      txHash: receipt.txHash, blockHeight: receipt.blockHeight };
    if (receipt.status === FailEntirely) return { ok: false, disposition: "definitive-rejection", txId: transactionId,
      txHash: receipt.txHash, blockHeight: receipt.blockHeight, error: "The finalized transaction failed entirely." };
    return { ok: false, disposition: "unresolved", txId: transactionId, error: "The receipt does not establish complete execution." };
  }

  async getRecoveryEvidence(query: RuntimeRecoveryQuery = {}): Promise<RuntimeRecoveryEvidence> {
    const address = this.contractAddress;
    if (!address) throw new ContractNotConfiguredError();
    const quoteKey = query.quoteCommit ? validateWitnessBytes32(query.quoteCommit, "quoteCommit") : undefined;
    const noteKey = query.noteCommit ? validateWitnessBytes32(query.noteCommit, "noteCommit") : undefined;
    const nullifierKey = query.nullifier ? validateWitnessBytes32(query.nullifier, "nullifier") : undefined;
    try {
      // No wallet, private provider, or signing operation is needed for evidence.
      const provider = this.cachedProviders?.publicDataProvider ?? this.createPublicDataProvider();
      const state = await provider.queryContractState(address);
      if (!state) throw new ContractNotFoundError(address, this.networkId);
      if (address !== this.contractAddress) throw new Error("Contract changed during recovery observation.");
      const l = ledger(state.data);
      const result: RuntimeRecoveryEvidence = {
        runtime: "network", networkId: this.networkId, contractAddress: address,
        contractDomain: toHex(l.contractDomain), identityCommitment: toHex(l.identityCommit),
        lineCommitment: toHex(l.lineCommit), lineGeneration: l.lineGeneration.toString(), actionClock: l.actionClock.toString(),
        feeFlat: l.feeFlat.toString(), feeBps: l.feeBps.toString(),
      };
      if (quoteKey) {
        const present = l.quotes.member(quoteKey);
        const q = present ? l.quotes.lookup(quoteKey) : undefined;
        result.quote = { commitment: toHex(quoteKey), present, ...(q ? { expiry: q.expiry.toString(), lineGeneration: q.lineGeneration.toString(), used: q.used } : {}) };
      }
      if (noteKey) {
        const present = l.notes.member(noteKey);
        const n = present ? l.notes.lookup(noteKey) : undefined;
        result.note = { commitment: toHex(noteKey), present, ...(n ? { amount: n.amount.toString(), fee: n.fee.toString(), expiry: n.expiry.toString(), lineGeneration: n.lineGeneration.toString(), redeemed: n.redeemed, cancelled: n.cancelled,
          compensationAllocated: n.compensationAllocated, refundCommitment: toHex(n.refundCommitment), cashRefundOwed: n.cashRefundOwed, refundAcknowledged: n.refundAcknowledged, refundPaymentNullifier: toHex(n.refundPaymentNullifier) } : {}) };
      }
      if (nullifierKey) result.nullifier = { value: toHex(nullifierKey), present: l.nullifiers.member(nullifierKey) };
      return result;
    } catch (err) {
      if (err instanceof LineRuntimeError) throw err;
      throw new NetworkUnreachableError(redactEndpoint(this.indexerUri ?? "indexer"), new Error(sanitizeServiceError(err instanceof Error ? err.message : String(err))));
    }
  }

  private validateTxResult(
    tx: { public: Pick<FinalizedTxData, "txHash" | "txId" | "blockHeight" | "status"> & Partial<Pick<FinalizedTxData, "identifiers">> },
    operationName: string
  ): RuntimeTransactionResult {
    if (tx?.public?.status !== SucceedEntirely) {
      return { ok: false, error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: transaction did not succeed entirely.`, code: "TRANSACTION_FINALIZATION_FAILED", disposition: tx?.public?.status === FailEntirely && this.hasReceiptEvidence(tx.public) ? "definitive-rejection" : "unresolved", txId: this.activeSubmission?.txId ?? tx?.public?.txId };
    }
    const txHash = tx.public.txHash ?? tx.public.txId;
    if (!txHash || typeof txHash !== "string" || txHash === "0x0" || txHash.trim().length === 0) {
      return {
        ok: false,
        error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: Transaction receipt missing finalization evidence.`,
        code: "TRANSACTION_FINALIZATION_FAILED",
        disposition: "unresolved", txId: this.activeSubmission?.txId ?? tx?.public?.txId,
      };
    }
    const blockHeight = Number(tx?.public?.blockHeight ?? 0);
    if (!Number.isSafeInteger(blockHeight) || blockHeight <= 0) {
      return {
        ok: false,
        error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: Transaction receipt unconfirmed or invalid block height (${blockHeight}).`,
        code: "TRANSACTION_NOT_CONFIRMED",
        disposition: "unresolved", txId: this.activeSubmission?.txId ?? tx?.public?.txId,
      };
    }
    if (!this.hasReceiptEvidence(tx.public)) {
      return { ok: false, error: operationName === "draw" ? "Clearance could not be proven." : `${operationName} failed: receipt does not identify the submitted transaction.`, code: "TRANSACTION_RECEIPT_MISMATCH", disposition: "unresolved", txId: this.activeSubmission?.txId };
    }
    return { ok: true, txHash, blockHeight, disposition: "confirmed-success", txId: this.activeSubmission?.txId ?? tx.public.txId };
  }

  private async withOperationLock<T>(
    witnessContext: LinePrivateWitnessContext,
    action: () => Promise<T>,
    options?: RuntimeOperationOptions
  ): Promise<T> {
    const release = await this.mutex.acquire();
    this.activeWitnessContext = witnessContext;
    this.activeSubmission = { attempted: false, options, contractAddress: this.contractAddress, wallet: this.connectedWallet, ...(typeof window !== "undefined" ? { vaultRevision: getVaultSessionRevision() } : {}) };
    try {
      return await action();
    } finally {
      this.activeWitnessContext = null;
      this.activeSubmission = null;
      release();
    }
  }

  async fundReserve(amount: number, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.fundReserve(BigInt(amount));
        return this.validateTxResult(tx, "fundReserve");
      } catch (err) {
        return this.failedOperation(err, "FUND_RESERVE_FAILED");
      }
    }, options);
  }

  async withdrawReserve(amount: number, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.withdrawUnencumberedReserve(BigInt(amount));
        return this.validateTxResult(tx, "withdrawReserve");
      } catch (err) {
        return this.failedOperation(err, "WITHDRAW_RESERVE_FAILED");
      }
    }, options);
  }

  async withdrawFees(callerSk?: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.withdrawFees();
        return this.validateTxResult(tx, "withdrawFees");
      } catch (err) {
        return this.failedOperation(err, "WITHDRAW_FEES_FAILED");
      }
    }, options);
  }

  async registerMerchant(merchantPk: string, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
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
        return this.failedOperation(err, "REGISTER_MERCHANT_FAILED");
      }
    }, options);
  }

  async disableMerchant(merchantPk: string, callerSk?: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    const merchantBytes = validateWitnessBytes32(merchantPk, "merchantPublicKey");
    return this.withOperationLock({ callerSecret: callerBytes }, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.disableMerchant(merchantBytes);
        return this.validateTxResult(tx, "disableMerchant");
      } catch (err) {
        return this.failedOperation(err, "DISABLE_MERCHANT_FAILED");
      }
    }, options);
  }

  async openLine(params: {
    limit: number;
    expiry: number;
    feeFlat?: number;
    feeBps?: number;
    callerSk: string;
    agentSecret: string;
    salt: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
      lineLimit: BigInt(params.limit),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.openLine(BigInt(params.expiry), BigInt(params.feeFlat ?? 0), BigInt(params.feeBps ?? 0));
        return this.validateTxResult(tx, "openLine");
      } catch (err) {
        return this.failedOperation(err, "OPEN_LINE_FAILED");
      }
    }, options);
  }

  async postQuote(params: {
    amount: number;
    expiry: number;
    merchantSk: string;
    invoiceId: string;
    nonce: string;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    if (!params.invoiceId || params.invoiceId.trim().length === 0) {
      throw new MissingPrivateWitnessError("invoiceId");
    }

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.merchantSk, "merchantSecret"),
      invoiceId: canonicalInvoiceIdBytes(params.invoiceId),
      quoteNonce: validateWitnessBytes32(params.nonce, "quoteNonce"),
      quoteAmount: BigInt(params.amount),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.postQuote(BigInt(params.expiry));
        return this.validateTxResult(tx, "postQuote");
      } catch (err) {
        return this.failedOperation(err, "POST_QUOTE_FAILED");
      }
    }, options);
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
    quoteMerchantPk?: string;
    quoteAmount?: number;
    drawAmount?: number;
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    try {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const rawExp = params.noteExpiry ?? params.expiry;
    if (rawExp === undefined || rawExp === null || Number(rawExp) <= 0) {
      throw new Error("Draw refused: noteExpiry is required");
    }
    const noteExpiry = rawExp;
    const fee = params.fee ?? 0;
    params = { ...params, noteExpiry, fee };

    if (!params.invoiceId || params.invoiceId.trim().length === 0) {
      throw new MissingPrivateWitnessError("invoiceId");
    }

    const mPk = params.merchantPk ?? params.quoteMerchantPk;
    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
      newSalt: validateWitnessBytes32(params.newSalt, "newSalt"),
      invoiceId: canonicalInvoiceIdBytes(params.invoiceId),
      quoteNonce: validateWitnessBytes32(params.quoteNonce, "quoteNonce"),
      noteNonce: validateWitnessBytes32(params.noteNonce, "noteNonce"),
      noteSalt: validateWitnessBytes32(params.noteSalt, "noteSalt"),
      lineLimit: BigInt(params.limit),
      lineOutstanding: BigInt(params.outstanding),
      lineEpoch: BigInt(params.epoch),
      quoteAmount: BigInt(params.quoteAmount ?? params.amount),
      drawAmount: BigInt(params.drawAmount ?? params.amount),
      ...(mPk ? { quoteMerchantPk: validateWitnessBytes32(mPk, "quoteMerchantPk") } : {}),
    };

    const qBytes = validateWitnessBytes32(params.quoteCommit, "quoteCommit");

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.draw(
          qBytes,
          BigInt(params.noteExpiry ?? params.expiry ?? 0),
          BigInt(params.fee ?? 0)
        );
        return this.validateTxResult(tx, "draw");
      } catch (err) {
        return this.failedOperation(err, "DRAW_FAILED", true);
      }
    }, options);
    } catch {
      // This catch covers only pre-lock validation. Another operation may be
      // active, so never borrow its submission ID or disposition.
      return { ok: false, error: "Clearance could not be proven.", code: "DRAW_FAILED", disposition: "definitive-rejection" };
    }
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
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const noteExpiry = params.noteExpiry ?? params.expiry ?? 0;
    params = { ...params, noteExpiry };

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.merchantSk, "merchantSecret"),
      noteIdentity: validateWitnessBytes32(params.noteIdentity, "noteIdentity"),
      noteQuoteCommit: validateWitnessBytes32(params.noteQuoteCommit, "noteQuoteCommit"),
      noteNonce: validateWitnessBytes32(params.noteNonce, "noteNonce"),
      noteSalt: validateWitnessBytes32(params.noteSalt, "noteSalt"),
      redeemAmount: BigInt(params.amount),
    };

    const dBytes = validateWitnessBytes32(params.noteCommit, "noteCommit");

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.redeemDraw(dBytes, BigInt(params.noteExpiry ?? params.expiry ?? 0));
        return this.validateTxResult(tx, "redeemDraw");
      } catch (err) {
        return this.failedOperation(err, "REDEEM_DRAW_FAILED");
      }
    }, options);
  }

  async cancelOrExpireNote(noteCommit: string, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    const dBytes = validateWitnessBytes32(noteCommit, "noteCommit");
    if (options?.compensation && options.refundAck) return { ok: false, disposition: "definitive-rejection", error: "Choose one compensation action.", code: "COMPENSATION_ACTION" };
    const comp = options?.compensation, ack = options?.refundAck, book = comp?.book;
    const witnessContext: LinePrivateWitnessContext = { callerSecret: callerBytes,
      ...(comp ? { noteIdentity: validateWitnessBytes32(comp.note.identity, "noteIdentity"),
        noteQuoteCommit: validateWitnessBytes32(comp.note.quoteCommit, "noteQuoteCommit"), quoteMerchantPk: validateWitnessBytes32(comp.note.merchantPk, "noteMerchantPk"),
        noteNonce: validateWitnessBytes32(comp.note.noteNonce, "noteNonce"), noteSalt: validateWitnessBytes32(comp.noteSalt, "noteSalt"),
        newSalt: validateWitnessBytes32(comp.newSalt, "newSalt"), ...(book ? { lineLimit: BigInt(book.limit), lineOutstanding: BigInt(book.outstanding),
          lineEpoch: BigInt(book.epoch), salt: validateWitnessBytes32(book.salt, "salt") } : {}) } : {}),
      ...(ack ? { noteIdentity: validateWitnessBytes32(ack.identity, "noteIdentity"), repayAmount: BigInt(ack.amount),
        salt: validateWitnessBytes32(ack.salt, "refundSalt"), paymentRef: canonicalPaymentReferenceBytes(ack.paymentRef) } : {}),
    };
    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.cancelOrExpireNote(dBytes, ack ? 2n : comp ? 1n : 0n, BigInt(ack?.receiptExpiry ?? 0));
        return this.validateTxResult(tx, "cancelOrExpireNote");
      } catch (err) {
        return this.failedOperation(err, "CANCEL_NOTE_FAILED");
      }
    }, options);
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
  }, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const witnessContext: LinePrivateWitnessContext = {
      callerSecret: validateWitnessBytes32(params.callerSk, "callerSecret"),
      agentSecret: validateWitnessBytes32(params.agentSecret, "agentSecret"),
      salt: validateWitnessBytes32(params.salt, "salt"),
      newSalt: validateWitnessBytes32(params.newSalt, "newSalt"),
      receiptNonce: validateWitnessBytes32(params.receiptNonce, "receiptNonce"),
      paymentRef: canonicalPaymentReferenceBytes(params.paymentRef),
      lineLimit: BigInt(params.limit),
      lineOutstanding: BigInt(params.outstanding),
      lineEpoch: BigInt(params.epoch),
      repayAmount: BigInt(params.amount),
    };

    return this.withOperationLock(witnessContext, async () => {
      try {
        const bound = await this.getBoundContract();
        const tx = await bound.callTx.acknowledgeRepayment(
          BigInt(params.receiptExpiry)
        );
        return this.validateTxResult(tx, "acknowledgeRepayment");
      } catch (err) {
        return this.failedOperation(err, "ACK_REPAYMENT_FAILED");
      }
    }, options);
  }

  async setStatus(status: Exclude<LineStatus, "none">, callerSk: string, options?: RuntimeOperationOptions): Promise<RuntimeTransactionResult> {
    if (!this.connectedWallet) throw new WalletNotConnectedError();
    if (!this.contractAddress) throw new ContractNotConfiguredError();

    const callerBytes = validateWitnessBytes32(callerSk, "callerSecret");
    const closing = status === "closed" ? options?.closingBook : undefined;
    if (status === "closed" && !closing) return { ok: false, disposition: "definitive-rejection", code: "CLOSING_BOOK_REQUIRED", error: "Closing requires the current zero-debt private opening." };
    return this.withOperationLock({ callerSecret: callerBytes, ...(closing ? {
      lineLimit: BigInt(closing.limit), lineOutstanding: BigInt(closing.outstanding), lineEpoch: BigInt(closing.epoch),
      salt: validateWitnessBytes32(closing.salt, "salt"),
    } : {}) }, async () => {
      try {
        const bound = await this.getBoundContract();
        const compactStatus = status === "open" ? Status.OPEN : status === "defaulted" ? Status.DEFAULTED : Status.CLOSED;
        const tx = await bound.callTx.setStatus(compactStatus);
        return this.validateTxResult(tx, "setStatus");
      } catch (err) {
        return this.failedOperation(err, "SET_STATUS_FAILED");
      }
    }, options);
  }
}
