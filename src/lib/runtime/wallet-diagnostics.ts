import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { decodeWalletPublicKey } from "./wallet.ts";
import { walletConnectorCode } from "./errors.ts";

export type WalletReadDiagnostic = { method: string; outcome: "passed" | "failed" | "timed out"; elapsedMs: number; detail: string; code?: string };
type Reader = Pick<ConnectedAPI, "getConfiguration" | "getShieldedAddresses" | "getUnshieldedAddress" | "getConnectionStatus">;
const timedOut = Symbol("wallet diagnostic timeout");
class DiagnosticMismatch extends Error {}

function failureDetail(error: unknown) {
  const row = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; reason?: unknown } : null;
  const code = walletConnectorCode(error);
  const message = String(row?.message ?? row?.reason ?? (typeof error === "string" ? error : ""));
  const detail = error instanceof DiagnosticMismatch ? error.message : /rate[\s_-]*limit|too many requests/i.test(message) || code === "429" ? "Connector rate limit" : /background script|extension.*loaded|forwarding message/i.test(message) ? "Wallet message bridge did not respond" : /^request failed[.!]?$/i.test(message.trim()) ? "Connector returned Request failed" : "Connector read failed";
  // Never echo arbitrary wallet diagnostics: they can contain service URLs,
  // credentials or account data. Only an allowlisted category and scalar code.
  return { detail, ...(code ? { code } : {}) };
}

/** Independent read-only probes. Results never authorize an operation or alter
 * connection/vault state. In particular a successful configuration read cannot
 * stand in for a failed live session check. No automatic retry is performed.
 */
export async function diagnoseWalletReads(wallet: Reader, expectedAddress: string | null, isCurrent: () => boolean, report: (result: WalletReadDiagnostic) => void, options: { timeoutMs?: number; pauseMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 10000, pauseMs = options.pauseMs ?? 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isSafeInteger(pauseMs) || pauseMs < 0 || pauseMs > 5000) throw Error("Invalid diagnostic deadline.");
  const current = () => { if (!isCurrent()) throw Error("Wallet connection changed. Diagnostic results were discarded."); };
  const probes = [
    { method: "getConfiguration", read: () => wallet.getConfiguration(), describe: (value: Awaited<ReturnType<Reader["getConfiguration"]>>) => { if (value.networkId !== "preprod") throw new DiagnosticMismatch("Configuration reports a different network"); return "Preprod configuration returned"; } },
    { method: "getShieldedAddresses", read: () => wallet.getShieldedAddresses(), describe: (value: Awaited<ReturnType<Reader["getShieldedAddresses"]>>) => {
      decodeWalletPublicKey(value.shieldedCoinPublicKey, "shield-cpk", "preprod"); decodeWalletPublicKey(value.shieldedEncryptionPublicKey, "shield-epk", "preprod"); return "Preprod public identities returned";
    } },
    { method: "getUnshieldedAddress", read: () => wallet.getUnshieldedAddress(), describe: (value: Awaited<ReturnType<Reader["getUnshieldedAddress"]>>) => { if (!value.unshieldedAddress) throw new DiagnosticMismatch("No receiving address returned"); if (expectedAddress === null) return "Receiving address returned; no verified connection to compare"; if (value.unshieldedAddress !== expectedAddress) throw new DiagnosticMismatch("Receiving address differs from this connection"); return "Receiving address matches this connection"; } },
    { method: "getConnectionStatus", read: () => wallet.getConnectionStatus(), describe: (value: Awaited<ReturnType<Reader["getConnectionStatus"]>>) => { if (value.status !== "connected" || value.networkId !== "preprod") throw new DiagnosticMismatch("Live session is disconnected or on a different network"); return "Live Preprod session confirmed"; } },
  ];
  const results: WalletReadDiagnostic[] = [];
  for (const probe of probes) {
    current();
    const started = Date.now(); let timer: ReturnType<typeof setTimeout> | undefined;
    let result: WalletReadDiagnostic;
    try {
      const value = await Promise.race([Promise.resolve().then<unknown>(() => { current(); return probe.read(); }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timedOut), timeoutMs); })]);
      current();
      // The descriptor belongs to this probe; the union is only needed to keep
      // heterogeneous connector return types inside one sequential loop.
      result = { method: probe.method, outcome: "passed", elapsedMs: Math.max(0, Date.now() - started), detail: (probe.describe as (value: unknown) => string)(value) };
    } catch (error) {
      current();
      result = { method: probe.method, outcome: error === timedOut ? "timed out" : "failed", elapsedMs: Math.max(0, Date.now() - started), ...(error === timedOut ? { detail: "No connector reply within the deadline" } : failureDetail(error)) };
    } finally { clearTimeout(timer); }
    current(); results.push(result); report(result);
    if (result.outcome === "timed out") break; // A pending wallet read cannot start another probe later.
    if (pauseMs && results.length < probes.length) await new Promise(resolve => setTimeout(resolve, pauseMs));
  }
  return results;
}
