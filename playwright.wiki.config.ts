import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Wiki UX tests.
 *
 * Serves the pre-built Hugo site from wiki/public/ using a simple static
 * file server (npx serve) and runs E2E tests against it.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'wiki-*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx serve wiki/public -l 4173 --no-clipboard',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
