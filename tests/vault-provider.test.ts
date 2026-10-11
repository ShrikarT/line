import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { VaultPrivateStateProvider } from "../src/lib/runtime/vault-provider.ts";
import { lockVaultSession, unlockVaultSession, loadEncryptedSecret, saveEncryptedSecret } from "../src/lib/security/vault.ts";
import { VaultLockedError, VaultPassphraseError, VaultPersistenceError, VaultTamperedError } from "../src/lib/runtime/errors.ts";

const passphrase = "provider-regression-password";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
function restore(name: string, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
afterEach(() => {
  lockVaultSession();
  restore("window", originalWindow);
  restore("indexedDB", originalIndexedDb);
});

function provider(options: ConstructorParameters<typeof VaultPrivateStateProvider>[0] = {}) {
  const p = new VaultPrivateStateProvider({ passwordProvider: () => passphrase, networkId: `test-${randomUUID()}`, ...options });
  p.setContractAddress("contract-a");
  return p;
}

function unavailableIndexedDb() {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {
    open() {
      const request = { error: new Error("database unavailable"), onerror: null as (() => void) | null };
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe("encrypted private-state provider authorization and recovery", () => {
  it("round-trips actual witness types through a recreated provider and independent decoded objects", async () => {
    const networkId = `typed-${randomUUID()}`;
    const a = provider({ networkId });
    const state = { callerSecret: new Uint8Array(32).fill(37), limit: (1n << 64n) - 1n,
      balance: 8n, nested: [new Uint8Array([0, 255]), { epoch: 4n }], ordinary: { type: "bigint", value: "123" } };
    await a.set("issuer-state", state);
    state.callerSecret.fill(99);
    const b = provider({ networkId });
    const recovered = await b.get("issuer-state") as typeof state;
    assert.equal(recovered.limit, (1n << 64n) - 1n);
    assert.ok(recovered.callerSecret instanceof Uint8Array);
    assert.equal(recovered.callerSecret[0], 37);
    assert.deepEqual(recovered.nested, [new Uint8Array([0, 255]), { epoch: 4n }]);
    assert.deepEqual(recovered.ordinary, { type: "bigint", value: "123" });
    recovered.callerSecret.fill(3);
    assert.equal(((await b.get("issuer-state")) as typeof state).callerSecret[0], 37);
    const encrypted = await loadEncryptedSecret(`midnight:ps:${networkId}:contract-a:issuer-state`, passphrase);
    assert.ok(encrypted?.includes("18446744073709551615"));
  });

  it("never returns a previously read signing key after lock", async () => {
    const p = provider({ passwordProvider: undefined });
    unlockVaultSession(passphrase);
    await p.setSigningKey("contract-a", "private-signing-key");
    assert.equal(await p.getSigningKey("contract-a"), "private-signing-key");
    lockVaultSession();
    await assert.rejects(p.getSigningKey("contract-a"), VaultLockedError);
  });

  it("all read/write/delete/clear methods require authorization, including explicit fallback", async () => {
    const p = provider({ passwordProvider: undefined, allowEphemeralFallback: true });
    for (const op of [() => p.get("s"), () => p.set("s", { sensitive: true }), () => p.remove("s"), () => p.clear(),
      () => p.getSigningKey("a"), () => p.setSigningKey("a", "secret"), () => p.removeSigningKey("a"), () => p.clearSigningKeys()]) {
      await assert.rejects(op(), VaultLockedError);
    }
    p.dispose();
  });

  it("failed durable writes do not become readable through a plaintext fallback", async () => {
    const p = provider();
    unavailableIndexedDb();
    await assert.rejects(p.set("s", { secret: "must-not-cache" }), VaultPersistenceError);
    await assert.rejects(p.setSigningKey("a", "must-not-cache"), VaultPersistenceError);
    restore("indexedDB", originalIndexedDb);
    assert.equal(await p.get("s"), null);
    assert.equal(await p.getSigningKey("a"), null);
  });

  it("explicit persistence fallback is encrypted, rejects wrong passwords and is purged on lock", async () => {
    let password = passphrase;
    const p = provider({ passwordProvider: () => password, allowEphemeralFallback: true });
    unavailableIndexedDb();
    await p.set("s", { debt: 17n, key: new Uint8Array([1, 2]) });
    assert.deepEqual(await p.get("s"), { debt: 17n, key: new Uint8Array([1, 2]) });
    password = "incorrect-password";
    await assert.rejects(p.get("s"), VaultPassphraseError);
    password = passphrase;
    lockVaultSession();
    assert.equal(await p.get("s"), null);
    p.dispose();
  });

  it("opt-in fallback returns the latest authorized write when storage recovers, not an older durable value", async () => {
    const p = provider({ allowEphemeralFallback: true });
    try {
      await p.set("s", { debt: 1n });
      unavailableIndexedDb();
      await p.set("s", { debt: 2n });
      await assert.rejects(p.remove("s"), VaultPersistenceError);
      assert.deepEqual(await p.get("s"), { debt: 2n });
      restore("indexedDB", originalIndexedDb);
      assert.deepEqual(await p.get("s"), { debt: 2n });
      await p.set("s", { debt: 3n });
      assert.deepEqual(await p.get("s"), { debt: 3n });
    } finally { p.dispose(); }
  });

  it("fallback never masks wrong-passphrase, tampered payload or unsupported serialization", async () => {
    const networkId = `tampered-${randomUUID()}`;
    const a = provider({ networkId, allowEphemeralFallback: true });
    await a.set("s", { value: 10 });
    const wrong = provider({ networkId, passwordProvider: () => "wrong", allowEphemeralFallback: true });
    await assert.rejects(wrong.get("s"), VaultPassphraseError);
    await saveEncryptedSecret(`midnight:ps:${networkId}:contract-a:s`, "{invalid", passphrase);
    await assert.rejects(a.get("s"), VaultTamperedError);
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    await assert.rejects(a.set("cycle", cyclic));
    assert.equal(await a.get("cycle"), null);
    a.dispose(); wrong.dispose();
  });

  it("network/account/contract/state scopes survive clear and signing-key removals", async () => {
    const networkId = `scoped-${randomUUID()}`;
    const a = provider({ networkId, accountId: "operator:a" });
    const b = provider({ networkId, accountId: "operator:b" });
    const defaultAccount = provider({ networkId });
    const otherNetwork = provider({ networkId: `other-${networkId}`, accountId: "operator:a" });
    await a.set("x", { private: "a" }); await a.set("y", { private: "y" });
    await b.set("x", { private: "b" }); await otherNetwork.set("x", { private: "other" });
    a.setContractAddress("contract-b"); await a.set("x", { private: "contract-b" });
    a.setContractAddress("contract-a"); await a.clear();
    assert.equal(await a.get("x"), null); assert.equal(await a.get("y"), null);
    assert.deepEqual(await b.get("x"), { private: "b" });
    assert.deepEqual(await otherNetwork.get("x"), { private: "other" });
    a.setContractAddress("contract-b"); assert.deepEqual(await a.get("x"), { private: "contract-b" });
    await a.setSigningKey("one", "a-one"); await a.setSigningKey("two", "a-two");
    await b.setSigningKey("one", "b-one"); await otherNetwork.setSigningKey("one", "other-one");
    await defaultAccount.setSigningKey("one", "default-one");
    await defaultAccount.clearSigningKeys();
    assert.equal(await a.getSigningKey("one"), "a-one");
    assert.equal(await b.getSigningKey("one"), "b-one");
    await a.removeSigningKey("one"); assert.equal(await a.getSigningKey("one"), null);
    assert.equal(await a.getSigningKey("two"), "a-two");
    await a.clearSigningKeys(); assert.equal(await a.getSigningKey("two"), null);
    assert.equal(await b.getSigningKey("one"), "b-one");
    assert.equal(await otherNetwork.getSigningKey("one"), "other-one");
  });

  it("locked deletes leave encrypted records intact for the next authorized session", async () => {
    const p = provider({ passwordProvider: undefined });
    unlockVaultSession(passphrase);
    await p.set("x", { value: 7n }); await p.setSigningKey("a", "key");
    lockVaultSession();
    await assert.rejects(p.remove("x"), VaultLockedError);
    await assert.rejects(p.clear(), VaultLockedError);
    await assert.rejects(p.removeSigningKey("a"), VaultLockedError);
    await assert.rejects(p.clearSigningKeys(), VaultLockedError);
    unlockVaultSession(passphrase);
    assert.deepEqual(await p.get("x"), { value: 7n }); assert.equal(await p.getSigningKey("a"), "key");
  });

  it("wrong passwords cannot overwrite or delete stored state or signing keys", async () => {
    const networkId = `delete-auth-${randomUUID()}`;
    const good = provider({ networkId });
    const wrong = provider({ networkId, passwordProvider: () => "wrong-password" });
    await good.set("x", { value: 7n }); await good.setSigningKey("a", "protected-key");
    for (const op of [() => wrong.remove("x"), () => wrong.clear(), () => wrong.removeSigningKey("a"), () => wrong.clearSigningKeys()]) {
      await assert.rejects(op(), VaultPassphraseError);
    }
    await assert.rejects(wrong.set("x", { replacement: true }), VaultPassphraseError);
    await assert.rejects(wrong.setSigningKey("a", "replacement"), VaultPassphraseError);
    assert.deepEqual(await good.get("x"), { value: 7n });
    assert.equal(await good.getSigningKey("a"), "protected-key");
  });

  it("browser password callbacks cannot bypass a locked vault", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const p = provider({ allowEphemeralFallback: true });
    try {
      await assert.rejects(p.set("x", { secret: true }), VaultLockedError);
      unlockVaultSession(passphrase);
      await p.set("x", { secret: true });
      assert.deepEqual(await p.get("x"), { secret: true });
      lockVaultSession();
      await assert.rejects(p.get("x"), VaultLockedError);
    } finally { p.dispose(); }
  });

  it("session replacement while awaiting a password rejects the operation before mutation", async () => {
    unlockVaultSession(passphrase);
    const password = deferred<string>();
    const networkId = `password-race-${randomUUID()}`;
    const p = provider({ networkId, passwordProvider: () => password.promise });
    const pending = p.set("x", { secret: true });
    unlockVaultSession(passphrase);
    password.resolve(passphrase);
    await assert.rejects(pending, VaultLockedError);
    const verify = provider({ networkId });
    assert.equal(await verify.get("x"), null);
  });

  it("disposed providers reject stale reads, writes and delayed authorization despite an unlocked session", async () => {
    unlockVaultSession(passphrase);
    const networkId = `disposed-${randomUUID()}`;
    const p = provider({ networkId });
    await p.setSigningKey("a", "protected-key");
    p.dispose();
    await assert.rejects(p.getSigningKey("a"), VaultLockedError);
    await assert.rejects(p.set("x", { secret: true }), VaultLockedError);
    const password = deferred<string>();
    const pendingProvider = provider({ networkId, passwordProvider: () => password.promise });
    const pending = pendingProvider.set("x", { secret: true });
    pendingProvider.dispose(); password.resolve(passphrase);
    await assert.rejects(pending, VaultLockedError);
    const active = provider({ networkId });
    assert.equal(await active.get("x"), null);
    assert.equal(await active.getSigningKey("a"), "protected-key");
  });

  it("locking during actual encryption prevents durable mutation", async () => {
    unlockVaultSession(passphrase);
    const networkId = `write-race-${randomUUID()}`;
    const p = provider({ networkId });
    const started = deferred<void>(); const release = deferred<void>();
    const subtle = globalThis.crypto.subtle;
    const original = subtle.encrypt;
    subtle.encrypt = async function (...args: Parameters<SubtleCrypto["encrypt"]>) {
      started.resolve(); await release.promise; return original.apply(this, args);
    };
    try {
      const pending = p.set("x", { debt: 42n });
      await started.promise; lockVaultSession(); release.resolve();
      await assert.rejects(pending, VaultLockedError);
    } finally { subtle.encrypt = original; release.resolve(); }
    assert.equal(await provider({ networkId }).get("x"), null);
  });

  it("locking during actual signing-key decryption prevents a secret result", async () => {
    unlockVaultSession(passphrase);
    const p = provider(); await p.setSigningKey("a", "protected-key");
    const started = deferred<void>(); const release = deferred<void>();
    const subtle = globalThis.crypto.subtle;
    const original = subtle.decrypt;
    subtle.decrypt = async function (...args: Parameters<SubtleCrypto["decrypt"]>) {
      started.resolve(); await release.promise; return original.apply(this, args);
    };
    try {
      const pending = p.getSigningKey("a");
      await started.promise; lockVaultSession(); release.resolve();
      await assert.rejects(pending, VaultLockedError);
    } finally { subtle.decrypt = original; release.resolve(); }
  });
});
