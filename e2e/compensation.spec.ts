import { test, expect } from "@playwright/test";

test("expired purchase credits debt, reports the private cash remainder and retains backing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/agent");
  const noteCommit = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts" as any);
    const { setRuntime, InMemoryTestRuntime } = await import("/src/lib/runtime/index.ts" as any);
    let now = Math.floor(Date.now() / 1000);
    setRuntime(new InMemoryTestRuntime(undefined, { clock: () => now }));
    const store = useAppStore.getState();
    if (!await store.unlockVault("BrowserCompensationPassword123!")) throw new Error("Vault setup failed");
    for (const role of ["issuer", "merchant", "agent"]) await store.generateIdentity(role);
    if (!await store.doFundReserve(200) || !await store.doRegisterMerchant() || !await store.doOpen(100, { feeFlat: 5, feeBps: 0 }) ||
        !await store.doQuote(40, "browser-expired-purchase")) throw new Error("Facility setup failed");
    const quote = useAppStore.getState().merchantQuotes[0];
    if (!await store.doDraw(quote.quoteCommitment) || !await store.doAck(20, "browser-prior-repayment")) throw new Error("Purchase or repayment failed");
    now = quote.expiry;
    Date.now = () => now * 1000;
    // The console's 10,000-second claim deadline exceeds the vault session.
    // Recover the actual encrypted opening after timeout before authorizing.
    if (!await store.unlockVault("BrowserCompensationPassword123!")) throw new Error("Expired vault recovery failed");
    return useAppStore.getState().drawNotes[0].noteCommitment;
  });
  await page.getByRole("button", { name: "Allocate expired claim compensation", exact: true }).click();
  await expect(page.getByText("Private debt credit: 25 units. Private cash refund obligation: 20 units.", { exact: true })).toBeVisible();
  await page.locator('a[href="/issuer"]').first().click();
  await page.getByLabel("Actual off-chain refund reference").fill("browser-outgoing-refund-20");
  await page.getByRole("button", { name: "Record issuer refund report", exact: true }).click();
  await expect(page.getByText("Issuer reported the refund; cash transfer remains unverified and full backing stays locked.", { exact: true })).toBeVisible();
  const state = await page.evaluate(async () => {
    const { useAppStore } = await import("/src/app/store.ts" as any);
    const { ledger, agentLineRecord, refunds } = useAppStore.getState();
    return { debt: agentLineRecord?.outstanding, pending: ledger.pendingFeeReserve, earned: ledger.feeReserve,
      held: ledger.refundReserve, reported: ledger.reportedRefundReserve, available: ledger.withdrawableReserve,
      total: ledger.totalReserve, refund: refunds[0] };
  });
  expect(state).toMatchObject({ debt: 0, pending: 0, earned: 0, held: 0, reported: 45, available: 155, total: 200,
    refund: { noteCommitment: noteCommit, amount: 20, allocatedCredit: 25, status: "issuer-reported", paymentReference: "browser-outgoing-refund-20" } });
  await page.locator('a[href="/explorer"]').first().click();
  await expect(page.getByText("Private debt credit:", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Private cash refund obligation:", { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});
