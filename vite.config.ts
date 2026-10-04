import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [tailwindcss(), react(), wasm()],
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
