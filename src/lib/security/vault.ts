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
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export type EncryptedEnvelope = {
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
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );

  return {
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
  const crypto = getCrypto();
  const salt = hexToBuffer(envelope.saltHex);
  const iv = hexToBuffer(envelope.ivHex);
  const ciphertext = hexToBuffer(envelope.ciphertextHex);

  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

export async function saveEncryptedSecret(
  id: string,
  plaintext: string,
  passphrase: string
): Promise<void> {
  const envelope = await encryptSecret(id, plaintext, passphrase);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(envelope);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadEncryptedSecret(
  id: string,
  passphrase: string
): Promise<string | null> {
  const db = await openDb();
  const envelope = await new Promise<EncryptedEnvelope | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });

  if (!envelope) return null;
  return decryptSecret(envelope, passphrase);
}

export async function saveEncryptedJson<T>(
  id: string,
  data: T,
  passphrase: string
): Promise<void> {
  const jsonStr = JSON.stringify(data);
  return saveEncryptedSecret(id, jsonStr, passphrase);
}

export async function loadEncryptedJson<T>(
  id: string,
  passphrase: string
): Promise<T | null> {
  const jsonStr = await loadEncryptedSecret(id, passphrase);
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

// In-memory ephemeral session state (never stored to disk or localStorage)
let sessionPassphrase: string | null = null;
let sessionExpiresAt: number = 0;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;

export function unlockVaultSession(passphrase: string, timeoutMinutes: number = 15): void {
  sessionPassphrase = passphrase;
  sessionExpiresAt = Date.now() + timeoutMinutes * 60 * 1000;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    lockVaultSession();
  }, timeoutMinutes * 60 * 1000);
}

export function lockVaultSession(): void {
  sessionPassphrase = null;
  sessionExpiresAt = 0;
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
}

export function isVaultSessionUnlocked(): boolean {
  return Boolean(sessionPassphrase && Date.now() < sessionExpiresAt);
}

export function getVaultSessionPassphrase(): string | null {
  if (!isVaultSessionUnlocked()) {
    lockVaultSession();
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
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

