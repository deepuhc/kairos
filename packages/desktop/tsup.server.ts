import { defineConfig } from 'tsup';

// Bundles the standalone Express+WS server into a single self-contained JS file
// so the Tauri app can ship it as a resource without carrying node_modules.
// The workspace `@kairos/*` packages and all third-party deps are inlined
// (noExternal), leaving only Node's built-ins as externals.
export default defineConfig({
  entry: { 'kairos-server': '../server/src/main.ts' },
  // CJS output: Express and its transitive deps use dynamic require() at
  // runtime, which an ESM bundle shims into a throwing stub ("Dynamic require
  // of 'path' is not supported"). CommonJS keeps require() native so the whole
  // dependency tree can be inlined into one file.
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  noExternal: [/.*/],
  outDir: 'src-tauri/resources/server',
  clean: true,
  minify: false,
  sourcemap: false,
});
