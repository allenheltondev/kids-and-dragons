# Kids & Dragons — Art Pipeline

How we get consistent, riggable, animated character art out of an image model
and into the game. Companion to [spec.md](./spec.md) and [architecture.md](./architecture.md).

---

## 1. The decision, and why

**Characters are illustrated raster art, cut into parts, and animated with a bone rig.
Effects are sprite sheets. UI, grid, and particles are SVG/CSS.**

### Why not sprite-sheet the characters

Image models produce a *grid of similar drawings*, not *animation frames*. Between cells the horn
moves a few pixels, the eye size shifts, the palette drifts a shade. At 12fps that reads as
boiling. It's invisible in low-res pixel art — which is why sprite sheets work so well there — but
it's very visible in the illustrated style we've chosen.

### Why rigging wins here

| | Sprite sheets | Rigged cutout |
|---|---|---|
| Assets for 6 species × 4 tiers | ~2,000 frames | **24 part-sets** |
| Adding a new animation | Regenerate every character | Author once, works on all |
| Level-up gear as an overlay | Impossible | Trivial — new node in the rig |
| Frame-to-frame consistency | Model-dependent | **Guaranteed** |
| Smooth motion | 12fps | 60fps interpolated |

The level-up requirement alone decides it. Gear and aura layers have to compose onto an existing
character, and that only works if the character is a tree of transformable parts.

---

## 2. Asset taxonomy

```
assets/
  manifest.json                  the one manifest — part lists, canvas, tolerances,
                                 palette slots, rigContract (asset-brief is its prose half)
  characters/
    <species>/
      <tier>/                    fledgling | sworn | radiant | mythic
        assembled.png            the reference the parts must recomposite to
        parts/                   cut PNGs, transparent, registered to a common canvas
          body.png  head.png  mane.png
          arm_l.png arm_r.png  leg_l.png leg_r.png
          tail.png  wings.png  horn.png     ← per species: mane is universal
                                              (secondary motion, asset-brief §4.4),
                                              horn is the unicorn's, wings the flyers'
        rig.riv                  all 24 delivered, authored by rive-mcp from
                                 manifest.rigContract (§6.1) on the 1400 stage.
                                 Green through art:verify:rig and the motion
                                 gate; 4 manticore fail the rest check on a
                                 mesh-tail bug (§6.3)
        portrait.webp            *derived*, not commissioned — `npm run art:portraits`
                                 trims assembled.png to the figure, squares it, and
                                 writes 384px WebP for cards and lists (§2.1)
  gear/
    <class>/<tier>/              overlay parts, same registration
  entities/
    <entity-id>/assembled.png    canonical non-player creatures — single cutouts,
                                 no parts, no tiers (asset-brief §6.4)
  effects/
    <name>.sheet.png + .json     sprite sheets — jitter is invisible here
  biomes/
    <destination>/  bg.webp  tiles.png  props/
```

There is deliberately **one** manifest, at the top of `assets/` — not one per character directory
— so the contract cannot fork per asset. UI icons never live here at all: they are inline SVG in
the client, resolved from slugs (spec §11).

### 2.1 Derived assets

`portrait.webp` is the only file in `assets/` no artist delivers. The commissioned figure is a
1024×1024 PNG whose value is its alpha and its registered origin — the right shape for the Pixi
stage, the wrong shape for a card. Character creation puts all six species on a phone at once, and
at ~700KB each that is 4MB to answer "who do you want to be?". The derivation trims to the
figure's own bounding box, pads it square (six species, six aspect ratios, one card box), and
resizes to 384px: ~25KB apiece.

It is committed like any other asset so a checkout renders without a Python toolchain, and it is
re-run — `npm run art:portraits` — after new art lands. Nothing depends on it: every consumer falls
back to `assembled.png` (`screens/CreatureImage.tsx`), so a missing or stale portrait is a slower
card, never a broken one. `verify.py` ignores it; it is derived from art that already passed.

**Registration is the load-bearing constraint.** Every part of every tier of every species is
authored against the same canvas size and the same origin. A `sworn` horn must drop onto a
`fledgling` skeleton without repositioning. This is enforced by a script, not by discipline.

---

## 3. Division of labor

Asset generation is **outsourced to a coding agent** (Codex). We do not build a generation pipeline.

What that changes, and what it doesn't:

**Allen owns image assets. Claude owns everything else on the art side.**

| | Owner |
|---|---|
| **Image assets** — character parts, gear overlays, effect sheets, backdrops, props, tiles, creature cutouts | **Allen** (commissioning them, and the eye that accepts them) |
| Rigging — skeleton, state machine, clip table, per-tier export | **Claude**, via `rive-mcp` (see below) |
| The spec the drawings work from | **Claude** — [asset-brief.md](./asset-brief.md) |
| The machine gates | **Claude** — `npm run art:verify`, `npm run art:verify:rig` |
| The taste call | **Allen**, on a contact sheet |

If it is a `.png` or a `.webp`, it is Allen's. What is outstanding at any
moment is [asset-inventory.md](./asset-inventory.md) — or better,
`npm run art:inventory`, which derives it instead of restating it.

**Rigging moved from human to agent, and that is the biggest change since this
document was written.** It was scoped here as the one step that stayed
hands-on — ~2h per species in the Rive editor, 12 hours across six, and the
long pole of the whole art plan. It is now `rive-mcp`
(allenheltondev/rive-mcp), whose `rig --contract` derives a rig's entire clip
table, event ticks and input list from `assets/manifest.json` directly. All 24
rigs are delivered, regenerated onto the 1400 stage, and green through `art:verify:rig:strict` and
the motion gate (§6.3).

**The line falls there because rigs are generated from a contract and drawings
are not.** A rig cannot drift from the manifest, because the manifest is what
it was generated from — the contract is rigging's *input*, not a description
checked afterwards. No comparable statement is true of a drawing. So rigging
could cross over on the strength of a machine gate that decides the whole
question, and the taste call cannot, for that same reason in reverse.

The important consequence: **"the agent says it's finished" is not an acceptance criterion.** We
still own an independent verifier that runs in our CI against our repo. Outsourcing the work does
not outsource the gate — if anything it raises the bar, because the failure modes (a part off by
four pixels, a canvas that's 1023 wide, a missing `tail.png`) are exactly the kind that look fine
in a preview and break at runtime.

So the tooling is nine commands. The first six run with nothing installed; the last three need the
Rive CLI, which is not a repo dependency, and therefore never run in CI:

| Command | Does |
|---|---|
| `npm run art:verify` | Checks `assets/` against `assets/manifest.json`: pixels, canvas, registration, alpha, orphans, effect composition. **Runs in CI. Blocking.** |
| `npm run art:verify:strict` | The same, but *undelivered* art fails too. Runs prod-only in the deploy workflow — on a PR, sets landing over time are not a regression. |
| `npm run art:verify:rig` | The rig contract (`tools/art/verify-rig.ts`, §6.1): clip table coherence, the turn budget, effect/clip sync, and any delivered `.riv` against `rigContract`. **Runs in CI.** |
| `npm run art:verify:rig:strict` | The same, but *missing* rigs fail. **On, and green** — all 24 are delivered, so a missing rig is a regression rather than a gap. |
| `npm run art:sheet` | Writes PNG contact sheets from `assets/` to `art/review/` for the human review pass (`tools/art/sheet.py`). |
| `npm run art:inventory` | **What is left to draw** (`tools/art/inventory.ts`). Derives what is needed from the manifest, checks it against the disk, names every missing file. Reports; never gates. Prose around it: [asset-inventory.md](./asset-inventory.md). |
| `npm run art:verify:rig:rest` | Frame 0 of `idle` against `assembled.png` — does a rig stand where its art stands, at the size its art is drawn (`tools/art/verify-rig-rest.mjs`). The gate for a regeneration; §6.3. |
| `npm run art:verify:rig:motion` | What a rig *renders*, clip by clip and through the real state machine (`tools/art/verify-rig-motion.mjs`, §3.1). |
| `npm run art:sheet:rig` | Contact sheets of art that **moves** — N frames across a clip, one row per species (`tools/art/rig-sheet.mjs`). The taste gate for motion. |

Nothing counts as accepted without passing both the verifier and an eye on the contact sheet.

### 3.1 What the verifiers check

Everything in this list is mechanically decidable, and every item is a real failure mode that a
preview image will not reveal. Be precise about *which command* holds each rule, because "the
verifier checks it" has been claimed loosely in this document before and the fix was a grep.

**`art:verify` (`tools/art/verify.py`) — pixels.** It walks the manifest's `species` × `tiers`,
its `entities[]`, and its `effects[]`:

1. **Canvas** — exact pixel dimensions, per the manifest. Not "about right."
2. **Format** — PNG, RGBA, 8-bit, sRGB, non-interlaced.
3. **Alpha** — part layers have genuine transparency, not white or near-white background. Checks corner pixels and total opaque coverage.
4. **Registration** — recompositing all part layers reproduces `assembled.png` within a per-pixel tolerance. **This is the one that matters most**, and it is the one a human eye will never catch.
5. **Seams and silhouette** — joint overdraw between adjacent parts, and signature legibility at 120px.
6. **Bounds** — no part's opaque region touches the canvas edge. This buys `edgeMarginPx` (8px) of clearance, which guarantees a part is not *born* against the edge. It does **not** guarantee room for rig rotation — see §6.3, where that claim is retracted with the measurement that killed it.
7. **Naming** — a set's filenames match the manifest's expected part list exactly, case-sensitive; nothing in `assets/effects/` is undeclared.
8. **Cross-tier registration, palette, origin** — the same character rules across all four tiers.
9. **Effect composition** — frame geometry, sidecar agreement, fades, tile-scoped centre mass, top-band clearance, tint safety (asset-brief §9.4).

**`art:verify:rig` (`tools/art/verify-rig.ts`) — the rig as data.** The rig-contract rules — every
clip defined and required, event ticks inside their clips, the 45-tick turn budget re-derived,
effect/clip sync, and any delivered `.riv` compared clip-by-clip against `rigContract` — live in
**this** command, not in `art:verify` (§6.1 has the full list). It opens each `.riv` and reads its
metadata; by design it **renders nothing**.

**`art:verify:rig:motion` (`tools/art/verify-rig-motion.mjs`) — the rig as it moves.** What the
command above cannot see, because it is not in the file, only in the frames: a figure sinking below
its own standing line, leaving the artboard, not moving at all, teleporting between ticks, failing
to close a loop, or acquiring colours the approved art does not contain. Its state-machine layer
drives every input for real, including the full knockdown lifecycle — fall, settle in `down_loop`,
then clear the bool and get back up — and matches fired events against the contract as a *set*, so a
dropped event fails as loudly as a mistimed one.

One measurement there is deliberately a warning rather than a gate: enclosed see-through area. It
was written as a joint-opening check and was, until this change, incapable of returning anything but
zero. Repaired, it turns out to measure anatomy as readily as breakage — the biggest enclosed region
on a celebrating unicorn is the gap between its hind legs — so it warns at a level no clean rig has
reached and otherwise leaves the judgement to the golden baseline, which can see the number change
without needing to know a leg from a seam. Three layers — every clip measured frame by frame, every input fired through the real state
machine (isolated clips lie: standalone, `down_loop` plays as a *standing* loop and only inherits
the prone pose under the machine), and a golden baseline in `art/rig/motion-baseline.json` so a
rebuild reports which clips moved instead of leaving 312 to re-watch.

**`art:verify:rig:rest` (`tools/art/verify-rig-rest.mjs`) — where the rig stands.** Frame 0 of
`idle`, rendered at the stage's native size and compared to that tier's `assembled.png` in the
canvas-sized window at `rigStage`'s offset. At rest a rig *is* the art, so any scale, any offset,
and any overlay that repaints approved pixels shows up here — and nowhere else. Note what this
covers that the two gates above structurally cannot: `art:verify:rig` reads the file as data, and
`art:verify:rig:motion` measures every clip against the rig's *own* rest pose, so a rig uniformly
too small or shifted bodily is internally consistent and passes both of them clean.

**Known blind spots, named honestly.** `verify.py` does not walk `assets/gear/` or the contents of
`assets/biomes/`: the manifest declares 12 gear sets and 3 are delivered, and the gate is green.
An existence check for both is being wired up separately; until it lands, gear and biome
completeness are review-sheet facts, not CI facts.

`art:verify:rig:motion` shells out to the Rive CLI, which is **not** a dependency of this repo, so
it does not run in CI and a green pipeline says nothing about it. It is a local gate, run
deliberately. Its baseline has never been generated against these rigs — §6.3.

Failures print the offending file, the expected value, and the actual value. The agent should be
able to run this itself and iterate to green without a human in the loop.

### 3.2 What the verifier cannot check

**Artistic consistency.** No script can decide whether the Radiant unicorn reads as the *same
unicorn* as the Fledgling. That is `art:sheet` plus Allen's eye, and it stays a human gate.

Keep the two separate in your head: the verifier prevents *broken*, the contact sheet prevents
*wrong*.

---

## 4. The manifest

`assets/manifest.json` is the shared contract. The agent generates against it; the verifier checks
reality against it. It is the machine-readable half of [asset-brief.md](./asset-brief.md), and the
two must never disagree.

```jsonc
{
  "canvas": { "width": 1024, "height": 1024, "originX": 512, "originY": 900 },
  "tolerance": { "recompositeMaxDeltaE": 3, "edgeMarginPx": 8 },

  "species": [
    {
      "id": "unicorn",
      "tiers": ["fledgling", "sworn", "radiant", "mythic"],
      "parts": ["body","head","horn","mane","arm_l","arm_r","leg_l","leg_r","tail"]
    }
  ],

  "gear": [
    { "class": "songkeeper", "tiers": ["sworn","radiant","mythic"],
      "parts": ["overlay_torso","prop_held"] }
  ],

  "effects": [
    { "id": "heal_bloom", "frames": 12, "size": 256 }
  ]
}
```

Descriptive prompt material lives in the brief, not here. The manifest answers *what must exist and
in what shape*; the brief answers *what it should look like*.

---

## 5. Where the client uses it

Every path into `assets/` is built in one module —
`packages/client/src/world/art-paths.ts` — and nothing derives a filename anywhere else. It
imports no Pixi on purpose: half the consumers are DOM, not canvas, and the renderer is a lazy
chunk that the join screen must not wait for.

| Asset | Drawn by | Where you see it |
|---|---|---|
| `characters/<species>/<tier>/assembled.png` | `screens/CharacterPortrait.tsx` (DOM) | the six species cards, the hero pinned above every later creation step, the creation preview, the lobby lineup, your own sheet |
| ” | `world/scene.ts`, `world/board.ts` (Pixi) | the party standing in a scene, the figures on the combat grid |
| `entities/<id>/assembled.png` | `world/board.ts` | monsters in a fight |
| `biomes/<b>/bg.webp` | `world/scene.ts` → `setBiome`, and the creation preview's stage | behind the party in every story scene |
| `biomes/<b>/tiles.png` | `world/board.ts` | the combat floor |
| `effects/*.sheet.png` | `world/board.ts` | hits, heals, revives |

Two rules hold across all of them, because art is deployed separately from the bundle and can
therefore 404 against a perfectly good build:

- **A missing file degrades, never blanks.** Pixi keeps `drawPlaceholder`'s hatched silhouette;
  the DOM portrait falls back to the species icon; a missing backdrop leaves the drawn stand-in.
- **No screen depends on a picture to be usable.** Every portrait sits beside the name it belongs
  to, so the art is decoration on top of text that already says the same thing (spec §11).

---

## 6. Rigging in Rive

**Six rigs are authored — one skeleton per species — and each is exported per tier as a skin-bound
`.riv` into that tier's directory**, so there are 6 skeletons' worth of animation work and 24
`.riv` files on disk (`assets/characters/<species>/<tier>/`, which is where `verify-rig.ts` looks
for them). Same skeleton across all tiers of a species, so a tier change is a **skin swap on an
identical rig** — which is what makes the transformation cutscene possible. When §9's budget says
"6 rigs", it is counting the authoring; the export count is 24.

**Authored by `rive-mcp`, not by hand in the Rive editor** — the ownership change in §3. Its
`rig --contract` reads `assets/manifest.json` and derives the clip table, event ticks and input
list below directly, which is why the table and the rigs cannot drift: one is generated from the
other. The per-species art facts a contract cannot know — hierarchy, draw order, origin, which
parts are meshed — live in `art/rig/<species>.rig.json`. `art:verify:rig:strict` is green across
all 24.

### 6.1 Required state machine

Every character rig exposes the same state machine so game code never special-cases a species:

| Clip | Ticks (12fps) | Started by | Notes |
|---|---|---|---|
| `idle` | 24, looped | default | Breathing loop. Must look alive when nothing is happening. |
| `walk` | 4 per cycle, looped | `move` | Two steps per cycle; loops for the duration of a grid move. |
| `attack` | 8 | `attack` | Preceded by the roll (`rolls`). **`impact` event at tick 3** so effects sync. |
| `cast` | 10 | `cast` | Preceded by the roll. **`release` event at tick 4.** Two ticks longer than `attack` on purpose. |
| `hurt` | 5 | `hurt` | Concurrent — starts on the attacker's `impact` event and adds nothing to the turn. |
| `guard` | 6, then hold | `guard` | A plant and a hold, not a loop — Brace lasts until your next turn. |
| `leap` | 11 | `leap` | 3 crouch, 5 airborne, 3 land; **`dust` events at ticks 3 and 8.** |
| `down` | 6 fall + `down_loop` (24, looped) | `knockedDown` (bool) | **Not held** — the fall hands off to `down_loop`, a breathing loop at half `idle`'s amplitude and a second Rive animation the rig must ship with `down` (the manifest's `loopClip` names it). A frozen pose reads as a corpse (asset-brief §9.3). |
| `lift` | 10 | `helpUp` | The helper's reach-down. **`contact` event at tick 6.** |
| `revive` | 10 | the lift's `contact` event | Concurrent with `lift` — the contact, not the button press, brings the downed figure up. It runs 5 ticks past the lift's end, and the verifier charges that overhang to the Help Up turn. |
| `celebrate` | 24 | `celebrate` | Victory and level-up. Out of combat, so outside the turn budget. |
| `transform` | 24 | `transform` | Tier change, the most animated moment in the game. Chapter 5's; declared but deferred. **`flash` event at tick 4** starts `transform_flash`'s white-out (the manifest's `$comment` carries the tick's reasoning). |

Inputs: `move`, `attack`, `cast`, `hurt`, `guard`, `leap`, `helpUp`, `celebrate`, `transform`
(nine triggers); `knockedDown` (bool); `facing` (number).

This table is a restatement of `assets/manifest.json`'s `rigContract`, which carries the same
twelve clips with their ticks, events and flags as data. **The manifest wins over this document**,
same as everywhere else; `asset-brief.md` §9.2 is where the timings come from and why.
`tools/art/verify-rig.ts` (`npm run art:verify:rig`) enforces it.

Be precise about what the tool does, because for months this paragraph claimed it enforced an
interface it had never seen:

| It checks | It does not check |
|---|---|
| The contract is coherent — every required clip defined, every event tick inside its clip, no duplicate input names, every clip reachable from a trigger, started by its host's event (`startsOn`), or documented as not needing one | Whether the animation is any good. §6.2 and asset-brief §9.8.2 |
| Every clip is required by some set, so nothing is a line in a table that no rigger is told to author | |
| The worst realistic turn fits §9.2's 45-tick budget, re-derived from the clips rather than quoted — including effect tails and any concurrent clip's overhang past its host, both read off the manifest's `startsOn` data | |
| Every delivered effect sheet declares its start in the manifest (`startsOn: { clip, event }`, or `null` for an ambient loop), names a real event, and runs on the contract's tick. A declared event no sheet consumes yet (`leap`'s `dust`) is a warning, not a failure | |
| A delivered rig, clip by clip — missing clips, clips nobody asked for, lengths that disagree with the tick table, a hold clip that loops, a `down` without its `down_loop`, missing or wrongly-typed inputs | |

**Where the edge actually is.** `compareRigToContract()` is complete and covered by
`verify-rig.test.ts` — twenty-eight cases against fabricated rigs — and the effect-sync and
turn-budget checks are exercised there too, against the real manifest and mutations of it, so
which sheet fires on which event is checked as the data it now is rather than as a table this
tool remembers.
And the `.riv` reader is real: an earlier revision of this paragraph claimed the Rive runtime could
not initialise headlessly (WebGL, shader compilation, `getShaderInfoLog`), and that claim was tested
and found **false** — `@rive-app/canvas-advanced` 2.39.1 is the Canvas2D build, and it starts under
plain Node with a tiny document stub and the wasm binary handed to it directly. So a `.riv` on disk
is genuinely opened, its clips and state-machine inputs read, and the result compared to
`rigContract` clip by clip.

The remaining honest caveat is younger and smaller: **no `.riv` exists in the repo yet**, so the
read path has never met a real delivery — the first rig is still its first full rehearsal. A `.riv`
the runtime cannot open is reported as a **failure**, not skipped: "I could not read this" is
information and silence is not, and silence is exactly the state that let this paragraph carry a
false claim for as long as it did.

Two gaps of exactly this shape have now been closed, and they are the reason to be suspicious of any
claim in this document that a check exists — **grep for it**. `verify.py` walked `manifest.species`
and never opened `assets/effects/`, so six `aura_*` sheets shipped with no manifest entry and nothing
noticed (`check_effects`); and it checked effect *geometry* while saying nothing about where an
effect's mass sat or how long it ran (`check_effect_composition`).

### 6.2 Palette slots

Player-chosen colors are applied at runtime by driving named color properties on the rig
(`mane`, `accent`, `marking`) — **not** by generating per-color art. Six species × four tiers stays
24 asset sets regardless of how many palettes we offer.

### 6.3 The stage, and the 24 rigs that predate it

Twenty-four rigs ship at `assets/characters/<species>/<tier>/rig.riv` — six species × four tiers,
generated by `rive-mcp` from the six configs in `art/rig/` against this manifest's `rigContract`
(§3). They were built on the bare 1024 art canvas until 2026-08-06, and **that stage was too small.**

§3.1 rule 6 used to claim the 8px `edgeMarginPx` "guarantees room for rig rotation without
clipping". It does not, and the arithmetic is not close: 8px is enough that a part is not *born*
against the edge and nowhere near enough for a figure to rotate, leap or topple inside one. A
knocked-down character sweeps its own **diagonal**, and a mythic tier fills the canvas standing
still. This is not a prediction from the geometry — the rigs were built that way and they clipped.
The contract ships `down` (6 ticks of fall), `down_loop` and `leap`, so it is three clips on every
one of the 24.

The stage is therefore **1400×1400**, declared once in `assets/manifest.json` as `rigStage`: the
1024 canvas centred in it, 188px of blank on every side, at scale 1, with the standing point still
landing on the manifest origin — `ground` in each config is that point in artboard coordinates
(512+188, 900+188). Rest stays 1:1 with `assembled.png` inside the sub-rect, which is what keeps
`art-paths.ts`'s anchors true when the renderer swaps.

**Regenerated on 2026-08-06, and the pass found a second bug bigger than the one it was for.**

The configs gained `scale: 1` with the stage, and that turned out to matter more than the stage did.
Every rig previously on `main` was built from a config with no `scale` key at all, so the builder
applied its default — fit the figure to a fraction of the artboard height. Measured against the
approved art, `unicorn/fledgling` as shipped:

| | bbox | w x h | feet |
|---|---|---|---|
| approved art | x149-875 y79-899 | 727 x 821 | y=899 |
| **rig as shipped on main** | x185-839 y234-972 | 655 x 739 | **y=972** |
| rig after regeneration | x149-875 y79-899 | 727 x 821 | y=899 |

That is **0.901 wide by 0.900 high** — the figure drawn at 90% of its commissioned size, with its
feet 73px below the manifest origin it is supposed to stand on. Not a unicorn problem: the whole
set measured 7.79-10.55% against its own art. And the client *draws these*, so every rigged
character in the game was a tenth too small and sunk into the floor.

**The stage question itself is settled.** `art:verify:rig:motion` has now run for the first time —
312 clips across all 24 rigs, plus all 9 inputs driven through every state machine: **PASS**, 0
failures, 10 warnings. Every clip stays on its feet and inside the artboard, `down` and `down_loop`
included, and every machine passes through the states the contract promises and fires its events on
the contracted ticks. The 10 warnings are all the same one — `leap` moving 6-7x the median on a
single tick — which is the missing-keyframe heuristic firing on the airborne frame of a leap, the
case its own threshold note says to expect from real acting.

Nothing caught the scale error for the same reason the stage was wrong: no gate compared a rig's
geometry to the art it was built from. `art:verify:rig` reads clip metadata, and the motion gate measures each clip
against the rig's own rest pose, so a uniformly-shrunk rig is internally consistent. That gap is
now `art:verify:rig:rest` (§3.1), and it is why the ladder below puts it second and calls it the
decisive one.

**The client draws these rigs** — `world/rive-rig.ts` and `world/rive-actor.ts`, on the story lineup
and the combat board — so this was never a dormant asset problem, and the client moved in the same
change. The invariant it now holds:

- Static art stays on the **1024 canvas** and anchors at `ANCHOR_X/Y` = (0.5, 900/1024).
- Rigs live on the **1400 stage** and anchor at `RIG_ANCHOR_X/Y` = (0.5, 1088/1400), because the
  standing point sits at a different fraction of a bigger texture.
- `createRiveActor` scales the rig sprite by `RIG_STAGE / CANVAS`, so the 1024 canvas *region*
  measures the requested character height rather than the whole artboard measuring it.

Different anchors and a scale factor, so that both paths draw the same character at the same size
with its feet on the same world point. `art-paths.test.ts` pins all three against the manifest,
including the trap that the horizontal anchor is unchanged at 0.5 while the vertical one moves —
half the pair looking untouched is what made this easy to miss.

#### The manticore mesh tail — root cause found and fixed upstream; a residual remains

Twenty of twenty-four rigs reproduce their art exactly. All four manticore tiers do not, and
manticore is the only species with a mesh: `meshParts: { tail: { bones: 5 } }`.

**Cause one — the crop threw art away. Fixed.** `rive-mcp`'s spine analysis builds a mask from the
*largest 8-connected component*, which is right for the tip search it was written for: a crumb of
stray alpha would otherwise hijack the search for the far end of the tail. But the same mask was
then used to crop the part, and that crop is what supplies the mesh its texture — so every
component except the biggest was silently deleted from the rig. The manticore tail is a **barbed**
tail: measured on mythic it is **6 components**, the largest 84.9%, and the other five — the barbs,
which do not touch the shaft — were **15.1% of the part, discarded**. Art that passed every pixel
gate on the way in, gone at the rigging step, and invisible to every gate after it.

**The fix, as merged.** Two domains instead of one, in `pageScript.ts`:

- `mask` — the largest connected component, unchanged. Still the domain for the tip search, the
  geodesic distances and the spine, because that is the job it was right for.
- `kept` — every component big enough to be artwork (64px, or 0.1% of the largest, whichever is
  larger). This is what the crop is taken from. The area filter matters: bounding the crop by raw
  alpha instead would let one stray pixel in a far corner stretch the crop across the canvas and
  thin the mesh over the shaft, which is the coarse-deformation problem the crop exists to prevent.
  Measured across the four tails, real barbs run 119–5351px and are all kept; two antialiasing
  specks of 34 and 19px are dropped.

Retained components also had to enter the *deformation* model, not just the texture — a barb drawn
in the right place that then rides the base of the tail is still wrong. A vertex resolves through an
unbounded search for the nearest primary-component pixel when there is retained artwork **within
half a cell** of it, and the cell-level test is load-bearing: the mesh is far coarser than the
texture, so a barb can sit entirely between four vertices and leave all four reading "transparent".

An earlier iteration of this took the crop from every opaque pixel and tested `kept` per vertex.
Both were superseded in review before merge; the two-domain, per-cell version above is what shipped.
Measured, per tier:

| | before | after |
|---|---|---|
| mythic | 96.90% | **99.58%** |
| radiant | 97.84% | **99.49%** |
| sworn | 98.01% | **98.73%** |
| fledgling | 99.61% | 99.61% *(unchanged — see below)* |

Mythic's missing pixels went 11,739 → 1,573. `fledgling` rebuilt **byte-identical**, which is its
own confirmation: its tail's components share a bounding box, so the crop never changed.

**Cause two — unfixed, and it is not the crop.** Every tier still sits under the 99.80% floor, and
fledgling never moved, so a second defect is in play. On fledgling it is 1,373 missing pixels
against 11 extra, all inside the tail, concentrated toward the tip, and only a third of them on the
silhouette rim — the figure is losing interior area, not an antialiased edge. It is mesh-specific:
the same tier rebuilt with `meshParts` removed scores **100.00%**, 0 pixels differing. It is not
the skinning bind pose — Rive's skin carries a bind matrix and per-bone inverse-bind tendons, so at
rest every bone composes to identity and a linear blend of identities is still identity, whatever
the weights say. Not diagnosed further.

**So the config is left as authored and those four stay red.** Dropping `meshParts` would take
manticore to 100% today and cost the tail its secondary motion — an art call (asset-brief §4.4),
not a pipeline one. Red is the correct state for a tail with a piece missing, and the number now
says how big the piece is.

Both causes are **pre-existing**: the rigs on `main` used the same config through the same
generator. The 90%-scale error was simply large enough to hide them.

#### Running the Rive CLI

Steps 2-5 below shell out to `rive-mcp-build`, which is not a dependency of this repo. Two
environment variables, and the second one is not obvious:

```bash
git clone https://github.com/allenheltondev/rive-mcp && cd rive-mcp && npm install && npm run build
export KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js
export RIVE_MCP_CHROME=/path/to/a/chromium          # see below
```

`rig`, `render` and `events` drive the real Rive runtime through headless Chromium via
`playwright-core`, and the CLI looks for a *branded* browser — `/opt/google/chrome/chrome`, then
`/opt/microsoft/msedge/msedge`. A Playwright-managed Chromium does not live at either path, so a
machine with a perfectly good browser still fails with "No Chromium-based browser found". Point
`RIVE_MCP_CHROME` at the executable; under Playwright's layout that is
`$PLAYWRIGHT_BROWSERS_PATH/chromium-<build>/chrome-linux/chrome`.

#### Validating the regeneration

The restage changes *only* geometry, and geometry is the one thing the cheap gates cannot see —
`art:verify:rig` reads the file as data, and `art:verify:rig:motion` measures every clip against
the rig's *own* rest pose, so a rig uniformly too small or shifted bodily is internally consistent
and passes both. Run these in order; each one can only be trusted once the one above it is green.

| # | Check | Needs | Catches |
|---|---|---|---|
| 1 | `npm run art:verify:rig:strict` | nothing (CI) | The artboard is 1400 and the clip table and inputs survived the rebuild. Cheap, runs in CI, and **green on all 24** since the regeneration. |
| 2 | `npm run art:verify:rig:rest` | Rive CLI | **The decisive one.** Frame 0 of `idle` against `assembled.png`, in the canvas window at (188,188). Catches scale, position and repaint — every way the restage can go wrong. A clean rig scores ≥99.8%; a figure fitted to the artboard instead of honouring `scale: 1` scores in the 20s. |
| 3 | `npm run art:verify:rig:motion` | Rive CLI | The clipping itself: does `down` still leave the artboard on the bigger stage? This is the question the restage exists to answer, and it cannot be asked before 2 passes — measuring motion on a rig that is the wrong size measures the wrong rig. |
| 4 | `npm run art:sheet:rig -- --clip down` | Rive CLI | A human looking at the fall. The gates prevent *broken*; only the sheet prevents *wrong* (§3.2). |
| 5 | `--update-baseline` | Rive CLI | Only now. A baseline blessed before 2–4 pins whatever is wrong with the rigs it was generated from. |
| 6 | Client anchor + `spike:rive` | — | The two consequences below. Not optional: 1–5 can all be green while the game draws the figure in the wrong place. |

Steps 2–5 need the Rive CLI, which is not a repo dependency, so none of them run in CI — a green
pipeline after a regeneration means step 1 and nothing else.

Three consequences to carry into that regeneration, the first of which is load-bearing:

- **The client's rig anchor moved with the stage — done in this change.**
  *Before:* `rive-rig.ts` re-exported `ANCHOR_Y` from `art-paths.ts` — `originY / canvas.height` =
  900/1024 = 0.879 — and `rive-actor.ts` anchored the rig at `(0.5, ANCHOR_Y)`. Correct only while
  the stage *was* the art canvas.
  *Now:* `art-paths.ts` derives `RIG_ANCHOR_X/Y` from `rigStage` — (0.5, 1088/1400 = **0.777**) —
  `rive-rig.ts` exports those instead, and `rive-actor.ts` uses them. Static PNG sprites keep
  `ANCHOR_X/Y` at 0.879, because they are still 1024 art. One constant became two.
  `art-paths.test.ts` pins both against the manifest, including the trap: X is unchanged at 0.5
  while Y moves, so a reader checking only the centring concludes nothing happened.
- **The figure got smaller in its own texture — also fixed here.** A character occupies 1024/1400 =
  ~73% of the stage, and `createRiveActor` sized the sprite to the whole texture, so it drew
  characters at 73% of the height asked for. It now scales the sprite by `RIG_STAGE / CANVAS` so the
  canvas *region* measures the requested height; `art-paths.test.ts` carries the invariant that a rig
  and a PNG of the same character come out the same size with their feet in the same place.
  What is **not** fixed is `BUFFER_PX = 512` in `rive-rig.ts`: the figure now occupies ~73% of the
  linear buffer, so 512 buys ~375px of character where it used to buy 512. Left alone rather than
  guessed at — the §7 spike has never been re-run at the larger stage, or on the TV.
- **`art/rig/motion-baseline.json` does not exist yet.** The motion gate's third layer is a golden
  baseline, and a baseline is only worth having once the thing it pins is the thing we intend to
  ship. Generate it (`--update-baseline`) after the restage and after a human has looked at a
  contact sheet — not before. A baseline blessed over a rig that topples off-stage pins the bug.

---

## 7. Rive → Pixi integration

Rive and Pixi are separate renderers. Compositing them is the one real technical seam in the client.

**Approach:** each character renders in an offscreen Rive canvas; the canvas is uploaded as a Pixi
texture each frame it changes and drawn as a sprite in the scene graph. Only dirty rigs re-upload.
With 3 players + 4 enemies that is at most 7 textures — well within budget on any machine that can
drive a TV.

> **Chapter 0 spike:** stand up 7 concurrent Rive rigs composited into a Pixi scene and measure
> frame time on the actual TV-connected hardware. If it doesn't hold 60fps, the fallback is a
> custom transform rig (a tree of Pixi sprites with keyframed transforms in JSON, ~300 lines of
> runtime) — cheaper to render, more painful to author. Decide this before any rigging work starts,
> because it determines the authoring tool.
>
> **Outcome: Rive, and the fallback was never built.** The harness is
> `packages/client/spike/rive-pixi.ts` (`npm run spike:rive`) — seven rigs, no dirty-rig skipping,
> frame time rather than FPS as the headline, both choices argued in its header. It sized the
> offscreen buffer at 512px, which is what `world/rive-rig.ts` uses. All 24 rigs shipped through
> this seam afterwards, so the tooling question is closed in practice. The one thing still owed is
> a **frame-time number taken on the actual TV and written down** — see the Chapter 0 note in
> [roadmap.md](./roadmap.md#chapter-0--foundation--spikes).

---

## 8. Build order

Do **not** turn the agent loose on 24 characters. The brief is unproven until something built from
it survives contact with the game.

1. **Write the brief and the verifier first.** Both before a single asset is commissioned. The verifier is ~200 lines and it is the thing that makes the handoff safe.
2. **Commission one species, one tier** — Fledgling unicorn. Iterate the *brief* against what comes back, not just the assets. Every correction you have to make by hand is a gap in the brief.
3. **Rig and animate it.** Validates the rig contract and the Pixi seam (§7).
4. **Ship it in the game.** One character, moving on a grid, on the TV and on a phone.
5. **Commission the remaining three unicorn tiers.** This is the real consistency test — same character, escalating detail.
6. **Only now**, batch the remaining 5 species.

The brief is the actual deliverable of steps 1–5. Every problem you find on one character is a
paragraph you add, and that paragraph saves you twenty-three repeats of the same fix.

**All six steps are done.** The order held: unicorn first, then its remaining three tiers as the
consistency test, then the other five species batched — 24 part-sets and 24 rigs, green through
`art:verify` and `art:verify:rig:strict`. Step 3 ("rig and animate it") turned out cheaper than
budgeted because rigging became generation rather than authoring (§3), which is the one place this
plan was wrong in the helpful direction.

---

## 9. Budget

| Category | Count | Notes |
|---|---|---|
| Character part-sets | 24 | 6 species × 4 tiers |
| Gear overlay sets | 12 | 4 classes × 3 tiers (fledgling has no gear) |
| Rigs | 6 | One skeleton per species, reused across tiers |
| Effect sheets | 17 | 11 delivered (attacks, heals, auras, transformation) + 6 specified in asset-brief §9.4 |
| Biome backdrops | 17 | The Realm of Red Sky destinations (asset-brief §4.5), plus prop sets. Shipped. |
| Tile sets | 12 | One per terrain family, copied into each destination directory. |
| UI icons | ~60 | SVG, hand-authored or traced |

With generation commissioned, the human time redistributes rather than disappearing:

| Human task | Effort | Why it stays human |
|---|---|---|
| Writing and iterating the brief | **Highest leverage. Front-loaded.** | It's the thing that scales to 24 characters. |
| Reviewing contact sheets | ~15 min per gate | No script decides "same character." |
| ~~**Rigging in Rive**~~ | ~~~2h per species skeleton~~ | **No longer human.** `rive-mcp` generates the skeleton and state machine from `manifest.rigContract`; see §3. |
| ~~Binding tier skins to rigs~~ | ~~~15 min per tier~~ | **No longer human,** and cross-tier joint registration did hold — all four tiers of all six species are rigged and green. |

Rigging was the long pole of this plan — roughly **12 hours across 6 species**, gated on a spike
that had to settle before commissioning past the first character. Both are closed: the spike
resolved in Rive's favour, and the work is `rive-mcp`'s. What is left of the human budget is the
brief and the taste call, which is where it was always most valuable.
