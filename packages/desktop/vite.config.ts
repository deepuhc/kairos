import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@kairos/core/coordinator": resolve(__dirname, "../core/src/coordinator.ts"),
    },
  },
});
