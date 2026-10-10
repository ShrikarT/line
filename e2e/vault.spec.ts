import { test, expect } from "@playwright/test";

const vaultModule = "/src/lib/security/vault.ts";
const providerModule = "/src/lib/runtime/vault-provider.ts";
const password = "browser-vault-regression-password";

test("real IndexedDB preserves encrypted typed openings across page reload and provider replacement", async ({ page }) => {
  await page.goto("/");
  const networkId = `browser-${Date.now()}`;
  const before = await page.evaluate(async ({ vaultModule, providerModule, password, networkId }) => {
    const vault = await import(vaultModule);
    const { VaultPrivateStateProvider } = await import(providerModule);
    vault.unlockVaultSession(password);
    const provider = new VaultPrivateStateProvider({ networkId, accountId: "wallet-a" });
    provider.setContractAddress("contract-a");
    await provider.set("line-opening", {
      callerSecret: new Uint8Array(32).fill(37), limit: (1n << 64n) - 1n, outstanding: 19n,
      nested: [new Uint8Array([0, 255]), { epoch: 8n }], ordinary: { type: "bigint", value: "123" },
      confidentialLabel: "confidential-agent-opening",
    });
    const request = indexedDB.open("line_vault_db", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const envelope = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("encrypted_keys", "readonly");
      const read = tx.objectStore("encrypted_keys").get(`midnight:ps-account:wallet-a:${networkId}:contract-a:line-opening`);
      tx.oncomplete = () => resolve(read.result); tx.onabort = () => reject(tx.error);
    });
    db.close(); provider.dispose();
    return { envelope: JSON.stringify(envelope), unlocked: vault.isVaultSessionUnlocked() };
  }, { vaultModule, providerModule, password, networkId });
  expect(before.unlocked).toBe(true);
  expect(before.envelope).toContain('"ciphertextHex"');
  expect(before.envelope).not.toContain("confidential-agent-opening");
  expect(before.envelope).not.toContain("18446744073709551615");

  await page.reload();
  const after = await page.evaluate(async ({ vaultModule, providerModule, password, networkId }) => {
    const vault = await import(vaultModule);
    const { VaultPrivateStateProvider } = await import(providerModule);
    const provider = new VaultPrivateStateProvider({ networkId, accountId: "wallet-a" });
    provider.setContractAddress("contract-a");
    const initiallyLocked = !vault.isVaultSessionUnlocked();
    let lockedCode = "";
    try { await provider.get("line-opening"); } catch (error) { lockedCode = (error as { code: string }).code; }
    vault.unlockVaultSession(password);
    const recovered = await provider.get("line-opening");
    provider.dispose();
    return { initiallyLocked, lockedCode, limit: recovered.limit.toString(), debt: recovered.outstanding.toString(),
      isBytes: recovered.callerSecret instanceof Uint8Array, bytes: Array.from(recovered.callerSecret),
      nestedBytes: Array.from(recovered.nested[0]), epoch: recovered.nested[1].epoch.toString(), ordinary: recovered.ordinary };
  }, { vaultModule, providerModule, password, networkId });
  expect(after).toEqual({ initiallyLocked: true, lockedCode: "VAULT_LOCKED", limit: "18446744073709551615",
    debt: "19", isBytes: true, bytes: Array(32).fill(37), nestedBytes: [0, 255], epoch: "8",
    ordinary: { type: "bigint", value: "123" } });
});

test("real IndexedDB rejects relocated ciphertext and encrypted-record tampering", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ vaultModule, password }) => {
    const vault = await import(vaultModule);
    const sourceId = "browser-vault-source";
    const copyId = "browser-vault-relocated";
    await vault.saveEncryptedJson(sourceId, { balance: 9n }, password);
    const request = indexedDB.open("line_vault_db", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const envelope = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction("encrypted_keys", "readonly");
      const get = tx.objectStore("encrypted_keys").get(sourceId);
      tx.oncomplete = () => resolve(get.result); tx.onabort = () => reject(tx.error);
    });
    async function put(value: Record<string, unknown>) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("encrypted_keys", "readwrite"); tx.objectStore("encrypted_keys").put(value);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    }
    let relocationCode = ""; let tamperCode = "";
    try {
      await put({ ...envelope, id: copyId });
      try { await vault.loadEncryptedJson(copyId, password); } catch (error) { relocationCode = (error as { code: string }).code; }
      const original = await vault.loadEncryptedJson(sourceId, password);
      const ciphertext = envelope.ciphertextHex as string;
      await put({ ...envelope, ciphertextHex: (ciphertext[0] === "a" ? "b" : "a") + ciphertext.slice(1) });
      try { await vault.loadEncryptedJson(sourceId, password); } catch (error) { tamperCode = (error as { code: string }).code; }
      return { relocationCode, tamperCode, originalBalance: original.balance.toString() };
    } finally { db.close(); }
  }, { vaultModule, password });
  expect(result).toEqual({ relocationCode: "VAULT_PASSPHRASE_ERROR", tamperCode: "VAULT_PASSPHRASE_ERROR", originalBalance: "9" });
});

test("a successful IndexedDB put followed by transaction abort rejects save and retains the old opening", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ vaultModule, password }) => {
    const vault = await import(vaultModule);
    const id = "browser-aborted-opening";
    await vault.saveEncryptedJson(id, { balance: 5n }, password);
    const originalPut = IDBObjectStore.prototype.put;
    let requestSucceeded = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      if (this.name === "encrypted_keys" && value?.id === id) {
        const transaction = this.transaction;
        request.addEventListener("success", () => { requestSucceeded = true; transaction.abort(); }, { once: true });
      }
      return request;
    };
    let saveCode = "";
    try {
      try { await vault.saveEncryptedJson(id, { balance: 99n }, password); } catch (error) { saveCode = (error as { code: string }).code; }
    } finally { IDBObjectStore.prototype.put = originalPut; }
    const recovered = await vault.loadEncryptedJson(id, password);
    return { requestSucceeded, saveCode, balance: recovered.balance.toString() };
  }, { vaultModule, password });
  expect(result).toEqual({ requestSucceeded: true, saveCode: "VAULT_PERSISTENCE_ERROR", balance: "5" });
});

test("a browser without IndexedDB fails closed rather than silently using a Node memory store", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ vaultModule, password }) => {
    const vault = await import(vaultModule);
    const original = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    let saveCode = ""; let readCode = "";
    try {
      try { await vault.saveEncryptedJson("browser-no-idb", { balance: 5n }, password); } catch (error) { saveCode = (error as { code: string }).code; }
      try { await vault.loadEncryptedJson("browser-no-idb", password); } catch (error) { readCode = (error as { code: string }).code; }
    } finally {
      if (original) Object.defineProperty(window, "indexedDB", original);
      else Reflect.deleteProperty(window, "indexedDB");
    }
    return { saveCode, readCode };
  }, { vaultModule, password });
  expect(result).toEqual({ saveCode: "VAULT_PERSISTENCE_ERROR", readCode: "VAULT_PERSISTENCE_ERROR" });
});

test("locking after an IndexedDB request succeeds aborts an authorized provider write before commit", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async ({ vaultModule, providerModule, password }) => {
    const vault = await import(vaultModule);
    const { VaultPrivateStateProvider } = await import(providerModule);
    vault.unlockVaultSession(password);
    const provider = new VaultPrivateStateProvider({ networkId: "browser-lock-commit", accountId: "wallet-a" });
    provider.setContractAddress("contract-a");
    await provider.set("opening", { debt: 5n });
    const originalPut = IDBObjectStore.prototype.put;
    let requestSucceeded = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      if (this.name === "encrypted_keys" && value?.id === "midnight:ps-account:wallet-a:browser-lock-commit:contract-a:opening") {
        request.addEventListener("success", () => { requestSucceeded = true; vault.lockVaultSession(); }, { once: true });
      }
      return request;
    };
    let writeCode = "";
    try {
      try { await provider.set("opening", { debt: 99n }); } catch (error) { writeCode = (error as { code: string }).code; }
    } finally { IDBObjectStore.prototype.put = originalPut; }
    vault.unlockVaultSession(password);
    const recovered = await provider.get("opening");
    provider.dispose();
    return { requestSucceeded, writeCode, debt: recovered.debt.toString() };
  }, { vaultModule, providerModule, password });
  expect(result).toEqual({ requestSucceeded: true, writeCode: "VAULT_LOCKED", debt: "5" });
});
