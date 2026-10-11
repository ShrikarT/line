import { test, expect } from "@playwright/test";

test("wallet connection keeps contract setup open and rejects invalid addresses", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { midnight: object }).midnight = {
      "io.line.test": {
        name: "Connector test", rdns: "io.line.test", apiVersion: "4.0.1", icon: "",
        connect: async () => ({
          getConfiguration: async () => ({ networkId: "preview", indexerUri: "https://indexer.preview.midnight.network/api/v4/graphql",
            indexerWsUri: "wss://indexer.preview.midnight.network/api/v4/graphql/ws", substrateNodeUri: "https://rpc.preview.midnight.network" }),
          getShieldedAddresses: async () => { throw new Error("No transaction requested by this test"); },
          balanceUnsealedTransaction: async () => { throw new Error("No transaction requested by this test"); },
          submitTransaction: async () => { throw new Error("No transaction requested by this test"); },
        }),
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Local Simulator" }).click();
  await page.getByLabel("Network", { exact: true }).selectOption("preview");
  await page.getByRole("button", { name: "Connect Midnight Wallet" }).click();
  await expect(page.getByText("Wallet connected. Join your deployed Line contract to continue.")).toBeVisible();
  await expect(page.getByText("Midnight Network Setup & Wallet Connection")).toBeVisible();
  await page.getByLabel("Contract address (32 hex bytes)").fill("invalid");
  await page.getByRole("button", { name: "Join Contract", exact: true }).click();
  await expect(page.getByText("Contract address must contain exactly 32 hex bytes.")).toBeVisible();
  await expect(page.getByText("Midnight Network Setup & Wallet Connection")).toBeVisible();
  await page.getByLabel("Network", { exact: true }).selectOption("preprod");
  await expect(page.getByRole("button", { name: "Join Contract", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Connect Midnight Wallet" }).click();
  await expect(page.getByText("Enter a Blockfrost Midnight Preprod project token.")).toBeVisible();
});
