import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("artifacts/ui-revision/rendered");

test("product preview explains a purchase and supports replay and each role", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") mutations.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: path.join(output, "home-hero-1440.png") });
  await page
    .getByRole("button", { name: "Preview a purchase", exact: true })
    .click();
  await expect(
    page.getByText(
      "Both illustrative claims redeemed. 45 units used, 15 remaining.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('.demo-execution li[data-done="true"]'),
  ).toHaveCount(3);
  // Replay also exercises the full-duration timeline, not only reduced motion.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page
    .getByRole("button", { name: "Replay purchase", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay purchase", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".purchase-playground")
    .screenshot({ path: path.join(output, "purchase-playground-1440.png") });
  await page.getByRole("tab", { name: "Issuer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You set the allowance.", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Merchants", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Verify. Redeem. Deliver.",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(output, "home-complete-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(output, "home-complete-390.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Merchants", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(mutations).toEqual([]);
});

test("workspace command palette searches, handles empty results and preserves navigation", async ({
  page,
}) => {
  await page.goto("/issuer");
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  const search = page.getByRole("combobox", {
    name: "Search Line pages",
    exact: true,
  });
  await search.fill("not-a-page");
  await expect(
    page.getByText("No pages found. Try issuer, agent or checkout."),
  ).toBeVisible();
  await search.fill("agent");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(search).toBeVisible();
  await search.fill("merchant");
  await page.getByRole("option", { name: /Merchant/ }).click();
  await expect(page).toHaveURL(/\/merchant$/);
  await page.keyboard.press("Control+k");
  await search.fill("issuer");
  await page.screenshot({ path: path.join(output, "workspace-search.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
