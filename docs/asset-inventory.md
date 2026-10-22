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

Snapshot — regenerate with `npm run art:inventory`.

| Category | Delivered | Outstanding |
|---|---|---|
| Character illustrations | **24 / 24** | — |
| Gear portraits | **72 / 72** | — |
| **Class figure variants** | **62 / 72** | **10 to illustrate** |
| Biome backdrops, tiles + props | **51 / 51** | — |
| Story-only environments | **5 / 5** | — |
| Canon place coverage | **23 / 23** | — |
| Scene illustrations | **94 / 94** | — |
| Effect sheets, declared | **28 / 28** | — |
| Entity cutouts | **32 / 32** | — |
| Campaign key art | **2 / 2** | — |
| **Story plates** (prologue + chapter plates) | **0 / 9** | **9 to paint** |
| Effect sheets, specified but undeclared | **0 / 0** | — |
| **Entity part-sets (combat roster)** | **9 / 9** | — |

**10 class figures and 9 story plates outstanding.** The character-and-gear paintings are complete.
What remains is a finished transparent `assembled.png` for each of the 10 Mythic Starweaver and
Songkeeper figures, and the nine Riftlight story plates ([story-plates.md](./story-plates.md)).

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

**Class figure variants — 47 files.** All Thornguard and Duskrunner tiers, plus Starweaver Sworn,
for all six species, and Bigfoot's Starweaver Radiant/Mythic and all three Songkeeper tiers. Each
is a finished transparent `assembled.png` declared in `manifest.figureVariants`, kept at its
`assets/character-rigs/<class>/<tier>/<species>/` path.

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

**Effect sheets — 17.** Six `aura_<species>` loops plus `impact_strike`, `miss_veer`,
`bonus_spark`, `dust_scuff`, `daze_swirl`, `guard_ward`, `burst_star`, `heal_bloom`,
`revive_lift`, `down_settle` and `transform_flash`.

**Entity cutouts — 30 declared.** Each has a single `assembled.png`. No tier dimension:
enemies do not level. All 18 creatures and 13 NPC peoples/orders in the current `canon/` files
have cutouts; additional delivered entities and named cast are covered by the wiki audit.

`portrait.webp` never appears above because portraits are **derived, not drawn** —
`npm run art:portraits` trims `assembled.png`, squares it and writes 384px WebP. Never commission
one. Inventory icons are painted WebP assets registered in `packages/client/src/assets/artwork.ts`;
`packages/client/src/screens/icons.tsx` also supplies SVG glyphs for other interface actions.

---

## 4. What is left

### 4.1 Class figure variants — 10 to illustrate

Every approved geared character needs one transparent class figure. Sixty-two of 72 are delivered. Outstanding:

| Class | Tiers | Variants |
|---|---|---:|
| `starweaver` | mythic; five species excluding Bigfoot | 5 |
| `songkeeper` | mythic; five species excluding Bigfoot | 5 |

No gear at `fledgling`, by design. Each is one finished `assembled.png` from art already approved,
to the contract in [art-pipeline.md](./art-pipeline.md), declared in `manifest.figureVariants`.
Undelivered combinations fall back to the un-geared species figure on figure surfaces; still-image
surfaces already use the approved gear portrait.

### 4.1b Story plates — 9 to paint

Full-screen paintings with the story told over them, before the table decides anything: a
campaign's prologue and one-off chapter plates. Riftlight's four prologue plates and five chapter
plates are written and wired; their paintings are owed. 1600×900 opaque WebP at
`assets/plates/<campaign>/<name>.webp`, declared in `manifest.storyPlates`. The story plays without
a plate until its painting lands. Spec, safe area and delivery steps: [story-plates.md](./story-plates.md);
prompts: [story-plates-prompts.json](./story-plates-prompts.json); composition check:
`npm run art:plates`.

### 4.2 Effect sheets — complete

All 28 are delivered and declared in the manifest. The six combat gaps identified by
[asset-brief §9.4](./asset-brief.md#94-effects--mapping-the-ten-verbs) are closed, including
`down_settle` on the `down.settle` event.

**No new combat sheet may exceed 12 frames** — 8 or 12 and nothing else, which at 12fps is 0.667s
or 1.0s and is what §9.2's turn budget affords. `transform_flash`'s 18 is the exception that proves
it: that one plays when the fighting has stopped.

### 4.3 Entity part-sets — 9 delivered

The 30 declared cutouts are delivered and the board draws them today. The approved `will_o_wisp` ships the
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

`art:verify` passes with **4 warnings, all the same one**: `bigfoot` palette drift at every tier.
Its coat sits outside the hue tolerance `paletteRule` derives from the approved unicorn. A warning
rather than a failure because it is a taste call, not a mechanical fault — but it is four tiers of
one species disagreeing with the rule the other five follow, so it is worth a decision: retune the
art, or widen bigfoot's latitude in the manifest and say why.

---

## 6. One thing specified only in prose

**`enemyPlans` and `enemies[]` are missing from the manifest** ([asset-brief §9.7](./asset-brief.md)
items 4 and 5). All nine part-sets now exist, so this is manifest/rig tooling debt rather than art
still to draw. The body-plan table in §4.3 remains prose, which is why `tools/art/inventory.ts`
still restates the roster by hand; adding both declarations should delete that constant.

This does not change the image inventory. It is noted so rig integration does not mistake completed
art for a complete machine-readable enemy contract.
