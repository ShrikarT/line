import { test, expect } from "@playwright/test";
import type { PreprodSummary } from "../src/lib/preprod";

const id = "12345678-1234-1234-1234-123456789abc", document = "A custom document retained across reload.";
const summary = (): PreprodSummary => ({ network: "preprod", contractAddress: "ab".repeat(32), phase: "ready", progress: "Ready", busy: false, pending: null, privateBook: { limit: 60, outstanding: 25, remaining: 35 }, orders: [{ id: `${id}-0`, service: "text-analysis", document, amount: 25, status: "delivered", result: { wordCount: 7 } }], receipts: [], settlement: "test", custody: "test" });

test("Preprod restores the original custom input and request ID, then offers a fresh plan after repayment", async ({ page }) => {
  const state = summary(), requests: { action: string; requestId: string; document?: string }[] = [];
  await page.route("**/api/preprod/**", async route => {
    const action = route.request().url().split("/").at(-1)!;
    if (action !== "status") {
      const input = route.request().postDataJSON(); requests.push({ action, ...input });
      if (action === "purchase") { state.orders.push({ id: `${id}-1`, service: "cost-report", document, amount: 20, status: "delivered", result: { totalServiceUnits: 45 } }); state.privateBook = { limit: 60, outstanding: 45, remaining: 15 }; }
      if (action === "acknowledge") state.privateBook = { limit: 60, outstanding: 0, remaining: 60 };
    }
    await route.fulfill({ status: action === "status" ? 200 : 202, json: action === "status" ? state : { accepted: true } });
  });
  await page.goto("/preprod");
  await expect(page.getByRole("textbox", { name: /Document to analyze/ })).toHaveValue(document);
  await page.reload();
  await expect(page.getByRole("textbox", { name: /Document to analyze/ })).toHaveValue(document);
  await page.getByRole("button", { name: "Run or resume purchases" }).click();
  await expect(page.getByText("Merchant B delivered", { exact: true })).toBeVisible();
  expect(requests[0]).toEqual({ action: "purchase", requestId: id, document });
  await page.getByRole("button", { name: "Acknowledge reported test repayment" }).click();
  await page.getByRole("button", { name: "Start another purchase" }).click();
  await expect(page.getByRole("textbox", { name: /Document to analyze/ })).toBeEnabled();
  const nextId = await page.evaluate(() => sessionStorage.getItem("line.preprod.purchase"));
  expect(nextId).not.toBe(id); expect(await page.evaluate(() => sessionStorage.getItem("line.preprod.repay"))).toBeNull();
  expect(requests).toHaveLength(2);
});

test("test-token setup uses its own endpoint and renders observed balances without using the canonical purchase ID", async ({ page }) => {
  const state = summary();
  Object.assign(state, { profile: "test-settlement", phase: "not-deployed", contractAddress: null, orders: [], privateBook: { limit: 60, outstanding: 0, remaining: 60 } });
  const requests: { path: string; requestId: string }[] = [];
  await page.addInitScript(() => sessionStorage.setItem("line.preprod.purchase", "12345678-1234-1234-1234-123456789abc"));
  await page.route("**/api/preprod/**", async route => {
    const path = new URL(route.request().url()).pathname;
    expect(path).toContain("/settlement/");
    if (!path.endsWith("status")) {
      requests.push({ path, requestId: route.request().postDataJSON().requestId });
      if (path.endsWith("setup")) { state.phase = "ready"; state.contractAddress = "cd".repeat(32); }
      else {
        state.tokenObservation = { color: "ef".repeat(32), verifiedAt: "2026-10-16T12:00:00Z", transparent: true, monetaryValue: false, balances: { A: { address: "merchant-a", addressHex: "aa".repeat(32), units: "25", expectedUnits: "25" }, B: { address: "merchant-b", addressHex: "bb".repeat(32), units: "20", expectedUnits: "20" } } };
      }
    }
    await route.fulfill({ status: path.endsWith("status") ? 200 : 202, json: path.endsWith("status") ? state : { accepted: true } });
  });
  await page.goto("/test-payout");
  await expect(page.getByText("No wallet observation yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run agent purchase", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Set up test-token facility", exact: true }).click();
  await page.getByRole("button", { name: "Run agent purchase", exact: true }).click();
  await expect(page.getByText("25 test units received", { exact: true })).toBeVisible();
  await expect(page.getByText("20 test units received", { exact: true })).toBeVisible();
  expect(requests.map(row => row.path)).toEqual(["/api/preprod/settlement/setup", "/api/preprod/settlement/purchase"]);
  expect(requests[1].requestId).not.toBe(id);
  expect(await page.evaluate(() => sessionStorage.getItem("line.preprod.purchase"))).toBe(id);
  await page.reload();
  await expect(page.getByText("25 test units received", { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/preprod-2026-10-16/token-mocked-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "artifacts/preprod-2026-10-16/token-mocked-mobile.png", fullPage: true });
});

test("pending live transaction has a serialized reconciliation action without starting another purchase", async ({ page }) => {
  const state = summary(); state.pending = "retained-draw"; const actions: string[] = [];
  await page.route("**/api/preprod/**", async route => {
    const action = route.request().url().split("/").at(-1)!;
    if (action !== "status") { actions.push(action); state.pending = null; }
    await route.fulfill({ status: action === "status" ? 200 : 202, json: action === "status" ? state : { accepted: true } });
  });
  await page.goto("/preprod");
  await expect(page.getByRole("button", { name: "Run or resume purchases" })).toBeDisabled();
  await page.getByRole("button", { name: "Reconcile saved transaction" }).click();
  await expect(page.getByRole("button", { name: "Run or resume purchases" })).toBeEnabled();
  expect(actions).toEqual(["reconcile"]);
});
