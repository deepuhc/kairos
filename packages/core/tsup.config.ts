import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/coordinator.ts", "src/project-manager.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
});
