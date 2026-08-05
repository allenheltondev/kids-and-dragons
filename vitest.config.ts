import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "tools/**/*.test.mjs",
      "tools/**/*.test.ts",
    ],
    environment: "node",

    /*
     * Coverage is off unless asked for (`npm run test:coverage`), so `npm test`
     * stays the few-second command you run on every save. CI runs the measured
     * one — see .github/workflows/ci.yml.
     */
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "tools/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.test.mjs",
        // Fixtures and harnesses: exercised by everything, asserted on by
        // nothing. Counting them inflates the number by measuring the tests.
        "**/test-fixtures.ts",
        "**/test-support.ts",
        "**/testing/**",
        "**/*.json",
        "**/tsconfig.json",
      ],
      reporter: ["text", "text-summary", "json-summary"],

      /*
       * A ratchet, not a target.
       *
       * These sit a couple of points under what the suite actually measures, so
       * an unrelated refactor that moves a few lines does not turn CI red — and
       * a change that deletes a test, or adds a slab of unexercised code, does.
       * When a number goes comfortably above its floor, raise the floor; that is
       * the whole ceremony.
       *
       * `packages/shared/**` gets its own, much higher floor because it is the
       * rules engine — the dice, the encounter, the progression — where a
       * regression is a wrong number at the table rather than a wrong pixel.
       * The glob floor is checked *in addition to* the global one rather than
       * carving those files out of it (both were confirmed to fail on demand),
       * so the global numbers below are the whole tree: 66.6% statements,
       * 60.8% branches, 66.3% functions, 68.6% lines at the time of writing.
       */
      thresholds: {
        statements: 64,
        branches: 58,
        functions: 63,
        lines: 66,
        "packages/shared/src/**": {
          statements: 90,
          branches: 82,
          functions: 95,
          lines: 94,
        },
      },
    },
  },
});
