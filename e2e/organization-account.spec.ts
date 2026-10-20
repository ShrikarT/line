import { expect, test, type Page } from "@playwright/test";
import { bech32m } from "@scure/base";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
    for (const method of ["getConfiguration", "getShieldedAddresses", "getUnshieldedAddress"] as const) {
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
  await expect(page.getByRole("alert")).toContainText("Request failed");
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
