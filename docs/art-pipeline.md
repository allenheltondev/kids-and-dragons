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
                                 manifest.rigContract (§6.1) and green through
                                 `art:verify:rig:strict`
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
| **Rigging — skeleton, state machine, clip table** | **The agent**, via `rive-mcp` (see below) |
| The spec it works from | **Us** — [asset-brief.md](./asset-brief.md) |
| The machine gate that decides "done" | **Us** — `npm run art:verify`, `npm run art:verify:rig` |
| The taste call | **Allen**, on a contact sheet |

**Rigging moved from human to agent, and that is the biggest change since this
document was written.** It was scoped here as the one step that stayed
hands-on — ~2h per species in the Rive editor, 12 hours across six, and the
long pole of the whole art plan. It is now `rive-mcp`
(allenheltondev/rive-mcp), whose `rig --contract` derives a rig's entire clip
table, event ticks and input list from `assets/manifest.json` directly. All 24
rigs are delivered and `art:verify:rig:strict` is green.

That the contract is the *input* to rigging rather than a description checked
afterwards is what makes it safe to hand over: a rig cannot drift from the
manifest, because the manifest is what it was generated from — and the
verifier still opens every `.riv` and compares it clip by clip, because
"the agent says it's finished" is not an acceptance criterion here either.

The important consequence: **"the agent says it's finished" is not an acceptance criterion.** We
still own an independent verifier that runs in our CI against our repo. Outsourcing the work does
not outsource the gate — if anything it raises the bar, because the failure modes (a part off by
four pixels, a canvas that's 1023 wide, a missing `tail.png`) are exactly the kind that look fine
in a preview and break at runtime.

So the tooling is five commands:

| Command | Does |
|---|---|
| `npm run art:verify` | Checks `assets/` against `assets/manifest.json`: pixels, canvas, registration, alpha, orphans, effect composition. **Runs in CI. Blocking.** |
| `npm run art:verify:strict` | The same, but *undelivered* art fails too. Runs prod-only in the deploy workflow — on a PR, sets landing over time are not a regression. |
| `npm run art:verify:rig` | The rig contract (`tools/art/verify-rig.ts`, §6.1): clip table coherence, the turn budget, effect/clip sync, and any delivered `.riv` against `rigContract`. **Runs in CI.** |
| `npm run art:verify:rig:strict` | The same, but *missing* rigs fail. **On, and green** — all 24 rigs are delivered, so a rig that goes missing is now a regression rather than a gap. |
| `npm run art:sheet` | Writes PNG contact sheets from `assets/` to `art/review/` for the human review pass (`tools/art/sheet.py`). |

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
