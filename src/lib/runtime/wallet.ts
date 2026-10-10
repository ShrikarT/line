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

export interface WalletInfo {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  isAvailable: boolean;
}

export type WalletConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WalletState {
  status: WalletConnectionStatus;
  activeWallet: WalletInfo | null;
  networkId: string | null;
  error: string | null;
}

let activeConnectedApi: ConnectedAPI | null = null;
let activeWalletInfo: WalletInfo | null = null;

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

export async function getWalletConfiguration(api: ConnectedAPI, networkId: string): Promise<Configuration> {
  for (const method of ["getConfiguration", "getShieldedAddresses", "balanceUnsealedTransaction", "submitTransaction"] as const) {
    if (typeof api[method] !== "function") throw new WalletNotConnectedError(`Wallet does not implement connector v4 capability: ${method}.`);
  }
  const configuration = await api.getConfiguration();
  if (configuration.networkId !== networkId) throw new WalletNotConnectedError("Wallet network does not match the selected contract network.");
  return configuration;
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
  activeConnectedApi = null;
  activeWalletInfo = null;
}

export async function connectWallet(
  preferredRdns?: string,
  networkId: string = "preprod"
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

  try {
    const connectedApi = await targetWallet.connect(networkId);
    if (!connectedApi) {
      throw new WalletNotConnectedError("Wallet connect resolved with empty API instance.");
    }

    await getWalletConfiguration(connectedApi, networkId);

    activeConnectedApi = connectedApi;
    activeWalletInfo = {
      rdns: targetWallet.rdns ?? walletKey,
      name: targetWallet.name ?? walletKey,
      icon: targetWallet.icon ?? "",
      apiVersion: targetWallet.apiVersion,
      isAvailable: true,
    };

    return connectedApi;
  } catch (err) {
    activeConnectedApi = null;
    activeWalletInfo = null;

    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes("reject") || msg.includes("denied") || msg.includes("user declined")) {
        throw new WalletApprovalRejectedError();
      }
    }
    if (err instanceof WalletNotConnectedError || err instanceof WalletApprovalRejectedError) {
      throw err;
    }
    throw new WalletNotConnectedError(
      `Failed to connect to ${targetWallet.name ?? walletKey}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
