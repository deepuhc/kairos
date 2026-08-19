import { defineConfig } from "vitest/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

// Some UI tests exercise CI/release tooling that lives outside the source tree
// and is only present in the CI environment: the build/release scripts under
// `packages/ui/scripts/` and the Tauri desktop shell under
// `packages/ui/src-tauri/`. On a plain `git clone` those directories don't
// exist, so those tests fail at import time through no fault of the app code.
//
// Rather than hardcode a brittle list, we detect each CI-only directory and, if
// it's absent, scan the UI test files and exclude just those that reference it.
// Where CI provides the directory, nothing is excluded and the tests run as
// normal — so coverage is never silently weakened.
const CI_ONLY_DIRS = [
  { marker: "packages/ui/scripts", needles: ["../../scripts/", "../scripts/"] },
  { marker: "packages/ui/src-tauri", needles: ["src-tauri"] },
];

function ciOnlyExclusions(): string[] {
  const testDir = path.join(root, "packages/ui/src/__tests__");
  if (!existsSync(testDir)) return [];

  const missing = CI_ONLY_DIRS.filter((d) => !existsSync(path.join(root, d.marker)));
  if (missing.length === 0) return [];

  const excluded: string[] = [];
  for (const file of readdirSync(testDir)) {
    if (!file.endsWith(".test.ts")) continue;
    const src = readFileSync(path.join(testDir, file), "utf8");
    if (missing.some((d) => d.needles.some((n) => src.includes(n)))) {
      excluded.push(`packages/ui/src/__tests__/${file}`);
    }
  }
  return excluded;
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...ciOnlyExclusions()],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/**/*.test.ts",
        "packages/test-utils/**",
        "**/*.d.ts",
      ],
    },
  },
});
