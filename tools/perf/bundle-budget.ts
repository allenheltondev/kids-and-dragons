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
 * layouts), the renderer, the figures, the scene — is loaded behind `lazy()` and
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
 * from `FrameMeter.tsx` had pulled the scene, Pixi and the figures into the
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
 * the figures, the scene) still fails it by a wide margin.
 *
 * Back to about 310 measured, the same day, with the cap left at 315 (#300):
 * the Cognito client (sync/auth) and the organizer store now load when a
 * grown-up starts signing in (store/keepsake.ts), not with the home screen.
 * Only the keepsake store's small state stays eager, because the home screen
 * reads it. This gate weighs the static graph only; e2e/lazy-sign-in.spec.ts
 * proves the home screen does not fetch them at runtime either.
 *
 * Down to about 296 measured, cap still 315 (#318): the sound engine, synth and
 * sample table (the 17KB `audio` chunk) load after first paint. `App` lazy-loads
 * `AudioControl`, and `CreationFlow` and `WorldMapPanel` import the cue seam
 * (`audio/cue`) rather than the `audio` barrel, which re-exports the engine and so
 * pulled it back in. Nothing on the home screen may import that barrel.
 * e2e/lazy-audio.spec.ts holds the engine's request open and checks the home
 * screen still works, since this gate weighs only the static graph. Left alone on
 * purpose: `encounter` (shared/encounter.ts, 10KB) and the game store, which the
 * entry's own code uses.
 *
 * About 312 measured, cap still 315 (#388): `@kad/shared` is marked
 * `"sideEffects": false`. Without it the bundler kept every shared module a
 * lazy chunk used next to the shared index, which every page loads, so the
 * spectator rules, used only once somebody is watching, cost every first
 * paint. No shared module does anything on import, and none may: the flag
 * lets the bundler drop a module nothing uses.
 *
 * 315 -> 318 on 2026-10-25, deliberately (matchups, #488). 316KB measured. The
 * 1KB that landed in the first paint is the bestiary: `loadBestiary` rides the
 * shared client and the store's content batch, which every phone loads, so the
 * check badge can read a creature's opinions offline. Everything else the
 * feature added (the matchup engine, the hints, the field guide sections) is in
 * lazy chunks; `matchups` is its own 3KB chunk.
 */
// 318 -> 320 for story interactions (#493): 319KB measured. The store needs
// stable interaction/relay turn identity; the controls and visuals stay lazy.
// 320 -> 322 for the privacy page (#523): 321KB measured, 320 before it. The 1KB
// that landed in the first paint is the `/privacy` route and the link on both
// start screens, which has to be there before anyone joins or hosts. The page
// itself, its words and the "what we store" text it shares are lazy chunks.
// 322 -> 324 for spoken names and mini-game clocks (#552, #566): 324KB measured, 322 before.
// About 1KB is the name rewording on the `speak()` seam, which is in the entry and must say
// "hero" before any speaker can; the other is the store recording each state's server stamp,
// which has to see every state as it lands, before a lazy screen exists to ask. The surface
// list, the interaction controls and their clock maths stay in lazy chunks.
const FIRST_PAINT_BUDGET_KB = 324;

/**
 * Everything, including what is lazily fetched.
 *
 * A ceiling on the whole payload, because "it is lazy" stops being an answer
 * somewhere — the renderer still has to arrive before the first fight, over
 * the same wifi.
 *
 * 1400 -> 1425 on 2026-10-24, deliberately (#479). Pixi 8.20 to 8.22 added
 * about 41KB of WebGPU machinery (render bundles, depth-stencil targets, shader
 * overrides), all of it in the lazy stage chunks: the first paint did not move
 * (315KB). 1415KB measured with the bump, 10KB of slack. React 19.3 was not
 * taken for the opposite reason: it grew the first paint, which this budget
 * cannot give back (see .github/dependabot.yml).
 *
 * 1425 -> 1440 on 2026-10-25, deliberately (matchups, #488). 1432KB measured.
 * The matchup hints, the field guide's "Fighting it" and "Good at" sections and
 * the creation cards, all in lazy chunks; the first paint grew 1KB (see above).
 */
// 1440 -> 1460 for nine reusable story mechanics (#493): 1452KB measured,
// mostly the lazy StoryInteraction and InteractionExtras controls and views.
// 1460 -> 1475 for the privacy page (#523): 1467KB measured, 1457 before it. The
// policy's words and its page are a lazy chunk; nothing else moved.
// 1475 -> 1505 on 2026-10-28, deliberately (#493 playtest). 1497KB measured. The
// mini-games became full-screen boards with real play (pads, a TAP pad, a lever,
// catch and flick, stamps, room sounds); the StoryInteraction chunk went 18KB to
// 45KB (13KB gzipped), all lazy. The first paint did not move (320KB).
// 1505 -> 1515 for campaign epilogues (#562): 1506KB in CI, 1507KB locally.
// The StoryPlates reel now also plays endings, with the epilogue hook and
// staged narration in lazy room screens. First paint kept its 322KB cap then;
// the paintings themselves are fetched separately and are not JavaScript.
// 1515 -> 1520 for crew setup and child-friendly creation: 1518KB measured.
// The editable strength suggestion, optional choice details, lobby readiness
// and creation-only hero greeting live in the lazy room/layout graph. First
// paint remains within its unchanged 324KB cap; painted assets remain files.
// 1520 -> 1530 for the grown-up's guide as a manual: its second page (setup.md), the painted layout's
// CSS and the help sheet's How to play cards, 1526KB measured. All of it is in the lazy guide chunk and
// the lazy help sheet; the first paint did not move, and the painted guide art stays files.
const TOTAL_BUDGET_KB = 1530;

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
