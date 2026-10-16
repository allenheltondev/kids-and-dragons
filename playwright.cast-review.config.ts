import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testIgnore: [],
  webServer: {
    command: "npm run dev",
    env: { VITE_LAUNCH_CAMPAIGN: "gemfall", PORT: "8793", KAD_DEV_API_TARGET: "http://localhost:8793", KAD_CLIENT_PORT: "5183" },
    url: "http://localhost:5183/api/health", reuseExistingServer: false, timeout: 120000,
  },
  use: { ...base.use, baseURL: "http://localhost:5183" },
});
