import { defineConfig } from "vitest/config";

// Mutation runs only the unit suites of the package under mutation; see stryker.config.json.
export default defineConfig({
  test: {
    include: ["packages/shared/src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
