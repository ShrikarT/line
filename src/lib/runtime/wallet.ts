/**
 * Midnight Browser Wallet Integration (DApp Connector API)
 *
 * Implements wallet discovery, connection lifecycle, network verification,
 * capability checks, and error mapping across arbitrary window.midnight.* providers.
 */
import type { InitialAPI, ConnectedAPI, Configuration } from "@midnight-ntwrk/dapp-connector-api";
import type { WalletProvider, MidnightProvider } from "@midnight-ntwrk/midnight-js-types";
import { Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { bech32m } from "@scure/base";
import { hexToBytes, toHex } from "../line/encoding.ts";
import { WalletNotConnectedError, WalletApprovalRejectedError } from "./errors.ts";
import { lockVaultSession } from "../security/vault.ts";

export interface WalletInfo {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  isAvailable: boolean;
}

export type WalletConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type WalletConnectionPhase = "requesting-access" | "verifying-network" | "reading-address" | "checking-session";
type WalletAccount = { address: string; network: string };

export interface WalletState {
  status: WalletConnectionStatus;
  activeWallet: WalletInfo | null;
  networkId: string | null;
  error: string | null;
}

let activeConnectedApi: ConnectedAPI | null = null;
let activeWalletInfo: WalletInfo | null = null;
let activeWalletAccount: WalletAccount | null = null;
let pendingConnection: AbortController | null = null;
const walletListeners = new Set<() => void>();

/** A cancelled extension prompt may still answer later; it must never own a session. */
function cancelledConnection(): WalletNotConnectedError {
  return new WalletNotConnectedError("Wallet connection cancelled. Close any old connection prompt in Lace before trying again.");
}

function walletResponse<T>(request: () => Promise<T>, milliseconds: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(cancelledConnection()); return; }
    const timer = setTimeout(() => finish(new WalletNotConnectedError(message)), milliseconds);
    const abort = () => finish(cancelledConnection());
    let settled = false;
    function finish(error?: unknown, value?: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error); else resolve(value as T);
    }
    signal?.addEventListener("abort", abort, { once: true });
    try { Promise.resolve(request()).then(value => finish(undefined, value), error => finish(error)); }
    catch (error) { finish(error); }
  });
}

export function cancelWalletConnection(): void {
  const pending = pendingConnection;
  pendingConnection = null;
  pending?.abort();
}

/** Keep the shared account control in sync with advanced network setup. */
export function subscribeWallet(listener: () => void): () => void {
  walletListeners.add(listener);
  return () => { walletListeners.delete(listener); };
}

function notifyWalletChanged(): void {
  walletListeners.forEach(listener => listener());
}

/** Connector v4 public keys carry both a key type and network in Bech32m.
 * Uint8Array decoding avoids the address SDK's reliance on a global Buffer.
 */
export function decodeWalletPublicKey(value: string, kind: "shield-cpk" | "shield-epk", networkId: string): string {
  const decoded = bech32m.decodeToBytes(value);
  const prefix = `mn_${kind}${networkId === "mainnet" ? "" : `_${networkId}`}`;
  if (decoded.prefix !== prefix || decoded.bytes.length !== 32) {
    throw new WalletNotConnectedError("Wallet public key type, network or length is incompatible.");
  }
  return toHex(decoded.bytes);
}

export async function getWalletConfiguration(api: ConnectedAPI, networkId: string, signal?: AbortSignal): Promise<Configuration> {
  for (const method of ["getConfiguration", "getShieldedAddresses", "balanceUnsealedTransaction", "submitTransaction"] as const) {
    if (typeof api[method] !== "function") throw new WalletNotConnectedError(`Wallet does not implement connector v4 capability: ${method}.`);
  }
  const configuration = await walletResponse(() => api.getConfiguration(), 20_000,
    "Wallet network verification timed out. Unlock Lace, select Preprod and reconnect.", signal);
  if (configuration.networkId !== networkId) throw new WalletNotConnectedError("Wallet network does not match the selected contract network.");
  return configuration;
}

async function readWalletAddress(api: ConnectedAPI, signal?: AbortSignal): Promise<string> {
  if (typeof api.getUnshieldedAddress !== "function") throw new WalletNotConnectedError("Wallet does not implement connector v4 capability: getUnshieldedAddress.");
  const account = await walletResponse(() => api.getUnshieldedAddress(), 20_000,
    "Wallet address request timed out. Unlock Lace and reconnect.", signal);
  if (typeof account?.unshieldedAddress !== "string" || !account.unshieldedAddress.trim()) {
    throw new WalletNotConnectedError("Wallet did not return a receiving address. Open your Midnight Preprod account in Lace and reconnect.");
  }
  return account.unshieldedAddress;
}

export async function getWalletAccount(api: ConnectedAPI): Promise<WalletAccount> {
  const config = await getWalletConfiguration(api, "preprod");
  return { address: await readWalletAddress(api), network: config.networkId };
}

export function getConnectedWalletAccount(): WalletAccount | null {
  return activeWalletAccount;
}

/** Adapts the standard connector to Midnight.js without obtaining secret keys. */
export async function createWalletProviders(api: ConnectedAPI, networkId: string): Promise<{ walletProvider: WalletProvider; midnightProvider: MidnightProvider }> {
  await getWalletConfiguration(api, networkId);
  const addresses = await api.getShieldedAddresses();
  const coinPublicKey = decodeWalletPublicKey(addresses.shieldedCoinPublicKey, "shield-cpk", networkId);
  const encryptionPublicKey = decodeWalletPublicKey(addresses.shieldedEncryptionPublicKey, "shield-epk", networkId);
  return {
    walletProvider: {
      getCoinPublicKey: () => coinPublicKey,
      getEncryptionPublicKey: () => encryptionPublicKey,
      balanceTx: async (unboundTx) => {
        const balanced = await api.balanceUnsealedTransaction(toHex(unboundTx.serialize()));
        if (typeof balanced?.tx !== "string" || !/^(?:[a-fA-F0-9]{2})+$/.test(balanced.tx)) throw new WalletNotConnectedError("Wallet returned an invalid finalized transaction encoding.");
        return Transaction.deserialize("signature", "proof", "binding", hexToBytes(balanced.tx));
      },
    },
    midnightProvider: {
      submitTx: async (finalizedTx) => {
        const identifier = finalizedTx.identifiers().at(-1);
        if (!identifier) throw new WalletNotConnectedError("Finalized transaction has no identifier.");
        await api.submitTransaction(toHex(finalizedTx.serialize()));
        return identifier;
      },
    },
  };
}

export function isWalletInjected(): boolean {
  if (typeof window === "undefined") return false;
  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  return Boolean(midnight && typeof midnight === "object" && Object.keys(midnight).length > 0);
}

export function getAvailableWallets(): WalletInfo[] {
  if (typeof window === "undefined") return [];
  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight || typeof midnight !== "object") return [];

  return Object.entries(midnight).map(([key, w]) => ({
    rdns: w?.rdns ?? key,
    name: w?.name ?? (key.toLowerCase().includes("lace") ? "Midnight Lace" : key),
    icon: w?.icon ?? "",
    apiVersion: w?.apiVersion ?? "unknown",
    isAvailable: typeof w?.connect === "function",
  }));
}

export function getConnectedWallet(): ConnectedAPI | null {
  return activeConnectedApi;
}

export function getActiveWalletInfo(): WalletInfo | null {
  return activeWalletInfo;
}

export async function disconnectWallet(): Promise<void> {
  cancelWalletConnection();
  lockVaultSession();
  activeConnectedApi = null;
  activeWalletInfo = null;
  activeWalletAccount = null;
  notifyWalletChanged();
}

export async function connectWallet(
  preferredRdns?: string,
  networkId: string = "preprod",
  report: (phase: WalletConnectionPhase) => void = () => {}
): Promise<ConnectedAPI> {
  if (typeof window === "undefined") {
    throw new WalletNotConnectedError("Browser window environment is required for wallet connection.");
  }

  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight || typeof midnight !== "object" || Object.keys(midnight).length === 0) {
    throw new WalletNotConnectedError(
      "No Midnight wallet extension (e.g. Lace) detected in browser. Please install and enable a Midnight compatible wallet."
    );
  }

  const walletEntries = Object.entries(midnight);
  const targetEntry = preferredRdns
    ? walletEntries.find(([key, w]) => (w?.rdns === preferredRdns || key === preferredRdns))
    : walletEntries[0];

  if (!targetEntry || !targetEntry[1]) {
    throw new WalletNotConnectedError("Selected Midnight wallet is unavailable.");
  }

  const [walletKey, targetWallet] = targetEntry;

  if (typeof targetWallet.connect !== "function") {
    throw new WalletNotConnectedError(`Wallet ${targetWallet.name ?? walletKey} does not provide a standard DApp connect method.`);
  }
  if (!/^4\./.test(targetWallet.apiVersion)) {
    throw new WalletNotConnectedError("Wallet must implement Midnight DApp Connector API v4.");
  }

  cancelWalletConnection();
  const attempt = new AbortController();
  pendingConnection = attempt;
  try {
    // Changing connections revokes decrypted organization and circuit records.
    // An in-flight operation must reconcile under its original account.
    lockVaultSession();
    activeConnectedApi = null;
    activeWalletInfo = null;
    activeWalletAccount = null;
    notifyWalletChanged();
    report("requesting-access");
    const connectedApi = await walletResponse(() => targetWallet.connect(networkId), 90_000,
      "Wallet connection timed out. Unlock Lace, select Preprod, close any old connection prompt and try again.", attempt.signal);
    if (!connectedApi) {
      throw new WalletNotConnectedError("Wallet connect resolved with empty API instance.");
    }

    report("verifying-network");
    await getWalletConfiguration(connectedApi, networkId, attempt.signal);
    report("reading-address");
    const address = await readWalletAddress(connectedApi, attempt.signal);
    if (typeof connectedApi.getConnectionStatus !== "function") throw new WalletNotConnectedError("Wallet does not implement connector v4 capability: getConnectionStatus.");
    report("checking-session");
    const status = await walletResponse(() => connectedApi.getConnectionStatus(), 20_000,
      "Wallet session check timed out. Unlock Lace and reconnect.", attempt.signal);
    if (status?.status !== "connected" || status.networkId !== networkId) {
      throw new WalletNotConnectedError(`Lace has not established a ${networkId} session. Open your Midnight account in Lace and reconnect.`);
    }
    if (attempt.signal.aborted || pendingConnection !== attempt) throw cancelledConnection();

    activeConnectedApi = connectedApi;
    activeWalletAccount = { address, network: networkId };
    activeWalletInfo = {
      rdns: targetWallet.rdns ?? walletKey,
      name: targetWallet.name ?? walletKey,
      icon: targetWallet.icon ?? "",
      apiVersion: targetWallet.apiVersion,
      isAvailable: true,
    };
    pendingConnection = null;
    notifyWalletChanged();

    return connectedApi;
  } catch (err) {
    if (pendingConnection === attempt) {
      pendingConnection = null;
      activeConnectedApi = null;
      activeWalletInfo = null;
      activeWalletAccount = null;
      notifyWalletChanged();
    }

    // Connector errors can be plain structured objects rather than Error instances.
    const message = err && typeof err === "object"
      ? "message" in err ? String(err.message) : "reason" in err ? String(err.reason) : String(err)
      : String(err);
    {
      const msg = message.toLowerCase();
      if (msg.includes("locked")) {
        throw new WalletNotConnectedError("Lace is locked. Unlock it in the extension, select Preprod, then try connecting again.");
      }
      if (msg.includes("reject") || msg.includes("denied") || msg.includes("user declined")) {
        throw new WalletApprovalRejectedError();
      }
    }
    if (err instanceof WalletNotConnectedError || err instanceof WalletApprovalRejectedError) {
      throw err;
    }
    throw new WalletNotConnectedError(
      `Failed to connect to ${targetWallet.name ?? walletKey}: ${message}`
    );
  }
}
