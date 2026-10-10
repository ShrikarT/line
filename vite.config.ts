import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import { pathToFileURL } from "node:url";

// Native import keeps generated Compact/WASM execution in the server process.
// It is excluded from the browser bundle and only provided in dev/preview.
const checkoutClosers = new Set<() => Promise<void>>();
async function installCheckout(server: ViteDevServer | PreviewServer) {
  const { checkoutMiddleware } = await import(pathToFileURL(`${process.cwd()}/server/checkout-http.ts`).href);
  const { zkAssetMiddleware } = await import(pathToFileURL(`${process.cwd()}/server/zk-assets.ts`).href);
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
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
