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
                                              (the recolor slot, asset-brief §4.4),
                                              horn is the unicorn's, wings the flyers'
        rig.riv                  the rig, built from art/rig/<species>.rig.json against
                                 manifest.rigContract (§6.1). Staged on a 1400 artboard
                                 so it has room to move in — §6.3
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

| | Owner |
|---|---|
| Generating images, cutting parts, hitting the spec | **The agent** |
| The spec it works from | **Us** — [asset-brief.md](./asset-brief.md) |
| The machine gate that decides "done" | **Us** — `npm run art:verify` |
| The taste call | **Allen**, on a contact sheet |

The important consequence: **"the agent says it's finished" is not an acceptance criterion.** We
still own an independent verifier that runs in our CI against our repo. Outsourcing the work does
not outsource the gate — if anything it raises the bar, because the failure modes (a part off by
four pixels, a canvas that's 1023 wide, a missing `tail.png`) are exactly the kind that look fine
in a preview and break at runtime.

So the tooling is seven commands:

| Command | Does |
|---|---|
| `npm run art:verify` | Checks `assets/` against `assets/manifest.json`: pixels, canvas, registration, alpha, orphans, effect composition. **Runs in CI. Blocking.** |
| `npm run art:verify:strict` | The same, but *undelivered* art fails too. Runs prod-only in the deploy workflow — on a PR, sets landing over time are not a regression. |
| `npm run art:verify:rig` | The rig contract (`tools/art/verify-rig.ts`, §6.1): clip table coherence, the turn budget, effect/clip sync, and any delivered `.riv` against `rigContract`. **Runs in CI.** |
| `npm run art:verify:rig:strict` | The same, but *missing* rigs fail. All 24 are delivered, so this passes too. |
| `npm run art:verify:rig:motion` | What a rig *renders* rather than what it declares (`tools/art/verify-rig-motion.mjs`, §6.4): every clip measured frame by frame, every trigger fired through the real state machine, and a golden baseline so review is a diff. Needs the Rive CLI, so not in CI. |
| `npm run art:rigs` | Builds all 24 rigs from the six configs in `art/rig/` (`tools/art/build-rigs.mjs`, §6.3). Not in CI — it needs the Rive CLI, which is not a dependency of this repo. |
| `npm run art:sheet` | Writes PNG contact sheets from `assets/` to `art/review/` for the human review pass (`tools/art/sheet.py`). |
| `npm run art:sheet:rig` | The same idea for art that moves: N frames of one clip, one row per species (`tools/art/rig-sheet.mjs`). |

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
6. **Bounds** — no part's opaque region touches the canvas edge (guarantees room for rig rotation without clipping).
7. **Naming** — a set's filenames match the manifest's expected part list exactly, case-sensitive; nothing in `assets/effects/` is undeclared.
8. **Cross-tier registration, palette, origin** — the same character rules across all four tiers.
9. **Effect composition** — frame geometry, sidecar agreement, fades, tile-scoped centre mass, top-band clearance, tint safety (asset-brief §9.4).

**`art:verify:rig` (`tools/art/verify-rig.ts`) — motion.** The rig-contract rules — every clip
defined and required, event ticks inside their clips, the 45-tick turn budget re-derived, effect/clip
sync, and any delivered `.riv` compared clip-by-clip against `rigContract` — live in **this**
command, not in `art:verify` (§6.1 has the full list).

**Known blind spots, named honestly.** `verify.py` does not walk `assets/gear/` or the contents of
`assets/biomes/`: the manifest declares 12 gear sets and 3 are delivered, and the gate is green.
An existence check for both is being wired up separately; until it lands, gear and biome
completeness are review-sheet facts, not CI facts.

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

That caveat is now spent. This paragraph used to end "**no `.riv` exists in the repo yet**, so the
read path has never met a real delivery — the first rig is still its first full rehearsal." The
rehearsal has happened: **all 24 rigs are delivered** (§6.3), and `art:verify:rig:strict` opens each
one with the runtime and compares it clip by clip, 24/24 read. It survived the delivery unchanged,
which is worth crediting to the one thing that was already fixed in advance: a character rig embeds
its part PNGs, the runtime decodes those with `new Image()`, and bare Node has no such global, so
`introspectRiv` had already learned to *claim* embedded assets rather than let them decode. Every
rig this pipeline produces would otherwise have come back as
`introspection failed: Image is not defined`. A `.riv` the
runtime cannot open is still reported as a **failure**, not skipped: "I could not read this" is
information and silence is not, and silence is exactly the state that let this paragraph carry a
false claim for as long as it did.

Two gaps of exactly this shape have now been closed, and they are the reason to be suspicious of any
claim in this document that a check exists — **grep for it**. `verify.py` walked `manifest.species`
and never opened `assets/effects/`, so six `aura_*` sheets shipped with no manifest entry and nothing
noticed (`check_effects`); and it checked effect *geometry* while saying nothing about where an
effect's mass sat or how long it ran (`check_effect_composition`).

### 6.2 Palette slots

The intent is unchanged and still right: player-chosen colors are applied at runtime by driving
named color properties on the rig — **not** by generating per-color art. Six species × four tiers
stays 24 asset sets regardless of how many palettes we offer.

**No rig ships a palette slot today, and the reason is measured rather than assumed.** The
mechanism works — a tint slot lays a vector shape traced from the part's own silhouette over it,
bound to a data-binding color property, adding no animations and no state-machine inputs, so the
contract gate stays green either way. What does not work yet is the *result*, in two independent
ways, both found by building the slots and looking:

1. **A `color` blend at the manifest's palette hexes repaints approved art.** `color` replaces hue
   and saturation across the whole slot and keeps luminance, so it flattens a painted region to one
   hue — and the manifest's `palette` values are the paletteRule's *targets*, not the colors the
   art was actually painted in. Measured against each tier's `assembled.png` at rest: manticore
   92.5% of pixels unchanged, unicorn 95.0%, kitsune **89.6%**. The kitsune's vivid orange ruff
   comes out muddy brown before a player has chosen anything.
2. **The traced silhouettes over-cover.** Set a property to any color other than white and the
   overlay spills onto neighbouring parts in hard-edged staircase blocks — chest, ears and legs on
   the kitsune. Invisible while the resting color happens to match the paint, which is exactly how
   a defect like this ships.

`multiply` with a `#FFFFFF` resting color fixes (1) — white multiplies to identity, 99.90% at
rest, the remainder being the overlay's own edge antialiasing — but not (2), and multiply over
already-saturated art gives a darkened muddy recolour rather than a clean one.

So the slots are deferred, and the shape of the fix is known: a tracer that does not over-cover, a
resting color measured from the art's own pixels rather than read off the paletteRule, and
`marking` needs its own registered art layer regardless — a slot that targets sub-part detail
(the star markings, bigfoot's leaf) cannot be traced out of a flattened body layer at all.

The property names each species will expose are settled and recorded in its `art/rig/*.rig.json`,
so re-adding the slots is a config edit and a rebuild, not a redesign:

| Species | Properties | Where they land |
|---|---|---|
| unicorn | `mane`, `mane_tail`, `accent` | mane and tail carry the species color; the horn is the accent |
| griffin | `mane`, `mane_tail`, `accent` | neck feathers and the tail tuft; wings are the accent |
| dragonling | `mane`, `accent` | the crest; the wing membrane is the accent |
| kitsune | `mane`, `accent` | the ruff; the tails are the accent |
| manticore | `mane`, `accent` | the ruff; the sting is the accent |
| bigfoot | `mane` | the fur trim — which is *also* bigfoot's signature part, so there is no second slot |

Two parts sharing one logical color need two properties (`mane`, `mane_tail`) because one property
drives one shape. The client sets both to the same hex.

### 6.3 Building the rigs

Six configs, `art/rig/<species>.rig.json`, one per **skeleton** — a tier is the same config pointed
at a different `parts/` directory, which is what §6's "6 rigs, 24 exports" means in practice. Joints
are measured per tier from that tier's own alpha overlaps, so the cross-tier drift
`tolerance.jointDriftToleranceNormalizedPx` allows is absorbed at build time rather than nudged by
hand; across all 24 builds not one pivot had to be guessed.

A config carries only what `rigContract` cannot know: adjacency and z-order, the manifest's canvas
and origin, the trigger→clip name mapping, and the two bool-driven state entries. **It restates no
tick.** Clip lengths, event ticks, loop/hold flags, the `down` → `down_loop` hand-off and the full
input list all derive from `assets/manifest.json` at build time. `art/rig/README.md` is the detail.

```bash
KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:rigs
npm run art:verify:rig:strict
```

The builder is a separate tool and deliberately not a dependency of this repo, which is why
`art:rigs` is not in CI and `art:verify:rig` is: the thing that has to hold on every push is that a
`.riv` in the tree matches the contract, not that anybody can rebuild it.

**The rigs are staged on a 1400×1400 artboard, larger than the 1024 art canvas**, with the art
centred in it (188px of blank on every side) at scale 1 and the standing point still on the
manifest origin, now (700, 1088). This is not cosmetic: `edgeMarginPx` is 8px, which is enough that
a *part* is not born against the edge and nowhere near enough for a rig to rotate, leap or topple
inside — a knocked-down character needs room for its own diagonal, and a mythic tier fills the
canvas standing still. Staging it removed **every** "off the artboard" failure in one change.

**The client consequence, recorded here because nothing enforces it yet:** `art-paths.ts` anchors
the static art at `originX/width, originY/height` = (0.5, 0.879) on the 1024 canvas. A rig anchors
at (0.5, 0.777) on the 1400 stage. Same point in the world, different fraction of a different
texture. Nothing in the client renders rigs today, so this costs nothing now and is a one-constant
change when it does. It also means the character occupies ~73% of the linear texture it used to, so
an offscreen buffer sized for sharpness has to grow with it — the §7 spike's numbers are at 512px
buffers and its TV row is still unrun.

**Every build is checked at rest against the art it was built from** — frame 0 of `idle`, rendered
at the stage's own size and cropped to the art-canvas sub-rect, against that tier's `assembled.png`. This is the check that matters most and it is not the
rig contract's job: `art-paths.ts` anchors every figure by the manifest's (512, 900) origin, so a
rig that is 90% the size of its own art stands in the wrong place the day the renderer swaps, and
nothing else in the pipeline can see it. That is not hypothetical — the builder's default scale
fits the figure to 90% of the artboard, and this check is how that was caught. Only *visible* pixels
are compared — below `tolerance.alphaThreshold` on both sides is ignored, the same line verify.py
draws, because comparing raw RGB counts colour noise inside pixels that are 97% transparent. The
floor is this pipeline's own number (0.998) and deliberately **not** `tolerance.recompositeIouMin`,
which it used to borrow: that governs silhouette IoU, while this compares RGB per pixel and is
strictly stricter. 23 of 24 rigs are pixel-exact; the radiant unicorn differs in 511 of 311,022
visible pixels where its horn crosses the forelock, which is the part split's edge showing through.

**Known and accepted, so nobody rediscovers them as bugs:**

- **Part-cut seams.** Off the rest pose, each part image resamples independently under a fractional
  transform, and the cut lines show as 1px color banding — bigfoot's thigh and shoulder cuts are the
  most visible. There are no transparency gaps (measured: zero semi-transparent pixels inside an
  opaque region on any of the six), and it fades at game size. `tolerance.minSeamOverlapPx` is the
  contract lever if it ever reads badly on a TV.
- **The manticore's sting is a rigid cutout**, not the five-bone chain a scorpion tail wants. It
  costs no clips and no inputs, so the gate is indifferent; it is deferred because mesh rendering
  quality is renderer-dependent and §7 is still open, and betting the species' signature move on a
  mesh nobody has seen on the shipping renderer is the wrong order.
- **Bigfoot's arm fur does not follow its arms.** The `mane` layer is a whole-figure fur trim —
  brow, mantle, chest, and islands along both arms — flattened into one PNG, so it hangs off the
  body. Splitting the trim per limb is an art change, not a rig change.
- **`facing` drives nothing.** It is exposed because the contract declares it and a partial
  interface is not the interface. Flipping is cheapest at the compositor (§7); wire it when the
  game decides what facing means.

### 6.4 Reviewing motion without watching 312 clips

Six species × four tiers × thirteen clips is 312 things to look at, and it is 312 again after every
rebuild. That does not scale to a pair of eyes, so most of it is measured instead.
`npm run art:verify:rig:motion` (`tools/art/verify-rig-motion.mjs`) is three layers:

**1. Every clip is rendered and measured.** The figure may not sink below its own standing line,
leave the artboard, open a hole at a joint, sit still, teleport between ticks, or fail to close a
loop. Thresholds come off `manifest.tolerance` — the number that decides whether two tiers stand in
the same place is the number that decides whether a crouch has sunk into the floor — rather than
being invented next to the check.

It also checks that **the rig has not painted anything**. A rig moves commissioned pixels around; it
does not invent colours. Anything that composites — a tint overlay whose traced silhouette overhangs
its part, a blend landing on the part underneath — produces hues that are in no part PNG, and it does
so *only on the ticks where the overhang sweeps across something else*. On screen that reads as
hard-edged patches of wrong colour appearing and disappearing as the figure moves, which is easy to
mistake for a transparency or codec artifact and is neither. Every tick's opaque pixels are compared
against the colour set of that tier's approved `assembled.png`; a clean rig scores 0.3% novel colour
(resampling between the art's own values) and the deliberately re-tinted kitsune used to calibrate it
scores 31%. Note what this catches that the rest check in §6.3 cannot: **the rest check only ever
looks at tick 0.** A defect that appears at tick 12 and is gone by tick 18 is invisible to it.

**2. Every input is fired through the real state machine.** This layer is not optional, because
rendering clips in isolation *lies*: standalone, `down_loop` plays as a standing breathing loop, and
only under the state machine does it inherit the prone pose from `down`. Each drive asserts the
states passed through and the state settled in — `knockedDown` passing through `down` into
`down_loop` and stopping there is the proof that the fall does not re-enter forever — and every
event is checked against the tick §6.1 puts it on.

**3. A golden baseline.** Layers 1 and 2 catch what somebody thought to measure. `art/rig/motion-baseline.json`
holds a hash per clip, so a rebuild reports *which clips changed* instead of asserting that all is
well. Review becomes a diff of three clips rather than a sweep of three hundred, and
`npm run art:sheet:rig -- --clip <clip>` is what you look at. A changed hash is a warning, not a
failure: usually somebody meant it.

**What this layer found on its first run**, none of which `art:verify:rig` could see, because none
of it is visible in the file:

- **A knocked-down character rotated most of itself off the artboard.** The fall pivots about the
  standing point, which is at the feet, so the body swung out of frame and a downed figure rendered
  as a pair of legs. Fixed in the generator: the fall now slides and lifts as it rotates, both
  offsets derived from the rotated bounding box of the measured standing pose.
- **Feet through the floor, in five different clips, from two different causes.** A rigid cutout leg
  cannot shorten, so dropping the root far enough to read as a crouch simply sinks it — `guard` and
  `lift` were putting bigfoot 20–25px under. Downward root motion is now capped at a foot's worth of
  squash. The subtler one: a leg rotating about the hip drives a *forward-pointing* foot **downward**,
  because the toe travels toward the point directly below the pivot. Bigfoot's flat feet went 30px
  under on `leap`'s crouch and 14px under on `walk`. The leap's legs now move only in the air, where
  there is no floor to hit, and the walk's swing came down from 16° to 13°.
- **The idle's breathing scale pushed tall tiers through the top edge.** 1.8% of a 884px figure is
  16px, and that is exactly the clear canvas the radiant unicorn has — on the clip a character plays
  most of the time. Every upward amplitude in the generator (the breath, the hop, `transform`'s 12%
  scale pop, which had the same fault) is now clamped to the headroom each tier actually measures.

The floor fixes cost something, and the gate says so in the same run: `leap` now warns that one tick
moves ~7× the median, because grounding the crouch made the crouch-to-airborne step a jump. That is a
real note about the acting, it is the tool doing its job on a change *it* prompted, and it is the kind
of thing a hand-polish pass in the studio fixes with an intermediate pose.

Also found, and **not** fixed: the taller tiers touch the artboard edge during `attack`, `cast` and
`hurt`. That is a warning rather than a failure and the reason is upstream of the rigs. §6.1 says
`edgeMarginPx` (8px) exists to "guarantee room for rig rotation without clipping", and it does not —
a rotation moves a mane tip by tens of pixels, and the radiant unicorn is commissioned with 16px of
clear canvas above it. The rig-side amplitudes are already clamped to whatever headroom each tier
actually has; past that the number in the art contract is the thing that has to change, and it should
change with eyes on a re-commission rather than by being edited to match.

**Three things this tool got wrong before it got them right**, which is the whole reason to distrust
a new gate more than an old one:

1. It rendered at `--fps 12` and therefore sampled only the **first fifth of every clip** — the Rive
   CLI's `--fps` does not reach the frame stepper, so frames advance at 1/60s whatever you ask for.
   It passed everything, including the fall it was written to catch. It now renders at `--fps 60`,
   where the bug cancels; `TICK_STEP` is the line to change if that is fixed upstream.
2. "How much of the figure is against the frame" counted edge pixels against the figure's area, and
   **passed the knockdown bug** — a head entirely outside the frame contributes only the handful of
   pixels where the neck crosses the boundary.
3. "How much of the figure is missing" measured lost silhouette area, and **failed `walk`, `hurt` and
   `celebrate`**, where nothing is off-canvas at all and the silhouette simply shrinks because the
   legs overlap each other.

What survived is *how much of one artboard edge the figure lies across*, calibrated against a rig
built with the fix and one built without: 0% typically with it, 23% typically without.

A fourth, added later for the same reason: comparing each tick's colours against **the rig's own
first frame** cannot see a tint at all, because a constant recolour drifts from the art without
drifting from itself. The reference has to be the approved `assembled.png`.

**A gate that has not been shown to fail on a known-bad rig is not evidence.** The knockdown fix was
reverted in the generator, the unicorn rebuilt, and the check confirmed to go red, before any of
this was written down.

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
| **Rigging in Rive** | ~2h per species skeleton | Authoring a skeleton and state machine is design work, not generation. Reused across all four tiers. |
| Binding tier skins to rigs | ~15 min per tier | Fast *if* cross-tier joint registration held. |

The rigging is now the long pole — roughly **12 hours across 6 species**, and it can't start until
the Rive-vs-custom-rig question (§7) is settled. Sequence that spike before commissioning past the
first character.
