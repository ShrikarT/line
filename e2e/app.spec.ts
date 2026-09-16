import { test, expect } from "@playwright/test";

test.describe("Line — Autonomous Agent Credit Platform", () => {
  test("homepage loads with core architecture and runtime badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Line Private credit" })).toBeVisible();
    await expect(page.locator("text=Local Simulator")).toBeVisible();
  });

  test("navigates across all role consoles and verify UI elements", async ({ page }) => {
    // 1. Issuer Console
    await page.goto("/issuer");
    await expect(page.locator("text=Issuer desk")).toBeVisible();
    await expect(page.locator("text=Allocate Reserve · 500")).toBeVisible();
    await expect(page.locator("text=Open line · 150")).toBeVisible();

    // 2. Merchant Console
    await page.goto("/merchant");
    await expect(page.locator("text=Merchant desk")).toBeVisible();
    await expect(page.locator("text=Active Merchant:")).toBeVisible();
    await expect(page.locator("text=Merchant A")).toBeVisible();
    await expect(page.locator("text=Merchant B")).toBeVisible();

    // 3. Agent Console
    await page.goto("/agent");
    await expect(page.locator("text=Agent console")).toBeVisible();
    await expect(page.locator("text=Private books & Draw Notes")).toBeVisible();

    // 4. Public Explorer
    await page.goto("/explorer");
    await expect(page.locator("text=Public ledger")).toBeVisible();
    await expect(page.locator("text=Total Reserve")).toBeVisible();
    await expect(page.locator("text=Encumbered")).toBeVisible();

    // 5. Attack Lab
    await page.goto("/lab");
    await expect(page.getByRole("heading", { name: "Attack Lab" })).toBeVisible();

    // 6. Circuits
    await page.goto("/circuits");
    await expect(page.locator("text=Ten circuits")).toBeVisible();
  });

  test("runtime switcher opens network setup screen", async ({ page }) => {
    await page.goto("/");
    const badge = page.locator("button:has-text('Local Simulator')");
    await expect(badge).toBeVisible();
    await badge.click();

    // Network setup screen should appear
    await expect(page.locator("text=Midnight Network Setup & Wallet Connection")).toBeVisible();
    await expect(page.locator("text=1. Browser Wallet")).toBeVisible();
    await expect(page.locator("text=2. Deployed Contract")).toBeVisible();
  });

  test("localStorage privacy audit: zero credit book leakage", async ({ page }) => {
    await page.goto("/issuer");

    // Perform an interaction
    const fundBtn = page.locator("button:has-text('Allocate Reserve · 500')");
    if (await fundBtn.isVisible()) {
      await fundBtn.click();
    }

    // Inspect localStorage
    const storageState = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const items: Record<string, string> = {};
      for (const k of keys) {
        items[k] = localStorage.getItem(k) || "";
      }
      return items;
    });

    // Verify no legacy plaintext line.protocol.v3
    expect(storageState["line.protocol.v3"]).toBeUndefined();

    // Inspect all values in localStorage to ensure no secrets or credit limits leaked
    for (const [k, v] of Object.entries(storageState)) {
      expect(k).not.toContain("secret");
      expect(k).not.toContain("witness");
      expect(v).not.toContain("agentSecret");
      expect(v).not.toContain("staleWitness");
      expect(v).not.toContain("identityCommitment");
    }
  });
});
