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
  characters/
    <species>/
      <tier>/                    fledgling | sworn | radiant | mythic
        parts/                   cut PNGs, transparent, registered to a common canvas
          body.png  head.png  horn.png
          arm_l.png arm_r.png  leg_l.png leg_r.png
          wing_l.png wing_r.png  tail.png
        rig.riv                  Rive file: skeleton + state machine
        manifest.json            part list, pivots, palette slots
  gear/
    <class>/<tier>/              overlay parts, same registration
  effects/
    <name>.sheet.png + .json     sprite sheets — jitter is invisible here
  biomes/
    <biome>/  bg.webp  tiles.png  props/
  ui/
    icons/*.svg                  never raster
```

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

So the tooling shrinks from four commands to two:

| Command | Does |
|---|---|
| `npm run art:verify` | Checks `assets/` against `assets/manifest.json`: missing files, wrong canvas, bad registration, alpha violations, orphans. **Runs in CI. Blocking.** |
| `npm run art:sheet` | Builds an HTML contact sheet from `staging/` for the human review pass. |

`staging/` is gitignored. Nothing enters `assets/` without passing both the verifier and an eye.

### 3.1 What the verifier checks

Everything in this list is mechanically decidable, and every item is a real failure mode that a
preview image will not reveal:

1. **Existence** — every asset the manifest declares is present; nothing present is undeclared.
2. **Canvas** — exact pixel dimensions, per the manifest. Not "about right."
3. **Format** — PNG, RGBA, 8-bit, sRGB, non-interlaced.
4. **Alpha** — part layers have genuine transparency, not white or near-white background. Checks corner pixels and total opaque coverage.
5. **Registration** — recompositing all part layers reproduces `assembled.png` within a per-pixel tolerance. **This is the one that matters most**, and it is the one a human eye will never catch.
6. **Bounds** — no part's opaque region touches the canvas edge (guarantees room for rig rotation without clipping).
7. **Rig contract** — every `.riv` exposes the exact state machine in §6.1.
8. **Naming** — filenames match the manifest's expected set exactly, case-sensitive.

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

## 6. Rigging in Rive

One `.riv` per species/tier. Same skeleton across all tiers of a species, so a tier change is a
**skin swap on an identical rig** — which is what makes the transformation cutscene possible.

### 6.1 Required state machine

Every character rig exposes the same state machine so game code never special-cases a species:

| State | Trigger | Notes |
|---|---|---|
| `idle` | default | Breathing loop. Must look alive when nothing is happening. |
| `walk` | `move` | Plays during grid movement, looped for the duration. |
| `attack` | `attack` | ~0.6s. Impact frame exposed as an event so effects sync. |
| `cast` | `cast` | Starweaver/Songkeeper variant. |
| `hurt` | `hurt` | Short, non-gory flinch. |
| `down` | `knockedDown` (bool) | Lying pose. Held, not looped. |
| `revive` | `helpUp` | `down` → `idle` transition. |
| `celebrate` | `celebrate` | Victory and level-up. |
| `transform` | `transform` | Tier change. The most animated moment in the game. |

Inputs: `move`, `attack`, `cast`, `hurt`, `helpUp`, `celebrate`, `transform` (triggers);
`knockedDown`, `facing` (bool/number).

**`tools/art/verify-rig.ts` does not exist yet.** This paragraph used to claim it asserted the
interface above; it never did. Until it is written, nothing checks a `.riv` against this table, so a
rig missing `celebrate` fails at the table rather than in CI — which is the exact inversion this
pipeline exists to prevent. Treat the table as a contract enforced by review, and write the tool
before the first rig lands. `asset-brief.md` §9.7 asks for the clip list to be moved into
`manifest.json` as `rigContract`, which is what such a tool would read.

The same gap swallowed six effect sheets: `verify.py` walked `manifest.species` and never opened
`assets/effects/`, so `aura_*` sheets shipped with no manifest entry and nothing noticed. That half
is now closed (`check_effects`), and it is the reason to be suspicious of any claim in this document
that a check exists — grep for it.

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
| Effect sheets | ~20 | Attacks, heals, impacts, auras, transformation |
| Biome backdrops | 5 | Plus prop sets |
| Tile sets | 5 | One per biome |
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
