import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const scripts = [
  "tools/art/gap-calibration.mjs",
  "tools/art/rig-sheet.mjs",
  "tools/art/verify-rig-motion.mjs",
  "tools/art/verify-rig-rest.mjs",
  "tools/content/validate.mjs",
];
let server;

beforeAll(async () => {
  server = await createServer({
    root,
    configFile: fileURLToPath(new URL("../vitest.config.ts", import.meta.url)),
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
});

afterAll(async () => { await server?.close(); });

it.each(scripts)("keeps %s executable and parseable after the coverage SSR transform", async (script) => {
  const path = fileURLToPath(new URL(`../${script}`, import.meta.url));
  expect(readFileSync(path, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  execFileSync(process.execPath, ["--check", path]);

  const result = await server.transformRequest(`/${script}`, { ssr: true });
  expect(result).not.toBeNull();
  // Parse without running CLI side effects. SSR imports contain top-level await.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  expect(() => new AsyncFunction(result.code)).not.toThrow();
});
