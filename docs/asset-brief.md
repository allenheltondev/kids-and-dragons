# Kids & Dragons — Asset Brief

**This document is the complete specification for producing the game's art assets. It is written to
be handed to an agent as a self-contained work order.** Everything needed to produce, name, place,
and self-verify the assets is here. Nothing in it requires reading the rest of the repo.

Machine-readable companion: `assets/manifest.json`. Where the two overlap, **the manifest wins** —
it is what the verifier reads.

> **Revision 3.** `unicorn/fledgling` is **approved** and is now the reference for the entire cast —
> for style, construction, and colour. Sections marked 🔺 changed in rev 2; 🔺🔺 in rev 3.
>
> **Match the approved unicorn.** Where this document and `assets/characters/unicorn/fledgling/`
> disagree, the unicorn wins and the document is wrong — say so rather than following the text.

---

## 0. TL;DR for the agent

Produce **registered, transparent PNG part-layers** for animated storybook creatures, plus effect
sprite sheets and biome backdrops. Every part layer is **full-canvas** with the part in its final
assembled position — so stacking all parts of a character reproduces the assembled character
exactly. Run `python tools/art/verify.py` until it is green. Then produce a contact sheet for
human review.

🔺 **Start clean.** Any existing content under `assets/characters/` and `art/generated/` is from a
rejected revision. Delete it and regenerate from this document. Do not patch it.

The four things that will fail you, in order of likelihood:

1. **Missing seam overdraw** (§3.3) — parts cut exactly at the joint. Verified.
2. **Registration drift** — parts that don't recomposite to the assembled reference. Verified.
3. **Character drift across tiers** — tier 3 doesn't read as the same creature as tier 1.
4. **Style drift** — pretty art that isn't *this* art. Read §2 twice; it is prescriptive, not evocative.

---

## 1. What this art is for

A cooperative fantasy adventure game played by two adults and an 8-year-old. Characters are
mythical creatures — unicorn, dragonling, griffin, bigfoot, kitsune, manticore — that visibly grow
more impressive as they level up.

The art is viewed in two places, and **must work in both**:

- **On a TV**, across a room, at up to 1920×1080.
- **In a ~360×380 pane on a phone**, held at arm's length.

That second constraint governs everything. Silhouettes must be readable when small. Fine detail is
decoration, never information. If you can't tell what a creature is from its silhouette alone at
120px tall, it is wrong — and that is now a verified check (§6.1).

---

## 2. Style specification

**This section is prescriptive. Where it gives a number or a hex value, match it.** Revision 1
treated it as evocative and filled the gaps with defaults; the gaps are now closed.

### 2.1 Register

**Warm storybook illustration. Light-hearted, not saccharine.**

Think of a well-made children's picture book with real craft behind it — expressive, a little
mischievous, with genuine atmosphere. It should feel like somewhere you'd want to go.

🔺 **Explicitly not**, and this list is exhaustive of the failure modes we've already seen:

- **Pony / MLP fandom style.** No anthropomorphic bipedal ponies, no coy hip-cocked poses, no cutie-mark-style flank decals, no fandom color conventions (pastel coat + saturated two-tone mane).
- Chibi / kawaii, "cute mascot," clip-art vector flatness.
- Generic mobile-game fantasy, photoreal, grimdark.
- The default AI-illustration look: airbrushed gradients, **purple-and-cyan palettes**, symmetrical rendered-3D feel.

### 2.2 Form 🔺

| Property | Specification |
|---|---|
| **Stance** | **Quadruped.** All four limbs on the ground, weight even across all four. These are animals, not anthropomorphic characters. Bigfoot is the sole exception — it is bipedal by nature. |
| **Proportions** | Head height ≈ **1/3 of total body height** (measured crown to feet, excluding horn/ears). Sturdy limbs with visible mass. Chunky, not slender. |
| **Silhouette** | Readable at **120px tall**. One signature shape per species, and it must be **thick enough to survive downscaling** — the unicorn's horn should be a bold cone, not a needle. |
| **Line** | Hand-drawn quality, tapered. Outline color **`#3A2A1E`** (warm dark brown), never pure black. Silhouette line ≈ **5px** at 1024 canvas; interior detail lines ≈ **3px**. |
| **Shading** | Two tones plus a highlight. Soft-edged cel shading. No gradient meshes, no rendered specular. |
| **Light source** | **Upper-left**, on every asset, always. |
| **Detail density** | Low. Detail concentrated in the face and the species signature; simple everywhere else. |

### 2.3 Color 🔺🔺

> **Revision 3.** The approved `unicorn/fledgling` is now the colour reference for the whole cast.
> The rule below was *derived from it* — it reproduces that unicorn to within a few units on every
> slot. Follow the rule; the hexes are targets, not exact requirements.

**Never pure black or pure white.** Each species picks **one mane hue `H`** — that hue is its
identity — and every other slot follows from it:

| Slot | Rule (HSV) | Reads as |
|---|---|---|
| **Coat** | hue `H`, sat **0.07**, val **0.95** | Near-white, faintly tinted toward the mane |
| **Mane** | hue `H`, sat **0.35–0.70**, val **0.30–0.62** | The dominant colour mass, saturated |
| **Accent** | hue **85–170° from `H`**, sat **0.50**, val **0.88** | Bright and *lighter* than the mane — signature part only |
| **Marking** | hue `H`, sat **0.20**, val **0.88** | Soft tint of the mane, on coat |
| **Outline** | hue `H+10`, sat **0.50**, val **0.23** | Very dark, tinted — never neutral black |

Three properties make this work; preserve all three:

1. **The accent is lighter than the mane, not darker.** This is what makes the signature pop.
2. **Mane hues are spread around the wheel**, so three party members are distinguishable at 120px on a grid.
3. **The warm species separate by saturation and value, not hue** — bigfoot is dark and muted, kitsune bright and saturated, manticore deep. Don't flatten them toward each other.

| Species | Mane hue `H` | Coat | Mane | Accent | Marking | Outline |
|---|---|---|---|---|---|---|
| `unicorn` | **300** violet | `#F2E1F2` | `#853A85` | `#709FE0` sky | `#E0B4E0` | `#3B1D36` |
| `dragonling` | **145** emerald | `#E1F2E8` | `#2B6B46` | `#E09F70` ember | `#B4E0C6` | `#1D3B2E` |
| `griffin` | **205** slate | `#E1EBF2` | `#4D728C` | `#E0C470` gold | `#B4CEE0` | `#1D2A3B` |
| `bigfoot` | **30** umber | `#F2EAE1` | `#4C3F32` | `#70E09F` moss | `#E0CAB4` | `#3B311D` |
| `kitsune` | **18** vermilion | `#F2E6E1` | `#9E512F` | `#70CEE0` teal | `#E0C1B4` | `#3B2B1D` |
| `manticore` | **350** crimson | `#F2E1E4` | `#662E37` | `#96E070` venom | `#E0B4BB` | `#3B1D1D` |

Verified as a **warning**, not a failure: the verifier samples the dominant hue of coat, mane, and
accent and flags anything more than **30° off**. Latitude within that band is yours — a prettier
green than `#2B6B46` is welcome; a purple griffin is not.

### 2.4 Face 🔺

Resolved, because it materially affects small-size readability:

- **Solid dark eyes** (`#2B2118`) with **one round highlight dot** in the upper-left of each eye.
- **No visible sclera, no iris ring, no eyelashes, no eyeliner.** Iris color appears only at `radiant` and `mythic` tiers, as a subtle accent-colored ring.
- A simple brow line above each eye conveys expression. One line, not a rendered brow.
- Expression is **warm and alert** — curious, ready. Not coy, not sultry, not sleepy.

### 2.5 Pose 🔺

All character art is a **neutral quadruped standing pose, facing three-quarter LEFT** (the
creature's head turns toward the viewer's left), weight even across all four legs, legs slightly
separated so parts do not overlap ambiguously.

This is a rigging source pose, not a beauty shot. No weight shift, no hip cock, no dynamic lean.
Readability of the joints matters more than personality — personality comes from animation later.

---

## 3. Hard technical constraints

These are non-negotiable and mechanically verified. A violation fails the build.

| Constraint | Value |
|---|---|
| Format | PNG, RGBA, 8 bits per channel, sRGB, non-interlaced |
| Character canvas | **1024 × 1024**, origin (feet contact point) at **(512, 900)** |
| Effect frame | 256 × 256 |
| Background | **True alpha 0.** Not white, not near-white, not a checkerboard baked in. |
| Edge margin | No opaque pixel within **8px** of any canvas edge |
| Part layers | **Full canvas**, part in its final assembled position, everything else transparent |
| 🔺 **Seam overdraw** | **≥ 2,000 shared opaque px** between every adjacent part pair (§3.3) |
| 🔺 **Signature legibility** | Signature part ≥ **40 opaque px** when the character is scaled to 120px tall |
| Color profile | Embedded sRGB, or none. Never Display P3 or Adobe RGB. |
| Filenames | Exactly as specified in §4. Lowercase, underscores, case-sensitive. |

### 3.1 Registration — read this twice

**Every part layer is the full 1024×1024 canvas, with that part drawn where it belongs on the
assembled character, and full transparency everywhere else.**

Stacking all of a character's part layers in the manifest's `zOrder` reproduces `assembled.png`
exactly. That property is tested per-pixel.

Do **not** deliver trimmed parts, parts on their own small canvases, a packed atlas, or a
paper-doll sheet as the final output. Those may all be useful intermediates — the deliverable is
full-canvas registered layers.

### 3.2 Cross-tier registration

The four tiers of a species share **one rig skeleton**. A `radiant` head must drop onto the same
skeleton as the `fledgling` head without repositioning.

So: **joint locations must be consistent across tiers of the same species.** The creature grows
more elaborate — bigger horn, longer mane, more gear — but shoulders stay at the same coordinates,
hips stay at the same coordinates, the neck joint stays put. Silhouette grows outward from fixed
joints.

If you get this wrong, every tier needs its own rig and the level-up transformation is impossible.

### 3.3 Seam overdraw 🔺 — and why it does not conflict with §3.1

Parts must **not** be exact cutouts. Each part extends **12–16px underneath its neighbours** at
every joint, so that rotating a joint in the rig does not open a visible gap.

Revision 1 delivered zero overlap at every joint — a horn-shaped hole punched through the head
layer, an arm-shaped hole in the body — because exact cutouts are the cheapest way to satisfy the
recomposite check. **They are not in tension, and here is why:**

> Sample the overdrawn pixels **from `assembled.png` itself.** If the head's overdraw region
> contains the same pixels the body has there, then whichever layer wins in z-order produces the
> same result, and the recomposite stays pixel-perfect.

Concretely: build each part mask, **dilate it by 12–16px toward the adjacent part**, then sample
all pixels inside the dilated mask from the assembled image. Both checks pass simultaneously.

Verified as: every adjacent pair in the manifest's `adjacency` list shares ≥ 2,000 opaque pixels.

---

## 4. Deliverables

### 4.1 Directory layout

```
assets/
  characters/<species>/<tier>/
      assembled.png              reference — the whole character, A-pose
      parts/
        body.png  head.png  mane.png  <signature>.png
        arm_l.png arm_r.png leg_l.png leg_r.png  tail.png
  gear/<class>/<tier>/
      overlay_torso.png  prop_held.png
  effects/
      <name>.sheet.png           horizontal strip, N frames of 256×256
      <name>.json                { "frames": N, "fps": 12, "size": 256 }
  biomes/<biome>/
      bg.webp                    1920×1080
      tiles.png                  see §4.5
      props/*.png
```

`assembled.png` ships as a reference and review artifact; the game loads only `parts/`.

The authoritative part list per species is in `assets/manifest.json`. **Every part named there must
exist as its own file** — see §4.4.

### 4.2 Species and tiers

Six species × four tiers = **24 character sets.**

| Species | Signature part | Silhouette hook |
|---|---|---|
| `unicorn` | `horn` | Bold spiral horn, flowing mane |
| `dragonling` | `wings` | Stubby wings, ridged back, round snout |
| `griffin` | `wings` | Feathered fore-body, broad wingspan, beak |
| `bigfoot` | `mane` | Sheer bulk, shaggy outline, small eyes. **Bipedal.** |
| `kitsune` | `tail` | Multiple tails, sharp ears |
| `manticore` | `tail` | Scorpion tail arc, mane, wide stance |

Tiers escalate in impressiveness while remaining recognisably the same individual:

| Tier | Direction |
|---|---|
| `fledgling` | Young, soft features, small signature, gentle colors. **The canonical reference.** |
| `sworn` | Grown proportions, confident stance, larger signature, first gear layer |
| `radiant` | Majestic, luminous accents on the signature, elaborated mane/feathers/scales |
| `mythic` | Awe-inspiring, dramatic silhouette growth, crystalline/starlit qualities |

**`fledgling` is generated first and approved before any other tier of that species is attempted.**
Every later tier is produced conditioned on the approved `fledgling` image, not from text alone.

### 4.3 Gear overlays

Four classes × three tiers (no gear at `fledgling`) = **12 sets.**

| Class | Visual theme |
|---|---|
| `thornguard` | Heavy bark-and-iron plating, broad pauldrons, earth tones |
| `duskrunner` | Wrapped cloth, hood, buckles, muted indigo |
| `starweaver` | Layered robes, floating focus stone, deep teal with brass |
| `songkeeper` | Woven shawl, chime pendant, warm amber and cream |

Gear overlays register against the **species-agnostic torso position**, so one overlay set works
across all six species at that tier. Design them to read on both the slimmest (kitsune) and
bulkiest (bigfoot) silhouettes.

### 4.4 Runtime-recolored regions 🔺

Three regions are recolored at runtime from player choices. Each must be a **separate part file**,
not merely a separable hue within another part:

| Slot | Part file | Region |
|---|---|---|
| `mane` | **`mane.png`** | Mane, fur ruff, feather crest, or dorsal frill — per species |
| `accent` | the signature part | Horn / wings / tail |
| `marking` | on `body.png` and limb parts | Body markings, dapples, stripes |

Revision 1 baked the mane into `head.png`. That silently disables the recolor slot **and** prevents
secondary mane motion in the rig. `mane.png` is a required file for every species, including those
where the "mane" is a ridge or crest.

`marking` is the one slot that stays a hue region rather than a file, because markings span several
parts. Keep marking hue clearly distinct from coat hue so it can be isolated at runtime.

### 4.5 Biomes, effects, tiles

- **Backdrops** — 1920×1080 WebP: `bramblewood`, `frostpeak`, `emberhollow`, `sunken_market`, `cloudreach`. Composed so the lower third stays visually quiet — the combat grid sits there.
- **Tile sets** — 128×128 tiles in a 4×4 grid sheet: floor ×4, blocked ×4, hazard ×2, edge/transition ×6.
- **Effects** — horizontal sprite strips, 256×256 frames, 12fps. Frame-to-frame jitter is acceptable here and only here.
- 🔺 **Mythic aura is a separate effect**, not baked into part layers. Deliver as `effects/aura_<species>.sheet.png`; the engine composites it behind the character.

---

## 5. Suggested approach

You own the method; we own the output contract. These are offered so you don't rediscover them:

- **Generate assembled first, then mask.** Produce `assembled.png`, then derive each part layer by masking that single image. This guarantees registration and style consistency by construction, and it is what makes the §3.3 overdraw trick work.
- **Dilate before sampling.** Build the part mask, dilate 12–16px toward neighbours, sample from assembled. This is the single technique that satisfies §3.1 and §3.3 together.
- **If generating parts separately**, condition every part on the assembled reference. Style drift between independently generated parts is the main risk.
- **A paper-doll layout** makes automated slicing easy via connected components — but it's an *intermediate*. You still owe full-canvas registered layers.

---

## 6. Acceptance

### 6.1 Mechanical — run this yourself

```bash
python tools/art/verify.py
```

Checks existence, canvas, format, real alpha, **per-pixel recomposite**, **seam overdraw**,
**120px signature legibility**, edge margins, and filename conformance. It prints expected vs.
actual for every failure and exits non-zero.

**Iterate to green before submitting.** It is designed to close the loop without a human.

### 6.2 Human — the taste gate

A human reviews for what no script can decide:

- Do the four tiers read as the **same individual**?
- Does it match §2.1 — storybook, **not pony fan-art**, not AI-default?
- Is it a **quadruped in a neutral pose facing three-quarter left**?
- Is head height ≈ 1/3 of body height?
- Is the light consistently upper-left?
- Does the palette match §2.3, with exactly one bright accent?

### 6.3 Order of work

Do **not** batch all 24 characters. Deliver in this order and **stop for review at each gate**:

1. `unicorn/fledgling` — full set, plus `assembled.png`. **Stop.**
2. Remaining three unicorn tiers. **Stop** — this is the cross-tier consistency test.
3. One gear set (`songkeeper`, three tiers) on the unicorn. **Stop.**
4. Remaining five species, all tiers.
5. Remaining gear, effects, biomes, tiles.

🔺 Revision 1 produced `sworn` before `fledgling` was reviewed. Don't. A character approved at
gate 1 defines all later tiers; producing them early guarantees rework.

Every correction needed at a gate should become an edit to *this document* before proceeding.

---

## 7. Resolved decisions 🔺

Revision 1 left these open and they were filled in with defaults, which is how the palette and face
style went wrong. They are now decided. If you disagree with one, raise it — do not silently
substitute.

| Question | Decision |
|---|---|
| Species palettes | Derived from the approved unicorn. See §2.3. Unicorn is **locked**; the other five have ±30° latitude. |
| Face style | Solid dark eyes, one highlight dot, no sclera, no lashes. See §2.4. |
| Outline weight | 5px silhouette / 3px interior at 1024 canvas, color `#3A2A1E`. See §2.2. |
| Mythic aura | Separate effect layer, engine-composited. See §4.5. |
| Quadruped vs bipedal | Quadruped for all except bigfoot. See §2.2. |
| Mane as a layer | Required separate file for every species. See §4.4. |
