# Brief: make the effect↔rig sync data, not code

**Status: done.** The last open item — the golden `.riv` fixture — landed in the
2026-08 rigging pass, authored not in the Rive editor but by `rive-mcp`
(allenheltondev/rive-mcp), whose `rig --contract` derives a rig's whole clip
table, event ticks and input list from `assets/manifest.json` directly.
`tools/art/fixtures/golden-hero.riv` is a two-part rig passing the hero set,
and `verify-rig.test.ts` now runs `introspectRiv` against it —
`compareRigToContract` gets real runtime output, and the garbage-bytes promise
is kept beside it. The same pass delivered the first real rigs (unicorn, all
four tiers), so the "first delivery" rehearsal below has happened and passed —
and the remaining five species followed, so the count is now all 24.

The 2026-07-30 pass landed
everything below that is decidable without the Rive editor: `startsOn` is in
the manifest for every effect (null for the six auras) and for both concurrent
clips, `EFFECT_SYNC` is deleted and every pairing derived from the manifest,
`checkTurnBudget` charges concurrent overhangs (worst turn still cast at
exactly 45/45), `down`'s hand-off loop is named `down_loop` and required with
its host, `transform` has its tick-4 `flash`, `guard` has its tick-3 `ward`
consumed by `guard_ward`, and `down` has its tick-6 `settle` consumed by
`down_settle`. The golden `.riv` fixture described below is also delivered and
exercised by `introspectRiv`. (The two provenance tolerances stay put by design
— they move only on a re-export of `heal_bloom`/`impact_strike`.)

Written during the 2026-07 pass, which fixed the rig
verifier's bugs (wrong Rive input-type codes, the broken wasm load path, the
false "cannot run headlessly" claim — `tools/art/verify-rig.ts` now genuinely
opens a `.riv`) but deliberately left three contract-shape problems for a
change with room to think. They share one root cause: **which effect fires on
which clip's event is code (`EFFECT_SYNC` in verify-rig.ts), not contract
(`assets/manifest.json`)**, so the checker can only see the three pairings
somebody hardcoded.

## What is wrong today

1. **8 of 11 effect sheets are never sync-checked.** `EFFECT_SYNC` knows
   `impact_strike`→`attack.impact`, `burst_star`→`cast.release`,
   `revive_lift`→`lift.contact`. `heal_bloom` fires from `cast` per
   asset-brief §9.1 and nothing checks it; `leap` declares a `dust` event no
   effect consumes; `guard` and `transform` declare **no events at all**, so
   the sheets specified for them (`guard_ward`, `transform_flash`) have nothing
   to start them — silent today, a guaranteed failure the day those sheets are
   wired.
2. **`concurrent` is an unverifiable assertion the budget math depends on.**
   The manifest's `$clipFlagsComment` claims `revive` "adds nothing to the
   turn"; it actually overhangs `lift` by 5 ticks (starts at contact tick 6,
   runs 10; lift ends at 10). `checkTurnBudget` excludes `concurrent` clips
   unconditionally, so the overhang is charged to nothing. Harmless at today's
   numbers, invisible until someone retimes `lift` — the exact failure mode
   this verifier exists to prevent.
3. **`down`'s hand-off loop has no name.** `loopTicks: 24` implies a second
   Rive animation, and the contract never names it — so the first *correct*
   `down` delivery fails as an unknown clip. A false failure on first contact
   with a rigger is the most expensive kind.

## The change

In `manifest.rigContract`:

- Each entry in `manifest.effects` gains `startsOn: { clip, event }` (auras,
  which loop ambiently, get `startsOn: null` and keep their `loop: true`).
- Each `concurrent` clip gains the same `startsOn`, so its real start tick is
  data and `checkTurnBudget` can charge any overhang past its host clip.
- `down` gains `loopClip: "down_loop"` (or the name the rigger prefers —
  agree *before* the first export) with its 24 ticks moved there.
- `guard`, `down` and `transform` declare the events their specified sheets need.

In `verify-rig.ts`: delete `EFFECT_SYNC`; derive every pairing from the
manifest; extend `checkEffectSync` to every effect with a `startsOn`; extend
`checkTurnBudget` to charge concurrent overhangs. The checks are pure
functions over the contract — they keep the existing test style (fixtures
built *from* the real manifest, so drift breaks tests).

Also fix the two numbers the pass documented but did not move (see
`$effectToleranceProvenanceComment`): if `heal_bloom` or `impact_strike` is
ever re-exported, `effectCentreEnergyMin` goes back to 0.70 and
`effectEndFrameCoverageMax` to 0.03.

## The fixture that makes it real

Commit one golden `.riv` under `tools/art/fixtures/` — a minimal rig matching
the hero contract (12 clips at contract lengths, the 11 inputs, events on the
right ticks), authored in the Rive editor once. Then `introspectRiv` gets an
integration test and `compareRigToContract` gets its first exercise against
real runtime output instead of fabricated introspections. Until this exists,
every claim about reading rigs rests on one garbage-bytes test.

## Acceptance

`npm run art:verify:rig` green with every delivered sheet sync-checked and a
turn budget that charges concurrent overhangs; `npx vitest run tools` green
including the golden-fixture test; `art:verify:rig:strict` red for exactly one
reason — no species rigs delivered yet — until the rigging lands.

**Met, and the last clause is now spent.** Rigging landed as `rive-mcp` rather
than as a human pass in the Rive editor — the ownership change recorded in
[art-pipeline §3](../art-pipeline.md#3-division-of-labor) — and all 24 rigs
(6 species × 4 tiers) are delivered. `art:verify:rig:strict` is **green**,
reading and comparing 24/24 rigs clip by clip, so a missing rig is a
regression now rather than an expected gap.
