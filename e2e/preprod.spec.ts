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
  await expect(page.getByRole("textbox", { name: "Document to analyze" })).toHaveValue(document);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document to analyze" })).toHaveValue(document);
  await page.getByRole("button", { name: "Run or resume purchases" }).click();
  await expect(page.getByText("Merchant B delivered", { exact: true })).toBeVisible();
  expect(requests[0]).toEqual({ action: "purchase", requestId: id, document });
  await page.getByRole("button", { name: "Acknowledge reported test repayment" }).click();
  await page.getByRole("button", { name: "Start another purchase" }).click();
  await expect(page.getByRole("textbox", { name: "Document to analyze" })).toBeEnabled();
  const nextId = await page.evaluate(() => sessionStorage.getItem("line.preprod.purchase"));
  expect(nextId).not.toBe(id); expect(await page.evaluate(() => sessionStorage.getItem("line.preprod.repay"))).toBeNull();
  expect(requests).toHaveLength(2);
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
