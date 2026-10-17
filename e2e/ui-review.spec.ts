import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const routes = ["/", "/app", "/organization", "/agents", "/suppliers", "/connect", "/preprod", "/test-payout", "/checkout", "/issuer", "/agent", "/merchant", "/explorer", "/circuits", "/lab", "/roadmap", "/privacy", "/missing-page"];
const output = path.resolve(process.env.LINE_UI_ARTIFACT_DIR ?? "artifacts/ui-redesign");
test.beforeEach(async ({ page }) => {
  // Visual review must never submit a funded transaction or access wallet material.
  await page.route("**/api/preprod/**", route => route.fulfill({ json: {
    network: "preprod", contractAddress: "ab".repeat(32), phase: "ready", progress: "Ready", busy: false, pending: null,
    privateBook: { limit: 60, outstanding: 0, remaining: 60 }, orders: [], receipts: [], settlement: "test", custody: "test",
  } }));
});

for (const width of [1440, 390]) {
  test(`all redesigned routes render without overflow at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route);
      // The pinned SDK initializes WASM on a fresh document; allow cold startup
      // while the full core suite or production bundler is using this machine.
      await expect(page.locator("main h1"), `render ${route}`).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow on ${route}`).toBe(true);
      await page.screenshot({ path: path.join(output, `${route === "/" ? "home" : route.slice(1)}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

test("landing FAQ and real workspace navigation are keyboard accessible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "What stays private?", exact: true }).click();
  await expect(page.getByText("The credit limit, debt and remaining capacity are private witnesses, not plaintext ledger fields.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "Agent purchases", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("circuit role filters and search compose and can recover from empty results", async ({ page }) => {
  await page.goto("/circuits");
  await page.getByRole("tab", { name: "Merchant", exact: true }).click();
  await expect(page.getByText("2 of 12 shown", { exact: true })).toBeVisible();
  await page.getByLabel("Search circuits").fill("redeem");
  await page.getByRole("button", { name: /redeemDraw/ }).click();
  await expect(page.getByRole("heading", { name: "What it proves" })).toBeVisible();
  await page.getByLabel("Search circuits").fill("no-such-circuit");
  await expect(page.getByRole("heading", { name: "No matching circuits." })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("12 of 12 shown", { exact: true })).toBeVisible();
});

test("expanded reference sections and delivered results remain usable on mobile", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/roadmap", "/circuits"]) {
    await page.goto(route);
    const triggers = page.locator('[data-slot="accordion-trigger"]');
    await expect(triggers).toHaveCount(route === "/roadmap" ? 6 : 12);
    for (const trigger of await triggers.all()) {
      if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    }
    await expect(page.locator('[data-slot="accordion-content"][data-state="open"]')).toHaveCount(route === "/roadmap" ? 6 : 12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `${route.slice(1)}-expanded-390.png`), fullPage: true });
  }
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Open evaluation line", exact: true }).click();
  await page.getByRole("button", { name: "Run agent purchase plan", exact: true }).click();
  await expect(page.getByRole("region", { name: "Merchant A service result" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Merchant B service result" })).toBeVisible();
  await page.getByRole("region", { name: "Merchant A service result" }).getByText("Full service response", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Merchant A service result" }).locator("pre")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "checkout-delivered-390.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "checkout-delivered-1440.png"), fullPage: true });
  await page.goto("/issuer");
  await page.getByLabel("Vault passphrase", { exact: true }).fill("VisualReviewVault123!");
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await page.getByRole("button", { name: "Generate Role Credentials", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate Role Credentials", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Allocate Reserve/ }).click();
  await page.getByRole("button", { name: /Open line/ }).click();
  await expect(page.getByText("Credit line opened. Encrypted opening saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Register vault merchant", exact: true }).click();
  await expect(page.getByText(/Merchant registered in Compact registry/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "issuer-populated-1440.png"), fullPage: true });
  await page.getByRole("link", { name: "Merchant console", exact: true }).click();
  await page.getByRole("button", { name: "Quote 40 (A)", exact: true }).click();
  await expect(page.getByText("Quote posted by Merchant A for 40 units.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Agent console", exact: true }).click();
  await page.getByRole("button", { name: "Draw & Issue Note", exact: true }).click();
  await expect(page.getByText("Note 40 units", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, "agent-populated-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(output, "agent-populated-390.png"), fullPage: true });
});
