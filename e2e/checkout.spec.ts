import { test, expect } from "@playwright/test";

test("default demo delivers both merchants within the issuer's spending line", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page.getByRole("radio", { name: /Complete both purchases/ })).toBeChecked();
  await page.getByRole("button", { name: "Open evaluation line", exact: true }).click();
  await page.getByRole("button", { name: "Run agent purchase plan", exact: true }).click();
  await expect(page.getByLabel("Merchant A service result")).toBeVisible();
  await expect(page.getByLabel("Merchant B service result")).toBeVisible();
  await expect(page.getByLabel("Issuer private credit book").getByText("45", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Issuer private credit book").getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByText("3. Both merchants delivered", { exact: true })).toBeVisible();
});

test("homepage purchase flow delivers, declines generically, and revolves under issuer control", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("link", { name: "Try API checkout", exact: true }).first().click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText("Generated Compact · local evaluation", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Decline and recovery/ }).check();
  await page.getByLabel("Document", { exact: true }).fill("Reliable agents. Reliable delivery.");
  await page.getByRole("button", { name: "Open evaluation line", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run agent purchase plan" })).toBeEnabled();
  await page.getByRole("button", { name: "Issuer: acknowledge evaluation repayment" }).click();
  await expect(page.getByRole("alert")).toContainText("Acknowledgement exceeds outstanding evaluation debt");
  await expect(page.getByLabel("Evaluation repayment", { exact: true })).toBeEnabled();
  await page.getByLabel("Evaluation repayment", { exact: true }).fill("24");
  await page.getByLabel("Evaluation repayment", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Run agent purchase plan" }).click();
  await expect(page.getByText("Clearance could not be proven.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Merchant A service result")).toContainText('"words": 4');
  await expect(page.getByLabel("Merchant B service result")).toHaveCount(0);
  await page.getByRole("button", { name: "Issuer: acknowledge evaluation repayment" }).click();
  await expect(page.getByRole("status")).toContainText("Credit capacity changed");
  await page.getByRole("button", { name: "Retry declined purchase" }).click();
  await expect(page.getByLabel("Merchant A service result")).toBeVisible();
  await expect(page.getByLabel("Merchant B service result")).toContainText('"utf8Bytes"');
  await expect(page.getByText("Payout: not connected. Claim redemption is an accounting transition.")).toHaveCount(2);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).not.toContain("issuerToken");
  expect(stored).not.toContain("agentToken");
  expect(errors).toEqual([]);
});
