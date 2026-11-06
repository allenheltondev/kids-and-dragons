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
// 324 -> 326 for naming crews and asking before new heroes resume one (#580): 325KB measured,
// 324 before. The crew names list now lives in @kad/shared (the server picks from it, the Room
// panel offers it), and the store carries the rename and keep-going host controls beside the
// other host controls it already holds. The Room panel and the lobby that use them stay lazy.
// 326 -> 328 for another TV in another place (OtherScreen.tsx): 327KB measured, 325 before.
// The first paint carries the start screen's one quiet link and the code it reads from a
// `?screen=` link, and the store the two host/follower calls beside the controls it already
// holds. The code card and the Room panel's section are their own lazy chunk (about 6KB).
// 328 -> 330 for combat planning: the shared preview protocol and mission state
// add 1KB to the entry graph (329KB measured). Combat surfaces remain lazy.
// 330 -> 332 for Phase 2 camp. Its base branch measures 331KB at first
// paint, and #623's artwork and tent tinting leave that measurement unchanged.
const FIRST_PAINT_BUDGET_KB = 332;

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
// 1520 -> 1525 for the hero picker saying what holds each hero (#596): 1522KB
// measured. The card lines, the dimmed can't-sit card, its tap-to-recheck and the choice note are in
// the lazy WelcomeBack/room graph; first paint did not move (325KB of 326KB).
// 1525 -> 1533 for another TV in another place: 1530KB measured, 1522 before. About 6KB is
// the lazy OtherScreen chunk (the leader's code card and the other TV's code entry), the
// rest the first-paint lines above.
// 1533 -> 1461, down, for leaving Pixi's WebGPU and canvas renderers out of the build
// (packages/client/pixi-webgl-only.ts): 1458KB measured with the other-TV work in, 1530 before it. The stage only ever
// asks for WebGL, but Pixi 8 registers all three renderers' adaptors at load, so their code rode
// in the stage chunks every TV fetched (the 8.22 bump above was most of it). A TV opening a fight
// fetches 73KB less JavaScript. First paint did not move (327KB). Keep this close to the
// measurement: a feature that needs more gives something back, or raises it as its own decision.
// 1461 -> 1462, deliberately, for recorded narration (#546, PR #593): 1462KB measured, 1458 before
// it. The clip speaker (which now also carries the device voice) in the lazy read-aloud chunk, the
// engine's voice bus and the narration panel's speaking mark, about 4KB, all lazy; first paint did
// not move (327KB). Agreed with the owner as its own decision rather than a give-back, and set to
// the measurement with no slack: the next feature that needs more gives something back.
// 1462 -> 1470 for the mini-game depth pass: seven versioned game loops and their phone/TV
// surfaces measure 1469KB total, versus 1454KB before this feature. First paint stays 328KB.
// This is an explicit feature cost, not a dependency bump; assets reuse the painted inventory.
// 1470 -> 1485 for combat planning: the deterministic enemy planner is now
// visible on phone/TV, with fighter inspection, suggestions and mission rules.
// 1481KB measured; existing biome and character art is reused, no dependency added.
// 1485 -> 1525 for the crew's camp (#613, #614, #615): 1523KB measured in CI
// and locally. Lane walking, moments, framing, the still fallback and registered
// kit tinting live in the lazy room/renderer graph. This is the explicit cost
// of the new camp feature, with no dependency added; first paint remains 329KB
// under its unchanged 330KB cap. Painted PNG/WebP assets are fetched separately.
// 1525 -> 1528 for the requested camp composition pass: 1526KB measured.
// Soft contact/cast shadows reuse existing textures, with no new dependency or
// art downloads. The shared light direction and kit placement stay in the lazy
// renderer. First paint is unchanged at 329KB under its existing 330KB ceiling.
// 1528 -> 1533 after merging main's combat presentation and the updated lobby,
// plus owner-relative camp kit sizing (#615). The integrated head measured
// 1531KB in Linux CI (run 41923372911), first paint still 329KB. The extra code
// stays in the lazy room/renderer graph; no dependency or first-paint allowance
// changed. Retain 2KB of slack and verify this cap against the next CI build.
// 1533 -> 1538 for the parent camp branch's queue/visibility pass (1d5e052a):
// 1536KB measured in Linux CI run 41934647049 after its automatic merge.
// Heroes leave the trailhead line cleanly and framing keeps every figure on
// screen. This adds lazy camp code; first paint remains 329KB. Keep 2KB slack.
// 1485 -> 1490 for the wagon defense benchmark: native wagon travel, shared
// state-derived progress/defender views and the departure payoff add ~5KB.
// First paint stays 329KB; no dependency is added. Wagon art warms with the chapter.
// 1538 + 5 = 1543 when the camp branch met main's wagon benchmark (#634): the
// two raises were made separately from 1485, so they add. The merged build
// measured exactly 1543KB locally, first paint 329KB; keep 2KB of slack for CI.
// 1545 -> 1616 for Phase 2 camp. Its base branch measures 1609KB with
// the shop, kit panel and stage-2 renderer. #623 adds 5KB for tent cloth
// masks and their renderer wiring. The art files are fetched separately.
// The integrated build measures 1614KB in CI and locally.
// 1616 -> 1642 for the Phase 3 camp integrated with main. The merged build
// measures 1639KB with the stage 3 and 4 layouts, shop art metadata and
// painted footprints in the lazy camp code. First paint stays at 331KB.
// 1642 -> 1646 when Phase 2 met main's Gemfall fight reworks (#639 to #644):
// the merged build measures 1644KB locally and in CI, first paint 331KB.
// Keep 2KB of slack for CI.
// 1646 -> 1650 for the six later camp backdrops (#649). Their lane layouts
// bring the lazy camp payload to 1648KB in CI. The WebPs are fetched separately
// and first paint stays at 331KB. Keep the existing 2KB of slack.
// 1650 -> 1654 for camp terrain accents (#652) integrated with the friend
// habits and latest main. The measured total is 1652KB, with first paint
// still at 331KB. Keep 2KB of slack.
// 1654 -> 1665 for indoor rest motion. Pixi's mesh renderer and the room
// effects load only on the painted rests that use them. The build measures
// 1663KB total and 331KB at first paint, retaining the 2KB total margin.
const TOTAL_BUDGET_KB = 1665;

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
