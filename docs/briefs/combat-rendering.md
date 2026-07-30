# Brief: the client half of combat

**Status: done.** Written during the 2026-07 performance/consistency pass, which
confirmed the split the README now states: Chapter 4's combat is built and
tested server-side (`packages/shared/src/encounter.ts`, `grid.ts`,
`enemy-ai.ts`, wired through `engine.ts`; `content/abilities.json`;
`content/maps/thicket.json`) and the client renders none of it. An encounter
today reaches the phones as state they cannot draw.

This brief is the work order for closing that half. It exists because the pass
found two traps that will bite whoever starts without knowing about them.

## Trap 1 — there are two cameras, and the tested one is not the wired one

`packages/client/src/world/camera.ts` (493 lines, 448 lines of tests) is the
focus camera the roadmap's Chapter 4 calls unconditional: it frames the active
actor, clamps to the board, letterboxes, launders NaN, and knows what
`MIN_VISIBLE_TILES` means. **Nothing imports it except its tests.**
`scene.ts` meanwhile ships its own ad-hoc `CameraState`/`resolveCamera` that
fits the 1600×900 design rect and nothing else. They disagree about what
"contain" means.

The work is to make `scene.ts` consume `camera.ts` — feed it the viewport from
`resize()`, drive the stage transform from `resolveCamera(state, viewport)` —
and delete the ad-hoc camera. Do this **first**, before the board renderer,
because the board renderer needs the real camera to be testable at both TV and
phone scales. `focusCamera()` / `getActiveScene()` in `scene.ts` are the seams
left waiting for exactly this; the `"character"` and `"point"` arms of
`FocusTarget` are currently dead and become live here.

## Trap 2 — the state is already flowing; do not invent a second channel

`RunState.encounter` (`packages/shared/src/types/state.ts`) already reaches
every client through the same JSON-patch mirror as everything else, and
`COMBAT_SEQUENCE` presentations (with `after` chaining and per-event duration —
both already handled in `sync/channel.ts` and `WorldView`) already gate the
patches. The renderer is a *reader* of `useGameStore`; it must not fetch,
poll, or keep combat state of its own. `legalActions` comes down on the state
for the active player; the phone draws only what it is handed — "illegal
actions are not presented" is the server's guarantee, and the UI's job is to
not re-derive it.

## The work, in order

1. **One camera.** As above. Done when `camera.test.ts` still passes, the ad-hoc
   camera is gone, and pinch/pan on a phone overrides the auto-frame.
2. **Board renderer** in `world/` — tiles from `board.terrain` (the biome tile
   sheets in `assets/biomes/<id>/tiles.png` are shipped and verified), actors as
   the existing party sprites plus enemy cutouts from `assets/entities/`,
   reachable-tile highlights from `legalMoves`, z-sorted by row
   (`sortableChildren` is already on).
3. **Phone combat UI** in `screens/` — action cards from `legalActions` only,
   target-confirm step, damage numbers in the top 64px band (the effect
   contract reserves it — `assets/manifest.json` `$effectToleranceComment`).
4. **Effect sheets.** `assets/effects/*.sheet.png` + JSON are shipped and
   verified; they sync to `COMBAT_SEQUENCE` events at 12fps on the contract's
   tick clock. `impact_strike` on hit, `heal_bloom`/`burst_star` on cast,
   `revive_lift` on Help Up.
5. **Focus camera in anger** — active-actor framing on every surface, which is
   what makes the grid legible in Travel Mode (roadmap Chapter 4).

## Acceptance

The e2e suite gains a combat leg: three contexts play `bramblewood-01` into the
thicket encounter, someone goes down, someone helps them up, victory branches
the story. `npm run typecheck`, `npm test`, `npm run build` stay green. Perf
gate: the render loop must respect the ticker discipline `PixiStage` now has
(stopped when hidden or zero-sized) — a combat renderer that reanimates the
always-on ticker regresses the 2026-07 pass.
