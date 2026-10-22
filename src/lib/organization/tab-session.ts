import type { Configuration } from "@midnight-ntwrk/dapp-connector-api";
import { getVaultSessionPassphrase, getVaultSessionRevision, getVaultSessionExpiresAt, onVaultSessionLock } from "../security/vault.ts";

export type OrganizationTabSession = { accountId: string; receivingAddress: string; passphrase: string; expiresAt: number; configuration: Configuration };
const KEY = "line:organization-tab:v1";
let worker: SharedWorker | null = null, token: string | null = null, ownsLease = false, established = false, generation = 0;
let lease: Promise<boolean> | null = null;
let releaseLease: (() => void) | null = null;
const waiting = new Map<string, { operation: string; resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
function initialize() {
  if (worker || typeof window === "undefined" || typeof SharedWorker === "undefined") return;
  try {
    worker = new SharedWorker(new URL("./tab-session.worker.ts", import.meta.url), { type: "module", name: "line-organization-tab-v1", extendedLifetime: true } as WorkerOptions);
    worker.port.onmessage = event => { const pending = waiting.get(event.data?.id); if (pending) { waiting.delete(event.data.id); clearTimeout(pending.timer); pending.resolve(event.data.ok ? pending.operation === "resume" ? event.data.value : true : null); } };
    worker.port.start();
  } catch { worker = null; }
}
// Start early enough to bridge a reload, before wallet RPCs or contract engines.
initialize();
function request(operation: string, record?: OrganizationTabSession, sessionToken = token): Promise<unknown> {
  initialize(); if (!worker || !sessionToken) return Promise.resolve(null);
  const id = random();
  return new Promise(resolve => {
    const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, 3000);
    waiting.set(id, { operation, resolve, timer });
    try { worker!.port.postMessage({ id, token: sessionToken, operation, record }); }
    catch { waiting.delete(id); clearTimeout(timer); resolve(null); }
  });
}
async function claim(create: boolean): Promise<boolean> {
  initialize(); if (!worker || !navigator.locks) return false;
  if (ownsLease) { try { if (token) sessionStorage.setItem(KEY, token); } catch { return false; } return true; }
  if (lease) return lease;
  try {
    const retained = sessionStorage.getItem(KEY);
    const reload = performance.getEntriesByType("navigation").some(entry => (entry as PerformanceNavigationTiming).type === "reload");
    token = reload && /^[a-f0-9]{64}$/.test(retained ?? "") ? retained : create ? random() : null;
    if (!token) return false;
    const claimed = token, version = generation;
    lease = new Promise(resolve => {
      void navigator.locks.request(`line:organization-tab:${claimed}`, { ifAvailable: true }, async lock => {
        if (generation !== version) {
          resolve(false);
          if (lock && !await request("forget", undefined, claimed)) await new Promise<void>(() => {});
          return;
        }
        ownsLease = !!lock;
        if (lock) sessionStorage.setItem(KEY, claimed);
        const held = lock ? new Promise<void>(release => { releaseLease = release; }) : null;
        resolve(!!lock);
        if (held) await held; // Explicit revocation or document unload releases the lease.
      }).catch(() => resolve(false));
    });
    const result = await lease;
    if (!result && generation === version && token === claimed) { sessionStorage.removeItem(KEY); ownsLease = false; token = null; lease = null; }
    return result;
  } catch { return false; }
}
export async function readOrganizationTabSession(): Promise<OrganizationTabSession | null> {
  const version = generation;
  if (!await claim(false)) return null;
  if (generation !== version) return null;
  const value = await request("resume", undefined, token) as OrganizationTabSession | null;
  if (generation !== version || !value || typeof value !== "object" || typeof value.passphrase !== "string" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) return null;
  return value;
}
export async function rememberOrganizationTabSession(accountId: string, receivingAddress: string, configuration: Configuration): Promise<void> {
  const revision = getVaultSessionRevision(), passphrase = getVaultSessionPassphrase(), expiresAt = getVaultSessionExpiresAt();
  if (!passphrase || !await claim(true) || getVaultSessionRevision() !== revision) return;
  const savedToken = token;
  const saved = await request("remember", { accountId, receivingAddress, configuration, passphrase, expiresAt }, savedToken);
  if (getVaultSessionRevision() !== revision) { void request("forget", undefined, savedToken); return; }
  established = !!saved;
}
export function forgetOrganizationTabSession(): void {
  generation++; established = false;
  // Only this document's leased token can be revoked. A duplicated tab cannot
  // erase or restore the original tab's unlocked session.
  const release = releaseLease;
  if (ownsLease) {
    // Keep copied tickets excluded until their memory record is gone. If the
    // broker does not acknowledge, hold the old lease until document unload.
    void request("forget", undefined, token).then(removed => { if (removed) release?.(); });
  } else release?.();
  try { sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
  releaseLease = null; ownsLease = false; lease = null; token = null;
}
onVaultSessionLock(() => { if (established) forgetOrganizationTabSession(); });
