import { defineConfig } from "@playwright/test";

/**
 * The specs that need a **production build** — the one place the service
 * worker (packages/client/src/sw/) exists. The main suite runs on the Vite dev
 * server, which never registers one, so it cannot test these:
 *
 *   offline.spec           the adventure book with no signal, on a reload and a new tab
 *   perf.spec              what a phone downloads on its first visit and every one after
 *   production-locks.spec  the playtest drawer did not ship (#263)
 *   installable.spec      the manifest, icons and worker Chromium installs from (#410)
 *
 * Two servers: the dev API server, and `vite preview` serving the built
 * client, which proxies `/api`, `/events`, `/content` and `/assets` to it
 * exactly as the dev server does (preview reuses `server.proxy`).
 */
const CHROMIUM = process.env.KAD_CHROMIUM ?? undefined;
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["offline.spec.ts", "perf.spec.ts", "production-locks.spec.ts", "installable.spec.ts"],
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(CHROMIUM ? { launchOptions: { executablePath: CHROMIUM } } : {}),
  },
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run build && npm run preview --workspace @kad/client -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
