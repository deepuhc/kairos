import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/adapters/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
});
