/**
 * Writes this build's Gemfall compatibility goldens — skipped unless asked.
 *
 *   KAD_GEMFALL_GOLDEN=/tmp/golden.json npx vitest run packages/server/src/handlers/gemfall-compat-golden.test.ts
 *
 * Imports nothing but the probe and the loader, so it runs on the build before
 * the nonlinear-campaign epic as well as on this one (gemfall-compat-probe.ts
 * says how the pre-epic goldens were taken, and gemfall-compat.test.ts
 * compares against them).
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { loadContent } from "../content/loader.ts";
import { goldens } from "./gemfall-compat-probe.ts";

const OUT = process.env.KAD_GEMFALL_GOLDEN;

it.runIf(OUT)("emits the Gemfall compatibility goldens", { timeout: 120_000 }, async () => {
  const content = await loadContent(path.resolve(import.meta.dirname, "..", "..", "..", "..", "content"));
  writeFileSync(OUT!, `${JSON.stringify(await goldens(content), null, 2)}\n`);
});
