import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("artifacts/ui-revision/rendered");

test("homepage explains real purchases and opens the wallet-owned workspace", async ({ page }) => {
  test.setTimeout(90_000);
  await mkdir(output, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mutations: string[] = [], errors: string[] = [];
  page.on("request", request => { if (request.method() === "POST") mutations.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Spending for agents.");
    await expect(page.getByRole("heading", { name: "Fund your agent.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview a purchase", exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/checkout"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(output, `home-organization-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "Open workspace", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Start with your wallet." })).toBeVisible();
  expect(mutations).toEqual([]); expect(errors).toEqual([]);
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
  await search.fill("Agent console");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/agent$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(search).toBeVisible();
  await search.fill("merchant");
  await page.getByRole("option", { name: /Merchant console/ }).click();
  await expect(page).toHaveURL(/\/merchant$/);
  await page.keyboard.press("Control+k");
  await search.fill("issuer");
  await page.screenshot({ path: path.join(output, "workspace-search.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
