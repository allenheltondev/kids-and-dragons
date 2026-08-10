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
| **Image assets** — character parts, gear overlays, effect sheets, backdrops, props, tiles, creature cutouts | **Allen** |
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
| Biome backdrops, tiles + props | **51 / 51** | — |
| Effect sheets, declared | **11 / 11** | — |
| Entity cutouts | **27 / 27** | — |
| **Gear overlays** | 6 / 24 | **18 files** — 9 sets |
| **Effect sheets, specified but undeclared** | 0 / 6 | **6 sheets** |
| **Entity part-sets (combat roster)** | **9 / 9** | — |

**24 files outstanding.** Creature generation is complete; what is left is gear and six combat
effects.

---

## 3. What is done

Recorded because "is that finished?" is the question this document exists to stop you asking.

**Character part-sets — 224 files.** Six species × four tiers, each a full-canvas registered part
set plus its `assembled.png`. Part counts differ by species because the signature part does:
unicorn/dragonling/griffin carry nine, kitsune/manticore eight, bigfoot seven. All green through
`art:verify`, including cross-tier joint registration — which is what made the rigs cheap.

**Rigs — 24 `.riv`.** Six skeletons, exported per tier. Mine, generated, green through
`art:verify:rig:strict`. Listed here only so the dependency below is visible.

**Biomes — 17 destinations.** Each with `bg.webp`, `tiles.png` and six props: 102 prop files, and
12 unique tile sheets shared across the 17 (several destinations share a terrain family).

**Effect sheets — 11.** Six `aura_<species>` loops plus `impact_strike`, `burst_star`,
`heal_bloom`, `revive_lift` and `transform_flash`.

**Entity cutouts — 27.** Every canonical creature as a single `assembled.png`. No tier dimension:
enemies do not level. Together with the six playable species these are the 33 entities in
`docs/red-sky-creature-canon.yaml`, and the two lists reconcile exactly.

`portrait.webp` never appears above because portraits are **derived, not drawn** —
`npm run art:portraits` trims `assembled.png`, squares it and writes 384px WebP. Never commission
one. UI icons are likewise not on this list: they are hand-authored inline SVG in
`packages/client/src/screens/icons.tsx`, not raster assets.

---

## 4. What is left

### 4.1 Gear overlays — 9 sets, 18 files

Three of twelve are delivered (`songkeeper`, all three tiers). Outstanding:

| Class | Tiers | Files |
|---|---|---|
| `thornguard` | sworn, radiant, mythic | `overlay_torso.png`, `prop_held.png` each |
| `duskrunner` | sworn, radiant, mythic | same |
| `starweaver` | sworn, radiant, mythic | same |

No gear at `fledgling`, by design. Overlays register against the **species-agnostic torso
position**, so one set works across all six species at that tier — which is why this is nine sets
and not fifty-four. Design them to read on both the slimmest (kitsune) and bulkiest (bigfoot)
silhouette. Themes are in [asset-brief §4.3](./asset-brief.md#43-gear-overlays).

**This is the largest outstanding block and the only one blocking a shipped feature** — the
transformation is Chapter 5's emotional payload and three of four classes currently level into
nothing visible.

### 4.2 Effect sheets — 6

Specified in [asset-brief §9.4](./asset-brief.md#94-effects--mapping-the-ten-verbs) and **not yet in
the manifest's `effects[]`**, which means no tool in this repo can see them. That is why they are
named by hand in `tools/art/inventory.ts`; add each to `effects[]` when it is commissioned and
delete it from that constant.

| Sheet | Frames | For |
|---|---|---|
| `miss_veer` | 8 | `attack` — miss. **A miss needs its own sheet: absence is not a signal.** `hurt` simply not playing leaves a child reading a d20 to find out whether the swing landed. |
| `bonus_spark` | 8 | the `rollBonus` verb |
| `dust_scuff` | 8 | `moveSelf`, and `shove` shares it |
| `daze_swirl` | 12 | the `skipTurn` verb |
| `guard_ward` | 8 | the `protect` verb — and `guard` must gain an event in `rigContract` before this can start (mine) |
| `down_settle` | 12 | the `down` event that damage produces |

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

## 6. Two things specified only in prose

Both are invisible to tooling, and both are mine to close rather than yours:

1. **`effects[]` is missing the six sheets of §4.2 above.** Until they are declared, nothing checks
   frame counts, tint tolerance or clip sync for them.
2. **`enemyPlans` and `enemies[]` are missing from the manifest** ([asset-brief §9.7](./asset-brief.md)
   items 4 and 5). All nine part-sets now exist, so this is manifest/rig tooling debt rather than
   art still to draw. The body-plan table in §4.3 remains prose, which is why
   `tools/art/inventory.ts` still restates the roster by hand; adding both declarations should
   delete that constant.

Neither changes the image inventory. They are noted so rig integration does not mistake completed
art for a complete machine-readable enemy contract.
