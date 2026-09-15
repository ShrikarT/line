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
});
