import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@traceforge/config": resolve(rootDir, "packages/config/src"),
      "@traceforge/contracts": resolve(rootDir, "packages/contracts/src"),
      "@traceforge/logger": resolve(rootDir, "packages/logger/src"),
      "@traceforge/metrics": resolve(rootDir, "packages/metrics/src"),
      "@traceforge/tracing": resolve(rootDir, "packages/tracing/src")
    }
  },
  test: {
    environment: "node",
    globals: true,
    include: [
      "apps/**/*.spec.ts",
      "packages/**/*.spec.ts",
      "scripts/**/*.spec.ts",
      "tests/**/*.spec.ts"
    ]
  }
});
