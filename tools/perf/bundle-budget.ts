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
 * is exactly what a gate is for. An accidental `import` of Pixi into the first
 * paint does not slow a frame down; it triples what a cold start costs — and
 * it happened, silently, for as long as this gate weighed only the entry file
 * (FIRST_PAINT_BUDGET_KB says how).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIST = path.join(ROOT, "packages", "client", "dist");

/**
 * What the first paint may cost, uncompressed.
 *
 * The first paint is what stands between opening the URL and seeing the join
 * screen; everything else — the room's panels (`App` lazily imports both
 * layouts), the renderer, the rigs, the scene — is loaded behind `lazy()` and
 * arrives while somebody is already reading something. That split is the
 * architecture (`WorldView` lazily imports `PixiStage` the same way), and this
 * is the number that notices when it stops being true.
 *
 * It is the entry chunk **and every chunk the entry statically imports**, not
 * the entry file alone. The bundler hoists modules that the entry shares with
 * a lazy chunk into chunks of their own, and the entry imports them before it
 * runs, so they are on the critical path exactly as if they were inlined. The
 * gate used to weigh the entry file alone, and it was green at 380KB while the
 * page fetched 915KB before it could paint: one static `import` of a helper
 * from `FrameMeter.tsx` had pulled the scene, Pixi and the rigs into the
 * entry's graph, and the bundler had filed all of it under other names. A
 * lazy `import()` is only lazy if nothing imports the same module eagerly.
 *
 * Set a little above today's measurement rather than at a round figure: a
 * budget with slack for one honest feature is a budget people keep, and one
 * that has to be raised every sprint is a budget people delete. (Measured at
 * 287KB when the room went lazy, most of it react-dom.)
 *
 * 302 -> 305 for pairing (#281): the three `Api` methods ride in the shared
 * client every phone loads, and the home screen reads `?pair=` and draws two
 * links. The pairing screens themselves, and their QR, are lazy chunks.
 *
 * 305 -> 315 on 2026-10-18, deliberately. The 287 slack went to the features
 * that have to be on the home screen: sign-in and groups (#248), shared
 * tablets (#250), host controls and quiet mode (#263, #260), with visitors
 * and safe names (#249, #253) each adding about a KB more. 315 is that plus
 * slack for those, not a new round number; a large accidental import (Pixi,
 * the rigs, the scene) still fails it by a wide margin.
 *
 * Back to about 310 measured, the same day, with the cap left at 315 (#300):
 * the Cognito client (sync/auth) and the organizer store now load when a
 * grown-up starts signing in (store/keepsake.ts), not with the home screen.
 * Only the keepsake store's small state stays eager, because the home screen
 * reads it. This gate weighs the static graph only; e2e/lazy-sign-in.spec.ts
 * proves the home screen does not fetch them at runtime either.
 */
const FIRST_PAINT_BUDGET_KB = 315;

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

/**
 * The entry and everything it imports before it can run.
 *
 * Read from the chunks themselves rather than from the `modulepreload` links
 * in index.html: the links are an optimisation Vite adds and a config line can
 * remove, while a static `import` in the entry is fetched either way. The
 * links are folded in too, since a preloaded chunk is fetched up front even
 * if nothing imports it. Dynamic `import("./x.js")` is the one form this
 * deliberately skips — that is the lazy half.
 */
const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
const STATIC_IMPORT = /(?:^|[;}\n])\s*import\s*(?:[\w$\s{},*]*?from\s*)?["']\.\/([^"']+\.js)["']/g;
const firstPaint = new Set<string>();
const pending = [
  entry.name,
  ...[...html.matchAll(/rel="modulepreload"[^>]*href="\/bundle\/([^"]+\.js)"/g)].map((match) => match[1] ?? ""),
];
for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
  if (firstPaint.has(name) || !byName.has(name)) continue;
  firstPaint.add(name);
  const code = fs.readFileSync(path.join(bundleDir, name), "utf8");
  for (const match of code.matchAll(STATIC_IMPORT)) if (match[1]) pending.push(match[1]);
}
const firstPaintChunks = [...firstPaint].map((name) => byName.get(name)!).sort((a, b) => b.bytes - a.bytes);
const firstPaintBytes = firstPaintChunks.reduce((sum, chunk) => sum + chunk.bytes, 0);

const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
const biggest = [...chunks].sort((a, b) => b.bytes - a.bytes).slice(0, 5);

console.log(`first paint ${String(kb(firstPaintBytes))}KB / ${String(FIRST_PAINT_BUDGET_KB)}KB   ` +
  `total ${String(kb(total))}KB / ${String(TOTAL_BUDGET_KB)}KB   (${String(chunks.length)} chunks)`);
console.log(`first paint (${String(firstPaintChunks.length)} chunks):`);
for (const chunk of firstPaintChunks) {
  console.log(`  ${chunk.name}: ${String(kb(chunk.bytes))}KB${chunk === entry ? "  (entry)" : ""}`);
}
console.log("largest overall:");
for (const chunk of biggest) console.log(`  ${chunk.name}: ${String(kb(chunk.bytes))}KB`);

const problems: string[] = [];
if (kb(firstPaintBytes) > FIRST_PAINT_BUDGET_KB) {
  problems.push(
    `the first paint is ${String(kb(firstPaintBytes))}KB, over its ${String(FIRST_PAINT_BUDGET_KB)}KB budget — ` +
      "something that used to be lazy probably is not any more (look for a static import of a module a " +
      "lazy chunk owns, or of a barrel that re-exports one)",
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
