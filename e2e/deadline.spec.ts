import { test, expect } from "@playwright/test";

test("role consoles display the agreed UTC deadline and confirmed redeemed status", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/merchant");
  const expiry = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts" as any);
    const { setRuntime, InMemoryTestRuntime } = await import("/src/lib/runtime/index.ts" as any);
    setRuntime(new InMemoryTestRuntime());
    const store = useAppStore.getState();
    if (!await store.unlockVault("BrowserDeadlinePassword123!")) throw new Error("Vault setup failed");
    for (const role of ["issuer", "merchant", "agent"]) await store.generateIdentity(role);
    if (!await store.doFundReserve(200) || !await store.doRegisterMerchant() || !await store.doOpen(100) || !await store.doQuote(25, "deadline-browser-invoice"))
      throw new Error("Facility or quote failed");
    const quote = useAppStore.getState().merchantQuotes[0];
    if (!await store.doDraw(quote.quoteCommitment)) throw new Error("Draw failed");
    return quote.expiry;
  });
  expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
  await expect(page.getByText("Claim active", { exact: true })).toBeVisible();
  const iso = new Date(expiry * 1000).toISOString();
  await expect(page.locator(`time[datetime="${iso}"]`)).toHaveCount(2);
  const redeem = page.getByRole("button", { name: "Redeem 25 against Reserve", exact: true });
  await redeem.click();
  await expect(page.getByText("Claim redeemed", { exact: true })).toBeVisible();
  await expect(redeem).toBeDisabled();
  await page.locator('a[href="/agent"]').first().click();
  await expect(page.locator(`time[datetime="${iso}"]`)).toHaveCount(1);
  await expect(page.getByText("Vault Unlocked", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Claim redeemed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redeem 25 against Reserve", exact: true })).toBeDisabled();
  await page.goForward();
  await expect(page.locator(`time[datetime="${iso}"]`)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("issuer sets fixed fee terms and both buyer and merchant see the complete price", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/issuer");
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts" as any);
    const { setRuntime, InMemoryTestRuntime } = await import("/src/lib/runtime/index.ts" as any);
    setRuntime(new InMemoryTestRuntime());
    const store = useAppStore.getState();
    if (!await store.unlockVault("BrowserPricingPassword123!")) throw new Error("Vault setup failed");
    for (const role of ["issuer", "merchant", "agent"]) await store.generateIdentity(role);
    if (!await store.doFundReserve(500) || !await store.doRegisterMerchant()) throw new Error("Issuer setup failed");
  });
  await page.getByLabel("Flat fee (units)").fill("3");
  await page.getByLabel("Fee rate (basis points)").fill("250");
  await page.getByRole("button", { name: /Open line/ }).click();
  await expect(page.getByText("Credit line opened. Encrypted opening saved.", { exact: true })).toBeVisible();
  await page.locator('a[href="/merchant"]').first().click();
  await page.getByRole("button", { name: "Quote 40 (A)", exact: true }).click();
  const disclosedPrice = "Merchant price: 40 · Line fee: 4 · Added debt: 44 units";
  await expect(page.getByText(disclosedPrice, { exact: true })).toBeVisible();
  await page.locator('a[href="/agent"]').first().click();
  await expect(page.getByText(disclosedPrice, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Draw & Issue Note", exact: true }).click();
  await expect(page.getByText("Note 40 units", { exact: true })).toBeVisible();
  const accounting = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts" as any);
    const { ledger, agentLineRecord } = useAppStore.getState();
    return { feeFlat: ledger.feeFlat, feeBps: ledger.feeBps, debt: agentLineRecord?.outstanding,
      encumbered: ledger.encumberedReserve, fees: ledger.feeReserve, pendingFees: ledger.pendingFeeReserve };
  });
  expect(accounting).toEqual({ feeFlat: 3, feeBps: 250, debt: 44, encumbered: 40, fees: 0, pendingFees: 4 });
  expect(errors).toEqual([]);
});
