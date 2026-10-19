import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const address = "mn_addr_preprod1vflat69hjj5n2m8ftfwwspp2vssf7ckjay22qcp8p9lxedv4hgjszhshk3";
async function injectWallet(page: Page, behavior: "success" | "reject-once" | "wrong-network" = "success") {
  await page.addInitScript(({ address, behavior }) => {
    let attempts = 0;
    const testWindow = window as unknown as { midnight: unknown; walletCalls: string[] };
    testWindow.walletCalls = [];
    testWindow.midnight = {
      unsupported: { name: "Unavailable wallet" },
      lace: {
        name: "Midnight Lace", rdns: "io.test.lace", apiVersion: "4.0.1",
        connect: async (network: string) => {
          testWindow.walletCalls.push(`connect:${network}`);
          if (behavior === "reject-once" && ++attempts === 1) throw new Error("User rejected connection");
          return {
            getConfiguration: async () => ({ networkId: behavior === "wrong-network" ? "preview" : network }),
            getUnshieldedAddress: async () => ({ unshieldedAddress: address }),
            getConnectionStatus: async () => ({ status: "connected", networkId: network }),
            getShieldedAddresses: async () => ({}),
            balanceUnsealedTransaction: async () => { testWindow.walletCalls.push("balance"); throw new Error("Must never balance during onboarding"); },
            submitTransaction: async () => { testWindow.walletCalls.push("submit"); throw new Error("Must never submit during onboarding"); },
          };
        },
      },
    };
  }, { address, behavior });
}

for (const width of [1440, 390]) {
  test(`wallet is visible, no-extension state and workspace work at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    const posts: string[] = [];
    page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect your wallet.", exact: true })).toBeVisible();
    await expect(page.getByText("No compatible Midnight wallet detected yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Wallet setup guide" })).toHaveAttribute("href", "https://docs.midnight.network/getting-started/installation");
    await page.getByRole("link", { name: "Continue to workspace" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your treasury");
    await expect(page.getByRole("heading", { name: "Start with your wallet." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open test-token checkout" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await mkdir("test-results/wallet-onboarding", { recursive: true });
    await page.screenshot({ path: `test-results/wallet-onboarding/workspace-${width}.png`, fullPage: true });
    expect(posts).toEqual([]);
  });
}

test("selected wallet connects, survives navigation, copies and disconnects without signing", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await injectWallet(page);
  await page.goto("/app");
  await page.locator("header").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Midnight Lace", exact: true }).click();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(page.getByText("preprod", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(page.getByRole("button", { name: "Address copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  await page.screenshot({ path: "test-results/wallet-onboarding/connected.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "test-results/wallet-onboarding/connected-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Continue to workspace" }).click();
  await page.getByRole("link", { name: "Agent purchases", exact: true }).click();
  await expect(page.locator("header").getByRole("button", { name: "Manage connected wallet" })).toBeVisible();
  await page.locator("header").getByRole("button", { name: "Manage connected wallet" }).click();
  await page.getByRole("button", { name: "Disconnect from Line" }).click();
  await expect(page.getByRole("heading", { name: "Connect your wallet.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { walletCalls: string[] }).walletCalls)).toEqual(["connect:preprod"]);
  await page.reload();
  await expect(page.locator("header").getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { walletCalls: string[] }).walletCalls)).toEqual([]);
});

test("rejected connection can be retried", async ({ page }) => {
  await injectWallet(page, "reject-once");
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Midnight Lace", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Connection declined");
  await expect(page.getByRole("heading", { name: "Your wallet is connected." })).toHaveCount(0);
  await page.getByRole("button", { name: "Midnight Lace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your wallet is connected." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("wrong network never displays a connected account", async ({ page }) => {
  await injectWallet(page, "wrong-network");
  await page.goto("/test-payout");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("button", { name: "Midnight Lace", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wallet network does not match");
  await expect(page.getByRole("heading", { name: "Your wallet is connected." })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Operator-run demo", { exact: true })).toBeVisible();
});

test("mobile wallet dialog exposes advanced facility setup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/issuer");
  await page.locator("header").getByRole("button", { name: "Connect wallet", exact: true }).click();
  await page.getByRole("link", { name: "Advanced: connect an existing canonical contract" }).click();
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole("heading", { name: "Connect a facility." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Midnight Wallet", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
