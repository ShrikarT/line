import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PLAYWRIGHT_PORT must be an integer from 1 to 65535.");
const localUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  // The pinned SDK parses ledger WASM on a fresh document before rendering.
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || localUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js ${process.env.PLAYWRIGHT_PREVIEW === "1" ? "preview " : ""}--host 127.0.0.1 --port ${port} --strictPort`,
    url: localUrl,
    reuseExistingServer: !process.env.CI,
  },
});
