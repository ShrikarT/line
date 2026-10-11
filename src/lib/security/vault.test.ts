import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encryptSecret, decryptSecret, deriveKey, INSTITUTIONAL_CUSTODY_WARNING,
  encodeVaultJson, decodeVaultJson, saveEncryptedJson, loadEncryptedJson,
  saveEncryptedSecret, removeEncryptedSecret, clearVaultState,
  lockVaultSession, unlockVaultSession, getVaultSessionRevision,
  getVaultSessionPassphrase, onVaultSessionLock,
} from "./vault.ts";
import { VaultLockedError, VaultPersistenceError, VaultTamperedError } from "../runtime/errors.ts";

describe("security vault: WebCrypto AES-GCM and PBKDF2", () => {
  it("displays institutional custody disclaimer", () => {
    assert.match(INSTITUTIONAL_CUSTODY_WARNING, /hardware security modules/);
  });

  it("encrypts and decrypts secret cleanly with correct passphrase", async () => {
    const plaintext = "agent_sk_secret_value_12345";
    const passphrase = "correct_horse_battery_staple";

    const envelope = await encryptSecret("agent_key", plaintext, passphrase);
    assert.equal(envelope.id, "agent_key");
    assert.ok(envelope.ciphertextHex);
    assert.ok(!envelope.ciphertextHex.includes(plaintext), "Ciphertext must not contain plaintext");

    const decrypted = await decryptSecret(envelope, passphrase);
    assert.equal(decrypted, plaintext);
  });

  it("fails decryption when provided incorrect passphrase", async () => {
    const plaintext = "secret_to_protect";
    const passphrase = "correct_password";
    const wrongPassphrase = "wrong_password";

    const envelope = await encryptSecret("secret_id", plaintext, passphrase);

    await assert.rejects(
      () => decryptSecret(envelope, wrongPassphrase),
      /operation failed|ciphertext|mac/i
    );
  });

  it("fails decryption when ciphertext is tampered", async () => {
    const plaintext = "secret_to_protect";
    const passphrase = "correct_password";

    const envelope = await encryptSecret("secret_id", plaintext, passphrase);

    // Tamper with first byte of ciphertext
    const tamperedCiphertext =
      (envelope.ciphertextHex[0] === "a" ? "b" : "a") + envelope.ciphertextHex.slice(1);
    const tamperedEnvelope = { ...envelope, ciphertextHex: tamperedCiphertext };

    await assert.rejects(
      () => decryptSecret(tamperedEnvelope, passphrase),
      /operation failed|ciphertext|mac/i
    );
  });

  it("manages ephemeral vault session locking and timeout", async () => {
    const {
      unlockVaultSession,
      lockVaultSession,
      isVaultSessionUnlocked,
      getVaultSessionPassphrase,
    } = await import("./vault.ts");

    lockVaultSession();
    assert.equal(isVaultSessionUnlocked(), false);
    assert.equal(getVaultSessionPassphrase(), null);

    unlockVaultSession("session-pass-123", 10);
    assert.equal(isVaultSessionUnlocked(), true);
    assert.equal(getVaultSessionPassphrase(), "session-pass-123");

    lockVaultSession();
    assert.equal(isVaultSessionUnlocked(), false);
    assert.equal(getVaultSessionPassphrase(), null);
  });

  it("purgeLegacyPlaintextStorage cleans sensitive legacy keys without removing UI prefs", async () => {
    const { purgeLegacyPlaintextStorage } = await import("./vault.ts");

    const mockStorage = new Map<string, string>();
    const fakeLocalStorage = {
      length: 0,
      key: (i: number) => Array.from(mockStorage.keys())[i] ?? null,
      getItem: (k: string) => mockStorage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mockStorage.set(k, v);
        fakeLocalStorage.length = mockStorage.size;
      },
      removeItem: (k: string) => {
        mockStorage.delete(k);
        fakeLocalStorage.length = mockStorage.size;
      },
    };

    // Simulate global window.localStorage
    const originalWindow = globalThis.window;
    (globalThis as any).window = { localStorage: fakeLocalStorage };

    try {
      fakeLocalStorage.setItem("line.protocol.v3", JSON.stringify({ state: { secret: "sensitive_sk", L: 150 } }));
      fakeLocalStorage.setItem("line.state.agent", "secret_agent_witness");
      fakeLocalStorage.setItem("line.ui.theme", "dark");
      fakeLocalStorage.setItem("line.ui.preferences", JSON.stringify({ activeMerchant: "A" }));

      assert.equal(mockStorage.size, 4);

      purgeLegacyPlaintextStorage();

      // Sensitive keys purged
      assert.equal(mockStorage.has("line.protocol.v3"), false);
      assert.equal(mockStorage.has("line.state.agent"), false);
      // Non-sensitive UI keys preserved
      assert.equal(mockStorage.get("line.ui.theme"), "dark");
      assert.equal(mockStorage.has("line.ui.preferences"), true);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});

describe("vault storage fidelity, authentication and transaction commitment", () => {
  it("preserves nested byte arrays, full Uint64 values, optional values and marker-shaped application data", async () => {
    const value = { limit: (1n << 64n) - 1n, bytes: new Uint8Array([0, 127, 255]),
      optional: undefined, nested: [false, null, -0, 23n, new Uint8Array()],
      marker: { format: "line:vault-json/v1", payload: ["bytes", "abcd"] } };
    assert.deepEqual(decodeVaultJson(encodeVaultJson(value)), value);
    await saveEncryptedJson("codec-opening", value, "codec-password");
    assert.deepEqual(await loadEncryptedJson("codec-opening", "codec-password"), value);
  });

  it("reads existing ordinary JSON and rejects corrupted typed records without prototype pollution", () => {
    assert.deepEqual(decodeVaultJson('{"balance":23,"salt":"abc"}'), { balance: 23, salt: "abc" });
    const data = JSON.parse('{"__proto__":{"polluted":true}}');
    const recovered = decodeVaultJson(encodeVaultJson(data)) as Record<string, unknown>;
    assert.ok(Object.hasOwn(recovered, "__proto__"));
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    for (const payload of [["bytes", "zz"], ["bigint", "1.5"], ["number", "NaN"],
      ["object", [["same", ["null"]], ["same", ["null"]]]], ["unknown", 1]]) {
      assert.throws(() => decodeVaultJson(JSON.stringify({ format: "line:vault-json/v1", payload })), VaultTamperedError);
    }
  });

  it("rejects cyclic, accessor, non-finite and unsupported objects before changing a stored opening", async () => {
    await saveEncryptedJson("codec-failure", { balance: 5n }, "codec-password");
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    for (const value of [cyclic, new Map(), { value: Infinity }, { get secret() { throw new Error("Must not evaluate accessor"); } }]) {
      await assert.rejects(saveEncryptedJson("codec-failure", value, "codec-password"), TypeError);
    }
    assert.deepEqual(await loadEncryptedJson("codec-failure", "codec-password"), { balance: 5n });
  });

  it("authenticates the record identity on new envelopes and still reads legacy AES-GCM records", async () => {
    const envelope = await encryptSecret("record-a", "opening", "password");
    await assert.rejects(decryptSecret({ ...envelope, id: "record-b" }, "password"));
    await assert.rejects(decryptSecret({ ...envelope, version: undefined }, "password"));
    await assert.rejects(decryptSecret({ ...envelope, saltHex: "gg" }, "password"), VaultTamperedError);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey("password", salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("legacy"));
    const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    assert.equal(await decryptSecret({ id: "legacy-record", saltHex: hex(salt), ivHex: hex(iv),
      ciphertextHex: hex(new Uint8Array(cipher)), updatedAt: 1 }, "password"), "legacy");
  });

  it("clears the non-browser encrypted store as well as the session", async () => {
    await saveEncryptedJson("clear-regression", { opening: 13n }, "password");
    await clearVaultState();
    assert.equal(await loadEncryptedJson("clear-regression", "password"), null);
  });

  it("revokes synchronously on replacement and lazy expiry, with side-effect-free locked reads", () => {
    let notifications = 0;
    const unsubscribe = onVaultSessionLock(() => notifications++);
    const originalNow = Date.now;
    try {
      unlockVaultSession("session", 1);
      const revision = getVaultSessionRevision();
      unlockVaultSession("replacement", 1);
      assert.ok(getVaultSessionRevision() > revision);
      const beforeExpiry = notifications;
      Date.now = () => originalNow() + 60_001;
      assert.equal(getVaultSessionPassphrase(), null);
      assert.equal(notifications, beforeExpiry + 1);
      assert.equal(getVaultSessionPassphrase(), null);
      assert.equal(notifications, beforeExpiry + 1);
    } finally { Date.now = originalNow; unsubscribe(); lockVaultSession(); }
  });

  it("does not report a write successful before commit and rejects an abort after request success", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    let request!: { onsuccess?: () => void };
    let transaction!: { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore: () => unknown; abort: () => void };
    let ready!: () => void;
    let readyPromise = new Promise<void>(resolve => { ready = resolve; });
    let closed = 0;
    const db = { close: () => closed++, transaction: () => {
      transaction = { objectStore: () => ({ put: () => { request = {}; ready(); return request; }, delete: () => { request = {}; ready(); return request; } }),
        abort: () => transaction.onabort?.() };
      return transaction;
    } };
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => {
      const opened = { result: db, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => opened.onsuccess?.());
      return opened;
    } } });
    try {
      let completed = false;
      const first = saveEncryptedSecret("commit", "secret", "password").then(() => { completed = true; });
      await readyPromise;
      request.onsuccess?.();
      await Promise.resolve();
      assert.equal(completed, false);
      transaction.oncomplete?.();
      await first;
      assert.equal(completed, true);
      assert.equal(closed, 1);
      readyPromise = new Promise<void>(resolve => { ready = resolve; });
      const aborted = saveEncryptedSecret("abort", "secret", "password");
      const rejection = assert.rejects(aborted, VaultPersistenceError);
      await readyPromise;
      request.onsuccess?.();
      transaction.onabort?.();
      await rejection;
      assert.equal(closed, 2);

      unlockVaultSession("password");
      const revision = getVaultSessionRevision();
      readyPromise = new Promise<void>(resolve => { ready = resolve; });
      const deletion = removeEncryptedSecret("commit", { beforeWrite: () => {
        if (getVaultSessionRevision() !== revision) throw new VaultLockedError();
      } });
      const lockRejection = assert.rejects(deletion, VaultLockedError);
      await readyPromise;
      lockVaultSession();
      await lockRejection;
      assert.equal(closed, 3);
    } finally {
      lockVaultSession();
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });
});
