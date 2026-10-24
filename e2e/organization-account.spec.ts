import { expect, test, type Page } from "@playwright/test";
import { bech32m } from "@scure/base";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { EXPIRED_OPENING, EXPIRED_OPENING_TRANSACTION_IDS } from "../src/lib/organization/expired-opening-policy.ts";
import { EXPIRED_DISABLE } from "../src/lib/organization/expired-disable-policy.ts";
import { EXPIRED_COMPENSATION } from "../src/lib/organization/expired-compensation-policy.ts";
import { EXPIRED_QUOTE } from "../src/lib/organization/expired-quote-policy.ts";
import { quoteCandidateFixture } from "../tests/fixtures/organization-quote.ts";
import { compensationCandidateFixture } from "../tests/fixtures/organization-compensation.ts";
import { candidateFixture } from "../tests/fixtures/organization-opening.ts";
import { disableCandidateFixture } from "../tests/fixtures/organization-disable.ts";
import { encodeVaultJson } from "../src/lib/security/vault.ts";
import * as ownershipLedger from "@midnight-ntwrk/ledger-v8";

async function wallets(page: Page, walletOnly = false, retiredReaders = false, identityRateLimit = false) {
  // CI has no developer provider credential; account tests must not borrow one.
  await page.route("**/api/line/network-session", route => route.fulfill({ status: 404, json: { error: "No developer credential in this test." } }));
  if (retiredReaders) await page.route("**/api/organization/network", route => {
    const indexerUri = new URL("/api/organization/network/indexer", route.request().url()).href;
    const indexerWsUri = new URL(indexerUri); indexerWsUri.protocol = indexerWsUri.protocol === "https:" ? "wss:" : "ws:"; indexerWsUri.pathname += "/ws";
    return route.fulfill({ json: { networkId: "preprod", indexerUri, indexerWsUri: indexerWsUri.href } });
  });
  const identity = (n: number) => ({ coin: bech32m.encodeFromBytes("mn_shield-cpk_preprod", new Uint8Array(32).fill(n)), encryption: bech32m.encodeFromBytes("mn_shield-epk_preprod", new Uint8Array(32).fill(n + 20)), receiving: bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(n + 40)) });
  // This suite tests browser custody and rejected approval, not supplier hosting.
  const sourceFingerprint = createHash("sha256").update(readFileSync(new URL("../contracts/organization/line.compact", import.meta.url))).digest("hex");
  await page.route("**/api/organization/catalog", route => route.fulfill({ json: {
    network: "preprod", assetColor: "0".repeat(64), decimals: 6, sourceFingerprint,
    hostedSupplierAutomation: !walletOnly,
    services: walletOnly ? [] : [{ id: "test-service", name: "Account test supplier", price: "25", description: "No fulfillment or settlement in this test.", profile: { name: "Account test supplier", publicKey: "11".repeat(32), address: identity(12).receiving } }],
  } }));
  await page.addInitScript(({ a, b, retiredReaders, identityRateLimit }) => {
    const target = window as unknown as { midnight: Record<string, unknown>; organizationSignatures: number; organizationProofRequests: number };
    target.organizationSignatures = 0;
    target.organizationProofRequests = 0;
    let identityReads = 0;
    target.midnight = Object.fromEntries([["a", a], ["b", b]].map(([id, keys]) => {
      const identity = keys as { coin: string; encryption: string; receiving: string };
      return [id as string, { name: `Organization wallet ${id}`, rdns: `test.org.${id}`, apiVersion: "4.0.1", connect: async () => ({
        getConfiguration: async () => ({ networkId: "preprod", indexerUri: retiredReaders ? "https://indexer.preprod.midnight.network/api/v3/graphql" : "https://indexer.example.test/graphql", indexerWsUri: retiredReaders ? "wss://indexer.preprod.midnight.network/api/v3/graphql/ws" : "wss://indexer.example.test/graphql/ws", substrateNodeUri: retiredReaders ? "https://rpc.preprod.midnight.network" : "https://node.example.test", proverServerUri: "http://127.0.0.1:6300" }),
        getShieldedAddresses: async () => {
          if (identityRateLimit && ++identityReads === 1) throw { code: 429, message: "Rate limited" };
          return { shieldedCoinPublicKey: identity.coin, shieldedEncryptionPublicKey: identity.encryption, shieldedAddress: "unused" };
        },
        getUnshieldedAddress: async () => ({ unshieldedAddress: identity.receiving }), getUnshieldedBalances: async () => ({}),
        getConnectionStatus: async () => ({ status: "connected", networkId: "preprod" }),
        getProvingProvider: async () => {
          target.organizationProofRequests++;
          return { check: async () => { throw new Error("Account-isolation tests do not check circuit preimages"); }, prove: async () => { throw new Error("Account-isolation tests do not produce circuit proofs"); } };
        },
        balanceUnsealedTransaction: async () => { target.organizationSignatures++; throw new Error("No payment is authorized by an account-isolation test"); },
        submitTransaction: async () => { throw new Error("Account-isolation tests never submit"); },
      }) }];
    }));
  }, { a: identity(11), b: identity(12), retiredReaders, identityRateLimit });
}
async function connect(page: Page, id: "a" | "b") {
  await page.locator("header").getByRole("button", { name: /^(Connect wallet|Manage connected wallet)$/ }).click();
  if (await page.getByRole("heading", { name: "Your wallet is connected.", exact: true }).isVisible()) {
    if (!(await page.getByRole("dialog").innerText()).includes(`Organization wallet ${id}`)) {
      await page.getByRole("button", { name: "Disconnect from Line", exact: true }).click();
      await page.getByRole("button", { name: `Organization wallet ${id}`, exact: true }).click();
    }
  } else await page.getByRole("button", { name: `Organization wallet ${id}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wallet is connected." })).toBeVisible();
  await page.getByRole("link", { name: "Continue to workspace" }).click();
}

for (const method of ["connect(preprod)", "getConfiguration"] as const) test(`connection diagnostics identify early ${method} failure without publishing an account`, async ({ page }) => {
  await wallets(page, true); await page.goto("/app");
  await page.evaluate(method => {
    const target = (window as any).midnight.a, original = target.connect;
    target.connect = async (...args: any[]) => {
      if (method === "connect(preprod)") throw { code: "InternalError", message: "Request failed", reason: "https://private.invalid/?token=redaction-control" };
      const api = await original(...args); api.getConfiguration = async () => { throw Error("Request failed"); }; return api;
    };
  }, method);
  await page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Organization wallet a", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Request failed");
  if (method === "connect(preprod)") {
    await expect(page.getByRole("alert")).toContainText("connector code InternalError");
    await expect(page.getByRole("dialog")).not.toContainText("private.invalid");
  }
  await page.getByText("Connection diagnostics", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`Connection stopped at ${method}.`);
  if (method === "getConfiguration") {
    await page.getByRole("button", { name: "Check connector reads", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("getConfiguration: failed", { timeout: 10_000 });
    await expect(page.getByRole("dialog")).toContainText("getConnectionStatus: passed", { timeout: 10_000 });
    await expect(page.getByRole("dialog")).toContainText("no verified connection to compare");
  } else await expect(page.getByRole("button", { name: "Check connector reads", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your wallet is connected.", exact: true })).toHaveCount(0);
});

for (const scenario of ["ready", "changed receiving wallet", "changed network", "expired signed bytes"] as const) test(`fresh signed submission preserves its wallet guard without duplicate post-balance reads: ${scenario}`, async ({ page }) => {
  const raw = readFileSync(new URL("../tests/fixtures/preprod-fees/confirmed-funded.bin", import.meta.url)).toString("hex");
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const result = await page.evaluate(async ({ raw, scenario }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { Transaction } = await import("/e2e/organization-provider.ts" as any);
    // Existing public fixture exercises transport/custody only, not this
    // release's proof validity or live chain acceptance. No wallet is contacted.
    const tx = Transaction.deserialize("signature", "proof", "binding", Uint8Array.from(raw.match(/../g)!.map(x => parseInt(x, 16))));
    const action = [...tx.intents!.values()].flatMap(i => i.actions)[0];
    const wallet = getConnectedWallet()!, account = await OrganizationAccount.unlock(wallet, "Organization123!");
    const client = await OrganizationNetwork.connect(account), events: string[] = [];
    const originalGuard = account.assertWallet.bind(account);
    account.assertWallet = async () => { events.push("check"); return originalGuard(); };
    wallet.balanceUnsealedTransaction = async () => {
      events.push("balance");
      if (scenario === "changed receiving wallet") wallet.getUnshieldedAddress = async () => ({ unshieldedAddress: "changed" });
      if (scenario === "changed network") wallet.getConnectionStatus = async () => ({ status: "connected", networkId: "preview" });
      return { tx: raw };
    };
    wallet.submitTransaction = async bytes => {
      events.push("submit");
      if (bytes !== raw || account.pending()?.transaction !== raw || account.pending()?.txId !== tx.identifiers().at(-1)) throw Error("Original bytes were not saved before submission");
    };
    let error = "";
    const now = Date.now;
    try {
      await account.exclusive(async () => {
        await account.prepare({ id: "fresh-submit", kind: "call", circuit: "fundReserve", facilityId: null, contractAddress: action.address, sourceFingerprint: (client as any).release.sourceFingerprint, after: account.snapshot(), txId: null, transaction: null });
        events.length = 0;
        // Pin time inside the old public fixture's signed validity window.
        if (scenario !== "expired signed bytes") Date.now = () => Math.min(...[...tx.intents!.values()].map(i => i.ttl.getTime())) - 1000;
        const balanced = await (client as any).providers.walletProvider.balanceTx(tx);
        await (client as any).providers.midnightProvider.submitTx(balanced);
      });
    } catch (failure) { error = (failure as Error).message; }
    finally { Date.now = now; }
    return { events, error, savedBytes: scenario === "ready" || scenario === "expired signed bytes" ? account.pending()?.transaction : undefined };
  }, { raw, scenario });
  if (scenario === "ready") expect(result).toMatchObject({ events: ["check", "balance", "check", "submit"], error: "", savedBytes: raw });
  else {
    expect(result.events).not.toContain("submit");
    expect(result.error).toMatch(scenario === "expired signed bytes" ? /expired.*reconciliation/i : scenario === "changed network" ? /preprod session/i : /wallet|address|account/i);
    if (scenario === "expired signed bytes") expect(result.savedBytes).toBe(raw);
  }
});

test("built-page refresh restores the organization without development module imports", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const before = await profile(page);
  await page.reload();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await profile(page)).toEqual(before);
});

test("an unavailable account code download offers reload instead of another password attempt", async ({ page }) => {
  await wallets(page, true, true);
  await page.route(/\/(?:src\/lib\/organization\/account\.ts|assets\/account-[^/]+\.js)(?:\?|$)/, route => route.abort());
  await page.goto("/app"); await connect(page, "a");
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reload the workspace to continue.", exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByLabel("Organization vault password", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh Line", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).not.toContainText("/assets/");
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

test("a failed account code download preserves the refresh session until the current code loads", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const before = await profile(page);
  const accountCode = /\/(?:src\/lib\/organization\/account\.ts|assets\/account-[^/]+\.js)(?:\?|$)/;
  await page.route(accountCode, route => route.abort()); await page.reload();
  await expect(page.getByRole("heading", { name: "Reload the workspace to continue.", exact: true })).toBeVisible();
  await page.unroute(accountCode);
  await page.getByRole("button", { name: "Refresh Line", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled();
  expect(await profile(page)).toEqual(before);
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

test("organization startup and refresh do not reread configuration after verifying the account", async ({ page }) => {
  await wallets(page, true, true);
  await page.addInitScript(() => {
    const target = (window as any).midnight.a, original = target.connect;
    target.connect = async (...args: any[]) => {
      const api = await original(...args), configuration = api.getConfiguration;
      (window as any).configurationReads = 0;
      api.getConfiguration = async () => {
        const allowed = sessionStorage.getItem("test-configuration-restoring") ? 1 : 2;
        if (++(window as any).configurationReads > allowed) throw Error("Request failed");
        return configuration();
      };
      return api;
    };
  });
  await page.goto("/app"); await connect(page, "a");
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled({ timeout: 8_000 });
  expect(await page.evaluate(() => (window as any).configurationReads)).toBe(2);
  await page.evaluate(() => sessionStorage.setItem("test-configuration-restoring", "yes"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).configurationReads)).toBe(1);
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

test("organization refresh retains its HTTP sign-in without asking the wallet to sign again", async ({ page }) => {
  await wallets(page, true, true);
  await page.route("**/api/organization/catalog", route => route.fulfill({ json: { network: "preprod", services: [], walletAuthentication: "required", hostedSupplierAutomation: false } }));
  const origin = test.info().project.use.baseURL as string;
  await page.context().addCookies([{ name: "line_session", value: "fixture-http-only-session", url: origin, httpOnly: true, sameSite: "Strict" }]);
  let resumed = 0;
  await page.route("**/api/organization/auth/session", route => {
    expect(route.request().headers().cookie).toContain("line_session=fixture-http-only-session");
    expect(route.request().headers()["x-line-wallet"]).toBeTruthy();
    resumed++;
    return route.fulfill({ json: { authenticated: true, expiresAt: Date.now() + 25 * 60_000 } });
  });
  // This fixture implements no signData method. A redundant sign-in therefore
  // prevents the actual network setup from completing instead of passing silently.
  await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const before = await profile(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled();
  expect(await profile(page)).toEqual(before);
  expect(resumed).toBe(2);
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

for (const failedRead of [2, 3]) test(`refresh keeps the organization session when wallet status read ${failedRead} is rate limited`, async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const before = await profile(page);
  await page.addInitScript(failedRead => {
    const target = (window as any).midnight.a, original = target.connect;
    target.connect = async (...args: any[]) => {
      const api = await original(...args); let reads = 0;
      api.getConnectionStatus = async () => {
        if (++reads >= failedRead && !sessionStorage.getItem("test-status-recovered")) throw { code: 429, message: "Rate limited" };
        return { status: "connected", networkId: "preprod" };
      };
      return api;
    };
  }, failedRead);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(/rate limited/i);
  await expect(page.getByLabel("Organization vault password", { exact: true })).toHaveCount(0);
  if (failedRead === 3) {
    await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Encrypted backup", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("line-organization-backup.json");
  }
  await page.evaluate(() => sessionStorage.setItem("test-status-recovered", "yes"));
  await page.getByRole("button", { name: "Retry wallet checks", exact: true }).click();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
  expect(await profile(page)).toEqual(before);
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

test("same-tab refresh restores the organization in memory and manual lock survives refresh", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const before = await profile(page);
  const deadline = await page.evaluate(async () => { const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any); const vault = await import(browserModuleUrl("/src/lib/security/vault.ts")); return vault.getVaultSessionExpiresAt(); });
  await page.reload();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await profile(page)).toEqual(before);
  expect(await page.evaluate(async () => { const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any); const vault = await import(browserModuleUrl("/src/lib/security/vault.ts")); return vault.getVaultSessionExpiresAt(); })).toBe(deadline);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain("Organization123!"); expect(storage).not.toContain("issuerSecret");
  await page.getByRole("button", { name: "Lock organization", exact: true }).click(); await page.reload();
  await expect(page.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
});

test("refresh retains the exact signed pending operation and private candidate without resubmission", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const retained = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { encodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const candidate = account.snapshot();
    await account.prepare({ id: "refresh-synthetic-opening", kind: "call", circuit: "openLine", facilityId: null, contractAddress: "ab".repeat(32), sourceFingerprint: "cd".repeat(32), after: candidate, txId: null, transaction: null });
    await account.submitted("ef".repeat(32), "a1b2c3d4", "ab".repeat(32));
    return { accountId: account.accountId, pending: encodeVaultJson(account.pending()) };
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
  const durable = await page.evaluate(async accountId => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { loadEncryptedJson, getVaultSessionPassphrase, encodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const record = await loadEncryptedJson(`line:organization:preprod:${accountId}`, getVaultSessionPassphrase()!);
    return { pending: encodeVaultJson(record.pending), signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests };
  }, retained.accountId);
  expect(durable).toEqual({ pending: retained.pending, signatures: 0, proofs: 0 });
});

test("a changed shielded account cannot restore the original organization after refresh", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.addInitScript(() => {
    const target = (window as any).midnight.a, original = target.connect;
    target.connect = async (...args: any[]) => { const api = await original(...args); api.getShieldedAddresses = async () => ((await (window as any).midnight.b.connect("preprod")).getShieldedAddresses()); return api; };
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved tab session no longer matches this wallet");
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("line:organization-tab:v1"))).toBeNull();
});

test("an expired organization session stays locked after refresh", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.addInitScript(() => { const now = Date.now; Date.now = () => now() + 13 * 60 * 60 * 1000; });
  await page.reload();
  await expect(page.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
});

test("a duplicated tab cannot inherit or revoke the original tab’s organization session", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const duplicateEvent = page.waitForEvent("popup");
  await page.evaluate(() => window.open("about:blank", "_blank"));
  const duplicate = await duplicateEvent;
  try {
    await wallets(duplicate, true, true); await duplicate.goto("/app");
    await expect(duplicate.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
    await duplicate.reload();
    await expect(duplicate.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
    await expect(duplicate.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
  } finally { await duplicate.close(); }
});

test("an unavailable memory session holder keeps the organization locked after refresh", async ({ page }) => {
  await wallets(page, true, true);
  await page.addInitScript(() => Object.defineProperty(window, "SharedWorker", { configurable: true, value: undefined }));
  await page.goto("/app"); await connect(page, "a"); await unlock(page);
  expect(await page.evaluate(() => sessionStorage.getItem("line:organization-tab:v1"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
});

test("a copied tab ticket cannot restore after the original tab closes", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const popup = page.waitForEvent("popup"); await page.evaluate(() => window.open("about:blank", "_blank"));
  const duplicate = await popup;
  try {
    await wallets(duplicate, true, true); await duplicate.goto("/app");
    await expect(duplicate.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
    await page.close(); await duplicate.reload();
    await expect(duplicate.getByLabel("Organization vault password", { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(duplicate.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  } finally { await duplicate.close(); }
});

test("disconnect during a pending refresh lease cannot recreate the saved tab ticket", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.addInitScript(() => {
    const original = navigator.locks.request.bind(navigator.locks); let delayed = false;
    navigator.locks.request = ((name: string, ...args: any[]) => {
      if (name.startsWith("line:organization-tab:") && !delayed) {
        delayed = true;
        const callback = args[args.length - 1];
        args[args.length - 1] = (lock: Lock | null) => { (window as any).tabLeaseDelivered = true; return callback(lock); };
        return new Promise((resolve, reject) => { (window as any).releaseTabLease = () => { void (original as any)(name, ...args).then(resolve, reject); }; });
      }
      return (original as any)(name, ...args);
    }) as typeof navigator.locks.request;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseTabLease)).toBe("function");
  await page.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect from Line", exact: true }).click();
  await page.evaluate(() => (window as any).releaseTabLease());
  await expect.poll(() => page.evaluate(() => (window as any).tabLeaseDelivered)).toBe(true);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("line:organization-tab:v1"))).toBeNull();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("banner").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
});

test("manual lock excludes copied tickets until the memory holder acknowledges revocation", async ({ page }) => {
  await wallets(page, true, true);
  await page.addInitScript(() => {
    const Native = SharedWorker;
    (window as any).SharedWorker = class extends Native {
      constructor(...args: ConstructorParameters<typeof SharedWorker>) {
        super(...args); const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = ((message: any, ...rest: any[]) => {
          if (message?.operation === "forget") setTimeout(() => { (send as any)(message, ...rest); (window as any).revocationDelivered = true; }, 2000);
          else (send as any)(message, ...rest);
        }) as typeof this.port.postMessage;
      }
    };
  });
  await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const popup = page.waitForEvent("popup"); await page.evaluate(() => window.open("about:blank", "_blank")); const duplicate = await popup;
  try {
    await wallets(duplicate, true, true); await duplicate.goto("/app");
    await expect(duplicate.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lock organization", exact: true }).click();
    await duplicate.reload();
    await expect.poll(() => page.evaluate(() => (window as any).revocationDelivered)).toBe(true);
    await expect(duplicate.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  } finally { await duplicate.close(); }
});

test("a new browser context cannot restore an organization from saved storage without its password", async ({ page, browser }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const original = await profile(page), state = await page.context().storageState({ indexedDB: true });
  const tabStorage = await page.evaluate(() => ({ ...sessionStorage }));
  const fresh = await browser.newContext({ storageState: state });
  try {
    await fresh.addInitScript(values => { for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value); }, tabStorage);
    const restored = await fresh.newPage(); await wallets(restored, true, true); await restored.goto("/app");
    await expect(restored.getByRole("banner").getByRole("button", { name: "Manage connected wallet", exact: true })).toBeVisible();
    await expect(restored.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
    await restored.reload();
    await expect(restored.getByLabel("Organization vault password", { exact: true })).toBeVisible();
    await expect(restored.locator(".network-status")).toHaveCount(0);
    await expect(restored.getByRole("alert")).toHaveCount(0);
    await unlock(restored); expect(await profile(restored)).toEqual(original);
  } finally { await fresh.close(); }
});

test("browser replays the canonical opening action against its exact retained private candidate", async ({ page }) => {
  const f = await candidateFixture();
  await page.goto("/app");
  const result = await page.evaluate(async ({ encoded, state, fingerprint }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { ContractState } = await import("/e2e/organization-provider.ts" as any);
    const { decodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { validateOpeningCandidate } = await import(browserModuleUrl("/src/lib/organization/expired-opening.ts"));
    const { before, pending } = decodeVaultJson(encoded) as any, predecessor = ContractState.deserialize(Uint8Array.from(state));
    const ttl = validateOpeningCandidate(before, pending, predecessor, fingerprint);
    pending.after.facilities[0].salt = "cc".repeat(32);
    let changedRejected = false; try { validateOpeningCandidate(before, pending, predecessor, fingerprint); } catch { changedRejected = true; }
    return { ttl, changedRejected };
  }, { encoded: encodeVaultJson({ before: f.before, pending: f.pending }), state: [...f.predecessor.serialize()], fingerprint: EXPIRED_OPENING.sourceFingerprint });
  expect(result).toEqual({ ttl: 4600_000, changedRejected: true });
});

test("browser replays the canonical disable action against its exact retained private candidate", async ({ page }) => {
  const f = await disableCandidateFixture();
  await page.goto("/app");
  const result = await page.evaluate(async ({ encoded, state, fingerprint }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { ContractState } = await import("/e2e/organization-provider.ts" as any);
    const { decodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { validateDisableCandidate } = await import(browserModuleUrl("/src/lib/organization/expired-disable.ts"));
    const { before, pending } = decodeVaultJson(encoded) as any, predecessor = ContractState.deserialize(Uint8Array.from(state));
    const ttl = validateDisableCandidate(before, pending, predecessor, fingerprint);
    pending.after.facilities[0].merchants[1].disabled = false;
    let changedRejected = false; try { validateDisableCandidate(before, pending, predecessor, fingerprint); } catch { changedRejected = true; }
    return { ttl, changedRejected };
  }, { encoded: encodeVaultJson({ before: f.before, pending: f.pending }), state: [...f.predecessor.serialize()], fingerprint: EXPIRED_DISABLE.sourceFingerprint });
  expect(result).toEqual({ ttl: 4600_000, changedRejected: true });
});

test("browser replays compensation against its exact retained claim and private candidate", async ({ page }) => {
  const f = await compensationCandidateFixture();
  await page.goto("/app");
  const result = await page.evaluate(async ({ encoded, state, fingerprint, target }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { ContractState } = await import("/e2e/organization-provider.ts" as any);
    const { decodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { validateCompensationCandidate } = await import(browserModuleUrl("/src/lib/organization/expired-compensation.ts"));
    const { before, pending } = decodeVaultJson(encoded) as any, predecessor = ContractState.deserialize(Uint8Array.from(state));
    const ttl = validateCompensationCandidate(before, pending, predecessor, fingerprint, target);
    pending.after.notes[0].refund.salt = "cc".repeat(32);
    let changedRejected = false;
    try { validateCompensationCandidate(before, pending, predecessor, fingerprint, target); } catch { changedRejected = true; }
    return { ttl, changedRejected };
  }, { encoded: encodeVaultJson({ before: f.before, pending: f.pending }), state: [...f.predecessor.serialize()], fingerprint: f.pending.sourceFingerprint, target: f.target });
  expect(result).toEqual({ ttl: 4600_000, changedRejected: true });
});

test("browser replays a merchant quote against its exact retained merchant candidate", async ({ page }) => {
  const f = await quoteCandidateFixture();
  await page.goto("/app");
  const result = await page.evaluate(async ({ encoded, state, fingerprint }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { ContractState } = await import("/e2e/organization-provider.ts" as any);
    const { decodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { validateQuoteCandidate } = await import(browserModuleUrl("/src/lib/organization/expired-quote.ts"));
    const { before, pending } = decodeVaultJson(encoded) as any, predecessor = ContractState.deserialize(Uint8Array.from(state));
    const ttl = validateQuoteCandidate(before, pending, predecessor, fingerprint);
    pending.after.quotes.at(-1).quoteNonce = "cc".repeat(32);
    let changedRejected = false;
    try { validateQuoteCandidate(before, pending, predecessor, fingerprint); } catch { changedRejected = true; }
    return { ttl, changedRejected };
  }, { encoded: encodeVaultJson({ before: f.before, pending: f.pending }), state: [...f.predecessor.serialize()], fingerprint: f.pending.sourceFingerprint });
  expect(result).toEqual({ ttl: 4600_000, changedRejected: true });
});

const openingPolicy = EXPIRED_OPENING;
for (const scopedOpening of [
  ...EXPIRED_OPENING_TRANSACTION_IDS.map((txId, index) => ({ ...EXPIRED_OPENING, txId, circuit: "openLine", priorIds: EXPIRED_OPENING_TRANSACTION_IDS.slice(0, index) })),
  { ...EXPIRED_DISABLE, circuit: "disableMerchant", priorIds: [...EXPIRED_OPENING_TRANSACTION_IDS] },
  { ...EXPIRED_COMPENSATION, circuit: "cancelOrExpireNote", priorIds: [...EXPIRED_OPENING_TRANSACTION_IDS, EXPIRED_DISABLE.txId] },
  { ...EXPIRED_QUOTE, circuit: "postQuote", priorIds: [] },
]) {
const EXPIRED_OPENING = scopedOpening;
const disabling = scopedOpening.circuit === "disableMerchant", compensating = scopedOpening.circuit === "cancelOrExpireNote", quoting = scopedOpening.circuit === "postQuote";
const laterCheckpoint = disabling || compensating || quoting;
const expectedHistory = scopedOpening.priorIds.length + 1;
test(`expired ${quoting ? "merchant quote" : compensating ? "claim compensation" : disabling ? "merchant disable" : "opening"} ${scopedOpening.txId.slice(0, 8)} recovery is atomic, rejects stale reviews and retains encrypted history through every commit and restore`, async ({ page }) => {
  test.setTimeout(120_000);
  const state = readFileSync(new URL(quoting ? "../tests/fixtures/organization-compensated-state.hex" : laterCheckpoint ? "../tests/fixtures/organization-merchant2-draw-state.hex" : "../tests/fixtures/organization-closed-state.hex", import.meta.url), "utf8");
  const L = await import("@midnight-ntwrk/ledger-v8"), checkpoint = L.ContractState.deserialize(Buffer.from(state, "hex"));
  const verifierKeys = Object.fromEntries(checkpoint.operations().map(name => [String(name), [...checkpoint.operation(name)!.verifierKey]]));
  const evidence = { schema: quoting ? "line:expired-quote-evidence/v1" : compensating ? "line:expired-compensation-evidence/v1" : disabling ? "line:expired-disable-evidence/v1" : "line:expired-opening-evidence/v1", address: EXPIRED_OPENING.address, genesisHash: EXPIRED_OPENING.genesisHash, runtimeSpecVersion: EXPIRED_OPENING.runtimeSpecVersion,
    baseline: { hash: EXPIRED_OPENING.baselineHash, height: EXPIRED_OPENING.baselineHeight, state }, finalized: { hash: "aa".repeat(32), height: quoting ? 3105000 : laterCheckpoint ? 3104000 : 3077281, timestamp: quoting ? 1792764600000 : laterCheckpoint ? 1792760400000 : 1792598700000, state } };
  const closed = readFileSync(new URL("../tests/fixtures/organization-closed-state.hex", import.meta.url), "utf8");
  const openingEvidence = { schema: "line:expired-opening-evidence/v1", address: openingPolicy.address, genesisHash: openingPolicy.genesisHash, runtimeSpecVersion: openingPolicy.runtimeSpecVersion,
    baseline: { hash: openingPolicy.baselineHash, height: openingPolicy.baselineHeight, state: closed }, finalized: { hash: "bb".repeat(32), height: 3077281, timestamp: 1792598700000, state: closed } };
  const recoveryPath = `**/api/organization/network/${quoting ? "expired-quote" : compensating ? "expired-compensation" : disabling ? "expired-disable" : "expired-opening"}`;
  await wallets(page, true, true);
  await page.route(recoveryPath, route => route.fulfill({ json: evidence }));
  await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async ({ policy, verifierKeys, laterCheckpoint, openingEvidence, disableId, evidence }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { validateExpiredOpeningEvidence } = await import(browserModuleUrl("/src/lib/organization/expired-opening.ts"));
    const { validateExpiredDisableEvidence } = await import(browserModuleUrl("/src/lib/organization/expired-disable.ts"));
    const { validateExpiredCompensationEvidence } = await import(browserModuleUrl("/src/lib/organization/expired-compensation.ts"));
    const { validateExpiredQuoteEvidence } = await import(browserModuleUrl("/src/lib/organization/expired-quote.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    // Controlled candidate-verification seam: the unit test separately replays
    // generated opening transcripts. This browser case tests actual encryption,
    // locks, durable reload, UI review and account commits, not a chain proof.
    for (const [method, validate] of [["verifyExpiredOpening", validateExpiredOpeningEvidence], ["verifyExpiredDisable", validateExpiredDisableEvidence], ["verifyExpiredCompensation", validateExpiredCompensationEvidence], ["verifyExpiredQuote", validateExpiredQuoteEvidence]] as const) {
      (OrganizationNetwork.prototype as any)[method] = async function (_before: unknown, pending: any, evidence: any) {
        (window as any).expiryAccount = this.account;
        if (![policy.txId, ...policy.priorIds].includes(pending.txId) || pending.transaction !== "abcd") throw Error("Fixture original changed");
        await validate(evidence, async (name: string) => Uint8Array.from(verifierKeys[name]));
        return { evidence, ttl: 1792500000000 };
      };
    }
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    await account.exclusive(async () => {
      for (const previousTxId of policy.priorIds) {
        // Model the owner's first archive before the newer opening. The same
        // controlled candidate seam applies; all encryption/commits are real.
        await account.prepare({ id: "previous-opening", kind: "call", circuit: previousTxId === disableId ? "disableMerchant" : "openLine", facilityId: null, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint, after: account.snapshot(), txId: null, transaction: null });
        await account.submitted(previousTxId, "abcd", policy.address);
        if (previousTxId === disableId) await account.archiveExpiredDisable(account.pending()!, { ...evidence, schema: "line:expired-disable-evidence/v1" } as any, 1792500000000);
        else await account.archiveExpiredOpening(account.pending()!, openingEvidence as any, 1792500000000);
      }
      const candidate = account.snapshot(); if (laterCheckpoint) candidate.serviceOrders = [];
      await account.prepare({ id: "expired-operation", kind: "call", circuit: policy.circuit as any, facilityId: null, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint, after: candidate, txId: null, transaction: null });
      await account.submitted(policy.txId, "abcd", policy.address);
    });
  }, { policy: EXPIRED_OPENING, verifierKeys, laterCheckpoint, openingEvidence, disableId: EXPIRED_DISABLE.txId, evidence });
  const reopen = async () => {
    await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
    await page.getByRole("button", { name: "Open organization", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your wallet and organization contract release are ready" })).toBeVisible();
  };
  await reopen();
  const review = page.getByRole("button", { name: quoting ? "Review expired quote recovery" : compensating ? "Review expired claim recovery" : disabling ? "Review expired merchant disable recovery" : "Review expired opening recovery", exact: true });
  const archive = page.getByRole("button", { name: "Archive original with evidence", exact: true });
  await expect(review).toBeVisible();
  await review.click(); await expect(page.getByRole("dialog")).toContainText(evidence.finalized.height.toLocaleString("en-US"));
  if (laterCheckpoint) {
    await page.unroute(recoveryPath);
    await page.route(recoveryPath, route => route.fulfill({ json: { ...evidence, finalized: { ...evidence.finalized, height: evidence.finalized.height - 1 } } }));
    await archive.click(); await expect(page.getByRole("alert")).toContainText("checkpoint moved backwards");
    await expect(review).toBeVisible();
    await page.unroute(recoveryPath); await page.route(recoveryPath, route => route.fulfill({ json: evidence }));
    await review.click(); await expect(archive).toBeVisible();
  }
  await page.evaluate(() => {
    (window as any).expiryPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) { const request = (window as any).expiryPut.apply(this, args); request.addEventListener("success", () => this.transaction.abort(), { once: true }); return request; };
  });
  await archive.click(); await expect(page.getByRole("alert")).toContainText("Encrypted storage transaction did not commit");
  await expect(review).toBeVisible();
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).expiryPut; });
  await review.click(); await expect(archive).toBeVisible();
  await page.evaluate(async () => {
    const account = (window as any).expiryAccount;
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const vault = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const key = organizationAccountKey("preprod", account.accountId);
    const record = await vault.loadEncryptedJson(key, "Organization123!"); record.pending.id = "changed-by-another-tab";
    await vault.saveEncryptedJson(key, record, "Organization123!");
  });
  await archive.click(); await expect(page.getByRole("alert")).toContainText("saved operation or recovery review changed");
  await review.click(); await expect(archive).toBeVisible();
  await page.evaluate(() => {
    const wallet = (window as any).expiryAccount.wallet;
    (window as any).expiryStatus = wallet.getConnectionStatus;
    wallet.getConnectionStatus = async () => ({ status: "connected", networkId: "preview" });
  });
  await archive.click(); await expect(page.getByRole("alert")).toContainText("preprod session");
  await page.evaluate(() => { (window as any).expiryAccount.wallet.getConnectionStatus = (window as any).expiryStatus; });
  await review.click(); await expect(archive).toBeVisible(); await archive.click();
  await expect(page.getByRole("status")).toContainText(quoting ? "Expired merchant quote archived with provider-backed nonapplication evidence" : compensating ? "Expired claim compensation archived with provider-backed nonapplication evidence" : disabling ? "Expired merchant disable archived with provider-backed nonapplication evidence" : "Expired opening archived with provider-backed nonapplication evidence");
  await expect(review).toHaveCount(0);
  await expect(page.getByText(`Expired operation recovery history (${expectedHistory})`, { exact: true })).toBeVisible();
  const result = await page.evaluate(async ({ policy, expectedHistory }) => {
    const account = (window as any).expiryAccount;
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { decodeOrganizationBackup } = await import(browserModuleUrl("/src/lib/organization/backup.ts"));
    const key = organizationAccountKey("preprod", account.accountId);
    const prepare = (id: string) => account.prepare({ id, kind: "key", circuit: "draw", facilityId: null, contractAddress: policy.address, sourceFingerprint: policy.sourceFingerprint, after: account.snapshot(), txId: null, transaction: null });
    const candidatePromoted = account.snapshot().serviceOrders !== undefined;
    await account.edit((snapshot: any) => { snapshot.serviceOrders = []; });
    await account.exclusive(async () => { await prepare("discard"); await account.discardUnsubmitted(); });
    for (const [id, finish] of [["aa", "complete"], ["bb", "rejectFinalized"]]) await account.exclusive(async () => {
      await prepare(id); const txId = "00" + id.repeat(32); await account.submitted(txId, "abcd", policy.address);
      await account[finish]({ kind: "key", circuit: "draw", contractAddress: policy.address, txId, txHash: id.repeat(32), blockHeight: 321, recordedAt: new Date().toISOString() });
    });
    const backup = JSON.stringify(await account.encryptedBackup());
    const record = await decodeOrganizationBackup(backup, "Organization123!", key, account.accountId);
    // A fresh, disposable browser account is the restore target.
    const { removeEncryptedSecret } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    await removeEncryptedSecret(key);
    const restored = await OrganizationAccount.unlock(account.wallet, "Organization123!");
    const restoredNetwork = await OrganizationNetwork.connect(restored);
    await restoredNetwork.restoreBackup(backup, "Organization123!");
    const roundTrip = await decodeOrganizationBackup(JSON.stringify(await restored.encryptedBackup()), "Organization123!", key, restored.accountId);
    return { candidatePromoted, pending: roundTrip.pending, count: roundTrip.recoveries!.length, txId: roundTrip.recoveries!.at(-1)!.original.txId, txIds: roundTrip.recoveries!.map(entry => entry.original.txId), bytes: roundTrip.recoveries!.at(-1)!.original.transaction, evidence: roundTrip.recoveries!.at(-1)!.evidence, sameArchive: JSON.stringify(roundTrip.recoveries, (_key, v) => typeof v === "bigint" ? v.toString() : v) === JSON.stringify(record.recoveries, (_key, v) => typeof v === "bigint" ? v.toString() : v), receipts: roundTrip.snapshot.receipts.length, failures: roundTrip.snapshot.failures?.length, proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures };
  }, { policy: EXPIRED_OPENING, expectedHistory });
  expect(result).toMatchObject({ pending: null, count: expectedHistory, txId: EXPIRED_OPENING.txId, txIds: [...scopedOpening.priorIds, scopedOpening.txId], candidatePromoted: false, bytes: "abcd", evidence, sameArchive: true, receipts: 1, failures: 1, proofs: 0, signatures: 0 });
  await reopen();
  await expect(page.getByText(`Expired operation recovery history (${expectedHistory})`, { exact: true })).toBeVisible();
});
}

test("the exact expired merchant disable offers evidence review while retaining the signed operation", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    await account.exclusive(async () => {
      await account.prepare({ id: "expired-disable", kind: "call", circuit: "disableMerchant", facilityId: null, contractAddress: "ab428f74f8a8e72dc66a2f521c932d97860525d848a4d7a3acf0c795b3ef7e73", sourceFingerprint: "057aa57267c0b8afd537cfb8950946db99bda45954a259c521877bdbb23e5157", after: account.snapshot(), txId: null, transaction: null });
      await account.submitted("0054af76ef4d913f967d607a266633d5fb6c7d6db18b79b4ddb7c6d9158649cce6", "abcd", "ab428f74f8a8e72dc66a2f521c932d97860525d848a4d7a3acf0c795b3ef7e73");
    });
  });
  await unlock(page);
  await expect(page.getByRole("button", { name: "Review expired merchant disable recovery", exact: true })).toBeVisible();
  await expect(page.getByText(/disableMerchant.*0054af76/)).toBeVisible();
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

test("explicit resubmission retains the original signed bytes without another proof or balance request", async ({ page }) => {
  test.setTimeout(120_000);
  const reopenPending = async () => {
    await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
    await page.getByRole("button", { name: "Open organization", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your wallet and organization contract release are ready" })).toBeVisible();
  };
  const L = await import("@midnight-ntwrk/ledger-v8");
  // Serialization fixture only; it is not a signed network-valid maintenance approval.
  const address = "ab".repeat(32), intent = L.Intent.new(new Date(Date.now() + 3600_000));
  const unproven = L.Transaction.fromParts("preprod", undefined, undefined, intent.addMaintenanceUpdate(new L.MaintenanceUpdate(address, [], 0n)));
  const unexpected = async () => { throw Error("No circuit proof is needed for this serialization fixture"); };
  const signed = (await unproven.prove({ check: unexpected, prove: unexpected }, L.CostModel.initialCostModel())).bind();
  const transaction = Buffer.from(signed.serialize()).toString("hex"), txId = signed.identifiers().at(-1)!;
  const sourceFingerprint = createHash("sha256").update(readFileSync(new URL("../contracts/organization/line.compact", import.meta.url))).digest("hex");
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async ({ address, transaction, txId, sourceFingerprint }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const wallet = getConnectedWallet()!;
    (window as any).originalSubmissionBytes = [];
    wallet.submitTransaction = async (bytes: string) => {
      (window as any).originalSubmissionBytes.push(bytes);
      throw Error("Operation failed: Transaction is temporarily banned");
    };
    const account = await OrganizationAccount.unlock(wallet, "Organization123!");
    (window as any).diagnosticsAccount = account;
    await account.exclusive(async () => {
      await account.prepare({ id: "original-maintenance", kind: "key", circuit: "draw", facilityId: null, contractAddress: address, sourceFingerprint, after: account.snapshot(), txId: null, transaction: null });
      await account.submitted(txId, transaction, address);
    });
  }, { address, transaction, txId, sourceFingerprint });
  await reopenPending();
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).originalSubmissionBytes)).toEqual([]);
  const details = page.getByRole("button", { name: "Inspect saved transaction", exact: true });
  await expect(details).toBeVisible();
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const originalDetails = OrganizationNetwork.prototype.savedSubmissionDetails;
    (OrganizationNetwork.prototype as any).savedSubmissionDetails = function (this: any) {
      (window as any).diagnosticsAccount = this.account;
      return originalDetails.call(this);
    };
    const target = window as any, wallet = target.diagnosticsAccount.wallet;
    target.diagnosticsReads = 0; target.diagnosticsWrites = 0;
    target.diagnosticsMethods = Object.fromEntries(["getConfiguration", "getConnectionStatus", "getShieldedAddresses", "getUnshieldedAddress"].map(name => [name, wallet[name]]));
    for (const name of Object.keys(target.diagnosticsMethods)) wallet[name] = async () => { target.diagnosticsReads++; throw Error("No wallet read is authorized for diagnostics"); };
    target.diagnosticsPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { target.diagnosticsWrites++; throw Error("Diagnostics cannot mutate encrypted storage"); };
  });
  await details.click();
  const detailDialog = page.getByRole("dialog", { name: "Saved transaction details", exact: true });
  await expect(detailDialog).toContainText("Signed intent 1 TTL:");
  await expect(detailDialog).toContainText([...signed.intents!.values()][0].ttl.toISOString());
  const diagnosticDownload = page.waitForEvent("download");
  await detailDialog.getByRole("button", { name: "Download submission diagnostics", exact: true }).click();
  const downloaded = await diagnosticDownload;
  expect(downloaded.suggestedFilename()).toBe("line-submission-diagnostics.json");
  const report = JSON.parse(readFileSync((await downloaded.path())!, "utf8"));
  expect(report).toMatchObject({ schema: "line:organization-submission-diagnostics/v1", operationId: "original-maintenance", identifier: txId, transaction, sourceFingerprint });
  expect(report).not.toHaveProperty("after"); expect(report).not.toHaveProperty("before");
  const inspection = await page.evaluate(() => {
    const target = window as any, account = target.diagnosticsAccount;
    return { reads: target.diagnosticsReads, writes: target.diagnosticsWrites, pendingBytes: account.pending().transaction, issuer: account.snapshot().issuerSecret, merchant: account.snapshot().merchantSecret, submissions: target.originalSubmissionBytes, proof: target.organizationProofRequests, signatures: target.organizationSignatures };
  });
  expect(JSON.stringify(report)).not.toContain(inspection.issuer); expect(JSON.stringify(report)).not.toContain(inspection.merchant);
  expect(inspection).toMatchObject({ reads: 0, writes: 0, pendingBytes: transaction, submissions: [], proof: 0, signatures: 0 });
  await detailDialog.getByRole("button", { name: "Close details", exact: true }).click();
  await expect(details).toBeFocused();
  await page.evaluate(() => {
    const target = window as any;
    IDBObjectStore.prototype.put = target.diagnosticsPut;
    Object.assign(target.diagnosticsAccount.wallet, target.diagnosticsMethods);
  });
  const retry = page.getByRole("button", { name: "Retry original submission", exact: true });
  await expect(retry).toBeVisible({ timeout: 5000 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await retry.click();
  await expect(page.getByRole("dialog")).toContainText("same signed bytes");
  expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => (window as any).originalSubmissionBytes)).toEqual([]);
  await page.getByRole("button", { name: "Resubmit same signed transaction", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Transaction is temporarily banned");
  await expect(page.getByText(new RegExp(txId))).toBeVisible();
  expect(await page.evaluate(() => ({ bytes: (window as any).originalSubmissionBytes, signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests }))).toEqual({ bytes: [transaction], signatures: 0, proofs: 0 });
  await page.getByRole("button", { name: "Lock organization", exact: true }).click(); await reopenPending();
  await expect(page.getByText(new RegExp(txId))).toBeVisible();
  expect(await page.evaluate(() => (window as any).originalSubmissionBytes)).toEqual([transaction]);
  const staleReview = await page.evaluate(async ({ txId }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    let submissions = 0, checks = 0;
    const client = { account: {
      exclusive: async (action: () => Promise<void>) => { checks++; return action(); },
      pending: () => ({ id: "different-operation", txId }),
      wallet: { submitTransaction: async () => { submissions++; } },
    } };
    let rejected = false;
    try { await OrganizationNetwork.prototype.resubmitOriginal.call(client as any, { operationId: "reviewed-operation", txId }); }
    catch (error) { rejected = /saved operation changed/i.test((error as Error).message); }
    return { rejected, submissions, checks };
  }, { txId });
  expect(staleReview).toEqual({ rejected: true, submissions: 0, checks: 1 });
  await page.evaluate(async ({ txId }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    getConnectedWallet()!.submitTransaction = async (bytes: string) => { (window as any).originalSubmissionBytes.push(bytes); };
    // Controlled receipt seam verifies durable promotion only, not network acceptance.
    (OrganizationNetwork.prototype as any).tx = () => ({ finality: {
      wait: async (id: string) => {
        if (id !== txId) throw Error("A replacement transaction was observed");
        return { identifiers: [txId], blockHeight: 321, txHash: "ee".repeat(32), status: "SucceedEntirely" };
      }, forget: () => {},
    } });
  }, { txId });
  await page.getByRole("button", { name: "Retry original submission", exact: true }).click();
  await page.getByRole("button", { name: "Resubmit same signed transaction", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Confirmed on Midnight Preprod");
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  await expect(page.getByText("1 finalized transactions", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ bytes: (window as any).originalSubmissionBytes, signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests }))).toEqual({ bytes: [transaction, transaction], signatures: 0, proofs: 0 });
  await page.getByRole("button", { name: "Lock organization", exact: true }).click(); await reopenPending();
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  await expect(page.getByText("1 finalized transactions", { exact: true })).toBeVisible();
});
for (const outcome of ["SucceedEntirely", "FailEntirely"]) test(`expired signed operations survive retry, backup and reopen until exact ${outcome} reconciliation`, async ({ page }) => {
  test.setTimeout(120_000);
  const L = await import("@midnight-ntwrk/ledger-v8");
  // Expired serialization fixture, not a network-valid maintenance approval.
  // Controlled finality below tests reconciliation, not live network acceptance.
  const address = "ab".repeat(32), intent = L.Intent.new(new Date(Date.now() - 60_000));
  const unproven = L.Transaction.fromParts("preprod", undefined, undefined, intent.addMaintenanceUpdate(new L.MaintenanceUpdate(address, [], 0n)));
  const unexpected = async () => { throw Error("No circuit proof is needed for this serialization fixture"); };
  const signed = (await unproven.prove({ check: unexpected, prove: unexpected }, L.CostModel.initialCostModel())).bind();
  const transaction = Buffer.from(signed.serialize()).toString("hex"), txId = signed.identifiers().at(-1)!;
  const sourceFingerprint = createHash("sha256").update(readFileSync(new URL("../contracts/organization/line.compact", import.meta.url))).digest("hex");
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async ({ address, transaction, txId, sourceFingerprint }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const wallet = getConnectedWallet()!;
    (window as any).expiredSubmissions = 0;
    wallet.submitTransaction = async () => { (window as any).expiredSubmissions++; throw Error("Expired bytes must not reach the wallet"); };
    const account = await OrganizationAccount.unlock(wallet, "Organization123!");
    await account.exclusive(async () => {
      await account.prepare({ id: "expired-maintenance", kind: "key", circuit: "draw", facilityId: null, contractAddress: address, sourceFingerprint, after: account.snapshot(), txId: null, transaction: null });
      await account.submitted(txId, transaction, address);
    });
    (window as any).expiredReceipt = "missing";
    (OrganizationNetwork.prototype as any).tx = () => ({ finality: {
      wait: async (id: string) => {
        if (id !== txId) throw Error("A replacement transaction was observed");
        const mode = (window as any).expiredReceipt;
        if (mode === "missing") throw Error("Finality has not been observed yet");
        return { identifiers: [mode === "foreign" ? "00" + "ef".repeat(32) : txId], blockHeight: 321, txHash: "ee".repeat(32), status: mode === "foreign" ? "SucceedEntirely" : mode };
      }, forget: () => {},
    } });
  }, { address, transaction, txId, sourceFingerprint });
  const reopen = async () => {
    await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
    await page.getByRole("button", { name: "Open organization", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
  };
  await reopen();
  await page.getByRole("button", { name: "Retry original submission", exact: true }).click();
  await page.getByRole("button", { name: "Resubmit same signed transaction", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The original signed transaction has expired. Keep it for reconciliation; expiry alone does not prove it was never applied.");
  for (const mode of ["missing", "foreign"]) {
    await page.evaluate(mode => { (window as any).expiredReceipt = mode; }, mode);
    await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(mode === "missing" ? "Finality has not been observed yet" : "exact organization transaction has not been observed");
    await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
  }
  const retained = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { decodeOrganizationBackup } = await import(browserModuleUrl("/src/lib/organization/backup.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const backup = await decodeOrganizationBackup(JSON.stringify(await account.encryptedBackup()), "Organization123!", organizationAccountKey("preprod", account.accountId), account.accountId);
    return { pending: backup.pending, snapshot: backup.snapshot, receipts: backup.snapshot.receipts.length, failures: backup.snapshot.failures?.length ?? 0, submissions: (window as any).expiredSubmissions, proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures };
  });
  expect(retained.pending).toMatchObject({ id: "expired-maintenance", txId, transaction, sourceFingerprint, contractAddress: address });
  expect(retained.pending!.after).toEqual(retained.snapshot);
  expect(retained).toMatchObject({ receipts: 0, failures: 0, submissions: 0, proofs: 0, signatures: 0 });
  // The independent account unlock used to decode the backup revokes the UI's
  // prior vault session. Reopen it normally rather than reusing stale controls.
  await expect(page.getByRole("heading", { name: "Open your organization.", exact: true })).toBeVisible();
  await reopen();
  await expect(page.getByText(new RegExp(txId))).toBeVisible();
  await page.evaluate(outcome => { (window as any).expiredReceipt = outcome; }, outcome);
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  if (outcome === "SucceedEntirely") await expect(page.getByRole("status")).toContainText("Confirmed on Midnight Preprod");
  else await expect(page.getByRole("alert")).toContainText("failed in a finalized block");
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  const reconciled = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    return { pending: account.pending(), receipts: account.snapshot().receipts.map(receipt => receipt.txId), failures: account.snapshot().failures?.map(receipt => receipt.txId) ?? [], submissions: (window as any).expiredSubmissions, proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures };
  });
  expect(reconciled).toEqual({ pending: null, receipts: outcome === "SucceedEntirely" ? [txId] : [], failures: outcome === "FailEntirely" ? [txId] : [], submissions: 0, proofs: 0, signatures: 0 });
});

async function disconnect(page: Page) {
  await page.locator("header").getByRole("button", { name: "Manage connected wallet" }).click();
  await page.getByRole("button", { name: "Disconnect from Line" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
}
async function unlock(page: Page, password = "Organization123!") {
  if (!await page.getByText("Organization vault unlocked", { exact: true }).isVisible()) {
    await page.getByLabel("Organization vault password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Open organization", exact: true }).click();
  }
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Organization", exact: true })).toBeVisible({ timeout: 30_000 });
}
async function profile(page: Page) {
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.getByRole("button", { name: "Show merchant profile", exact: true }).click();
  const result = JSON.parse(await page.getByRole("textbox", { name: "Your public merchant profile", exact: true }).inputValue());
  await page.getByRole("button", { name: "Close package", exact: true }).click();
  return result;
}

test("merchant invoice references reject oversized UTF-8 before requesting a proof", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app");
  await connect(page, "a"); await unlock(page);
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.getByLabel("Organization facility address", { exact: true }).fill("ab".repeat(32));
  await page.getByLabel("Price in this facility’s asset base units", { exact: true }).fill("100000");
  const reference = page.getByRole("textbox", { name: "Invoice / service reference", exact: true });
  const submit = page.getByRole("button", { name: "Post quote in wallet", exact: true });
  for (const value of ["Line protocol checkout acceptance 2026-10-20", "é".repeat(17)]) {
    await reference.fill(value);
    await expect(reference).toHaveAttribute("aria-invalid", "true");
    await expect(submit).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("32 UTF-8 bytes");
    await reference.press("Enter");
  }
  for (const value of ["x".repeat(32), "é".repeat(16), "ab".repeat(32), "0x" + "AB".repeat(32)]) {
    await reference.fill(value);
    await expect(reference).toHaveAttribute("aria-invalid", "false");
    await expect(submit).toBeEnabled();
  }
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

for (const outcome of ["SucceedEntirely", "FailEntirely"] as const) test(`saved merchant quotes recover a timed-out posting only after exact ${outcome} finality`, async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  // Replace only public-state/transaction boundaries. Account preparation,
  // encryption, receipt validation, reconciliation and UI are the real code.
  // No proof, wallet signature or network submission is performed.
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { receivingAddressBytes } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { encodeQuote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const target = window as any;
    target.quoteCalls = 0; target.quoteReceipt = "missing";
    (OrganizationNetwork.prototype as any).inspect = async function () {
      return { book: { lineGeneration: 1n, contractDomain: new Uint8Array(32).fill(18), feeFlat: 1000n, feeBps: 100n,
        merchantPayoutRecipients: { lookup: () => ({ bytes: receivingAddressBytes(this.account.receivingAddress) }) } } };
    };
    (OrganizationNetwork.prototype as any).tx = function () {
      return {
        call: async (address: string) => {
          target.quoteCalls++;
          target.retainedQuote = encodeQuote(this.account.pending().after.quotes[0]);
          await this.account.submitted("cd".repeat(32), "ff", address);
          throw Error("Synthetic quote submission acknowledgement timed out");
        },
        finality: { forget: () => {}, wait: async () => {
          if (target.quoteReceipt === "missing") throw Error("Synthetic receipt not observed");
          return { identifiers: [target.quoteReceipt === "unrelated" ? "ee".repeat(32) : "cd".repeat(32)], status: target.quoteReceipt === "unrelated" ? "SucceedEntirely" : target.quoteReceipt, txHash: "ef".repeat(32), blockHeight: 7 };
        } },
      };
    };
  });
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.getByLabel("Organization facility address", { exact: true }).fill("ab".repeat(32));
  await page.getByRole("textbox", { name: "Invoice / service reference", exact: true }).fill("remote-supplier-001");
  await page.getByLabel(/^Price in this facility/).fill("100000");
  await page.getByRole("button", { name: "Post quote in wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic quote submission acknowledgement timed out");
  const library = page.getByRole("region", { name: "Saved merchant quotes", exact: true });
  await expect(library.getByRole("button", { name: "Share saved quote", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Confirmed supplier quote", { exact: true })).toHaveCount(0);
  const expected = await page.evaluate(() => JSON.parse((window as any).retainedQuote));
  for (const receipt of ["missing", "unrelated", "PartiallySucceeded"]) {
    await page.evaluate(value => { (window as any).quoteReceipt = value; }, receipt);
    await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check original transaction", exact: true })).toBeEnabled();
    await expect(library.getByRole("button", { name: "Share saved quote", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post quote in wallet", exact: true })).toBeDisabled();
  }
  await page.evaluate(value => { (window as any).quoteReceipt = value; }, outcome);
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  if (outcome === "SucceedEntirely") {
    await expect(library).toContainText("Organization fee: 2000 base units · Total allowance charge: 102000 base units");
    await library.getByRole("button", { name: "Share saved quote", exact: true }).click();
    expect(JSON.parse(await page.getByRole("textbox", { name: "Saved merchant quote package", exact: true }).inputValue())).toEqual(expected);
    await page.getByRole("button", { name: "Close package", exact: true }).click();
  } else {
    await expect(page.getByRole("alert")).toContainText("failed in a finalized block");
    await expect(library.getByRole("button", { name: "Share saved quote", exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Lock organization", exact: true }).click(); await unlock(page);
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await expect(library.getByRole("button", { name: "Share saved quote", exact: true })).toHaveCount(outcome === "SucceedEntirely" ? 1 : 0);
  if (outcome === "SucceedEntirely") {
    await page.getByLabel("Find saved quotes", { exact: true }).fill("unrelated-invoice");
    await expect(library).toContainText("No saved quotes match this search.");
    await page.getByLabel("Find saved quotes", { exact: true }).fill(expected.invoiceId.toUpperCase());
    await library.getByRole("button", { name: "Share saved quote", exact: true }).click();
    expect(JSON.parse(await page.getByRole("textbox", { name: "Saved merchant quote package", exact: true }).inputValue())).toEqual(expected);
  }
  expect(await page.evaluate(() => ({ calls: (window as any).quoteCalls, proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ calls: 1, proof: 0, signatures: 0 });
});

test("saved merchant quotes paginate, survive encrypted backup and export historical terms on mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const expected = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { decodeOrganizationBackup } = await import(browserModuleUrl("/src/lib/organization/backup.ts"));
    const { encodeQuote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    // Synthetic history includes expired and extreme Uint64 terms accepted by
    // older backups. Neither their rendering nor export should require proving.
    await account.edit(snapshot => {
      for (let index = 1; index <= 11; index++) snapshot.quotes.push({
        contractAddress: "ab".repeat(32), domain: "12".repeat(32), merchantPk: "13".repeat(32), invoiceId: index.toString(16).padStart(64, "0"), quoteNonce: "14".repeat(32),
        amount: 100000n, expiry: index === 1 ? (1n << 64n) - 1n : 1n, generation: 1n, feeFlat: index === 1 ? (1n << 64n) - 1n : 1000n, feeBps: 100n, quoteCommitment: index.toString(16).padStart(64, "0"),
      });
    });
    const record = await decodeOrganizationBackup(JSON.stringify(await account.encryptedBackup()), "Organization123!", organizationAccountKey("preprod", account.accountId), account.accountId);
    return { count: record.snapshot.quotes.length, original: JSON.parse(encodeQuote(record.snapshot.quotes[0])) };
  });
  expect(expected.count).toBe(11);
  await unlock(page); await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const library = page.getByRole("region", { name: "Saved merchant quotes", exact: true });
  await expect(library.getByRole("article")).toHaveCount(10);
  await expect(library).toContainText("Page 1 of 2");
  await expect(library.getByRole("button", { name: "Previous quotes", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await library.getByRole("button", { name: "Next quotes", exact: true }).click();
  await expect(library.getByRole("article")).toHaveCount(1);
  await expect(library).toContainText("Page 2 of 2");
  await expect(library).toContainText("The saved fee terms exceed the supported fee range.");
  await expect(library).toContainText(`Unix second ${expected.original.expiry}`);
  await library.getByRole("button", { name: "Share saved quote", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Saved merchant quote package", exact: true })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Saved merchant quote package", exact: true })).toBeFocused();
  expect(JSON.parse(await page.getByRole("textbox", { name: "Saved merchant quote package", exact: true }).inputValue())).toEqual(expected.original);
  await page.getByRole("button", { name: "Close package", exact: true }).click();
  await library.getByLabel("Find saved quotes", { exact: true }).fill("AB".repeat(32));
  await expect(library).toContainText("Page 1 of 2");
  await expect(library.getByRole("article")).toHaveCount(10);
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

test("saved quote sharing opens a focused dialog, copies complete JSON and supports denied clipboard access", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const expected = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { encodeQuote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const quote = { contractAddress: "ab".repeat(32), domain: "12".repeat(32), merchantPk: "13".repeat(32), invoiceId: "14".repeat(32), quoteNonce: "15".repeat(32), amount: 100000n, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600), generation: 2n, feeFlat: 1000n, feeBps: 100n, quoteCommitment: "16".repeat(32) };
    await account.edit(snapshot => {
      snapshot.quotes.push(quote);
      snapshot.facilities.push({ id: "quote-copy-fixture", name: "Copy fixture", address: quote.contractAddress, instanceNonce: "17".repeat(32), maintenanceKey: "18".repeat(32), assetColor: "00".repeat(32), issuerRecipient: account.receivingAddress, merchants: [], agentSecret: "19".repeat(32), salt: "20".repeat(32), limit: 1000000n, outstanding: 0n, epoch: 0n, generation: 2n });
    });
    return encodeQuote(quote);
  });
  await unlock(page); await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const share = page.getByRole("button", { name: "Share saved quote", exact: true });
  await share.click();
  const dialog = page.getByRole("dialog", { name: "Saved merchant quote package", exact: true });
  const text = dialog.getByRole("textbox", { name: "Saved merchant quote package", exact: true });
  await expect(dialog).toBeInViewport(); await expect(text).toBeFocused();
  await expect(text).toHaveValue(expected);
  await dialog.getByRole("button", { name: "Copy package", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Package copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows clipboard transport normalizes line endings. JSON fields and
  // package contents must otherwise remain identical on every platform.
  expect(copied.replace(/\r\n/g, "\n")).toBe(expected);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Denied", "NotAllowedError"); } } }));
  await dialog.getByRole("button", { name: "Copy package", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("package text is selected");
  await expect(dialog.getByRole("status")).toHaveCount(0); await expect(text).toBeFocused();
  expect(await text.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, expected.length]);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download package", exact: true }).click();
  const download = await downloadPromise;
  expect(readFileSync((await download.path())!, "utf8")).toBe(expected);
  await dialog.getByRole("button", { name: "Close package", exact: true }).click();
  await expect(share).toBeFocused();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByText("Use a quote from another supplier", { exact: true }).click();
  await page.getByLabel("Merchant quote package", { exact: true }).fill(copied);
  await expect(page.getByLabel("Quoted purchase costs")).toContainText("Total allowance charge: 102000 base units");
  await expect(page.getByRole("button", { name: "Authorize purchase in wallet", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "Merchant", exact: true }).click(); await share.click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { lockVaultSession } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    lockVaultSession();
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Organization vault password", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

for (const outcome of ["SucceedEntirely", "FailEntirely"] as const) test(`separate claim expiry rejects stale state and reconciles exact ${outcome} without early promotion`, async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await compensationCandidateFixture(0n);
  await wallets(page, true, true); await page.goto("/app");
  await page.evaluate(address => {
    const provider = (window as any).midnight.a, original = provider.connect;
    provider.connect = async (...args: any[]) => {
      const api = await original(...args); api.getUnshieldedAddress = async () => ({ unshieldedAddress: address }); return api;
    };
  }, fixture.before.facilities[0].issuerRecipient);
  await connect(page, "a"); await unlock(page);
  const guards = await page.evaluate(async ({ snapshot, state, target, outcome }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { decodeVaultJson } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const { Contract, ledger } = await import("/contracts/managed/organization/contract/index.js" as any);
    const { CompactContractState, createCircuitContext } = await import("/e2e/organization-provider.ts" as any);
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const base = decodeVaultJson(snapshot) as any;
    await account.edit(saved => Object.assign(saved, { issuerSecret: base.issuerSecret, merchantSecret: base.merchantSecret, facilities: base.facilities, notes: base.notes, quotes: base.quotes }));
    const w = window as any, address = base.facilities[0].address;
    w.expiryState = CompactContractState.deserialize(Uint8Array.from(state.match(/../g)!.map(x => parseInt(x, 16))));
    w.expiryScenario = "uncertain"; w.expiryCalls = 0; w.expiryGuard = "ready";
    const receipt = { identifiers: ["00" + "aa".repeat(32)], status: outcome, txHash: "bb".repeat(32), blockHeight: 321 };
    w.expiryReceipt = receipt;
    (OrganizationNetwork.prototype as any).inspect = async function () {
      w.expiryAccount = this.account;
      const book = ledger(w.expiryState.data);
      const state = { balance: new Map(), operations: () => Array(12).fill("test-circuit") };
      if (w.expiryGuard === "ready") return { book, state };
      return { state, book: { ...book, notes: { member: (key: Uint8Array) => book.notes.member(key), lookup: (key: Uint8Array) => ({ ...book.notes.lookup(key), ...(w.expiryGuard === "redeemed" ? { redeemed: true } : w.expiryGuard === "cancelled" ? { cancelled: true } : { amount: 1n }) }) } } };
    };
    (OrganizationNetwork.prototype as any).tx = function () {
      const client = this;
      return {
        call: async (destination: string, circuit: string, args: any[]) => {
          w.expiryCalls++;
          if (destination !== address || circuit !== "cancelOrExpireNote" || args[1] !== 0n || args[2] !== 0n) throw Error("Unexpected expiry action");
          // Execute the generated branch with the real SDK's witness callbacks.
          // Its input is null: mode 0 must request no role or book witness.
          const context = createCircuitContext(address, "0".repeat(64), w.expiryState, {}, undefined, undefined, 2100);
          const result = new Contract(client.witnesses).circuits.cancelOrExpireNote(context, ...args);
          const next = new CompactContractState(); next.data = result.context.currentQueryContext.state;
          w.expiryAppliedState = next;
          if (result.context.currentQueryContext.effects.unshieldedOutputs.size || result.context.currentQueryContext.effects.unshieldedInputs.size) throw Error("Expiry moved assets");
          await client.account.submitted(receipt.identifiers[0], "abcd", address);
          if (w.expiryScenario === "uncertain") throw Error("Synthetic expiry acknowledgement unavailable");
          return receipt;
        },
        finality: { wait: async () => w.expiryReceipt, forget: () => { w.expiryState = w.expiryAppliedState; } },
      };
    };
    const client = await OrganizationNetwork.connect(account), rejected: string[] = [];
    for (const scenario of ["redeemed", "cancelled", "wrong amount", "future deadline"]) {
      w.expiryGuard = scenario === "future deadline" ? "ready" : scenario;
      const now = Date.now;
      try {
        if (scenario === "future deadline") Date.now = () => 1000_000;
        await client.recordClaimExpiry(base.facilities[0].id, target);
      } catch (error) { rejected.push((error as Error).message); }
      finally { Date.now = now; }
    }
    w.expiryGuard = "ready";
    return { rejected, calls: w.expiryCalls, pending: account.pending() };
  }, { snapshot: encodeVaultJson(fixture.before), state: Buffer.from(fixture.predecessor.serialize()).toString("hex"), target: fixture.target, outcome });
  expect(guards).toMatchObject({ calls: 0, pending: null }); expect(guards.rejected).toHaveLength(4);
  expect(guards.rejected[0]).toContain("already redeemed or cancelled");
  expect(guards.rejected[1]).toContain("already redeemed or cancelled");
  expect(guards.rejected[2]).toContain("does not match");
  expect(guards.rejected[3]).toContain("deadline has not passed");
  await unlock(page);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  const card = page.getByRole("region", { name: "Saved merchant claims" }).getByRole("article").filter({ hasText: fixture.target });
  await card.getByRole("button", { name: "Record claim expiry", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic expiry acknowledgement unavailable");
  const uncertain = await page.evaluate(async () => {
    const account = (window as any).expiryAccount;
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { decodeOrganizationBackup } = await import(browserModuleUrl("/src/lib/organization/backup.ts"));
    const { organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const record = await decodeOrganizationBackup(JSON.stringify(await account.encryptedBackup()), "Organization123!", organizationAccountKey("preprod", account.accountId), account.accountId);
    return { beforeFlag: record.snapshot.notes[0].expiryRecorded ?? false, candidateFlag: record.pending?.after.notes[0].expiryRecorded, originalBytes: record.pending?.transaction, bookUnchanged: JSON.stringify(record.snapshot.facilities, (_k, v) => typeof v === "bigint" ? String(v) : v) === JSON.stringify(record.pending?.after.facilities, (_k, v) => typeof v === "bigint" ? String(v) : v) };
  });
  expect(uncertain).toEqual({ beforeFlag: false, candidateFlag: true, originalBytes: "abcd", bookUnchanged: true });
  await page.getByRole("button", { name: "Lock organization", exact: true }).click(); await unlock(page);
  await page.evaluate(() => { const w = window as any; w.expiryReceipt = { ...w.expiryReceipt, identifiers: ["00" + "cc".repeat(32)] }; });
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "exact organization transaction has not been observed" })).toBeVisible();
  await page.evaluate(() => { const w = window as any; w.expiryReceipt = { ...w.expiryReceipt, identifiers: ["00" + "aa".repeat(32)] }; });
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  if (outcome === "SucceedEntirely") await expect(page.getByRole("status")).toContainText("Confirmed on Midnight Preprod");
  else await expect(page.getByRole("alert").filter({ hasText: "original transaction failed in a finalized block" })).toBeVisible();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  if (outcome === "SucceedEntirely") {
    await expect(card).toContainText("Expiry recorded in this workspace. Compensation has not been allocated.");
    await expect(card.getByRole("button", { name: "Record claim expiry", exact: true })).toBeDisabled();
  } else {
    await expect(card).not.toContainText("Expiry recorded in this workspace");
    await expect(card.getByRole("button", { name: "Record claim expiry", exact: true })).toBeEnabled();
  }
  await expect(card.getByRole("button", { name: "Recover expired claim", exact: true })).toBeEnabled();
  const restored = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, organizationAccountKey } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { removeEncryptedSecret } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const w = window as any, account = w.expiryAccount, backup = JSON.stringify(await account.encryptedBackup());
    await removeEncryptedSecret(organizationAccountKey("preprod", account.accountId));
    const reopened = await OrganizationAccount.unlock(account.wallet, "Organization123!");
    const client = await OrganizationNetwork.connect(reopened);
    (client as any).providers.publicDataProvider.queryContractState = async () => w.expiryState;
    await client.restoreBackup(backup, "Organization123!");
    return { expiryRecorded: reopened.snapshot().notes[0].expiryRecorded ?? false, refund: reopened.snapshot().notes[0].refund ?? null, pending: reopened.pending(), calls: w.expiryCalls, receipts: reopened.snapshot().receipts.length, failures: reopened.snapshot().failures?.length ?? 0, proofs: w.organizationProofRequests, signatures: w.organizationSignatures };
  });
  expect(restored).toEqual({ expiryRecorded: outcome === "SucceedEntirely", refund: null, pending: null, calls: 1, receipts: outcome === "SucceedEntirely" ? 1 : 0, failures: outcome === "FailEntirely" ? 1 : 0, proofs: 0, signatures: 0 });
});

test("claim cards identify generations and fees, prioritize newer generations and preserve older exports", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const expected = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { encodeNote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const old = { contractAddress: "ab".repeat(32), domain: "12".repeat(32), identity: "13".repeat(32), merchantPk: "14".repeat(32), quoteCommitment: "15".repeat(32), amount: 100000n, fee: 0n, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600), generation: 1n, noteNonce: "16".repeat(32), noteSalt: "17".repeat(32), noteCommitment: "18".repeat(32), redeemed: true };
    const current = { ...old, generation: 2n, fee: 2000n, noteCommitment: "19".repeat(32) };
    const importedLater = { ...old, redeemed: false, noteCommitment: "20".repeat(32) };
    await account.edit(snapshot => {
      snapshot.facilities.push({ id: "claim-list-fixture", name: "Claim list fixture", address: old.contractAddress, instanceNonce: "21".repeat(32), maintenanceKey: "22".repeat(32), assetColor: "00".repeat(32), issuerRecipient: account.receivingAddress, merchants: [], agentSecret: "23".repeat(32), salt: "24".repeat(32), limit: 1000000n, outstanding: 102000n, epoch: 1n, generation: 2n });
      snapshot.notes.push(old, current, importedLater);
    });
    return [current, importedLater, old].map(note => JSON.parse(encodeNote(note)));
  });
  await unlock(page); await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const library = page.getByRole("region", { name: "Saved merchant claims", exact: true });
  await expect(library).toBeVisible();
  const cards = library.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Allowance generation 2");
  await expect(cards.nth(0)).toContainText("Organization fee: 2000 base units");
  await expect(cards.nth(0)).toContainText("Total allowance charge: 102000 base units");
  await expect(cards.nth(0)).toContainText("Redemption recorded in this workspace");
  await expect(cards.nth(1)).toContainText("Allowance generation 1");
  await expect(cards.nth(1)).toContainText("Check current payout status");
  await expect(cards.nth(1)).not.toContainText("Unspent");
  await expect(cards.nth(2)).toContainText("Organization fee: 0 base units");
  for (let index = 0; index < expected.length; index++) {
    await cards.nth(index).getByRole("button", { name: "Share claim", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merchant claim package", exact: true });
    expect(JSON.parse(await dialog.getByRole("textbox", { name: "Merchant claim package", exact: true }).inputValue())).toEqual(expected[index]);
    await dialog.getByRole("button", { name: "Close package", exact: true }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

test("merchant claim review binds payout terms and rechecks spent state before transaction preparation", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const packageText = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, receivingAddressBytes } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { drawNoteCommit, merchantPublicKey, toHex, hexToBytes } = await import(browserModuleUrl("/src/lib/line/encoding.ts"));
    const { encodeNote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const pk = merchantPublicKey(hexToBytes(account.snapshot().merchantSecret));
    const note = { contractAddress: "ab".repeat(32), domain: "12".repeat(32), identity: "13".repeat(32), merchantPk: toHex(pk), quoteCommitment: "14".repeat(32), amount: 100000n, fee: 2000n, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600), generation: 1n, noteNonce: "15".repeat(32), noteSalt: "16".repeat(32), noteCommitment: "", redeemed: false };
    note.noteCommitment = toHex(drawNoteCommit({ domain: hexToBytes(note.domain), lineGeneration: note.generation, identity: hexToBytes(note.identity), quoteCommit: hexToBytes(note.quoteCommitment), merchantPk: pk, amount: note.amount, fee: note.fee, noteNonce: hexToBytes(note.noteNonce), expiry: note.expiry }, hexToBytes(note.noteSalt)));
    const target = window as any;
    target.claimState = "unspent"; target.claimCalls = 0; target.claimMissing = false; target.claimReadFailure = false;
    (OrganizationNetwork.prototype as any).inspect = async function (address: string) {
      if (target.claimReadFailure) throw Error("Synthetic claim state unavailable");
      if (address !== note.contractAddress) throw Error("Unexpected facility");
      return { book: {
        contractDomain: hexToBytes(note.domain), settlementTokenColor: new Uint8Array(32).fill(23),
        // A previous-generation claim must not depend on current line status
        // or merchant registration. Compact deliberately preserves its payout.
        lineGeneration: 2n, status: 3, registeredMerchants: { lookup: () => false },
        merchantPayoutRecipients: { member: (key: Uint8Array) => toHex(key) === note.merchantPk, lookup: () => ({ bytes: receivingAddressBytes(this.account.receivingAddress) }) },
        notes: { member: (key: Uint8Array) => !target.claimMissing && toHex(key) === note.noteCommitment, lookup: () => ({ amount: note.amount, fee: note.fee, expiry: note.expiry, lineGeneration: note.generation, redeemed: target.claimState === "redeemed", cancelled: target.claimState === "cancelled" }) },
      } };
    };
    // The real SDK reaches its prepared transaction boundary only for the
    // current unspent state; this seam rejects without any wallet request.
    (OrganizationNetwork.prototype as any).tx = function () {
      return { call: async () => { target.claimCalls++; throw Error("Synthetic redemption declined"); } };
    };
    return encodeNote(note);
  });
  await unlock(page); await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Merchant claim package", exact: true });
  const check = page.getByRole("button", { name: "Check claim and payout", exact: true });
  const redeem = page.getByRole("button", { name: "Redeem and receive assets", exact: true });
  await input.fill("invalid"); await expect(check).toBeDisabled(); await expect(redeem).toBeDisabled();
  await input.fill(packageText); await expect(redeem).toBeDisabled(); await check.click();
  const review = page.getByRole("article", { name: "Checked merchant claim", exact: true });
  await expect(review).toContainText("Merchant payout: 100000 asset base units");
  await expect(review).toContainText("Organization fee: 2000 base units, retained by the organization.");
  await expect(review).toContainText("17".repeat(32));
  await expect(review).toContainText("Allowance generation: 1");
  await expect(redeem).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // Another transaction spends the claim after review. Rechecking in redeem()
  // must reject before prepare(), even though the UI held an unspent snapshot.
  await page.evaluate(() => { (window as any).claimState = "redeemed"; });
  await redeem.click(); await expect(page.getByRole("alert")).toContainText("already redeemed");
  await expect(redeem).toBeDisabled();
  for (const state of ["redeemed", "cancelled"]) {
    await page.evaluate(value => { (window as any).claimState = value; }, state); await check.click();
    await expect(review).toContainText(state === "redeemed" ? "Already redeemed" : "Cancelled");
    await expect(redeem).toBeDisabled();
  }
  await page.evaluate(() => { (window as any).claimState = "unspent"; }); await check.click();
  await expect(redeem).toBeEnabled();
  const tampered = JSON.parse(packageText); tampered.amount = "99999";
  await input.fill(JSON.stringify(tampered)); await expect(redeem).toBeDisabled();
  await expect(review).toHaveCount(0); await check.click();
  await expect(page.getByRole("alert")).toContainText("opening does not match");
  await input.fill(packageText);
  await page.evaluate(() => { (window as any).claimMissing = true; }); await check.click();
  await expect(page.getByRole("alert")).toContainText("not found"); await expect(redeem).toBeDisabled();
  await page.evaluate(() => { (window as any).claimMissing = false; (window as any).claimReadFailure = true; }); await check.click();
  await expect(page.getByRole("alert")).toContainText("Synthetic claim state unavailable"); await expect(redeem).toBeDisabled();
  await page.evaluate(() => { (window as any).claimReadFailure = false; }); await check.click();
  await expect(redeem).toBeEnabled(); await redeem.click();
  await expect(page.getByRole("alert")).toContainText("Synthetic redemption declined");
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ({ calls: (window as any).claimCalls, proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ calls: 1, proof: 0, signatures: 0 });
});

test("connection diagnostics isolate connector reads without opening a vault or preparing a transaction", async ({ page }) => {
  await wallets(page, true); await page.goto("/app"); await connect(page, "a");
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const wallet = getConnectedWallet()!;
    const read = wallet.getConfiguration.bind(wallet);
    wallet.getConfiguration = async () => ({ ...await read(), substrateNodeUri: "https://provider.invalid/?token=private-diagnostic-control" });
    wallet.getConnectionStatus = async () => { throw { code: -32603, message: "Request failed" }; };
  });
  await page.locator("header").getByRole("button", { name: "Manage connected wallet", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Connection diagnostics", { exact: true }).click();
  await dialog.getByRole("button", { name: "Check connector reads", exact: true }).click();
  await expect(dialog.getByText(/getConfiguration: passed/)).toBeVisible();
  await expect(dialog.getByText(/getShieldedAddresses: passed/)).toBeVisible();
  await expect(dialog.getByText(/getUnshieldedAddress: passed/)).toBeVisible();
  await expect(dialog.getByText(/getConnectionStatus: failed/)).toContainText("Connector returned Request failed (code -32603)");
  await expect(dialog.getByRole("button", { name: "Check connector reads", exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText("private-diagnostic-control");
  await expect(dialog).not.toContainText("provider.invalid");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Open your organization.", exact: true })).toBeVisible();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

test("failed session verification remains diagnosable without publishing a wallet connection", async ({ page }) => {
  await wallets(page, true);
  await page.addInitScript(() => {
    for (const wallet of Object.values((window as any).midnight) as any[]) {
      const connect = wallet.connect;
      wallet.connect = async () => {
        const api = await connect(); api.getConnectionStatus = async () => { throw { code: -32603, message: "Request failed" }; }; return api;
      };
    }
  });
  await page.goto("/app");
  await page.locator("header").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Organization wallet a", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Request failed");
  await dialog.getByText("Connection diagnostics", { exact: true }).click();
  await dialog.getByRole("button", { name: "Check connector reads", exact: true }).click();
  await expect(dialog.getByText(/getConnectionStatus: failed/)).toContainText("code -32603");
  await expect(dialog.getByText(/getConfiguration: passed/)).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Connect your wallet.", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with your wallet.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

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

test("a Preprod wallet with retired readers opens its organization through the hosted read connection", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app");
  await connect(page, "a"); await unlock(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
});

test("organization opening recovers a temporary wallet identity limit without requesting a transaction", async ({ page }) => {
  await wallets(page, true, true, true); await page.goto("/app");
  await connect(page, "a"); await unlock(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const requests = await page.evaluate(() => {
    const state = window as unknown as { organizationSignatures: number; organizationProofRequests: number };
    return { signatures: state.organizationSignatures, proofs: state.organizationProofRequests };
  });
  expect(requests).toEqual({ signatures: 0, proofs: 0 });
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
  await page.screenshot({ path: "test-results/organization-product/merchant-account-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/organization-product/merchant-account-mobile.png", fullPage: true });
});

test("incomplete facility fields show actionable feedback without requesting a signature", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.getByRole("button", { name: "Create facility", exact: true }).click();
  const requiredFeedback = page.getByRole("alert").filter({ hasText: "Complete the required name, asset and supplier profile" });
  await expect(requiredFeedback).toBeVisible();
  await expect(requiredFeedback).toBeInViewport();
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
});

test("wallet-only onboarding uses the account's actual receiving profile without authorizing a transaction", async ({ page }) => {
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const merchant = await profile(page);
  await page.getByRole("tab", { name: "Organization", exact: true }).click();
  await expect(page.getByLabel("Initial merchant profile", { exact: false })).toHaveValue("");
  await page.getByRole("button", { name: "Use my receiving wallet", exact: true }).click();
  const selected = JSON.parse(await page.getByLabel("Initial merchant profile", { exact: false }).inputValue());
  expect(selected.schema).toBe("line:organization-merchant/v1");
  expect(selected.publicKey).toBe(merchant.publicKey);
  expect(selected.address).toBe(merchant.address);
  expect(selected).not.toHaveProperty("merchantSecret");
  await page.getByLabel("Organization / agent name", { exact: true }).fill("My organization");
  await expect(page.getByText("Facility address", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { organizationSignatures: number }).organizationSignatures)).toBe(0);
});

test("an actual encrypted account uses fresh session and identity checks after configuration becomes unavailable", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const result = await page.evaluate(async ({ foreignCoin, foreignRecipient }) => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { isVaultSessionUnlocked } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const wallet = getConnectedWallet()!, original = {
      configuration: wallet.getConfiguration.bind(wallet), session: wallet.getConnectionStatus.bind(wallet),
      shielded: wallet.getShieldedAddresses.bind(wallet), receiving: wallet.getUnshieldedAddress.bind(wallet),
    };
    let configurationReads = 0, mutations = 0;
    const unavailable = async () => { configurationReads++; throw Error("Request failed"); };
    let account = await OrganizationAccount.unlock(wallet, "Organization123!");
    wallet.getConfiguration = unavailable;
    const first = await account.assertWallet(); first.configuration.indexerUri = "https://changed.example.test";
    const second = await account.assertWallet();
    const settingsUnchanged = second.configuration.indexerUri !== first.configuration.indexerUri;
    const rejectedSessions = [];
    for (const status of [{ status: "disconnected" }, { status: "connected", networkId: "mainnet" }]) {
      wallet.getConnectionStatus = async () => status as any;
      try { await account.exclusive(async () => { mutations++; }); rejectedSessions.push(false); }
      catch (failure) { rejectedSessions.push(/preprod session/i.test((failure as Error).message)); }
    }
    const rejectedIdentities = [];
    for (const changed of ["shielded", "receiving"]) {
      wallet.getConfiguration = original.configuration; wallet.getConnectionStatus = original.session;
      wallet.getShieldedAddresses = original.shielded; wallet.getUnshieldedAddress = original.receiving;
      account = await OrganizationAccount.unlock(wallet, "Organization123!");
      wallet.getConfiguration = unavailable;
      if (changed === "shielded") wallet.getShieldedAddresses = async () => ({ ...await original.shielded(), shieldedCoinPublicKey: foreignCoin });
      else wallet.getUnshieldedAddress = async () => ({ unshieldedAddress: foreignRecipient });
      try { await account.exclusive(async () => { mutations++; }); rejectedIdentities.push(false); }
      catch (failure) { rejectedIdentities.push(/wallet.*account changed/i.test((failure as Error).message) && !isVaultSessionUnlocked()); }
    }
    return { configurationReads, mutations, settingsUnchanged, rejectedSessions, rejectedIdentities };
  }, {
    foreignCoin: bech32m.encodeFromBytes("mn_shield-cpk_preprod", new Uint8Array(32).fill(12)),
    foreignRecipient: bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(52)),
  });
  expect(result).toEqual({ configurationReads: 0, mutations: 0, settingsUnchanged: true, rejectedSessions: [true, true], rejectedIdentities: [true, true] });
  expect(await page.evaluate(() => ({ signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests }))).toEqual({ signatures: 0, proofs: 0 });
});

test("treasury serializes wallet reads across refreshes and does not refetch balances while typing an asset", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount, readOrganizationWallet } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const wallet = getConnectedWallet()!, account = await OrganizationAccount.unlock(wallet, "Organization123!");
    await account.edit(snapshot => snapshot.facilities.push({ id: "serial-reads", name: "Serial reads", address: "ab".repeat(32), instanceNonce: "12".repeat(32), maintenanceKey: "13".repeat(32), assetColor: "0".repeat(64), issuerRecipient: account.receivingAddress, merchants: [], agentSecret: "14".repeat(32), salt: "15".repeat(32), limit: 100n, outstanding: 0n, epoch: 0n, generation: 1n }));
    const state = window as any; state.walletReadActive = 0; state.walletReadPeak = 0; state.walletReadOverlaps = 0; state.walletBalanceReads = 0;
    const probe = async (request: () => Promise<unknown>) => {
      state.walletReadPeak = Math.max(state.walletReadPeak, ++state.walletReadActive);
      try {
        if (state.walletReadActive > 1) { state.walletReadOverlaps++; throw Error("Request failed"); }
        await new Promise(resolve => setTimeout(resolve, 80));
        return await request();
      } finally { state.walletReadActive--; }
    };
    for (const name of ["getConfiguration", "getConnectionStatus", "getShieldedAddresses", "getUnshieldedAddress"] as const) {
      const original = wallet[name].bind(wallet); (wallet as any)[name] = () => probe(original);
    }
    wallet.getUnshieldedBalances = () => probe(async () => { state.walletBalanceReads++; return { ["0".repeat(64)]: 5000000n }; }) as ReturnType<typeof wallet.getUnshieldedBalances>;
    // Exercise the actual identity reader at the public-summary seam. Synthetic
    // chain state and a concurrency-sensitive wallet establish no live receipt.
    OrganizationNetwork.prototype.facilitySummary = async () => {
      await readOrganizationWallet(wallet);
      return { status: "OPEN", registeredCircuits: 12, assetColor: "0".repeat(64), reserve: "1000000", encumbered: "0", paid: "0", feeFlat: "0", feeBps: "0", fees: "0", pendingFees: "0", domain: "16".repeat(32), balances: [{ color: "0".repeat(64), units: "1000000" }] };
    };
  });
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByText("OPEN · 12/12 circuit keys · Reserve accounting 1000000 · Principal paid 0", { exact: true })).toBeVisible();
  await expect(page.getByText("5000000 asset base units", { exact: true })).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Refresh balances and suppliers", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause agent", exact: true })).toBeDisabled();
  }
  await expect(page.getByText("5000000 asset base units", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).walletReadActive)).toBe(0);
  await expect(page.getByRole("button", { name: "Pause agent", exact: true })).toBeEnabled();
  const before = await page.evaluate(() => (window as any).walletBalanceReads);
  await page.getByText("Create an agent facility", { exact: true }).click();
  await page.getByRole("textbox", { name: /Settlement asset color/ }).fill("11".repeat(32));
  await page.getByRole("textbox", { name: /Settlement asset color/ }).fill("22".repeat(32));
  await expect(page.getByText("5000000 asset base units", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ peak: (window as any).walletReadPeak, overlaps: (window as any).walletReadOverlaps, balanceReads: (window as any).walletBalanceReads }))).toEqual({ peak: 1, overlaps: 0, balanceReads: before });
  expect(await page.evaluate(() => ({ signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests }))).toEqual({ signatures: 0, proofs: 0 });
});

test("facility custody uses the contract ledger balance instead of wallet-style outputs", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    let walletBalanceReads = 0;
    // Controlled public-state read exercises the actual summary method only;
    // finalized custody acceptance is checked separately against Preprod.
    const contractState = { operations: () => Array.from({ length: 12 }, (_, i) => String(i)), balance: new Map([
      [{ tag: "unshielded", raw: "0".repeat(64) }, 900000n],
      [{ tag: "shielded", raw: "11".repeat(32) }, 123n],
    ]) };
    const book = { status: 1, settlementTokenColor: new Uint8Array(32), totalReserve: 1000000n, encumberedReserve: 0n, redeemedReserve: 100000n, feeFlat: 0n, feeBps: 0n, feeReserve: 0n, pendingFeeReserve: 0n, contractDomain: new Uint8Array(32) };
    const client = {
      facility: () => ({ address: "ab".repeat(32) }), inspect: async () => ({ state: contractState, book }),
      providers: { publicDataProvider: { queryUnshieldedBalances: async () => { walletBalanceReads++; return [{ tokenType: "0".repeat(64), balance: 999999n }]; } } },
    };
    const funded = await OrganizationNetwork.prototype.facilitySummary.call(client as any, "controlled-read");
    contractState.balance.clear();
    const empty = await OrganizationNetwork.prototype.facilitySummary.call(client as any, "controlled-read");
    return { funded: funded.balances, reserve: funded.reserve, paid: funded.paid, empty: empty.balances, walletBalanceReads };
  });
  expect(result).toEqual({ funded: [{ color: "0".repeat(64), units: "900000" }], reserve: "1000000", paid: "100000", empty: [], walletBalanceReads: 0 });
});

test("organization fee terms reach allowance preparation and invalid policy never reaches wallet checks", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    let checks = 0;
    const calls: unknown[][] = [];
    const facility = { id: "fees", address: "ab".repeat(32), agentSecret: "11".repeat(32) };
    const snapshot = { issuerSecret: "12".repeat(32), facilities: [{ ...facility }] };
    const client = {
      account: { exclusive: async (action: () => Promise<unknown>) => { checks++; return action(); }, snapshot: () => structuredClone(snapshot) },
      facility: () => facility, inspect: async () => ({ book: { lineGeneration: 0n } }),
      operation: async (_kind: string, _name: string, _id: string, _address: string, _after: unknown, prepare: () => Promise<unknown>) => prepare(),
      tx: () => ({ call: async (address: string, name: string, args: bigint[]) => { calls.push([address, name, args.map(String)]); } }), input: null,
    };
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await OrganizationNetwork.prototype.openAllowance.call(client as any, "fees", 1000n, expiry, 2n, 250n);
    await OrganizationNetwork.prototype.openAllowance.call(client as any, "fees", 1000n, expiry);
    const validChecks = checks, failures: boolean[] = [];
    for (const [flat, bps] of [[-1n, 0n], [1n << 64n, 0n], [0n, 10001n]]) {
      try { await OrganizationNetwork.prototype.openAllowance.call(client as any, "fees", 1000n, expiry, flat, bps); failures.push(false); }
      catch { failures.push(true); }
    }
    return { terms: calls.map(call => (call[2] as string[]).slice(1)), failures, validChecks, checks, inputCleared: client.input === null };
  });
  expect(result).toEqual({ terms: [["2", "250"], ["0", "0"]], failures: [true, true, true], validChecks: 2, checks: 2, inputCleared: true });
});

test("the locked purchase boundary enforces the saved service fee ceiling before preparing a draw", async ({ page }) => {
  test.setTimeout(120_000); await page.goto("/app");
  const preparations = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { quoteCommit, toHex } = await import(browserModuleUrl("/src/lib/line/encoding.ts"));
    const bytes = (n: number) => new Uint8Array(32).fill(n);
    const address = "ab".repeat(32), domain = bytes(12), merchant = bytes(13), invoice = bytes(14), nonce = bytes(15);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const commitment = toHex(quoteCommit({ merchantPk: merchant, invoiceId: invoice, nonce, amount: 25n, expiry, generation: 1n, domain, feeFlat: 2n, feeBps: 250n }));
    const quote = { contractAddress: address, domain: toHex(domain), merchantPk: toHex(merchant), invoiceId: toHex(invoice), quoteNonce: toHex(nonce), amount: 25n, expiry, generation: 1n, feeFlat: 2n, feeBps: 250n, quoteCommitment: commitment };
    const facility = { id: "bound-fees", address, limit: 100n, outstanding: 0n, epoch: 0n, agentSecret: toHex(bytes(16)), salt: toHex(bytes(17)) };
    const order = { id: "request", facilityId: facility.id, quoteCommitment: commitment, delivered: false, maxFee: undefined as string | undefined };
    const snapshot = { facilities: [facility], serviceOrders: [order], notes: [] };
    let prepared = 0;
    const client = {
      account: { exclusive: async (action: () => Promise<unknown>) => action(), snapshot: () => structuredClone(snapshot) },
      facility: () => facility, inspect: async () => ({ book: { contractDomain: domain, lineGeneration: 1n, feeFlat: 2n, feeBps: 250n } }),
      operation: async () => { prepared++; throw Error("Stop before proof or signature"); }, input: null,
    };
    const counts: number[] = [];
    for (const maxFee of [undefined, "2", "3"]) {
      order.maxFee = maxFee;
      try { await OrganizationNetwork.prototype.purchase.call(client as any, facility.id, quote, { orderId: order.id, requestId: order.id }); } catch { /* Rejected before any proof. */ }
      counts.push(prepared);
    }
    return counts;
  });
  expect(preparations).toEqual([0, 0, 1]);
});

test("service fee ceilings bind fresh and resumed orders without blocking an existing claim", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  const recipient = bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(4));
  const result = await page.evaluate(async recipient => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { encodeQuote } = await import(browserModuleUrl("/src/lib/organization/transfers.ts"));
    const address = "ab".repeat(32), pk = "11".repeat(32), asset = "0".repeat(64);
    const facility = { id: "fees", address, assetColor: asset, limit: 100n, outstanding: 0n, generation: 1n, merchants: [{ publicKey: pk, address: recipient }] };
    const state = { facilities: [facility], serviceOrders: [] as any[], notes: [] as any[] };
    let saves = 0, continued = 0, draws = 0;
    const quote = { contractAddress: address, domain: "12".repeat(32), merchantPk: pk, invoiceId: "13".repeat(32), quoteNonce: "14".repeat(32), amount: 25n, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600), generation: 1n, feeFlat: 2n, feeBps: 250n, quoteCommitment: "15".repeat(32) };
    const client = {
      account: { snapshot: () => structuredClone(state), edit: async (change: (state: any) => void) => { saves++; change(state); } },
      facility: () => facility,
      catalog: async () => ({ assetColor: asset, services: [{ id: "test-api", price: "25", profile: { publicKey: pk, address: recipient } }] }),
      inspect: async () => ({ book: { status: 1, lineGeneration: 1n, feeFlat: 2n, feeBps: 250n, merchantPayoutRecipients: { lookup: () => ({ bytes: new Uint8Array(32).fill(4) }) } } }),
      continueService: async () => { continued++; }, report: () => {},
      supplierRequest: async (path: string) => { if (path.endsWith("/redeem")) throw Error("Existing claim recovery reached"); },
      waitForSupplier: async () => ({ quotePackage: encodeQuote(quote) }),
      purchase: async () => { draws++; throw Error("Reviewed fee ceiling reached"); },
    };
    let excessiveRejected = false, capacityRejected = false;
    try { await OrganizationNetwork.prototype.purchaseService.call(client as any, "fees", "test-api", "Document", 2n); } catch { excessiveRejected = true; }
    facility.limit = 27n;
    try { await OrganizationNetwork.prototype.purchaseService.call(client as any, "fees", "test-api", "Document", 3n); } catch { capacityRejected = true; }
    const rejectedSaves = saves; facility.limit = 100n;
    await OrganizationNetwork.prototype.purchaseService.call(client as any, "fees", "test-api", "Document", 3n);
    const savedFee = state.serviceOrders[0].maxFee;
    const failures: string[] = [];
    for (const maxFee of [undefined, "2", "3"]) {
      state.serviceOrders[0].maxFee = maxFee;
      try { await OrganizationNetwork.prototype.continueService.call(client as any, state.serviceOrders[0].id); }
      catch (error) { failures.push((error as Error).message); }
    }
    state.serviceOrders[0].maxFee = undefined;
    state.notes.push({ contractAddress: address, quoteCommitment: quote.quoteCommitment, noteCommitment: "16".repeat(32), amount: 25n, fee: 3n });
    let recovery = "";
    try { await OrganizationNetwork.prototype.continueService.call(client as any, state.serviceOrders[0].id); } catch (error) { recovery = (error as Error).message; }
    return { excessiveRejected, capacityRejected, rejectedSaves, savedFee, continued, failures, draws, recovery };
  }, recipient);
  expect(result).toEqual({ excessiveRejected: true, capacityRejected: true, rejectedSaves: 0, savedFee: "3", continued: 1,
    failures: [expect.stringContaining("saved organization fee limit"), expect.stringContaining("saved organization fee limit"), "Reviewed fee ceiling reached"], draws: 1, recovery: "Existing claim recovery reached" });
});

test("treasury validates public fees and withdraws only finalized fees to the organization recipient", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    // Controlled public state and intercepted preparation test the form only.
    // They do not establish fee payout or any new finalized transaction.
    await account.edit(snapshot => snapshot.facilities.push({ id: "fee-policy", name: "Fee policy", address: "ab".repeat(32), instanceNonce: "12".repeat(32), maintenanceKey: "13".repeat(32), assetColor: "0".repeat(64), issuerRecipient: account.receivingAddress, merchants: [], agentSecret: "14".repeat(32), salt: "15".repeat(32), limit: 0n, outstanding: 0n, epoch: 0n, generation: 0n }));
    const target = window as any; target.feePolicyCalls = []; target.finalizedFeeUnits = "0"; target.feeSummaryAvailable = true;
    OrganizationNetwork.prototype.facilitySummary = async () => {
      if (!target.feeSummaryAvailable) throw Error("Fee summary unavailable");
      return { status: "NONE", registeredCircuits: 12, assetColor: "0".repeat(64), reserve: "1000000", encumbered: "0", paid: "0", feeFlat: "2", feeBps: "250", fees: target.finalizedFeeUnits, pendingFees: "3", domain: "16".repeat(32), balances: [{ color: "0".repeat(64), units: "1000000" }] };
    };
    OrganizationNetwork.prototype.openAllowance = async (...args) => { target.feePolicyCalls.push(args.map(String)); throw Error("Stopped before allowance approval"); };
    OrganizationNetwork.prototype.reserve = async (...args) => { target.feePolicyCalls.push(args.map(String)); throw Error("Stopped before fee withdrawal approval"); };
  });
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
  await page.getByText("Fee policy (optional)", { exact: true }).click();
  const flat = page.getByRole("textbox", { name: "Flat fee in asset base units", exact: true });
  const bps = page.getByRole("textbox", { name: "Fee rate in basis points", exact: true });
  await expect(flat).toHaveValue("0"); await expect(bps).toHaveValue("0");
  await page.getByLabel("Allowance in asset base units", { exact: true }).fill("1000000");
  await flat.fill("2"); await bps.fill("10001");
  await expect(bps).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Set agent allowance", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).feePolicyCalls.length)).toBe(0);
  await bps.fill("250");
  await page.getByRole("button", { name: "Set agent allowance", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Stopped before allowance approval");
  expect(await page.evaluate(() => (window as any).feePolicyCalls[0].slice(3))).toEqual(["2", "250"]);
  await page.getByText("Organization fees", { exact: true }).click();
  const withdraw = page.getByRole("button", { name: "Withdraw finalized fees", exact: true });
  await expect(withdraw).toBeDisabled();
  await expect(page.getByText("Pending fees: 3 base units", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).finalizedFeeUnits = "2"; });
  await page.getByRole("button", { name: "Refresh balances and suppliers", exact: true }).click();
  await expect(withdraw).toBeEnabled();
  await withdraw.click();
  await expect(page.getByRole("alert")).toContainText("Stopped before fee withdrawal approval");
  expect(await page.evaluate(() => (window as any).feePolicyCalls[1])).toEqual(["fee-policy", "withdrawFees"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/organization-product/fee-controls-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { (window as any).feeSummaryAvailable = false; });
  await page.getByRole("button", { name: "Refresh balances and suppliers", exact: true }).click();
  await expect(withdraw).toBeDisabled();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.getByText("Use a quote from another supplier", { exact: true }).click();
  const quote = { schema: "line:organization-quote/v1", contractAddress: "ab".repeat(32), domain: "16".repeat(32), merchantPk: "17".repeat(32), invoiceId: "18".repeat(32), quoteNonce: "19".repeat(32), amount: "25", expiry: String(Math.floor(Date.now() / 1000) + 3600), generation: "1", feeFlat: "2", feeBps: "250", quoteCommitment: "20".repeat(32) };
  await page.getByRole("textbox", { name: "Merchant quote package", exact: true }).fill(JSON.stringify(quote));
  await expect(page.getByText("Organization fee: 3 base units", { exact: true })).toBeVisible();
  await expect(page.getByText("Total allowance charge: 28 base units", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Merchant quote package", exact: true }).fill(JSON.stringify({ ...quote, feeBps: "10001" }));
  await expect(page.getByRole("button", { name: "Authorize purchase in wallet", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
});

test("hosted service checkout shows the whole charge and passes the reviewed fee ceiling", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, false, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const recipient = bech32m.encodeFromBytes("mn_addr_preprod", new Uint8Array(32).fill(52));
  await page.evaluate(async recipient => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    await account.edit(snapshot => snapshot.facilities.push({ id: "hosted-fees", name: "Hosted fee review", address: "ab".repeat(32), instanceNonce: "12".repeat(32), maintenanceKey: "13".repeat(32), assetColor: "0".repeat(64), issuerRecipient: account.receivingAddress, merchants: [{ name: "Account test supplier", publicKey: "11".repeat(32), address: recipient }], agentSecret: "14".repeat(32), salt: "15".repeat(32), limit: 100n, outstanding: 0n, epoch: 0n, generation: 1n }));
    OrganizationNetwork.prototype.facilitySummary = async () => ({ status: "OPEN", registeredCircuits: 12, assetColor: "0".repeat(64), reserve: "1000", encumbered: "0", paid: "0", feeFlat: "2", feeBps: "250", fees: "0", pendingFees: "0", domain: "16".repeat(32), balances: [] });
    OrganizationNetwork.prototype.purchaseService = async (...args) => { (window as any).reviewedServiceTerms = args.map(String); throw Error("Stopped before service approval"); };
  }, recipient);
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByText("Organization vault unlocked", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(page.getByText(/Organization fee: 3 base units.*Total allowance charge: 28 base units/)).toBeVisible();
  await page.getByRole("textbox", { name: "Document for the API services", exact: false }).fill("Review this document");
  await page.getByRole("button", { name: "Buy Account test supplier", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText("Stopped before service approval");
  expect(await page.evaluate(() => (window as any).reviewedServiceTerms)).toEqual(["hosted-fees", "test-service", "Review this document", "3"]);
  expect(await page.evaluate(() => ({ proofs: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proofs: 0, signatures: 0 });
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

test("organization sessions last twelve hours and still lock on request or wallet disconnect", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const sessionAt = (elapsed: number) => page.evaluate(async elapsed => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { isVaultSessionUnlocked } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const originalNow = Date.now, now = originalNow();
    try { Date.now = () => now + elapsed; return isVaultSessionUnlocked(); }
    finally { Date.now = originalNow; }
  }, elapsed);
  expect(await sessionAt(31 * 60_000)).toBe(true);
  expect(await sessionAt((12 * 60 - 1) * 60_000)).toBe(true);
  await page.getByRole("button", { name: "Lock organization", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Open your organization.", exact: true })).toBeVisible();
  await unlock(page); await disconnect(page);
  await expect(page.getByRole("heading", { name: "Start with your wallet.", exact: true })).toBeVisible();
  await connect(page, "a"); await unlock(page);
  expect(await sessionAt((12 * 60 + 1) * 60_000)).toBe(false);
  await expect(page.getByRole("heading", { name: "Open your organization.", exact: true })).toBeVisible();
});

test("clearing an unsubmitted candidate reports completion without preparing another transaction", async ({ page }) => {
  test.setTimeout(120_000);
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    // Synthetic unsubmitted candidate exercises the recovery UI and durable
    // discard, not financial acceptance or an actual wallet approval.
    await account.prepare({ id: crypto.randomUUID(), kind: "call", circuit: "redeemDraw", facilityId: null, contractAddress: "ab".repeat(32), sourceFingerprint: "ef".repeat(32), after: account.snapshot(), txId: null, transaction: null });
  });
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unsubmitted request cleared");
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create facility", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Lock organization", exact: true }).click();
  await unlock(page);
  await expect(page.getByRole("heading", { name: "Resolve the saved operation first.", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ({ proof: (window as any).organizationProofRequests, signatures: (window as any).organizationSignatures }))).toEqual({ proof: 0, signatures: 0 });
});

test("refresh recovers a failed facility read without signing or recreating the organization", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { OrganizationNetwork } = await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    // Synthetic facility and controlled read failure exercise UI recovery only.
    await account.edit(snapshot => snapshot.facilities.push({ id: "read-recovery", name: "Read recovery", address: "ab".repeat(32), instanceNonce: "12".repeat(32), maintenanceKey: "13".repeat(32), assetColor: "0".repeat(64), issuerRecipient: account.receivingAddress, merchants: [], agentSecret: "14".repeat(32), salt: "15".repeat(32), limit: 0n, outstanding: 0n, epoch: 0n, generation: 0n }));
    const state = window as unknown as { facilityReads: number; facilityAvailable: boolean }; state.facilityReads = 0; state.facilityAvailable = false;
    OrganizationNetwork.prototype.facilitySummary = async () => {
      state.facilityReads++;
      if (!state.facilityAvailable) throw Error("Temporary facility read limit");
      return { status: "NONE", registeredCircuits: 10, assetColor: "0".repeat(64), reserve: "0", encumbered: "0", paid: "0", feeFlat: "0", feeBps: "0", fees: "0", pendingFees: "0", domain: "16".repeat(32), balances: [] };
    };
  });
  await page.getByLabel("Organization vault password", { exact: true }).fill("Organization123!");
  await page.getByRole("button", { name: "Open organization", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Temporary facility read limit");
  await expect(page.locator(".organization-contract").getByText("Balance unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deposit assets", exact: true })).toBeDisabled();
  const before = await page.evaluate(() => { (window as any).facilityAvailable = true; return (window as any).facilityReads; });
  await page.getByRole("button", { name: "Refresh balances and suppliers", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish facility setup", exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("NONE · 10/12 circuit keys · Reserve accounting 0 · Principal paid 0", { exact: true })).toBeVisible();
  await expect(page.locator(".organization-contract").getByText("0 base units", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const requests = await page.evaluate(() => ({ reads: (window as any).facilityReads, signatures: (window as any).organizationSignatures, proofs: (window as any).organizationProofRequests }));
  expect(requests.reads).toBeGreaterThan(before); expect(requests.signatures).toBe(0); expect(requests.proofs).toBe(0);
});

test("verifier registrations are visibly distinct from financial calls to the same circuit", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    // Synthetic receipt metadata exercises presentation only, not chain acceptance.
    await account.edit(snapshot => snapshot.receipts.push(...(["key", "call"] as const).map((kind, i) => ({
      kind, circuit: "fundReserve", contractAddress: "ab".repeat(32), txId: String(i + 1).repeat(64),
      txHash: String(i + 3).repeat(64), blockHeight: i + 1, recordedAt: new Date().toISOString(),
    }))));
  });
  // Direct account reopening revokes the UI's previous vault session.
  await unlock(page);
  await expect(page.getByRole("cell", { name: "Register fundReserve verifier", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "fundReserve", exact: true })).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText("Encrypted backup download requested");
  await expect(page.getByRole("button", { name: "Encrypted backup", exact: true })).toBeEnabled();
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

test("an unlocked organization can export its encrypted backup during a wallet outage while deployment stays blocked", async ({ page }) => {
  await wallets(page, true, true); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  await page.getByLabel("Organization / agent name", { exact: true }).fill("Wallet outage recovery");
  await page.getByRole("button", { name: "Use my receiving wallet", exact: true }).click();
  await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const wallet = getConnectedWallet()!;
    const state = window as unknown as { failedWalletReads: number }; state.failedWalletReads = 0;
    for (const method of ["getConfiguration", "getConnectionStatus", "getShieldedAddresses", "getUnshieldedAddress"] as const) {
      wallet[method] = async () => { state.failedWalletReads++; throw Error("Request failed"); };
    }
  });
  const downloadEvent = page.waitForEvent("download", { timeout: 5_000 });
  await page.getByRole("button", { name: "Encrypted backup", exact: true }).click();
  const stream = await (await downloadEvent).createReadStream(), chunks: Buffer[] = [];
  if (!stream) throw Error("The actual encrypted backup download is missing");
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const backup = Buffer.concat(chunks).toString();
  expect(JSON.parse(backup).version).toBe(2); expect(backup).not.toContain("issuerSecret");
  await expect(page.getByRole("status")).toContainText("Encrypted backup download requested");
  expect(await page.evaluate(() => (window as unknown as { failedWalletReads: number }).failedWalletReads)).toBe(0);
  await page.getByRole("button", { name: "Create facility", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your wallet could not complete the network session check.");
  await expect(page.getByRole("alert")).toContainText("No signature or payment was requested by this check.");
  const requests = await page.evaluate(() => {
    const state = window as unknown as { failedWalletReads: number; organizationSignatures: number; organizationProofRequests: number };
    return { reads: state.failedWalletReads, signatures: state.organizationSignatures, proofs: state.organizationProofRequests };
  });
  expect(requests).toEqual({ reads: 1, signatures: 0, proofs: 0 });
});

test("encrypted backup cannot escape a vault lock during encryption", async ({ page }) => {
  await wallets(page); await page.goto("/app"); await connect(page, "a"); await unlock(page);
  const result = await page.evaluate(async () => {
    const { browserModuleUrl } = await import("/e2e/browser-module.ts" as any);
    const { OrganizationAccount } = await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const { getConnectedWallet } = await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const { lockVaultSession } = await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const account = await OrganizationAccount.unlock(getConnectedWallet()!, "Organization123!");
    const original = crypto.subtle.encrypt;
    let encrypted = false, rejected = false;
    crypto.subtle.encrypt = async function (...args: Parameters<typeof original>) {
      const output = await original.apply(this, args);
      encrypted = true; lockVaultSession(); return output;
    };
    try { await account.encryptedBackup(); } catch { rejected = true; }
    finally { crypto.subtle.encrypt = original; }
    return { encrypted, rejected };
  });
  expect(result).toEqual({ encrypted: true, rejected: true });
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

async function stagedAgentFixture(page: Page, rejectSignature = false) {
  // Dedicated test wallet only. Chain verification is a controlled boundary;
  // this fixture never proves, pays, activates a runner or contacts an extension.
  const key=ownershipLedger.sampleSigningKey(),verifyingKey=ownershipLedger.signatureVerifyingKey(key);
  const address=bech32m.encodeFromBytes("mn_addr_preprod",Buffer.from(ownershipLedger.addressFromKey(verifyingKey),"hex"));
  let authorizations=0;
  await page.exposeFunction("controlledAgentOwnerSign",(message:string)=>{
    if (!message.startsWith("Line autonomous purchasing authorization\n")) throw Error("Unexpected fixture signature request");
    authorizations++;
    if (rejectSignature) throw Error("Controlled owner rejection");
    return {data:message,verifyingKey,signature:ownershipLedger.signData(key,new TextEncoder().encode(`midnight_signed_message:${Buffer.byteLength(message,"utf8")}:`+message))};
  });
  await wallets(page,true,true);
  await page.addInitScript(address=>{
    const provider=(window as any).midnight.a,connect=provider.connect;
    provider.connect=async(...args:any[])=>{
      const api=await connect(...args);
      api.getUnshieldedAddress=async()=>({unshieldedAddress:address});
      api.signData=(message:string)=>(window as any).controlledAgentOwnerSign(message);
      return api;
    };
  },address);
  await page.goto("/app");await connect(page,"a");await unlock(page);
  const staged=await page.evaluate(async()=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount,bytes32}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {getConnectedWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const {merchantPublicKey,randomBytes32,toHex}=await import(browserModuleUrl("/src/lib/line/encoding.ts"));
    const {generateX25519KeyPair}=await import(browserModuleUrl("/src/lib/agent/pairing.ts"));
    const account=await OrganizationAccount.unlock(getConnectedWallet()!,"Organization123!"),facilityId=crypto.randomUUID();
    await account.edit(snapshot=>snapshot.facilities.push({id:facilityId,name:"Controlled delegated facility",address:"ab".repeat(32),instanceNonce:toHex(randomBytes32()),maintenanceKey:"33".repeat(32),assetColor:"00".repeat(32),issuerRecipient:account.receivingAddress,merchants:[{name:"Controlled merchant",publicKey:toHex(merchantPublicKey(bytes32(snapshot.merchantSecret))),address:account.receivingAddress}],agentSecret:toHex(randomBytes32()),salt:toHex(randomBytes32()),limit:1000000n,outstanding:0n,epoch:0n,generation:2n}));
    const beforeBackup=JSON.stringify(await account.encryptedBackup()),runner=await generateX25519KeyPair();
    const pinned={runnerOrigin:"http://127.0.0.1:8000",runnerPublicKey:runner.publicKeyHex,runnerSigningPublicKey:"55".repeat(32)};
    const request={offer:{schema:"line:agent-pairing-offer/v1" as const,...pinned,offerNonce:toHex(randomBytes32()),timestamp:Date.now()},pinned,sourceFingerprint:"cd".repeat(32),expiresAt:Date.now()+3600_000,maxSpend:"100000",maxFee:"1500",allowedServices:["line-doc-extract-v1"],allowedMerchants:[account.snapshot().facilities[0].merchants[0].publicKey]};
    const review=await account.stageAgentDelegation(facilityId,request,async()=>{});
    return {grantId:review.scope.grantId,facilityId,beforeBackup,runnerPrivateKey:runner.privateKeyHex,accountId:account.accountId};
  });
  return {...staged,authorizations:()=>authorizations};
}

test("agent delegation staging survives refresh and blocks writes while permitting a fenced emergency pause",async({page})=>{
  test.setTimeout(90_000);
  const fixture=await stagedAgentFixture(page);
  await page.reload();
  await expect(page.getByText("Organization vault unlocked",{exact:true})).toBeVisible();
  const result=await page.evaluate(async({facilityId,beforeBackup})=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {OrganizationNetwork}=await import(browserModuleUrl("/src/lib/organization/network.ts"));
    const {getConnectedWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account=await OrganizationAccount.unlock(getConnectedWallet()!,"Organization123!");
    let blocked=0,calls=0,paused=false;
    const stale=structuredClone((account as any).record);delete stale.delegations;(account as any).record=stale;
    await account.save();
    const refuse=async(action:()=>Promise<unknown>)=>{try{await action();}catch{blocked++;}};
    await refuse(()=>account.edit(snapshot=>{snapshot.facilities[0].limit+=1n;}));
    await refuse(()=>account.exclusive(()=>account.prepare({id:crypto.randomUUID(),kind:"call",circuit:"draw",facilityId:null,contractAddress:"ab".repeat(32),sourceFingerprint:"cd".repeat(32),after:account.snapshot(),txId:null,transaction:null})));
    await refuse(()=>account.restoreBackup(beforeBackup,"Organization123!",async()=>{}));
    const client=new (OrganizationNetwork as any)(account,{}, {sourceFingerprint:"cd".repeat(32)},()=>{},{});
    client.inspect=async()=>({});
    client.transactions={finality:{forget(){}},call:async(address:string,circuit:string,args:number[])=>{
      calls++;paused=args[0]===2;
      const txId="00"+"ee".repeat(32);
      await account.submitted(txId,"abcd",address);
      return {identifiers:[txId],blockHeight:1,txHash:"ff".repeat(32),status:"SucceedEntirely"};
    }};
    await refuse(()=>client.status(facilityId,"resume"));
    await refuse(()=>client.status(facilityId,"close"));
    await client.status(facilityId,"pause");
    const review=account.agentDelegationReviews()[0];
    return {blocked,calls,paused,phase:review.phase,pending:account.pending(),receipts:account.snapshot().receipts.length,limit:account.snapshot().facilities[0].limit.toString(),signatures:(window as any).organizationSignatures};
  },{facilityId:fixture.facilityId,beforeBackup:fixture.beforeBackup});
  expect(result).toEqual({blocked:5,calls:1,paused:true,phase:"staged",pending:null,receipts:1,limit:"1000000",signatures:0});
  expect(fixture.authorizations()).toBe(0);
});

test("agent delegation exports only its durable encrypted original and repeats it after refresh without signing again",async({page})=>{
  test.setTimeout(90_000);
  const fixture=await stagedAgentFixture(page);
  const original=await page.evaluate(async({grantId,runnerPrivateKey})=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {getConnectedWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const {browserAgentGrantDigest}=await import(browserModuleUrl("/src/lib/agent/grant.ts"));
    const {decryptBookOpening}=await import(browserModuleUrl("/src/lib/agent/pairing.ts"));
    const account=await OrganizationAccount.unlock(getConnectedWallet()!,"Organization123!");
    const packet=await account.authorizeAgentDelegation(grantId,async()=>{});
    const book=await decryptBookOpening({envelope:packet.encryptedOpening,expectedPurpose:"line:agent-pairing/v1",expectedGrantDigest:await browserAgentGrantDigest(packet.scope),expectedNonce:packet.offerNonce,recipientPrivateKeyHex:runnerPrivateKey});
    return {packet:JSON.stringify(packet),phase:account.agentDelegationReviews()[0].phase,fields:Object.keys(book).sort(),secretMatches:book.agentSecret===account.snapshot().facilities[0].agentSecret};
  },{grantId:fixture.grantId,runnerPrivateKey:fixture.runnerPrivateKey});
  expect(original.phase).toBe("export-ready");expect(original.secretMatches).toBe(true);
  expect(original.fields).toEqual(["agentSecret","epoch","generation","limit","outstanding","salt"]);
  expect(original.packet).not.toContain("issuerSecret");expect(original.packet).not.toContain("merchantSecret");expect(original.packet).not.toContain("Organization123!");
  await page.reload();
  await expect(page.getByText("Organization vault unlocked",{exact:true})).toBeVisible();
  const repeated=await page.evaluate(async grantId=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {getConnectedWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const account=await OrganizationAccount.unlock(getConnectedWallet()!,"Organization123!");
    return JSON.stringify(await account.authorizeAgentDelegation(grantId,async()=>{throw Error("An exact retained export must not prepare another delegation");}));
  },fixture.grantId);
  expect(repeated).toBe(original.packet);expect(fixture.authorizations()).toBe(1);
});

test("an aborted agent delegation export never returns a package or clears its durable staged fence",async({page})=>{
  test.setTimeout(90_000);
  const fixture=await stagedAgentFixture(page);
  const result=await page.evaluate(async grantId=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount,organizationAccountKey}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {getConnectedWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const {loadEncryptedJson}=await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const account=await OrganizationAccount.unlock(getConnectedWallet()!,"Organization123!"),put=IDBObjectStore.prototype.put;
    let writes=0;
    IDBObjectStore.prototype.put=function(...args:Parameters<typeof put>){writes++;const request=put.apply(this,args);request.addEventListener("success",()=>this.transaction.abort(),{once:true});return request;};
    let returned=false,rejected=false;
    try{await account.authorizeAgentDelegation(grantId,async()=>{});returned=true;}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
    const disk=await loadEncryptedJson(organizationAccountKey("preprod",account.accountId),"Organization123!");
    return {returned,rejected,writes,phase:account.agentDelegationReviews()[0].phase,diskPhase:disk.delegations[0].phase,packet:disk.delegations[0].package};
  },fixture.grantId);
  expect(result).toEqual({returned:false,rejected:true,writes:1,phase:"staged",diskPhase:"staged",packet:null});
  expect(fixture.authorizations()).toBe(1);
});

for (const failure of ["owner rejection","wallet change"] as const) test(`agent delegation keeps its staged fence after ${failure}`,async({page})=>{
  test.setTimeout(90_000);
  const fixture=await stagedAgentFixture(page,failure==="owner rejection");
  const result=await page.evaluate(async({grantId,accountId,changeWallet})=>{
    const {browserModuleUrl}=await import("/e2e/browser-module.ts" as any);
    const {OrganizationAccount,organizationAccountKey}=await import(browserModuleUrl("/src/lib/organization/account.ts"));
    const {getConnectedWallet,disconnectWallet}=await import(browserModuleUrl("/src/lib/runtime/wallet.ts"));
    const {loadEncryptedJson}=await import(browserModuleUrl("/src/lib/security/vault.ts"));
    const wallet=getConnectedWallet()!,account=await OrganizationAccount.unlock(wallet,"Organization123!");
    if (changeWallet) {
      const sign=wallet.signData.bind(wallet);
      wallet.signData=async(...args:Parameters<typeof sign>)=>{const proof=await sign(...args);await disconnectWallet();return proof;};
    }
    let returned=false,rejected=false;
    try{await account.authorizeAgentDelegation(grantId,async()=>{});returned=true;}catch{rejected=true;}
    const disk=await loadEncryptedJson(organizationAccountKey("preprod",accountId),"Organization123!");
    return {returned,rejected,phase:disk.delegations[0].phase,packet:disk.delegations[0].package,pending:disk.pending};
  },{grantId:fixture.grantId,accountId:fixture.accountId,changeWallet:failure==="wallet change"});
  expect(result).toEqual({returned:false,rejected:true,phase:"staged",packet:null,pending:null});
  expect(fixture.authorizations()).toBe(1);
});
