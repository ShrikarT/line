import { test, expect } from "@playwright/test";

test.describe("Line — Autonomous Agent Credit Platform", () => {
  test("homepage loads with core architecture and runtime badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header a[href='/']").first()).toBeVisible();
    await expect(page.locator("text=Local Simulator")).toBeVisible();
  });

  test("navigates across all role consoles without browser runtime errors", async ({ page }) => {
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
    await expect(page.locator("text=Twelve circuits")).toBeVisible();

    expect(pageErrors).toEqual([]);
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

  test("populated console vault stores encrypted openings without plaintext localStorage", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/issuer");

    await page.getByLabel("Vault passphrase", { exact: true }).fill("PopulatedConsoleVault123!");
    await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
    await expect(page.getByText("Vault Unlocked", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Generate Role Credentials", exact: true }).click();
    await expect(page.getByRole("button", { name: "Generate Role Credentials", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /Allocate Reserve/ }).click();
    await expect(page.getByText(/Settlement capacity recorded: \+500/)).toBeVisible();
    await page.getByRole("button", { name: /Open line/ }).click();
    await expect(page.getByText("Credit line opened. Encrypted opening saved.", { exact: true })).toBeVisible();

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
      for (const field of ["issuerSecret", "merchantSecret", "lineCommitment", "limit", "outstanding", "L", "B"]) {
        expect(v).not.toContain(`"${field}"`);
      }
      expect(v).not.toContain("PopulatedConsoleVault123!");
    }

    // Missing storage, failed reads and absent records are failures, never
    // evidence of encryption or of complete protocol privacy.
    const encryptedRecords = await page.evaluate(async () => {
      if (typeof window.indexedDB === "undefined") throw new Error("IndexedDB unavailable after vault setup.");
      return new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const req = window.indexedDB.open("line_vault_db", 1);
        req.onupgradeneeded = () => {
          req.transaction?.abort();
          reject(new Error("Expected an existing populated vault database."));
        };
        req.onerror = () => reject(new Error("Cannot read populated vault database."));
        req.onblocked = () => reject(new Error("Populated vault database read blocked."));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("encrypted_keys")) {
            db.close();
            reject(new Error("Expected encrypted_keys vault store."));
            return;
          }
          const tx = db.transaction("encrypted_keys", "readonly");
          const store = tx.objectStore("encrypted_keys");
          const getAll = store.getAll();
          let records: Record<string, unknown>[] | null = null;
          getAll.onsuccess = () => { records = getAll.result; };
          getAll.onerror = () => reject(new Error("Cannot read encrypted vault records."));
          tx.oncomplete = () => {
            db.close();
            if (!records) reject(new Error("Vault read completed without records."));
            else resolve(records);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(new Error("Encrypted vault read transaction failed."));
          };
        };
      });
    });

    const prefix = "line:vault:local-simulator:0xlocal_compact_simulator_instance:";
    for (const suffix of ["issuer", "agent", "merchant", "agent-line"]) {
      expect(encryptedRecords.filter((record) => record.id === `${prefix}${suffix}`)).toHaveLength(1);
    }
    expect(encryptedRecords.length).toBeGreaterThanOrEqual(4);
    for (const record of encryptedRecords) {
      expect(Object.keys(record).sort()).toEqual(["ciphertextHex", "id", "ivHex", "saltHex", "updatedAt", "version"]);
      expect(record.version).toBe(2);
      expect(record.saltHex).toMatch(/^[0-9a-f]{32}$/);
      expect(record.ivHex).toMatch(/^[0-9a-f]{24}$/);
      expect(record.ciphertextHex).toMatch(/^(?:[0-9a-f]{2})+$/);
      expect((record.ciphertextHex as string).length).toBeGreaterThan(32);
      expect(record.updatedAt).toEqual(expect.any(Number));
      const envelope = JSON.stringify(record);
      for (const field of ["agentSecret", "issuerSecret", "merchantSecret", "identityCommitment", "lineCommitment", "limit", "outstanding", "epoch", "salt", "L", "B"]) {
        expect(envelope).not.toContain(`"${field}"`);
      }
      expect(envelope).not.toContain("PopulatedConsoleVault123!");
    }
    expect(pageErrors).toEqual([]);
  });
});
