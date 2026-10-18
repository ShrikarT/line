import { expect, test, type Page } from "@playwright/test";
import { bech32m } from "@scure/base";

async function wallets(page: Page) {
  const identity = (n: number) => ({ coin: bech32m.encodeFromBytes("mn_shield-cpk_preprod", new Uint8Array(32).fill(n)), encryption: bech32m.encodeFromBytes("mn_shield-epk_preprod", new Uint8Array(32).fill(n + 20)), receiving: bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(n + 40)) });
  await page.addInitScript(({ a, b }) => {
    const target = window as unknown as { midnight: Record<string, unknown>; organizationSignatures: number; organizationProofRequests: number };
    target.organizationSignatures = 0;
    target.organizationProofRequests = 0;
    target.midnight = Object.fromEntries([["a", a], ["b", b]].map(([id, keys]) => {
      const identity = keys as { coin: string; encryption: string; receiving: string };
      return [id as string, { name: `Organization wallet ${id}`, rdns: `test.org.${id}`, apiVersion: "4.0.1", connect: async () => ({
        getConfiguration: async () => ({ networkId: "preprod", indexerUri: "https://midnight-preprod.blockfrost.io/api/v0", indexerWsUri: "wss://midnight-preprod.blockfrost.io/api/v0/ws", substrateNodeUri: "https://rpc.midnight-preprod.blockfrost.io", proverServerUri: "http://127.0.0.1:6300" }),
        getShieldedAddresses: async () => ({ shieldedCoinPublicKey: identity.coin, shieldedEncryptionPublicKey: identity.encryption, shieldedAddress: "unused" }),
        getUnshieldedAddress: async () => ({ unshieldedAddress: identity.receiving }), getUnshieldedBalances: async () => ({}),
        getProvingProvider: async () => {
          target.organizationProofRequests++;
          return { check: async () => { throw new Error("Account-isolation tests do not check circuit preimages"); }, prove: async () => { throw new Error("Account-isolation tests do not produce circuit proofs"); } };
        },
        balanceUnsealedTransaction: async () => { target.organizationSignatures++; throw new Error("No payment is authorized by an account-isolation test"); },
        submitTransaction: async () => { throw new Error("Account-isolation tests never submit"); },
      }) }];
    }));
  }, { a: identity(11), b: identity(12) });
}
async function connect(page: Page, id: "a" | "b") {
  await page.locator("header").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: `Organization wallet ${id}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wallet is connected." })).toBeVisible();
  await page.getByRole("link", { name: "Continue to workspace" }).click();
}
async function disconnect(page: Page) {
  await page.locator("header").getByRole("button", { name: "Manage connected wallet" }).click();
  await page.getByRole("button", { name: "Disconnect from Line" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
}
async function unlock(page: Page, password = "Organization123!") {
  await page.getByLabel("Organization vault password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled({ timeout: 30_000 });
}
async function profile(page: Page) {
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.getByRole("button", { name: "Show merchant profile", exact: true }).click();
  return JSON.parse(await page.getByLabel("Your public merchant profile", { exact: true }).inputValue());
}

test("real product routes require a wallet and expose no operator or simulator shortcuts", async ({ page }) => {
  test.setTimeout(120_000);
  const posts: string[] = [], errors: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/app", "/organization", "/agents", "/suppliers"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Your treasury", { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Start with your wallet." })).toBeVisible();
      await expect(page.getByRole("link", { name: "Test-token payout", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Local Simulator", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test("two real account namespaces isolate encrypted identities and recover only the selected wallet", async ({ page }) => {
  test.setTimeout(180_000);
  await wallets(page); await page.goto("/app");
  const mutations: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && !request.url().endsWith("/api/line/network-session")) mutations.push(request.url()); });
  await connect(page, "a"); await unlock(page);
  const a = await profile(page);
  await disconnect(page);
  await expect(page.getByLabel("Your public merchant profile", { exact: true })).toHaveCount(0);
  await connect(page, "b"); await unlock(page);
  const b = await profile(page);
  expect(b.publicKey).not.toBe(a.publicKey); expect(b.address).not.toBe(a.address);
  await disconnect(page); await connect(page, "a");
  await page.getByLabel("Organization vault password", { exact: true }).fill("WrongPassword123");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  await unlock(page);
  expect((await profile(page)).publicKey).toBe(a.publicKey);
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
  expect(mutations).toEqual([]);
  await page.screenshot({ path: "artifacts/organization-product/merchant-account-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "artifacts/organization-product/merchant-account-mobile.png", fullPage: true });
});

test("incomplete facility fields show actionable feedback without requesting a signature", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.getByRole("button", { name: "Create facility", exact: true }).click();
  const requiredFeedback = page.getByRole("alert").filter({ hasText: "Complete the required name, asset and supplier profile" });
  await expect(requiredFeedback).toBeVisible();
  await expect(requiredFeedback).toBeInViewport();
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
});

test("the actual supplier client calls browser fetch with its required global receiver", async ({ page }) => {
  await page.route("**/api/organization/catalog", route => route.fulfill({ json: { network: "preprod", services: [] } }));
  await page.goto("/app");
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationSupplierClient } = await import(browserModuleUrl("/src/lib/organization/supplier-client.ts"));
    const account = { receivingAddress: "unused-read-only-control", assertSession() {}, async assertWallet() {}, wallet: { async signData() { throw new Error("A public catalog must not request a signature"); } } };
    return new OrganizationSupplierClient(account, location.origin).request("catalog");
  });
  expect(result).toEqual({ network: "preprod", services: [] });
});

for (const width of [1440, 390]) test(`real facility preparation reaches wallet approval and a rejection creates no confirmed facility at ${width}px`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width, height: 900 });
  await wallets(page); await page.goto("/app");
  await connect(page, "a"); await unlock(page);
  await page.getByLabel("Organization / agent name", { exact: true }).fill("Approval rejection control");
  await expect(page.getByLabel("Initial merchant profile", { exact: false })).not.toHaveValue("", { timeout: 30_000 });
  await page.getByRole("button", { name: "Create facility", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No payment is authorized", { timeout: 150_000 });
  await expect(page.getByRole("alert")).toBeInViewport();
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { organizationProofRequests: number }).organizationProofRequests)).toBe(1);
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled();
  await expect(page.getByText("Facility address", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reconcile original transaction", exact: true })).toHaveCount(0);
});

test("an aborted organization receipt commit retains the exact pending candidate in memory and IndexedDB", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  // Synthetic finality exercises account persistence only. No wallet signature,
  // transaction submission or network-payment acceptance is asserted here.
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { loadEncryptedJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const password = "Organization123!", account = await OrganizationAccount.unlock(getConnectedWallet()!, password);
    const before = account.snapshot(), candidate = account.snapshot(); candidate.issuerSecret = "22".repeat(32);
    const address = "ab".repeat(32), txId = "cd".repeat(32);
    await account.prepare({ id: crypto.randomUUID(), kind: "call", circuit: "fundReserve", facilityId: null, contractAddress: address, sourceFingerprint: "ef".repeat(32), after: candidate, txId: null, transaction: null });
    await account.submitted(txId, "ff", address);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort(), { once: true }); return request;
    };
    let rejected = false;
    try { await account.complete({ kind: "call", circuit: "fundReserve", contractAddress: address, txId, txHash: "12".repeat(32), blockHeight: 1, recordedAt: new Date().toISOString() }); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.put = original; }
    const disk = await loadEncryptedJson(organizationAccountKey("preprod", account.accountId), password);
    return { rejected, memoryUnchanged: account.snapshot().issuerSecret === before.issuerSecret, diskUnchanged: disk.snapshot.issuerSecret === before.issuerSecret, retainedCandidate: disk.pending.after.issuerSecret === candidate.issuerSecret, memoryTx: account.pending()?.txId, diskTx: disk.pending.txId, signatures: (window as unknown as { organizationSignatures: number }).organizationSignatures };
  });
  expect(result).toEqual({ rejected: true, memoryUnchanged: true, diskUnchanged: true, retainedCandidate: true, memoryTx: "cd".repeat(32), diskTx: "cd".repeat(32), signatures: 0 });
});

test("the downloaded encrypted backup restores the same organization in a fresh browser with a new vault password", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const originalProfile = await profile(page);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Encrypted backup", exact: true }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks: Buffer[] = [];
  if (!stream) throw new Error("The real encrypted download is missing.");
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks);
  expect(JSON.parse(backup.toString()).version).toBe(2);
  expect(backup.toString()).not.toContain("issuerSecret");
  const recoveryContext = await browser.newContext();
  try {
    const recovered = await recoveryContext.newPage(); await wallets(recovered);
    await recovered.goto(new URL("/app", page.url()).href); await connect(recovered, "a");
    await unlock(recovered, "FreshBrowserVault123!");
    await recovered.getByText("Restore an encrypted organization backup", { exact: true }).click();
    await recovered.getByLabel("Encrypted backup file", { exact: true }).setInputFiles({ name: "organization.json", mimeType: "application/json", buffer: backup });
    await recovered.getByLabel("Backup vault password", { exact: true }).fill("WrongBackupPassword123!");
    await recovered.getByRole("button", { name: "Restore organization", exact: true }).click();
    await expect(recovered.getByRole("alert")).toBeVisible();
    await recovered.getByLabel("Backup vault password", { exact: true }).fill("Organization123!");
    await recovered.getByRole("button", { name: "Restore organization", exact: true }).click();
    await expect(recovered.getByRole("status")).toContainText("Organization restored", { timeout: 30_000 });
    expect((await profile(recovered)).publicKey).toBe(originalProfile.publicKey);
    await recovered.getByRole("button", { name: "Lock organization", exact: true }).click();
    await unlock(recovered, "FreshBrowserVault123!");
    expect((await profile(recovered)).publicKey).toBe(originalProfile.publicKey);
    expect(await recovered.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
  } finally { await recoveryContext.close(); }
});

test("organization restore refuses active-record overwrite before a network check and aborts failed persistence", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { encryptSecret, encodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const originalSecret = account.snapshot().issuerSecret, replacement = account.snapshot(); replacement.issuerSecret = "22".repeat(32);
    const envelope = await encryptSecret(`line:organization:preprod:${account.accountId}`, encodeVaultJson({ snapshot: replacement, pending: null }), "BackupControl123!");
    const file = JSON.stringify(envelope), put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) { const request = put.apply(this, args); request.addEventListener("success", () => this.transaction.abort(), { once: true }); return request; };
    let aborted = false;
    try { await account.restoreBackup(file, "BackupControl123!", async () => {}); } catch { aborted = true; }
    finally { IDBObjectStore.prototype.put = put; }
    const unchanged = account.snapshot().issuerSecret === originalSecret;
    // Synthetic history protects an already-used account. No chain receipt is claimed.
    await account.edit(snapshot => snapshot.receipts.push({ kind: "call", circuit: "fundReserve", contractAddress: "ab".repeat(32), txId: "cd".repeat(32), txHash: "ef".repeat(32), blockHeight: 1, recordedAt: new Date().toISOString() }));
    let rejected = false, networkChecks = 0;
    try { await account.restoreBackup(file, "BackupControl123!", async () => { networkChecks++; }); } catch { rejected = true; }
    return { aborted, unchanged, rejected, networkChecks, retainedReceipts: account.snapshot().receipts.length };
  });
  expect(result).toEqual({ aborted: true, unchanged: true, rejected: true, networkChecks: 0, retainedReceipts: 1 });
});
