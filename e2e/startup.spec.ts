import { expect, test } from "@playwright/test";

for (const path of ["/", "/app"]) {
  test(`wallet connection on ${path} does not wait for contract engines`, async ({ page }) => {
    let release!: () => void;
    const requestedEngines: string[] = [];
    const engines = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\.wasm(?:\?|$)/, async route => {
      requestedEngines.push(route.request().url());
      await engines;
      await route.continue().catch(() => {});
    });
    await page.addInitScript(() => {
      Object.assign(window, { midnight: { startup: {
        name: "Startup test wallet", rdns: "test.startup", apiVersion: "4.0.1",
        connect: async (networkId: string) => ({
          getConfiguration: async () => ({ networkId }),
          getUnshieldedAddress: async () => ({ unshieldedAddress: "startup-receiving-address" }),
          getConnectionStatus: async () => ({ status: "connected", networkId }),
          getShieldedAddresses: async () => { throw new Error("Connection does not need proving keys"); },
          balanceUnsealedTransaction: async () => { throw new Error("No transaction authorized"); },
          submitTransaction: async () => { throw new Error("No transaction authorized"); },
        }),
      } } });
    });
    try {
      await page.goto(path, { waitUntil: "commit" });
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 8_000 });
      await page.locator("header").getByRole("button", { name: "Connect wallet", exact: true }).click();
      await page.getByRole("button", { name: "Startup test wallet", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your wallet is connected.", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Continue to workspace", exact: true }).click();
      await expect(page.getByLabel("Organization vault password", { exact: true })).toBeVisible();
      expect(requestedEngines).toEqual([]);
      // Disconnecting while deferred SDK loading is pending must revoke the unlock.
      await page.getByLabel("Organization vault password", { exact: true }).fill("StartupTest123!");
      await page.getByRole("button", { name: "Open organization", exact: true }).click();
      await expect.poll(() => requestedEngines.length).toBeGreaterThan(0);
      await page.locator("header").getByRole("button", { name: "Manage connected wallet", exact: true }).click();
      await page.getByRole("button", { name: "Disconnect from Line", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Connect your wallet.", exact: true })).toBeVisible();
      release();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      // Wait for the deferred unlock itself to settle. SharedWorker startup can
      // keep browser network-idle pending after the UI operation is complete.
      await expect(page.locator(".network-status")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Start with your wallet.", exact: true })).toBeVisible();
      await expect(page.getByText("Organization vault unlocked", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally { release(); }
  });
}

test("a failed workspace download offers recovery instead of a blank page", async ({ page }) => {
  await page.route(/\/(?:src\/pages\/organization-workspace\.tsx|assets\/organization-workspace-[^/]+\.js)(?:\?|$)/, route => route.abort());
  await page.goto("/app", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Line could not load this workspace.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Line", exact: true })).toBeEnabled();
});
