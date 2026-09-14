import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ["object-inspect"],
    exclude: [
      "@midnightntwrk/onchain-runtime-v4",
      "@midnight-ntwrk/compact-runtime",
    ],
  },
  assetsInclude: ["**/*.wasm"],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
