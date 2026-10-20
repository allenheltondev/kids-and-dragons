> Character delivery was simplified on 2026-10-20. The current
> [art pipeline](art-pipeline.md) supersedes rigging, split-part, underpainting,
> and animation requirements in this historical brief. Deliver finished figures.

# Kids & Dragons — Asset Brief

**This document is the complete specification for producing the game's art assets. It is written to
be handed to an agent as a self-contained work order.** Everything needed to produce, name, place,
and self-verify the assets is here. Nothing in it requires reading the rest of the repo.

Machine-readable companion: `assets/manifest.json`. Where the two overlap, **the manifest wins** —
it is what the verifier reads.

> **Revision 5.** `unicorn/fledgling` is **approved** and is now the reference for the entire cast —
> for style, construction, and colour. Sections marked 🔺 changed in rev 2; 🔺🔺 in rev 3;
> 🔺🔺🔺 is new in rev 5, which adds §9 — combat animation, the enemy roster, and effects.
> The Realm of Red Sky map replaces the former five-biome roster. Its seventeen named
> destinations and twelve shared terrain families are authoritative in §4.5.
>
> **Match the approved unicorn.** Where this document and `assets/characters/unicorn/fledgling/`
> disagree, the unicorn wins and the document is wrong — say so rather than following the text.

---

## 0. TL;DR for the agent

Produce finished transparent storybook figures, effect sprite sheets, and scenery.
Character figures use a 1024px square canvas with feet at (512, 900). Preserve the
approved cast and its authored colors. Run `python tools/art/verify.py`, then
`python tools/art/sheet.py` for human review of silhouette, palette, and identity.
No body-part separation, underpainting, joint files, or animation binaries.

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
The finished pose and silhouette must communicate the creature clearly at gameplay size.

---

## 3. Hard technical constraints

Deliver a finished 1024 x 1024 RGBA illustration with transparent corners, an 8px
edge margin, and feet at (512, 900), within 12px vertically. Review silhouette,
color, and identity on light and dark backgrounds at 120px figure height.
No split body parts, joint registration, underpainting, or animation binaries.

---

## 4. Deliverables

### 4.1 Directory layout

- `assets/characters/<species>/<tier>/assembled.png`: finished transparent figure.
- `assets/character-rigs/<class>/<tier>/<species>/assembled.png`: finished class
  figure, selected by `manifest.figureVariants`. The directory name is retained
  for URL compatibility; these are static illustrations.
- `assets/gear-portraits/<class>/<tier>/<species>.png`: approved opaque portrait.
- Effects, biome backgrounds, tiles, and props retain the contracts below.

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

### 4.3 Class illustrations

Approved `gear-portraits` are complete opaque images for portrait UI surfaces.
Transparent class figures use the same 1024px canvas and ground origin as base
characters. Declare delivered combinations in `figureVariants`; missing combinations
use the base species/tier illustration. Do not split these images into layers.

### 4.4 Finished character colors

Render authored colors directly. Palette choices dress UI chrome; they do not
recolor figures. No separately delivered mane or tint layers are needed.

### 4.5 Biomes, effects, tiles

The authoritative world reference is `art/reference/realm_of_red_sky.png`. The former five-biome
roster is retired; do not produce aliases or compatibility assets for it.

- **Destinations** — every named destination below gets its own `assets/biomes/<destination>/`
  directory, 1920×1080 WebP backdrop, and transparent prop set.
- **Backdrop composition** — keep the lower third visually quiet because the combat grid sits
  there. A destination must be recognizable from its silhouette, lighting, and two or three large
  landmarks rather than dense surface detail.
- **Tile families** — destinations in the same family may share the same base `tiles.png`. Copy
  that family sheet into each destination directory so runtime lookup remains
  `biomes/<destination>/tiles.png`.
- **Tile sets** — 128×128 tiles in a 4×4 grid sheet: floor ×4, blocked ×4, hazard ×2,
  edge/transition ×6.
- **Effects** — horizontal sprite strips, 256×256 frames, 12fps. Frame-to-frame jitter is
  acceptable here and only here.
- 🔺 **Mythic aura is a separate effect**, not baked into part layers. Deliver as
  `effects/aura_<species>.sheet.png`; the engine composites it behind the character.

#### Destination roster

| Destination | Asset ID | Tile family | Visual identity |
|---|---|---|---|
| Sky Islands | `sky_islands` | `sky_islands` | Floating stone islands, wind, open blue sky, elevated temples |
| Enchanted Woods | `enchanted_woods` | `enchanted_forest` | Ancient dense canopy, deep greens, blue bioluminescent growth |
| MossHome | `mosshome` | `enchanted_forest` | Living-tree settlement, wooden towers, moss, blue lantern growth |
| Whispering Marsh | `whispering_marsh` | `whispering_marsh` | Mist, dark roots, shallow water, spirit lights |
| The Exchange | `exchange` | `cliffside_exchange` | Cliffside port city, blue-roofed towers, docks, trade roads |
| The Sunward Fields | `sunward_fields` | `open_plains` | Warm rolling farms, hedgerows, golden-green pasture |
| The Plains | `plains` | `open_plains` | Broad grassland, caravan roads, low hills, open horizon |
| The Eastern Plains | `eastern_plains` | `open_plains` | Windswept grassland, river influence, sparse woods |
| Stone Crossing | `stone_crossing` | `great_river` | Narrow stone bridge, strong current, steep riverbanks |
| Red Sky Foothills | `red_sky_foothills` | `red_sky_volcanic` | Volcanic hills, crystal veins, ash, hidden cave mouths |
| Mount Red Sky | `mount_red_sky` | `red_sky_volcanic` | Active volcano, lava channels, smoke column, gem-lit rock |
| The Expanse | `expanse` | `expanse` | Barren cracked plateau, dead spires, severe empty horizon |
| Frostfang Peaks | `frostfang_peaks` | `frozen_north` | Jagged alpine snowfields, dark stone, cutting wind |
| Glacier of Origins | `glacier_of_origins` | `frozen_north` | Blue-white glacier, ancient ice, meltwater river source |
| Skullwater Cave | `skullwater_cave` | `skullwater_caverns` | Skull-shaped coastal entrance, black rock, underground water |
| Mermaid Cove | `mermaid_cove` | `mermaid_cove` | Warm turquoise tides, coral reefs, sheltered tropical shore |
| The Bone Yard | `bone_yard` | `bone_yard` | Colossal fossils, rib arches, dark sand, pale weathered bone |

#### Shared terrain families

| Family | Destinations |
|---|---|
| `sky_islands` | `sky_islands` |
| `enchanted_forest` | `enchanted_woods`, `mosshome` |
| `whispering_marsh` | `whispering_marsh` |
| `cliffside_exchange` | `exchange` |
| `open_plains` | `sunward_fields`, `plains`, `eastern_plains` |
| `great_river` | `stone_crossing` |
| `red_sky_volcanic` | `red_sky_foothills`, `mount_red_sky` |
| `expanse` | `expanse` |
| `frozen_north` | `frostfang_peaks`, `glacier_of_origins` |
| `skullwater_caverns` | `skullwater_cave` |
| `mermaid_cove` | `mermaid_cove` |
| `bone_yard` | `bone_yard` |

---

## 5. Suggested approach

Use the approved finished illustration as the reference for style and tier identity.
Keep the figure transparent and its feet on the shared ground line. Review it on
light and dark backgrounds at gameplay size before creating further variants.

---

## 6. Acceptance

### 6.1 Mechanical — run this yourself

```bash
python tools/art/verify.py
```

Checks canvas, format, transparency, edge margins, non-empty figures, ground
placement, portrait delivery, effects, and scenery. Artistic quality stays a human gate.

### 6.2 Human — the taste gate

A human reviews for what no script can decide:

- Do the four tiers read as the **same individual**?
- Does it match §2.1 — storybook, **not pony fan-art**, not AI-default?
- Is it a **quadruped in a neutral pose facing three-quarter left**?
- Is head height ≈ 1/3 of body height?
- Is the light consistently upper-left?
- Does the palette match §2.3, with exactly one bright accent?

### 6.3 Order of work

The base cast is delivered. Review existing figures in play and replace only those
with visible defects; review each new class illustration before extending the set.

### 6.4 Canonical non-player entities

The playable peoples keep the rigged, four-tier contract above. Every other drawable entry in
`docs/red-sky-creature-canon.yaml` uses a simpler runtime contract:

- **Path:** `assets/entities/<entity-id>/assembled.png`
- **Format:** 1024 × 1024 RGBA PNG with real transparency and at least 8px clear edge margin.
  The approved Gemfall Seal-Keeper is the sole declared exception: 2048 × 2048 for its 2×2
  footprint.
- **Contents:** one definitive, complete cutout. The Witch Order is the intentional exception: its
  representative asset is a cross-species group.
- **Scale:** the figure fills the asset canvas for readability; `assets/manifest.json` carries the
  entity's canonical world scale. A cloud whale and an embermoth are not the same size in play.
- **Biome identity:** `primaryBiome` names the runtime biome whose palette and material language
  guide the artwork. `canonicalLocations` preserves the source-canon location ids, including
  waterways and regions that do not have a standalone runtime backdrop.
- **Protected mysteries:** entries under `open_canon_slots` are not drawable entities and must not
  receive artwork until the canon explicitly defines them.
- **Review:** the `art/review/canonical_entities_*.png` sheets are the human gate for silhouette,
  subject identity, biome fit, family-friendly tone, and transparency.

`python tools/art/verify.py` checks every manifested entity's canvas, RGBA mode, alpha, margins,
primary biome, and canonical-location metadata alongside the existing character checks.

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

---

## 8. The keepsake lantern 🔺

**Status: shipping as vector, open to commission.** The game ships an SVG
version today — `packages/client/src/screens/KeepsakeLantern.tsx` — which is
correct per §2 of [art-pipeline.md](./art-pipeline.md): UI is vector, never
raster. This section exists so that a commissioned illustrated version can
replace it without a second round of specifying what the picture is *for*.

### 8.1 What it is

The single piece of art in the optional sign-in flow
([architecture §4.5](./architecture.md#45-accounts-devices-and-joining)). A
hanging lantern holding **one flame per party member**, each flame tinted with
that character's `appearance.accent` — the colour that player picked, which
dresses their chrome rather than their creature (§4.4: the figure is drawn in
its authored colours and carries its name instead).

### 8.2 What it is for, which decides everything else

The screen asks a family whether to keep three characters a child spent an
evening with. It is not an account prompt with a picture on it. So:

| Must | Must not |
|---|---|
| Read as an **object from the world** — something that could hang in the Bramblewood | Read as interface furniture: padlock, shield, cloud, key, badge |
| Be **warm and lit**. It is an invitation, not a warning | Suggest danger, loss, or a countdown |
| Look **calm when empty**. Nobody being kept yet is an ordinary state | Look broken, error-ish, or "missing" with no flames |
| Take the party's colours as **input** | Have the party's colours baked in |

The empty state is the one most likely to be got wrong. An unlit lantern is
already the right picture; earlier drafts drew an explicit wick and it read as
a stray glyph at small sizes.

### 8.3 Technical contract

Different from the character contract in §3 — this is UI, so **none** of the
registration or canvas rules apply.

- **Format:** SVG, animated with CSS where needed.
- **Colour:** every fixed colour must be a token from `styles/theme.css`
  (`--kad-gold` for the metalwork, `--kad-bg-sunken` for the glass). No literal
  hex except in a gradient stop that references a token.
- **Flames:** must be *addressable* — one node per flame, fillable from outside,
  1 to 6 of them, positioned so each stays inside the glass at every count.
- **Aspect:** taller than wide, and not by much more than 1.5:1. It sits above a
  headline and a button on a 390px phone, and every unit of width costs 1.5 of
  height. The current draft is 120 × 176.
- **Legibility:** must read at **3.2em** (the small card on the chapter-complete
  panel) as well as at 5.5em (the flow itself). At the small size the flames are
  a few pixels each — silhouette carries it, detail does not.
- **Motion:** a slow sway from the hanger and an independent per-flame flicker.
  Decorative only, so `prefers-reduced-motion` stops it and nothing is lost.

### 8.4 Acceptance

`npm test` covers the mechanical part — one flame per member, distinct
positions, all inside the glass at 1–6, unique gradient ids, an accessible
label naming the characters. The taste gate is §6.2 as usual: does it look like
it belongs in the same world as the unicorn?

---

## 9. Combat animation and effects 🔺🔺🔺

**Status: open to commission. This is roadmap Chapter 4's art, and it is the first section of
this brief that specifies *motion* rather than *pictures*.** §1–§8 got a cast onto the screen. This
section gets them into a fight and back out of it with nobody dead.

Read `packages/shared/src/encounter.ts` before you start — its header is the other half of this
document. It defines **ten effect verbs** (`attack`, `damage`, `heal`, `revive`, `rollBonus`,
`moveSelf`, `shove`, `skipTurn`, `protect`, `goFirst`), and *those ten verbs are the entire
vocabulary a fight can express.* Nothing in this section exists that no verb can trigger, and
nothing a verb can trigger is missing from it. When you are tempted to add a clip, find the verb
first. If there isn't one, the clip is somebody else's chapter.

The roadmap's Chapter 4 line reads "combat animations for all 4 classes (attack, cast, hurt, down,
revive)". **That line is wrong in a way that costs money**, and §9.1 is the correction.

### 9.1 Figure motion

Story and combat share a gentle six-second breath, anchored at the feet, with at
most 0.8% vertical stretch. Reduced motion and downed figures use resting scale.
Travel, facing, knocked-down tilt/fade, numbers, sound, and spell effects belong
to the renderer. Character clip libraries and rig contracts are retired.

### 9.4 Effects — mapping the ten verbs

All ten combat sheets now exist; `transform_flash` is the additional Chapter 5 cutscene sheet.
The ten verbs plus two moments the verbs imply rather than name (a *miss* is the same verb as a hit
and the opposite information; a *knockdown* is the `down` event that damage produces) come to
eleven moments needing **ten sheets**, because `moveSelf` and `shove` share one.

| Verb | Sheet | Status |
|---|---|---|
| `attack` — hit | `impact_strike` | exists, 8 |
| `attack` — miss | `miss_veer` | exists, 8 |
| `damage` (area) | `burst_star` | exists, 12 |
| `heal` | `heal_bloom` | exists, 12 |
| `revive` | `revive_lift` | exists, 12 |
| `rollBonus` | `bonus_spark` | exists, 8 |
| `moveSelf` | `dust_scuff` | exists, 8 |
| `shove` | `dust_scuff` | same sheet |
| `skipTurn` | `daze_swirl` | exists, 12 |
| `protect` | `guard_ward` | exists, 8 |
| `goFirst` | — | **nothing.** Initiative-time; the turn-order strip is vector UI |
| (the `down` event) | `down_settle` | exists, 12 |

**A miss gets its own sheet because absence is not a signal.** `resolveAttack` produces a real
miss result and `hurt` simply does not play; if nothing else marks it, the child is left reading a
d20 to find out whether the swing landed. `miss_veer` is a wide arc and a scatter of chips that
passes *beside* the target's silhouette rather than through it.

**Frames are 8 or 12 and nothing else, inside a fight.** At 12fps those are 0.667s and 1.0s, which
is exactly what §9.2's budget affords — and it is why the four existing combat sheets are already
8s and 12s. `transform_flash`'s 18 frames (1.5s) is the exception that proves it: that one plays
when the fighting has stopped. **No new combat sheet may exceed 12 frames.**

Every new sheet inherits the §4.5 effect contract — horizontal strip, 256×256 frames, 12fps, real
alpha, jitter permitted — plus these, which are new and mechanically checked in §9.7:

- **A declared start.** Every `effects[]` entry in the manifest carries
  `startsOn` — historical authoring metadata, unused by the static figure renderer — or `startsOn: null` for an
  ambient loop (the auras start with the figure, not with an event). The verifier derives every
  effect/clip sync check and every effect-tail charge in the turn budget from this field, so
  coverage is **every delivered sheet**, not a shortlist somebody hardcoded; an entry that declares
  neither is a failure. The reverse gap — a clip event no sheet consumes yet, like `leap`'s `dust`
  waiting on `dust_scuff` — is a warning, because undelivered work is tolerated, not hidden.

- **Tile-scoped.** ≥ 70% of the sheet's total opaque alpha mass falls inside the centre 128×128 of
  the 256px frame. A 256 frame is **two tiles wide** at §4.5's 128px tiles, so an effect that
  spreads its energy evenly reads as having hit three squares. 70% is where the approved
  `impact_strike` sits — the loosest of the five and the one that reads correctly, so it sets the
  floor. `aura_<species>` is exempt (`tileScoped: false`): an aura is character-scale by design.
- **Fade in, fade out.** First and last frame ≤ 3% opaque coverage, so a sheet can be composited
  additively without a pop at either end. `impact_strike` measures 2.5% and 1.8%; that is why the
  number is 3 and not 2.
- **Keep the top clear.** ≤ 15% of opaque mass in the **top 64px band** of the frame. Damage
  numbers float there and they are the one piece of text in a fight she actually needs.
  `impact_strike` measures 13%.
- **Tintable sheets carry luminance, not colour.** `bonus_spark`, `daze_swirl` and `guard_ward` are
  tinted at runtime from a character's `accent` slot — Fox Fire's "little blue flames" are the
  kitsune's teal, and the same sheet has to serve a future daze from any source. So: every opaque
  pixel at HSV saturation ≤ 0.15, and let the multiply do the colouring. The four narrative sheets
  (`impact_strike`, `heal_bloom`, `burst_star`, `revive_lift`) are **not** tintable — see §9.3 on
  why `heal_bloom` and `revive_lift` must stay visibly different colours.

**One principle decides everything this section does not say: effects mark transitions, vector pips
carry duration.** A sprite sheet fires once, at the instant a verb resolves. Anything that persists
— braced, dazed, holding a +2, lying down, whose turn it is — is a status, and statuses are vector,
shape-and-icon, colourblind-safe (§11), and owned by the UI rather than by this brief. That is why
there is no looping "dazed" sheet here and why you should not add one.

### 9.5 The enemy roster

Canonical creature identity comes from `docs/red-sky-creature-canon.yaml`; delivered
figures are declared in `manifest.entities`. Each creature needs a finished
transparent `assets/entities/<id>/assembled.png`, using the shared ground origin.
No enemy body-part sets or clip libraries are needed. Combat occupancy remains a
rules concern independent of the picture's silhouette.

### 9.6 Reading a fight at 64 pixels

The product decides this, not taste. §7.1 puts a **10×8 grid** on the board; §2.2 auto-frames it,
because the whole board on a phone has unreadable tiles. Work the framing through:

```
10 tiles × 128px (§4.5)        = a 1280px board
TV at 1920 wide                = 192px per tile — generous
Phone at 390 wide, whole board =  39px per tile — the reason the focus camera exists
Focus camera, 5 tiles across   =  78px per tile
A figure is ~820/1024 of its canvas → ~64px of drawn height
```

Five tiles is the floor because it holds the active figure plus everything within a two-step reach,
which is what a turn is about. **So combat art has to survive 64px** — roughly half the 120px
§3 legibility floor, and that changes three things:

1. **Enemy signatures get a harder floor than heroes'.** §3 asks for ≥ 40 opaque signature pixels
   at 120px tall. Coverage scales with area, so the equivalent at 64px is 11px — not enough.
   Require **≥ 24 opaque signature pixels when the enemy is scaled to 64px tall**, which is about
   84px at 120px, a little over twice §3's ask. The asymmetry is deliberate: heroes are shapes she
   chose and has watched for weeks, and they are separated by the mane hues of §2.3. An enemy is a
   thing she has never seen, and she has to name it in the second it appears.
2. **Two values, not three.** At 64px §2.2's two-tones-plus-highlight collapses. Every enemy needs
   to work as **one dark mass plus one accent**, and the accent goes on the signature part only.
   Check it by desaturating and squinting, not by looking at the full-size render.
3. **Whose turn it is comes from three signals, none of them yours alone.** §11 forbids colour as
   the only carrier. The three are: the focus camera centring the figure (position), a vector ring
   under it (UI), and the turn-order strip (UI). **Your job is not to fight them:** no `idle` may
   displace a figure more than **6% of tile height** — 8px at a 128px tile, 5px at the phone's
   78px — because the ring is 4px thick and a body drifting out of its own ring is worse than no
   ring at all.

And two rules that follow from "what just hit whom":

- **An effect belongs to exactly one square.** That is the §9.4 centre-energy rule, and the
  behavioral half of it is that the sheet plays on the **target's** tile — never between attacker
  and target, never at a midpoint. Three players and up to four enemies means neighbouring tiles
  are usually occupied, and an effect that straddles two of them is a question.
- **Damage numbers own the top of the frame** (§9.4's top-band rule). They are the only text in a
  fight she has to read, and an effect drawn behind a number is a number that does not exist.

### 9.7 Manifest entries

The manifest declares the canvas, base species and tiers, finished class figure
variants, opaque gear portraits, NPCs, enemies, effects, and scenery. No character
parts, joint graph, rig interface, or animation clip contract is required.

### 9.8 Acceptance

#### 9.8.1 Mechanical — `npm run art:verify`

Check finished figures for canvas size, RGBA format, corner transparency, edge
margin, non-empty content, and ground placement. Check effect sheets for frame
geometry, timing, and visual bounds. Portrait and scenery checks remain in force.
Silhouette recognition, authored palette, and seam quality are human review gates;
part-based signature and palette measurements do not apply to a complete painting.

#### 9.8.2 Human — the taste gate

§6.2 still applies to every enemy and every pose. These are the questions only combat raises, and
the first one is the gate:

- **Freeze a recording of a real fight at any frame. Can an 8-year-old answer three questions from
  that single frame — whose turn is it, what just hit whom, who is down?** If it takes motion to
  answer, it fails; she looks away and looks back.
- With the **sound off and the numbers hidden**, does a hit read as a hit and a miss as a miss?
- Does the downed character **look alive**? Would a five-year-old watching over her shoulder ask
  whether they are dead? That question is the failure.
- Is the lift a **hero move** (§4.3) — does the helper look like they did something brave, rather
  than performing a mercy?
- Could you feel **sorry** for the cinder wolf? Canon says these animals are not evil; a design
  that reads as evil has failed a rule, not a preference.
- Is anything here frightening enough that she would rather not play? The canon's `child_hero_tone`
  allows danger and frightening mysteries. It does not allow gore, cruelty, or dread.
- Does each exact-pose class skin survive the pose extremes — the `attack` impact tick, the `cast`
  release, the `guard` hold, and mid-`leap` — without floating, clipping a signature feature, or
  hiding the face (§4.3)? No script can see this; it is why the gate exists.

#### 9.8.3 Order of work

Review finished figures at story and combat sizes, including on light and dark
backgrounds. Replace only images with visible defects. Review shared effects and
subtle breathing on the actual display before adding motion complexity.
