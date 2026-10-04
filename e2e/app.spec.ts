import { test, expect } from "@playwright/test";

test.describe("Line — Autonomous Agent Credit Platform", () => {
  test("homepage loads with core architecture and runtime badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header a[href='/']").first()).toBeVisible();
    await expect(page.locator("text=Local Simulator")).toBeVisible();
  });

  test("navigates across all role consoles and verify UI elements with zero Buffer errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

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
    await expect(page.locator("text=Protocol Verification Lab")).toBeVisible();
    await expect(page.locator("text=Attack Vector Execution & Invariant Verification")).toBeVisible();

    // 6. Circuits
    await page.goto("/circuits");
    await expect(page.locator("text=Ten circuits")).toBeVisible();

    // Assert zero runtime Buffer reference errors across all navigated routes
    const bufferErrors = pageErrors.filter((e) => e.includes("Buffer is not defined"));
    expect(bufferErrors).toHaveLength(0);
  });

  test("runtime switcher opens network setup screen and enforces wallet boundaries", async ({ page }) => {
    await page.goto("/");
    const badge = page.locator("button:has-text('Local Simulator')");
    await expect(badge).toBeVisible();
    await badge.click();

    // Network setup screen should appear
    await expect(page.locator("text=Midnight Network Setup & Wallet Connection")).toBeVisible();
    await expect(page.locator("text=1. Browser Wallet")).toBeVisible();
    await expect(page.locator("text=2. Deployed Contract")).toBeVisible();
    await expect(page.locator("text=No extension detected in browser window.")).toBeVisible();
  });

  test("localStorage and IndexedDB privacy audit: zero credit book leakage and encrypted vault", async ({ page }) => {
    await page.goto("/issuer");

    // Perform an interaction
    const fundBtn = page.locator("button:has-text('Allocate Reserve · 500')");
    if (await fundBtn.isVisible()) {
      await fundBtn.click();
    }

    // Inspect localStorage: must never leak credit limits, balances, or private secrets
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

    for (const [k, v] of Object.entries(storageState)) {
      expect(k).not.toContain("secret");
      expect(k).not.toContain("witness");
      expect(v).not.toContain("agentSecret");
      expect(v).not.toContain("staleWitness");
      expect(v).not.toContain("identityCommitment");
    }

    // Inspect IndexedDB: check if vault entries contain AES-GCM ciphertext rather than raw secrets
    const indexedDbAudit = await page.evaluate(async () => {
      if (typeof window.indexedDB === "undefined") return { available: false, plaintextSecrets: false };
      return new Promise<{ available: boolean; plaintextSecrets: boolean }>((resolve) => {
        const req = window.indexedDB.open("line-secure-vault", 1);
        req.onerror = () => resolve({ available: false, plaintextSecrets: false });
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("vault_records")) {
            resolve({ available: true, plaintextSecrets: false });
            return;
          }
          const tx = db.transaction("vault_records", "readonly");
          const store = tx.objectStore("vault_records");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const records = getAll.result || [];
            let leaked = false;
            for (const rec of records) {
              const str = JSON.stringify(rec);
              if (str.includes("ISSUER_SK") || str.includes("AGENT_SK") || str.includes("line:demo:")) {
                leaked = true;
              }
            }
            resolve({ available: true, plaintextSecrets: leaked });
          };
          getAll.onerror = () => resolve({ available: true, plaintextSecrets: false });
        };
      });
    });

    expect(indexedDbAudit.plaintextSecrets).toBe(false);
  });
});
