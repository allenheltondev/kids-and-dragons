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
  // Three players each walking a five-step creation flow is a lot of real
  // interaction — the travel-mode spec spends most of its budget there.
  timeout: 180_000,
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
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
