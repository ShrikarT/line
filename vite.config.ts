import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import { pathToFileURL } from "node:url";
import { zkAssetMiddleware } from "./server/zk-assets.ts";
import { preprodMiddleware } from "./server/preprod-http.ts";

// Native import keeps generated Compact/WASM execution in the server process.
// It is excluded from the browser bundle and only provided in dev/preview.
const checkoutClosers = new Set<() => Promise<void>>();
async function installCheckout(server: ViteDevServer | PreviewServer) {
  const { checkoutMiddleware } = await import(pathToFileURL(`${process.cwd()}/server/checkout-http.ts`).href);
  const { networkSessionMiddleware } = await import(pathToFileURL(`${process.cwd()}/server/network-session.ts`).href);
  const checkout = checkoutMiddleware();
  let closing: Promise<void> | undefined;
  const close = () => closing ??= checkout.close().finally(() => checkoutClosers.delete(close));
  try {
    // Wrong credentials, incompatible snapshots and live directory owners fail startup.
    await checkout.ready();
    const assets = zkAssetMiddleware();
    checkoutClosers.add(close);
    server.httpServer?.once("close", () => {
      void close().catch(() => server.config.logger.error("Checkout storage cleanup failed. Inspect its directory lease before restarting."));
    });
    server.middlewares.use(assets);
    const networkEnv = loadEnv(server.config.mode, server.config.envDir, "MIDNIGHT_");
    server.middlewares.use(networkSessionMiddleware(process.env.MIDNIGHT_BLOCKFROST_PROJECT_ID ?? networkEnv.MIDNIGHT_BLOCKFROST_PROJECT_ID));
    const live = preprodMiddleware({ env: { ...networkEnv, LINE_LIVE_PREPROD: process.env.LINE_LIVE_PREPROD ?? loadEnv(server.config.mode, server.config.envDir, "LINE_").LINE_LIVE_PREPROD } });
    server.middlewares.use((req, res, next) => { void live.middleware(req, res, next); });
    checkoutClosers.add(live.close);
    server.httpServer?.once("close", () => { void live.close().finally(() => checkoutClosers.delete(live.close)); });
    server.middlewares.use(checkout);
  } catch (error) { await close().catch(() => {}); throw error; }
}
const checkoutEvaluation: Plugin = {
  name: "line-checkout-evaluation",
  configureServer: installCheckout,
  configurePreviewServer: installCheckout,
  async closeBundle() { await Promise.all([...checkoutClosers].map(close => close())); },
};

export default defineConfig({
  plugins: [tailwindcss(), react(), wasm(), checkoutEvaluation],
  // Tailwind runs through its Vite plugin. An explicit empty PostCSS pipeline
  // avoids caching a failed package.json search during dependency updates.
  css: { postcss: { plugins: [] } },
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ["object-inspect"],
    exclude: [
      "@midnight-ntwrk/compact-runtime",
      "@midnight-ntwrk/ledger-v8",
    ],
  },
  build: {
    target: "esnext",
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Private caches and test output must not reload an active wallet session.
    watch: { ignored: ["**/.midnight-cache/**", "**/.compact-keys/**", "**/.line-checkout-private/**", "**/test-results/**", "**/.deployment/**"] },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
