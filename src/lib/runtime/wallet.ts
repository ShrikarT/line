/**
 * Midnight Browser Wallet Integration (DApp Connector API)
 */
import type { InitialAPI, ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { WalletNotConnectedError, WalletApprovalRejectedError } from "./errors.ts";

export interface WalletInfo {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
}

export function isWalletInjected(): boolean {
  if (typeof window === "undefined") return false;
  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  return Boolean(midnight && Object.keys(midnight).length > 0);
}

export function getAvailableWallets(): WalletInfo[] {
  if (typeof window === "undefined") return [];
  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight) return [];

  return Object.values(midnight).map((w) => ({
    rdns: w.rdns,
    name: w.name,
    icon: w.icon,
    apiVersion: (w as unknown as { apiVersion?: string }).apiVersion ?? "4.0.1",
  }));
}

export async function connectWallet(preferredRdns?: string, networkId: string = "midnight-testnet"): Promise<ConnectedAPI> {
  if (typeof window === "undefined") {
    throw new WalletNotConnectedError("Browser window environment is required for wallet connection.");
  }

  const midnight = (window as unknown as { midnight?: Record<string, InitialAPI> }).midnight;
  if (!midnight || Object.keys(midnight).length === 0) {
    throw new WalletNotConnectedError("No Midnight wallet extension (e.g. Lace) detected in browser. Please install and enable Lace.");
  }

  const walletEntries = Object.values(midnight);
  const targetWallet = preferredRdns
    ? walletEntries.find((w) => w.rdns === preferredRdns) ?? walletEntries[0]
    : walletEntries[0];

  if (!targetWallet) {
    throw new WalletNotConnectedError("Selected Midnight wallet is unavailable.");
  }

  try {
    const connectedApi = await targetWallet.connect(networkId);
    return connectedApi;
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes("reject")) {
      throw new WalletApprovalRejectedError();
    }
    throw new WalletNotConnectedError(`Failed to connect to ${targetWallet.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
