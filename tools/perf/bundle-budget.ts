#!/usr/bin/env node
/**
 * The payload gate — `npm run perf:bundle`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS AND NOT A FRAME-TIME TEST
 *
 * The obvious CI performance check is "a frame must cost under N milliseconds",
 * and it was written, and it was deleted. Two measurements killed it: the
 * scene's tick costs about 0.007ms against a fake stage, and going from 8
 * figures to 32 moves that by 1.5x — fixed work dominates, and a real fight
 * has three heroes and five wisps (spec §7.1). A deliberately quadratic tick
 * passed the budget comfortably. A green test that survives sabotage is worse
 * than no test: it is a claim nobody checked.
 *
 * Frame time is measured where frames exist — on the machine driving the
 * television, with `?perf` (client/src/world/frame-stats.ts).
 *
 * What CI *can* measure honestly is what the machine has to fetch before
 * anything appears. That number is deterministic, it is a real constraint —
 * the display client loads over house wifi onto a laptop somebody wants
 * working within a minute of sitting down — and it regresses silently, which
 * is exactly what a gate is for. An accidental `import` of Pixi into the entry
 * chunk does not slow a frame down; it triples what a cold start costs.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIST = path.join(ROOT, "packages", "client", "dist");

/**
 * What the first paint may cost, uncompressed.
 *
 * The entry chunk is what stands between opening the URL and seeing the join
 * screen; everything else — the renderer, the rigs, the scene — is loaded
 * behind `lazy()` and arrives while somebody is already reading something.
 * That split is the architecture (`WorldView` lazily imports `PixiStage`), and
 * this is the number that notices when it stops being true.
 *
 * Set a little above today's measurement rather than at a round figure: a
 * budget with slack for one honest feature is a budget people keep, and one
 * that has to be raised every sprint is a budget people delete.
 */
const ENTRY_BUDGET_KB = 380;

/**
 * Everything, including what is lazily fetched.
 *
 * A ceiling on the whole payload, because "it is lazy" stops being an answer
 * somewhere — the renderer still has to arrive before the first fight, over
 * the same wifi.
 */
const TOTAL_BUDGET_KB = 1400;

function kb(bytes: number): number {
  return Math.round(bytes / 1024);
}

const bundleDir = path.join(DIST, "bundle");
if (!fs.existsSync(bundleDir)) {
  console.error("No build to measure. Run `npm run build` first.");
  process.exit(2);
}

/** Source maps are not shipped to a browser unless somebody opens devtools. */
const chunks = fs
  .readdirSync(bundleDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => ({ name, bytes: fs.statSync(path.join(bundleDir, name)).size }));

const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const entryName = /src="\/bundle\/([^"]+)"/.exec(html)?.[1];
const entry = chunks.find((chunk) => chunk.name === entryName);

if (!entry) {
  console.error(`index.html points at "${entryName ?? "nothing"}", which is not in the bundle.`);
  process.exit(1);
}

const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
const biggest = [...chunks].sort((a, b) => b.bytes - a.bytes).slice(0, 5);

console.log(`entry ${String(kb(entry.bytes))}KB / ${String(ENTRY_BUDGET_KB)}KB   ` +
  `total ${String(kb(total))}KB / ${String(TOTAL_BUDGET_KB)}KB   (${String(chunks.length)} chunks)`);
for (const chunk of biggest) console.log(`  ${chunk.name}: ${String(kb(chunk.bytes))}KB`);

const problems: string[] = [];
if (kb(entry.bytes) > ENTRY_BUDGET_KB) {
  problems.push(
    `the entry chunk is ${String(kb(entry.bytes))}KB, over its ${String(ENTRY_BUDGET_KB)}KB budget — ` +
      "something that used to be lazy probably is not any more",
  );
}
if (kb(total) > TOTAL_BUDGET_KB) {
  problems.push(`the whole payload is ${String(kb(total))}KB, over its ${String(TOTAL_BUDGET_KB)}KB budget`);
}

if (problems.length > 0) {
  console.error("\nperf: payload over budget —");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
