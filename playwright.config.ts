import { defineConfig } from "@playwright/test";

/**
 * The e2e suite boots the real stack — dev server and Vite — because the things
 * worth catching here (SSE ordering, patch application, room codes, hard-refresh
 * recovery) only exist when both are running.
 *
 * `executablePath` points at the preinstalled Chromium rather than one Playwright
 * downloads; drop it and the browser it wants gets fetched instead.
 */
const CHROMIUM = process.env.KAD_CHROMIUM ?? undefined;

export default defineConfig({
  testDir: "./e2e",
  // wiki-* are their own suite. rig-shot is a review tool, not a test: it
  // photographs the party on a TV-sized screen so a human can judge rig size
  // and ground placement (art-pipeline §6.3). Run it by name when the stage,
  // the anchor or the rigs change.
  testIgnore: ["wiki-*.spec.ts", "rig-shot.spec.ts"],
  // Three players each walking a five-step creation flow, and then a whole
  // chapter with real roll animations, is a lot of genuine interaction — the
  // playthrough spends about two minutes of this on its own.
  timeout: 300_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    // Locally, reuse the dev server you already have running. On CI there
    // should never be one — if something is already on :5173 it is a leaked
    // process from an earlier step, and testing against it would silently
    // test the wrong build. Fail loudly there instead.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
