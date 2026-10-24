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
const BASE_URL = process.env.KAD_E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  // Visual review tools run explicitly with playwright.cast-review.config.ts.
  // Offline, performance, production-lock and installability checks need a
  // production build (the service worker): playwright.prod.config.ts.
  testIgnore: ["wiki-*.spec.ts", "static-figures-shot.spec.ts", "cast-shot.spec.ts", "offline.spec.ts", "perf.spec.ts", "production-locks.spec.ts", "installable.spec.ts", "worker-update.spec.ts", "boot-heal.spec.ts"],
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
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  webServer: {
    command: "npm run dev",
    // The suite walks the reference chapter scene by scene, so it pins the
    // reference campaign rather than following whatever the lobby launches.
    env: {
      VITE_LAUNCH_CAMPAIGN: "the-hollow-crown",
      // Presence as production has it (#258): the phones' heartbeats alone,
      // since AppSync reports no stream closing. The timeout is shortened so
      // drop-in.spec can wait out a phone that goes quiet; it stays more than
      // twice the 20s heartbeat, so a phone that is here is never swept.
      KAD_STREAM_PRESENCE: "off",
      KAD_PRESENCE_AWAY_MS: "45000",
    },
    // Wait for the API through Vite, so a fast client boot cannot race the server.
    url: new URL("/api/health", BASE_URL).href,
    // Locally, reuse the dev server you already have running. On CI there
    // should never be one — if something is already on :5173 it is a leaked
    // process from an earlier step, and testing against it would silently
    // test the wrong build. Fail loudly there instead.
    reuseExistingServer: !process.env.CI && !process.env.KAD_E2E_BASE_URL,
    timeout: 120_000,
  },
});
