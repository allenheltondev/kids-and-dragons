#!/usr/bin/env node
/**
 * The guide's pictures (#257) — `npm run guide:pictures`.
 *
 * Runs every e2e spec that calls `guidePicture()` (e2e/guide-pictures.ts)
 * with `KAD_GUIDE_PICTURES=1`, so each of those calls writes its screen to
 * packages/client/public/guide-pictures/. The specs are the ones that already
 * walk each flow, so a picture is always the screen as the flow reaches it
 * today, never a hand capture. Commit what changed.
 *
 * Extra arguments go to Playwright, e.g. `npm run guide:pictures -- --grep host`.
 * Set KAD_CHROMIUM as for any e2e run.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const E2E = path.join(ROOT, "e2e");

/** The specs that take a picture, and the names they take. */
export function pictureSpecs(dir = E2E) {
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".spec.ts")) continue;
    const text = readFileSync(path.join(dir, file), "utf8");
    const names = [...text.matchAll(/guidePicture\([^,]+,\s*"([a-z0-9-]+)"\)/g)].map((m) => m[1]);
    if (names.length > 0) out.push({ file, names });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const specs = pictureSpecs();
  if (specs.length === 0) {
    console.error("no spec calls guidePicture()");
    process.exit(1);
  }
  console.log(`Taking ${specs.flatMap((s) => s.names).length} pictures from ${specs.length} specs.`);
  const run = spawnSync(
    "npx",
    ["playwright", "test", ...specs.map((s) => `e2e/${s.file}`), ...process.argv.slice(2)],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, KAD_GUIDE_PICTURES: "1" } },
  );
  process.exit(run.status ?? 1);
}
