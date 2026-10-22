# Asset inventory — everything that has to be drawn

**One question: what is left to draw?** Not what it should look like — that is
[asset-brief.md](./asset-brief.md), which is long, and stays long, because it is the thing that
scales to twenty-four characters. This is the shorter document you read to find out where the work
is, and it assumes the brief for every "how".

> **Live numbers: `npm run art:inventory`.** Every count below comes from that command, which
> derives what is *needed* from `assets/manifest.json` and checks what is *there* against the disk.
> The snapshot in this file is a convenience and can go stale; the command cannot. It reports and
> never gates — `art:verify` is the gate.

---

## 1. Who owns what

| | Owner |
|---|---|
| **Image assets** — character illustrations, gear portraits, class figures, effect sheets, backdrops, props, tiles, creature cutouts | **Allen** |
| The manifest, the verifiers, the briefs | **Claude** |

That is the whole split. Characters are finished transparent illustrations with procedural
breathing ([art-pipeline.md](./art-pipeline.md)); there are no rigs to build. `art:verify`
checks pixels mechanically and then still sends a contact sheet to a human.

Practically: **if it is a `.png` or a `.webp`, it is Allen's. Everything else on the art side is
mine.**

---

## 2. Where it stands

Snapshot **2026-10-22**, after #421 — regenerate with `npm run art:inventory`.

| Category | Delivered | Outstanding |
|---|---|---|
| Character illustrations | **24 / 24** | — |
| Gear portraits | **72 / 72** | — |
| **Class figure variants** | **72 / 72** | — |
| Biome backdrops, tiles + props | **51 / 51** | — |
| Story-only environments | **5 / 5** | — |
| Canon place coverage | **23 / 23** | — |
| Scene illustrations | **94 / 94** | — |
| Effect sheets, declared | **28 / 28** | — |
| Entity cutouts | **32 / 32** | — |
| Campaign key art, declared | **2 / 2** | — |
| Effect sheets, specified but undeclared | **0 / 0** | — |
| **Entity part-sets (combat roster)** | **9 / 9** | — |

**No declared image deliverables outstanding.** All 72 class figures are delivered, including
the ten Mythic Starweaver and Songkeeper figures added for #421. Optional artwork outside the
manifest is listed in §4.1; a complete inventory does not mean those optional commissions exist.

---

## 3. What is done

**Home and lobby illustrations — 16 files.** Landscape and portrait versions of the home market, five hero-creation steps,
waiting camp, and ready departure are declared in `manifest.sceneIllustrations`.
Coverage and prompts: [entry-scenes.md](./entry-scenes.md).

**Gemfall scene illustrations — 54 files.** Chapter landmarks, camps, roads, and interiors are
declared in `manifest.sceneIllustrations`. They supplement the existing biome backdrops. Prompts and coverage:
[gemfall-illustrations.md](./campaigns/gemfall-illustrations.md).

Recorded because "is that finished?" is the question this document exists to stop you asking.

**Character illustrations — 24 files.** Six species × four tiers, one transparent
`assembled.png` each. All green through `art:verify`.

**Gear portraits — 72 files.** Four classes × three geared tiers × six species. Each is an approved,
purpose-drawn creature-and-gear composite and is the visual source of truth for its exact fit.

**Class figure variants — 72 files.** All four classes, all three geared tiers and all six
species have a finished transparent `assembled.png`, declared in `manifest.figureVariants` and
selected by the runtime lookup. The ten final Mythic figures, exact built-in imagegen prompts,
reference roles, hashes and light/dark review sheets are in [the #421 review](./reviews/issue-421/README.md).

**Biomes — 17 destinations.** Each with `bg.webp`, `tiles.png` and six props: 102 prop files, and
12 unique tile sheets shared across the 17 (several destinations share a terrain family).

**Story-only environments — 5 backdrops.** Sallow Wastelands, Bramblewood, Redspire Citadel,
Open Sea, and the Whirlpool are declared in `manifest.backgroundOnlyBiomes`. They require
`bg.webp`, with derived `portrait.webp` for wiki previews, but no tiles or props. They support
story scenes through `art: "biomes/<id>/bg"`. Combat still uses the chapter biome's tactical kit.
Promote a destination to `manifest.biomes` only when its tiles and props are required and delivered.
Redspire Citadel's intentionally undefined canon remains protected; this records its existing art.

**Canon place coverage — 23 entries.** Inventory reads `canon/biomes.yaml` and
`canon/locations.yaml`, uses the wiki's canonical image lookup, and reports any backdrop
that is undeclared or missing on disk. Hollow Gate reuses its declared Gemfall illustration.
Shared artwork is allowed; this count measures coverage, not unique paintings. A new canon
place therefore appears as a coverage gap even before anyone adds it to the asset manifest.

**Effect sheets — 28.** All declared sheets are present, including the six species auras,
combat feedback and group-action effects. `npm run art:inventory` also checks specified-but-
undeclared effects; none remain.

**Entity cutouts — 32 declared.** Each has a single `assembled.png`. Enemies do not level.
Named cast are tracked separately: all 101 declared cast figures have files. All 48 field-guide
portrait references resolve, as recorded in the #421 audit.

**Campaign key art — 2 declared.** Gemfall and Riftlight have lobby paintings. Practice and
fixture campaigns are optional commissions, not missing declared assets.

`portrait.webp` never appears above because portraits are **derived, not drawn** —
`npm run art:portraits` trims `assembled.png`, squares it and writes 384px WebP. Never commission
one. Inventory icons are painted WebP assets registered in `packages/client/src/assets/artwork.ts`;
`packages/client/src/screens/icons.tsx` also supplies SVG glyphs for other interface actions.

---

## 4. What is left

### 4.1 Class figure variants — complete; optional artwork remains

All 72 class figures are delivered. No gear at `fledgling`, by design. Each is one finished
`assembled.png` from the approved species and gear references, to the contract in
[art-pipeline.md](./art-pipeline.md), declared in `manifest.figureVariants`. Fledgling figures
continue to use the base species illustration.

Issue #421 also records these conditional or optional commissions:

- **Hollow Crown backgrounds:** `hedge_wall`, `clearing`, `fork`, `canopy`, `stair`, `stream`,
  `thicket`, `shrine`, `hill_door`, `lanternfall`. The reference chapter uses the existing
  Bramblewood biome fallback; bespoke scenes are only needed if it becomes a real campaign.
- **Campaign key art:** First Steps and The Hollow Crown, if they need dedicated lobby cards.
- **Painted ability icons:** shield, wing, spark, fist, eye, moon, thorn and flame currently
  use the working vector glyphs.
- **Distinct item icons:** the 14 facets share `trinket`; key uses `quest`, potion uses
  `consumable`. Dedicated paintings are optional.

These are outside the current manifest requirements and are not included in the zero-outstanding
count. The #421 delivery completes the required Mythic figures, not these optional commissions.

### 4.2 Effect sheets — complete

All 28 are delivered and declared in the manifest. The six combat gaps identified by
[asset-brief §9.4](./asset-brief.md#94-effects--mapping-the-ten-verbs) are closed, including
`down_settle` on the `down.settle` event.

**No new combat sheet may exceed 12 frames** — 8 or 12 and nothing else, which at 12fps is 0.667s
or 1.0s and is what §9.2's turn budget affords. `transform_flash`'s 18 is the exception that proves
it: that one plays when the fighting has stopped.

### 4.3 Entity part-sets — 9 delivered

The 32 declared cutouts are delivered and the board draws them today. The approved `will_o_wisp` ships the
floating proof (`core`, `halo`, `trail`), and the approved `cinder_wolf` now ships the first shared
quadruped plan plus its `ruff_alt` pack variant. The approved `glassback_crab` adds the first
`low_shell` plan, and the approved `mire_mimic` extends it with the retractable `whiskers` sensory
layer and disguised idle. The approved `bone_crawler` completes that shared plan and adds its
registered `shell_alt` fossil pattern. The approved `frost_wyrm` adds the first compact serpentine
plan with a wedge-head signature and separate ice-ridge `fin`; the approved `river_drake` completes
that shared plan with a continuous river-fin signature and crossing-keeper idle. The approved
`echo_hunter` completes the shared quadruped plan with its broad `frills`, gentle sound-cartographer
face, and ground-listening stance. The approved `legend_dragon` completes the roster as the
campaign-specific Gemfall Seal-Keeper: a custom 2048×2048, 2×2 rig with a speaking jaw, independent
display wings, and a deliberate ancient-curator personality.

Keep it in proportion: **shipped content fights exactly one of these** (`will_o_wisp`, the
bramblewisps). The other eight are the planned roster, not a backlog anything is currently waiting
on; `cinder_wolf` is delivered because it proves the quadruped plan and restrained ember rule.

| Body plan | Parts | Creatures |
|---|---|---|
| `quadruped` | `body` `head` `ruff` `limb_fl` `limb_fr` `limb_bl` `limb_br` `tail` | `cinder_wolf`, `echo_hunter` |
| `low_shell` | `body` `shell` `claw_l` `claw_r` `leg_l` `leg_r` | `glassback_crab`, `mire_mimic`, `bone_crawler` |
| `serpentine` | `head` `neck` `body` `coil` `limb_l` `limb_r` `fin` | `frost_wyrm`, `river_drake` |
| `floating` | `core` `halo` `trail` | `will_o_wisp` |
| `legend_dragon` | `body` `head` `jaw` `crown` `mantle` `wing_far` `wing_near` `limb_fl` `limb_fr` `limb_bl` `limb_br` `tail` | Gemfall Seal-Keeper only |

Two creatures add exactly one part to their shared plan — `mire_mimic`'s
`whiskers`, `echo_hunter`'s `frills` — and nobody else adds anything: a plan three creatures all
bend is not a plan.

The four shared plans use the same technical contract as the heroes (1024×1024, origin (512, 900),
registered layers, seam overdraw, real alpha), one directory deep rather than two. The Seal-Keeper
is the declared exception: 2048×2048, origin (1024, 2024), and a four-tile footprint. Its art is
complete; grid occupancy and enemy-rig playback remain separate engine integration work.

### 4.4 Interface chrome — 38 / 38, in use

The frames, the tray and rail, panels and buttons are painted: the 38 pieces in
`packages/client/src/assets/chrome/` (prompts and slicing in its README) are laid on by
`packages/client/src/styles/chrome.css`, and `chrome.test.ts` fails if a piece goes unused or a
`url()` names one that is not there. They are not in the art manifest, so `art:inventory` does not
count them. The full list, sizes and placements are in
[briefs/tablet-chrome-art.md](./briefs/tablet-chrome-art.md); the
[review sheets](./reviews/tablet-chrome-art/) show every piece on night and biome backgrounds.

---

## 5. Known warnings

`python tools/art/verify.py --strict` passes **752 checks with no failures or warnings** on
2026-10-22. This is the mechanical gate. The #421 figures were also visually inspected on light
and dark backgrounds at larger size and at 120px; the retained sheets support the owner's
artistic review. Historical Bigfoot palette warnings are no longer reported by the current verifier.

---

## 6. One thing specified only in prose

**`enemyPlans` and `enemies[]` are missing from the manifest** ([asset-brief §9.7](./asset-brief.md)
items 4 and 5). All nine part-sets now exist, so this is manifest/rig tooling debt rather than art
still to draw. The body-plan table in §4.3 remains prose, which is why `tools/art/inventory.ts`
still restates the roster by hand; adding both declarations should delete that constant.

This does not change the image inventory. It is noted so rig integration does not mistake completed
art for a complete machine-readable enemy contract.
