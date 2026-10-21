import { defineConfig } from '@playwright/test';
import base from '../../../playwright.cast-review.config';
export default defineConfig({
  ...base,
  testDir: '../../../e2e',
  webServer: { ...base.webServer, reuseExistingServer: true },
});
