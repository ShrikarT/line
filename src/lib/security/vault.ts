/**
 * Secure Client-Side Vault
 *
 * Implements WebCrypto AES-GCM 256-bit encryption with PBKDF2-HMAC-SHA256 key derivation.
 * Only encrypted ciphertext is persisted to IndexedDB.
 *
 * WARNING: Local browser custody is for evaluation and local workflows only.
 * Production agent infrastructure requires institutional MPC custody or hardware security modules (HSM).
 */

export const INSTITUTIONAL_CUSTODY_WARNING =
  "WARNING: Local browser custody is intended solely for evaluation and local agent workflows. Institutional production deployments must use dedicated hardware security modules (HSM) or multi-party computation (MPC) key managers.";

import { VaultPassphraseError, VaultTamperedError, VaultPersistenceError } from "../runtime/errors.ts";
import { encodeVaultJson, decodeVaultJson } from "./vault-codec.ts";
export { encodeVaultJson, decodeVaultJson } from "./vault-codec.ts";

const DB_NAME = "line_vault_db";
const STORE_NAME = "encrypted_keys";
const PBKDF2_ITERATIONS = 100_000;

function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error("WebCrypto SubtleCrypto is not available in this environment.");
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new VaultPersistenceError("IndexedDB is not available."));
      return;
    }
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch { reject(new VaultPersistenceError("Cannot open encrypted storage.")); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    let settled = false;
    const fail = () => { settled = true; reject(new VaultPersistenceError("Cannot open encrypted storage.")); };
    request.onerror = fail;
    request.onblocked = fail;
  });
}

export type EncryptedEnvelope = {
  version?: 2;
  id: string;
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
  updatedAt: number;
};

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(hex: string): Uint8Array {
  if (typeof hex !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new VaultTamperedError("Malformed encrypted envelope.");
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(
  id: string,
  plaintext: string,
  passphrase: string
): Promise<EncryptedEnvelope> {
  const crypto = getCrypto();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const key = await deriveKey(passphrase, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(id) },
    key,
    enc.encode(plaintext)
  );

  return {
    version: 2,
    id,
    saltHex: bufferToHex(salt),
    ivHex: bufferToHex(iv),
    ciphertextHex: bufferToHex(new Uint8Array(ciphertext)),
    updatedAt: Date.now(),
  };
}

export async function decryptSecret(
  envelope: EncryptedEnvelope,
  passphrase: string
): Promise<string> {
  if (!envelope || typeof envelope.id !== "string" ||
      (envelope.version !== undefined && envelope.version !== 2)) throw new VaultTamperedError("Malformed encrypted envelope.");
  const crypto = getCrypto();
  const salt = hexToBuffer(envelope.saltHex);
  const iv = hexToBuffer(envelope.ivHex);
  const ciphertext = hexToBuffer(envelope.ciphertextHex);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new VaultTamperedError("Malformed encrypted envelope.");

  const key = await deriveKey(passphrase, salt);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource,
        ...(envelope.version === 2 ? { additionalData: new TextEncoder().encode(envelope.id) } : {}) },
      key,
      ciphertext as BufferSource
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    throw new VaultPassphraseError("Ciphertext MAC authentication failed: Incorrect vault passphrase or corrupted ciphertext.");
  }
}

// Fallback encrypted envelope store for non-browser environments (e.g., Node.js tests or CLI)
// All data stored here remains fully encrypted with WebCrypto AES-GCM and PBKDF2.
const fallbackEncryptedStore = new Map<string, EncryptedEnvelope>();

export interface VaultWriteOptions { beforeWrite?: () => void; }

function assertNonBrowserFallback(): void {
  if (typeof window !== "undefined") throw new VaultPersistenceError("Browser encrypted storage is unavailable.");
}

/** A successful request is not a committed transaction. Only oncomplete resolves. */
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, setResult: (value: T) => void, guard: () => boolean) => void,
  initialResult: T,
  options?: VaultWriteOptions,
): Promise<T> {
  const db = await openDb();
  try { options?.beforeWrite?.(); }
  catch (err) { db.close(); throw err; }
  return new Promise<T>((resolve, reject) => {
    let result = initialResult;
    let tx: IDBTransaction | undefined;
    let settled = false;
    let guardFailure: unknown;
    let stopLockListener: (() => void) | undefined;
    const fail = () => {
      if (settled) return;
      settled = true;
      stopLockListener?.();
      db.close();
      reject(guardFailure ?? new VaultPersistenceError("Encrypted storage transaction did not commit."));
    };
    const guard = () => {
      try { options?.beforeWrite?.(); return true; }
      catch (err) {
        guardFailure = err;
        try { tx?.abort(); } catch { /* Already inactive. */ }
        fail();
        return false;
      }
    };
    try {
      tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        stopLockListener?.();
        db.close();
        resolve(result);
      };
      tx.onabort = fail;
      tx.onerror = fail;
      if (options?.beforeWrite) {
        stopLockListener = onVaultSessionLock(() => { guard(); });
      }
      run(tx.objectStore(STORE_NAME), value => { result = value; }, guard);
    } catch {
      try { tx?.abort(); } catch { /* Already inactive. */ }
      fail();
    }
  });
}

export async function saveEncryptedSecret(
  id: string,
  plaintext: string,
  passphrase: string,
  options?: VaultWriteOptions,
): Promise<void> {
  const envelope = await encryptSecret(id, plaintext, passphrase);
  if (typeof indexedDB === "undefined") {
    assertNonBrowserFallback();
    options?.beforeWrite?.();
    fallbackEncryptedStore.set(id, envelope);
    return;
  }
  await transact("readwrite", store => { store.put(envelope); }, undefined, options);
}

export async function loadEncryptedSecret(
  id: string,
  passphrase: string
): Promise<string | null> {
  let envelope: EncryptedEnvelope | null = null;
  if (typeof indexedDB === "undefined") {
    assertNonBrowserFallback();
    envelope = fallbackEncryptedStore.get(id) ?? null;
  } else {
    envelope = await transact<EncryptedEnvelope | null>("readonly", (store, setResult) => {
      const req = store.get(id);
      req.onsuccess = () => setResult(req.result ?? null);
    }, null);
  }

  if (!envelope) return null;
  if (envelope.id !== id) throw new VaultTamperedError("Encrypted record identity does not match its storage key.");
  return decryptSecret(envelope, passphrase);
}

export async function saveEncryptedJson<T>(
  id: string,
  data: T,
  passphrase: string,
  options?: VaultWriteOptions,
): Promise<void> {
  return saveEncryptedSecret(id, encodeVaultJson(data), passphrase, options);
}

export async function loadEncryptedJson<T>(
  id: string,
  passphrase: string
): Promise<T | null> {
  const jsonStr = await loadEncryptedSecret(id, passphrase);
  if (jsonStr === null) return null;
  return decodeVaultJson(jsonStr) as T;
}

export async function removeEncryptedSecret(id: string, options?: VaultWriteOptions): Promise<void> {
  if (typeof indexedDB === "undefined") {
    assertNonBrowserFallback();
    options?.beforeWrite?.();
    fallbackEncryptedStore.delete(id);
    return;
  }
  await transact("readwrite", store => { store.delete(id); }, undefined, options);
}

export async function removeEncryptedPrefix(prefix: string, options?: VaultWriteOptions): Promise<number> {
  if (typeof indexedDB === "undefined") {
    assertNonBrowserFallback();
    options?.beforeWrite?.();
    let count = 0;
    for (const key of Array.from(fallbackEncryptedStore.keys())) {
      if (key.startsWith(prefix)) {
        fallbackEncryptedStore.delete(key);
        count++;
      }
    }
    return count;
  }
  return transact<number>("readwrite", (store, setResult, guard) => {
    let count = 0;
    const req = store.openCursor();
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const key = String(cursor.key);
        if (key.startsWith(prefix)) {
          if (!guard()) return;
          cursor.delete();
          count++;
        }
        cursor.continue();
      } else {
        setResult(count);
      }
    };
  }, 0, options);
}

export async function listEncryptedKeys(prefix?: string): Promise<string[]> {
  if (typeof indexedDB === "undefined") {
    assertNonBrowserFallback();
    return Array.from(fallbackEncryptedStore.keys()).filter((k) => !prefix || k.startsWith(prefix));
  }
  return transact<string[]>("readonly", (store, setResult) => {
    const keys: string[] = [];
    const req = store.openKeyCursor();
    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor>).result;
      if (cursor) {
        const key = String(cursor.key);
        if (!prefix || key.startsWith(prefix)) {
          keys.push(key);
        }
        cursor.continue();
      } else {
        setResult(keys);
      }
    };
  }, []);
}

// In-memory ephemeral session state (never stored to disk or localStorage)
let sessionPassphrase: string | null = null;
let sessionExpiresAt: number = 0;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let sessionRevision = 0;
const lockListeners = new Set<() => void>();

export function getVaultSessionRevision(): number { return sessionRevision; }
export function onVaultSessionLock(callback: () => void): () => void {
  lockListeners.add(callback);
  return () => { lockListeners.delete(callback); };
}

export function unlockVaultSession(passphrase: string, timeoutMinutes: number = 15): void {
  if (!passphrase || !Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0 || timeoutMinutes * 60_000 > 2_147_483_647) {
    throw new TypeError("A passphrase and a valid positive vault timeout are required.");
  }
  lockVaultSession();
  sessionRevision++;
  sessionPassphrase = passphrase;
  sessionExpiresAt = Date.now() + timeoutMinutes * 60 * 1000;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    lockVaultSession();
  }, timeoutMinutes * 60 * 1000);
  if (sessionTimer && typeof (sessionTimer as any).unref === "function") {
    (sessionTimer as any).unref();
  }
}

export function lockVaultSession(): void {
  sessionRevision++;
  sessionPassphrase = null;
  sessionExpiresAt = 0;
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  // Every listener runs even if one subscriber fails. Revocation must be synchronous.
  for (const listener of [...lockListeners]) {
    try { listener(); } catch { /* A failing UI observer cannot prevent other revocations. */ }
  }
}

export function isVaultSessionUnlocked(): boolean {
  if (sessionPassphrase && Date.now() >= sessionExpiresAt) lockVaultSession();
  return sessionPassphrase !== null;
}

export function getVaultSessionPassphrase(): string | null {
  if (!isVaultSessionUnlocked()) {
    return null;
  }
  return sessionPassphrase;
}

export function purgeLegacyPlaintextStorage(targetStorage?: {
  length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}): void {
  const storage = targetStorage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!storage) return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (
        key &&
        (key.startsWith("line.protocol") ||
          key.includes("line:store") ||
          key.includes("line.state") ||
          key.includes("agent-secret") ||
          key.includes("witness"))
      ) {
        toRemove.push(key);
      }
    }
    for (const k of toRemove) {
      storage.removeItem(k);
    }
  } catch {
    // Ignore restricted storage contexts
  }
}

export async function clearVaultState(): Promise<void> {
  lockVaultSession();
  purgeLegacyPlaintextStorage();
  if (typeof indexedDB === "undefined") { assertNonBrowserFallback(); fallbackEncryptedStore.clear(); return; }
  await transact("readwrite", store => { store.clear(); }, undefined);
}

