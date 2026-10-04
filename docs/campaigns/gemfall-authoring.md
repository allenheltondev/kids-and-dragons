# Gemfall — the authoring contract

[gemfall.md](./gemfall.md) is the story. This is the **wiring**: what each chapter file
must set, what it may read, and the engine rules that decide whether a campaign spread
across sixteen files and eight evenings actually holds together at the table.

If the two documents disagree about *story*, gemfall.md wins. If they disagree about
*flags, items or file shape*, this one wins — it describes what the engine can do.

---

## 1. The files

| Beat | Index | Files | Route set → flag | Biome |
|---|---|---|---|---|
| 1 The Spark | 1 | `gemfall-01` | — | `exchange` |
| 2 The Fork | 2 | `gemfall-02` | — | `sunward_fields` |
| 3 The Toll | 3 | `gemfall-03a` / `-03b` / `-03c` | `road`: `route_river` / `route_wild` / `route_rush` | `stone_crossing` / `whispering_marsh` / `plains` |
| 4 The Country That Noticed | 4 | `gemfall-04a` / `-04b` / `-04c` | `road` (same) | `eastern_plains` / `enchanted_woods` / `plains` |
| 5 The Outline of the Truth | 5 | `gemfall-05a` / `-05b` / `-05c` | `road` (same) | `eastern_plains` / `mosshome` / `red_sky_foothills` |
| 6 The Whole Truth | 6 | `gemfall-06` | — | `red_sky_foothills` |
| 7 The Gathering | 7 | `gemfall-07r` / `-07h` / `-07l` | `pursuit`: `pursuit_restore` / `pursuit_hoard` / `pursuit_leash` | `red_sky_foothills` |
| 8 Gemfall | 8 | `gemfall-08` / `-08w` | `summit`: `climbed_the_mountain` / `walked_away` | `mount_red_sky` / `red_sky_foothills` |

**One correction to gemfall.md:** the Walk does not end the campaign "at the tree line with no
chapter 8". A campaign completes — and commits everybody's levels — only when a party finishes
a chapter at its **last beat**. So the Walk is its own short beat-8 file, `gemfall-08w`
("The Tree Line"), an epilogue chapter with no climb in it. Walkers still never enter the mountain.

## 2. What survives between evenings

Every evening is a new run whose flags start empty. **The only flags that cross a chapter
boundary are the members of the campaign's `routeSets`** (`content/campaigns/gemfall.json`),
written onto the household's campaign attempt and seeded back into the next chapter.
Everything else a chapter sets — doors opened, objectives earned — dies with the chapter.

A route set is a **fork**: at most one of its flags stands at a time, and a newly set member
replaces the old one. That is what lets a chapter *re-route* a party (3C's failed ford sets
`route_wild`, which replaces `route_rush`, and the party plays 4B).

| Set | Members | Must be set by | Read by |
|---|---|---|---|
| `road` | `route_river`, `route_rush`, `route_wild` | **every ending of 02** | picks 03–05; door in 06; callbacks in 07 |
| `motive` | `motive_wealth`, `motive_curiosity`, `motive_prestige`, `motive_duty`, `motive_fresh_start`, `motive_proving` | **every ending of 01** | 06 reading-back, 08 epilogue |
| `ember` | `ember_sold`, `ember_kept` | **every ending of 01** | 07 (Ember Facet comes back north), 08 |
| `sprites` | `sprites_friends`, `sprites_wronged` | **every ending of 02** | 07 Wild callbacks, 08 dragon's questions |
| `crossing` | `crossed_dry`, `river_took_us` | **every ending of 03a** | 04a opening, 07 Ossley's debt |
| `west_branch` | `forded_clean`, `marsh_kept_us`, `walked_over` | **every ending of 03b and 03c** | 04b / 04c openings |
| `glade` | `glade_mended`, `glade_finished` | every ending of 04b | 07, 08 |
| `allies` | `told_wardens`, `told_gatherers`, `kept_close` | **every ending of 05a/b/c**; 06 may change it | 07 faction plays, 08 epilogue |
| `pursuit` | `pursuit_restore`, `pursuit_hoard`, `pursuit_leash` | **every ending of 06** | picks 07; 08 final choices |
| `seal_clock` | `clock_steady`, `clock_stirring`, `clock_late` | **every ending of 06**; 07 may change it | 07, 08 |
| `cult` | `refused_the_cult`, `funded_the_break` | optional, 04c/05x/06/07 | 07, 08 |
| `summit` | `climbed_the_mountain`, `walked_away` | **every ending of 07r/07h/07l** | picks 08 / 08w |

### The two rules that keep this from stranding a party

1. **Never set two members of one set on the same path through a chapter.** If a path sets
   `clock_stirring` and later `clock_late`, the engine sees two new members, refuses to guess,
   and keeps the old value. Set the set **once**, on the edge into the ending (or on the
   branch effect that decides it).
2. **A "must be set" set has to be set on every path to every ending.** Put the `setFlag`
   on the choice or branch that *leads to* each ending, or in the ending scene's `onEnter`.
   02 that ends without a road strands the party at beat 3 with nothing to start.

### Reading a carried flag

Gate a choice on it with `requiresFlag`. Requirements **hide** choices, and every scene
needs at least one ungated choice, so a carried flag can only ever **add** an option —
a callback, a shortcut, a friend who shows up. It can never be the only way forward. That
is a feature: the ledger rewards, it does not wall off. (There is no "requires NOT flag".)

`content:validate` accepts `requiresFlag` on any member of the campaign's route sets even
though the chapter never sets it; for any other flag the chapter must set it itself.

## 3. The facets — quest items that do persist

Quest items live on the character, outside the six slots, and outlive the chapter — that is
how the collection is real. Each facet is a **chapter prop** (`props` in the file where it is
found), `"kind": "quest"`, `"icon": "gem"`. Grant with `grantQuestItem`. Read with
`requiresItem` (satisfied by anyone in the party).

| Item id | Defined in | Name |
|---|---|---|
| `facet_ember` | 01 | The Ember Facet |
| `facet_harvest` | 02 | The Harvest Stone |
| `facet_drakes_rate` | 03a | The Drake's Rate |
| `facet_barge` | 03b | The Barge Stone |
| `facet_ford` | 03c | The Ford Stone |
| `facet_pride` | 04a | The Pride Stone |
| `facet_glade` | 04b | The Glade Stone |
| `facet_depot` | 04c | The Depot Stone |
| `facet_clerks` | 05a | The Clerk's Stone |
| `facet_confiscated` | 05b | The Confiscated Stone |
| `facet_unassigned` | 05c | The Unassigned Stone |
| `facet_table` | 06 | The Table Stone |
| `facet_caravan` | 07h (granted in 07r/07l too) | The Caravan Stone |
| `facet_keystone` | 08 | The Keystone |

Other chapter-only props (a knot-cord, a tuned charm, Ossley's token) get ids prefixed by
what they are, and must not collide with anything above or in `content/items.json`.
There is no "remove item" effect: giving a facet back is narration plus a flag, and the
stone stays in the bag as a memory until the campaign ends and quest items are cleared.

## 4. Shape of a chapter

Follow `content/chapters/bramblewood-01.json`. Each Gemfall chapter:

- **18–28 scenes, about 25 minutes.** `estimatedMinutes` 25–30.
- **`xpAward`**: 01 = 100; 02–07 = 90; 08 and 08w = 120. Objectives total ≤ 25% of it
  (≤ 22 for a 90 chapter), pointed at flags the chapter already sets.
- **At least one rest waypoint** (a `rest` scene *with* choices) before the end, and an
  ending (a scene with `"choices": []`). Several endings is normal.
- **A setback ending somewhere** (`"outcome": "setback"`), reached by losing a fight or by a
  bad run of luck — never by a single ordinary failed roll. The campaign tolerates four
  (`setbackLimit: 4`) before it fails, so they must stay rarer than one per chapter on average.
- **A failed roll keeps the story going.** Failure reroutes. Nothing is a retry.
- **Species gates** where gemfall.md says a species shines, always beside an ungated way.
- **0–2 encounters.** 2–4 enemies total. Name canon creatures: `cinder_wolf`, `mire_mimic`,
  `will_o_wisp`, `river_drake`, `glassback_crab`, `bone_crawler`, `restless_remains`,
  `echo_hunter`, `legend_dragon`. Do not restate canon stats. `legend_dragon` has none and
  must author `hp`, `guard`, `quick`, `steps`, `attack` itself (and still needs a second
  enemy entry or a `count` to reach two figures). Maps: `ford`, `reedbank`, `roadside`,
  `glade`, `switchback`, `gallery`, `thicket`. `onDefeat` always branches somewhere real —
  robbed, rescued, rerouted — and costs stones or time.
- **Choice icons** from the client's set: `might quick clever heart eye ear arrow hand flame
  map scroll rest star crown drop feather lantern leaf note thorn whistle acorn bead boot
  cake charm ribbon swords trophy party travel forward back check` plus aliases `fist wing
  spark gem key shield moon potion`, and species icons.
- **Stats** for checks: `might`, `quick`, `clever`, `heart`. TNs: 8 easy, 12 normal, 16 hard.
- **`llmHints`** with `tone`, `vocabulary: "age-8"`, `forbidden` (at least: death, blood,
  permanent loss, weapons that wound, anyone being left behind), and `npcVoices` for every
  chapter-scoped character who speaks.
- **No `art` keys** — the backdrop comes from `biome`.

### Voice

Read bramblewood-01 aloud and match it: short sentences an 8-year-old follows when an adult
reads them off the TV, one concrete funny detail per scene, warm and a little spooky, never
scary. Nobody dies. Losses in chapter 8 are grief and consequence, never gore; the realm
endures and every loss ends on a spark. The Hollow Gate is witnessed, never explained.
