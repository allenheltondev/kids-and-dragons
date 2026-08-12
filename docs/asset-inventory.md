# Asset inventory — everything that has to be drawn

**One question: what is left to draw?** Not what it should look like — that is
[asset-brief.md](./asset-brief.md), which is long, and stays long, because it is the thing that
scales to twenty-four characters. This is the shorter document you read to find out where the work
is, and it assumes the brief for every "how".

> **Live numbers: `npm run art:inventory`.** Every count below comes from that command, which
> derives what is *needed* from `assets/manifest.json` and checks what is *there* against the disk.
> The snapshot in this file is a convenience and can go stale; the command cannot. It reports and
> never gates — `art:verify` and `art:verify:rig` are the gates.

---

## 1. Who owns what

| | Owner |
|---|---|
| **Image assets** — character parts, gear portraits, class-rig parts, effect sheets, backdrops, props, tiles, creature cutouts | **Allen** |
| Rigs — skeleton, state machine, clip table, per-tier export | **Claude**, via `rive-mcp` |
| The manifest, the verifiers, the briefs | **Claude** |

That is the whole split, and the line is drawn where it is for one reason: **rigs are generated
from a contract, drawings are not.** `rive-mcp`'s `rig --contract` reads `manifest.rigContract` and
derives the clip table, event ticks and input list directly, so a rig cannot drift from the spec —
the spec is its input. No comparable statement is true of a drawing, which is why `art:verify`
checks pixels mechanically and then still sends a contact sheet to a human.

Practically: **if it is a `.png` or a `.webp`, it is Allen's. Everything else on the art side is
mine.**

---

## 2. Where it stands

Snapshot — regenerate with `npm run art:inventory`.

| Category | Delivered | Outstanding |
|---|---|---|
| Character part-sets | **224 / 224** | — |
| Character rigs *(mine)* | **24 / 24** | — |
| Gear portraits | **72 / 72** | — |
| **Class rig variants** | **6 / 72** | **66 exact-pose splits** |
| Biome backdrops, tiles + props | **51 / 51** | — |
| Effect sheets, declared | **17 / 17** | — |
| Entity cutouts | **27 / 27** | — |
| Effect sheets, specified but undeclared | **0 / 0** | — |
| **Entity part-sets (combat roster)** | **9 / 9** | — |

**66 rig variants outstanding.** The character-and-gear paintings are complete. What remains is
splitting those approved exact poses into transparent registered parts and building their rigs.

---

## 3. What is done

Recorded because "is that finished?" is the question this document exists to stop you asking.

**Character part-sets — 224 files.** Six species × four tiers, each a full-canvas registered part
set plus its `assembled.png`. Part counts differ by species because the signature part does:
unicorn/dragonling/griffin carry nine, kitsune/manticore eight, bigfoot seven. All green through
`art:verify`, including cross-tier joint registration — which is what made the rigs cheap.

**Rigs — 24 `.riv`.** Six skeletons, exported per tier. Mine, generated on the 1400 stage. Green
through `art:verify:rig:strict` and the motion gate; manticore's four are red on the rest check,
where its mesh tail drops ~15% of itself in the generator (art-pipeline §6.3). Listed here only so
the dependency below is visible.

**Gear portraits — 72 files.** Four classes × three geared tiers × six species. Each is an approved,
purpose-drawn creature-and-gear composite and is the visual source of truth for its exact fit.

**Class rig variants — 6 `.riv`.** The full Thornguard Sworn set is split and rigged for all six
species. Each build keeps its species skeleton and clip contract while replacing the skin with
registered transparent parts from the approved exact pose.

**Biomes — 17 destinations.** Each with `bg.webp`, `tiles.png` and six props: 102 prop files, and
12 unique tile sheets shared across the 17 (several destinations share a terrain family).

**Effect sheets — 17.** Six `aura_<species>` loops plus `impact_strike`, `miss_veer`,
`bonus_spark`, `dust_scuff`, `daze_swirl`, `guard_ward`, `burst_star`, `heal_bloom`,
`revive_lift`, `down_settle` and `transform_flash`.

**Entity cutouts — 27.** Every canonical creature as a single `assembled.png`. No tier dimension:
enemies do not level. Together with the six playable species these are the 33 entities in
`docs/red-sky-creature-canon.yaml`, and the two lists reconcile exactly.

`portrait.webp` never appears above because portraits are **derived, not drawn** —
`npm run art:portraits` trims `assembled.png`, squares it and writes 384px WebP. Never commission
one. UI icons are likewise not on this list: they are hand-authored inline SVG in
`packages/client/src/screens/icons.tsx`, not raster assets.

---

## 4. What is left

### 4.1 Class rig variants — 66 exact-pose splits

Every approved geared character needs one animated variant. Six of 72 are delivered: the complete
Thornguard Sworn set. Outstanding:

| Class | Tiers | Variants |
|---|---|---:|
| `thornguard` | radiant, mythic | 12 |
| `duskrunner` | sworn, radiant, mythic | 18 |
| `starweaver` | sworn, radiant, mythic | 18 |
| `songkeeper` | sworn, radiant, mythic | 18 |

No gear at `fledgling`, by design. This is production work from art already approved, not a new
painting commission: recover registered transparent body and gear layers from each exact pose,
declare their draw order in `manifest.rigVariants`, build the species rig, and run the rest-pose
and all-clip motion gates. Undelivered combinations fall back to the un-geared species rig on
animated surfaces; still-image surfaces already use the approved gear portrait.

Thornguard Radiant is next, using the same one-species-at-a-time exact-pose review sequence that
proved Thornguard Sworn.

### 4.2 Effect sheets — complete

All 17 are delivered and declared in the manifest. The six combat gaps identified by
[asset-brief §9.4](./asset-brief.md#94-effects--mapping-the-ten-verbs) are closed, including
`down_settle` on the `down.settle` event.

**No new combat sheet may exceed 12 frames** — 8 or 12 and nothing else, which at 12fps is 0.667s
or 1.0s and is what §9.2's turn budget affords. `transform_flash`'s 18 is the exception that proves
it: that one plays when the fighting has stopped.

### 4.3 Entity part-sets — 9 delivered

The 27 cutouts are delivered and the board draws them today. The approved `will_o_wisp` ships the
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
