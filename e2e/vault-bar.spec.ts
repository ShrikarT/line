import { test, expect } from "@playwright/test";

test("vault UI displays generation failures and protects an issued agent opening", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/issuer");
  await page.getByLabel("Vault passphrase", { exact: true }).fill("BrowserVaultPassphrase123!");
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await expect(page.getByText("Vault Unlocked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Vault Keys", exact: true }).click();

  // Exercise the actual browser persistence failure through an individual
  // generation button. The UI must display it without an unhandled rejection.
  await page.evaluate(() => Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined }));
  await page.getByRole("button", { name: "Generate Issuer Key", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Browser encrypted storage is unavailable.");

  // Reload restores genuine IndexedDB; no synthetic store or ledger is injected.
  await page.reload();
  await page.getByLabel("Vault passphrase", { exact: true }).fill("BrowserVaultPassphrase123!");
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await page.getByRole("button", { name: "Generate Role Credentials", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate Role Credentials", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Allocate Reserve/ }).click();
  await expect(page.getByText(/Settlement capacity recorded: \+500/)).toBeVisible();
  await page.getByRole("button", { name: /Open line/ }).click();
  await expect(page.getByText("Credit line opened. Encrypted opening saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Vault Keys", exact: true }).click();
  await expect(page.getByText("Issued credit line: agent key replacement is disabled. Keep the existing encrypted book for recovery.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Identity role to import").locator("option[value='agent']")).toBeDisabled();

  await page.getByLabel("Identity secret key").fill("01".repeat(32));
  await page.getByRole("button", { name: "Lock Vault", exact: true }).click();
  await expect(page.getByText("Private Vault Locked:", { exact: true })).toBeVisible();
  await page.getByLabel("Vault passphrase", { exact: true }).fill("BrowserVaultPassphrase123!");
  await page.getByRole("button", { name: "Unlock Vault", exact: true }).click();
  await page.getByRole("button", { name: "Manage Vault Keys", exact: true }).click();
  await expect(page.getByLabel("Identity secret key")).toHaveValue("");
  await expect(page.getByLabel("Identity role to import").locator("option[value='agent']")).toBeDisabled();
  expect(pageErrors).toEqual([]);
});
