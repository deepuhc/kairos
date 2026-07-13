import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/tui/App.tsx"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
});
