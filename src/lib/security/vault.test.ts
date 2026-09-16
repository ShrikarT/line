import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, INSTITUTIONAL_CUSTODY_WARNING } from "./vault.ts";

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
