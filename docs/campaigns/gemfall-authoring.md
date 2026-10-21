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
| 8 Gemfall | 8 | `gemfall-08` | — | `mount_red_sky` |

**The Walk ends the campaign inside 07h.** gemfall.md's Collection can turn south at the tree
line and never climb; a walking party never enters chapter 8. 07h's Walk branch (the `walk_`
scenes) plays the epilogue in place, and its two endings carry `"endsCampaign": true`, which
completes the attempt and commits everybody's levels exactly as finishing chapter 8 does. Only an
ending may carry it (`content:validate`), and only 07h's Walk does (`gemfall-wiring.test.mjs`).
The Walk's opening grants 60 XP, so a party that finishes a chapter early still reaches Sworn.

## 2. What survives between evenings

Every evening is a new run whose flags start empty. **The only flags that cross a chapter
boundary are the members of the campaign's `routeSets`** (`content/campaigns/gemfall.json`),
written onto the household's campaign attempt and seeded back into the next chapter.
Everything else a chapter sets — doors opened, objectives earned — dies with the chapter.

A route set is a **fork**: at most one of its flags stands at a time, and a newly set member
replaces the old one. That is what lets a chapter *re-route* a party (3C's failed ford sets
`route_wild`, which replaces `route_rush`, and the party plays 4B).
The roads weave both ways: 3B's walk-over ending sets `route_rush`, and that party plays 4C.
So a road flag says which chapters 4 and 5 a party plays, **not** which chapter 3 it played:
a 4B/5B party may never have met Gullet or seen the Hollow Gate, and a 4C/5C party may never
have met Mother Thrum or Burdock. A callback to one chapter 3 gates on something only that
chapter gives (its facet, a prop, a `crossing` / `west_branch` member it alone sets).

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

### The two rules that keep this from stranding a party

1. **Never set two members of one set on the same path through a chapter.** If a path sets
   `clock_stirring` and later `clock_late`, the engine sees two new members, refuses to guess,
   and keeps the old value. Set the set **once**, on the edge into the ending (or on the
   branch effect that decides it).
2. **A "must be set" set has to be set on every path to every ending.** Put the `setFlag`
   on the choice or branch that *leads to* each ending, or in the ending scene's `onEnter`.
   02 that ends without a road strands the party at beat 3 with nothing to start.

### The finale is never gated by pursuit

gemfall.md: pursuits are not walls. All four of chapter 8's philosophies — Restore, Destroy,
Control, Exploit — are ungated in the seal chamber. The pursuit a party declared changes how hard
each one is, never whether it is there: a Tether party holds the leash on a TN 12 roll and
anybody else on TN 16; a Collection party lifts the Keystone, and anybody else has to pry it out
(TN 16). Either way the party can step back and choose again. A way the party tried and lost
closes behind it, so nothing is a retry: a failed pry stings and the Keeper keeps the Keystone, and
a leash let go (or a song stopped) sinks back under the seal. Every party arrives to all four.

The losses stay rare (gemfall.md, "Losing"). Last Ring follows a lost race only for a `clock_late`
party with no stone to wedge the door; Turned Back follows a lost fight with the Keeper and a
failed hold only for a party with no stone to give and no time to ask for; Broken Tether needs a
failed hold and a second failed try the party chose over letting go. Everything else reroutes at a
cost: a stone taken, a scrape, an hour lost, a way closed.

### Reading a carried flag

Gate a choice on it with `requiresFlag`. Requirements **hide** choices, and every scene
needs at least one ungated choice, so a carried flag can only ever **add** an option —
a callback, a shortcut, a friend who shows up. It can never be the only way forward. That
is a feature: the ledger rewards, it does not wall off. (`when: { notFlag }` can say "only if
not", and a `when` choice counts as gated like any other: it needs an ungated sibling. See §5.)

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
`takeItem` removes one copy of an item from whoever holds it. The hand-over scenes written
before it existed (giving a facet back) are still narration plus a flag, and that stone stays
in the bag as a memory until the campaign ends and quest items are cleared.

### Coins and food are real

If a choice says the party pays, buys, shares supper or hands over a cake, it has to
actually cost something. Otherwise the party's purse and bag stop meaning anything.

- **The purse.** One shared number per party (`RunState.coins`), carried across chapters on
  the campaign attempt. Chapter 1 starts it at 6 coins. Selling the Ember Facet adds 15, or
  30 if haggled up. Hessa's offer in 07h adds 30. `grantCoins` adds coins and `spendCoins`
  takes them away (never below zero). A choice that spends must also be gated with
  `when: { coins: { min: N } }`, where N is at least the amount spent. The party sees the
  purse next to its bag.
- **Campaigns already under way.** An attempt that had finished a chapter before the purse
  existed never saved one. It gets `purseBackfill` from `campaigns/gemfall.json` instead: 6
  coins, plus 15 if it holds `ember_sold`. `byFlag` keys must be route-set flags, because
  those are the only flags an attempt saves. A party in the middle of a chapter when the
  purse arrives sees an empty purse until that chapter ends. The backfill is saved then, and
  their next chapter starts with it.
- **Food.** `supper_bundle` is the road's food: bread, cheese and a sausage. Caravan cooks,
  sausage carts, centaurs and grandmothers hand them out. "Share your supper" is gated with
  `when: { count: { of: ["supper_bundle", "honeycake"], min: 1 } }` and takes
  `{ "type": "takeItem", "itemId": ["supper_bundle", "honeycake"] }`, which uses a bundle
  first and a honeycake only if there is no bundle. Text that names a sausage takes
  `supper_bundle` alone.
- **The validator holds you to it.** A choice that has `takeItem` or `spendCoins` without a
  matching gate fails `content:validate`. Coins a scene charges on arrival also count as a
  cost of every choice leading into it. That covers its `onEnter` and the highest charge
  among a check's success and failure (or a fight's victory and defeat), so the haggle
  choice in chapter 1 is gated on 2 coins. A charging scene may only be reached through
  choices, since a branch cannot be gated on the purse. Take an item at most once per choice. Gates
  count distinct items, not copies, so nothing can promise a party holds two bundles. Because cost gates are gates, every such scene still
  needs one choice that costs nothing. "Keep your coins and walk on" is a real choice.

## 4. Shape of a chapter

Follow `content/chapters/bramblewood-01.json`. Each Gemfall chapter:

- **A real evening: 30–45 minutes at the table.** The first draft's chapters ran in about
  eight minutes each in playtesting, because a party could win one in a dozen scenes with
  four or five real decisions. So the bar is the **shortest path to a success ending**: at
  least **30 scenes**, at least **14** of which ask something (a scene with two or more
  ungated choices, a `choice_point` vote, or a check). New material goes on the spine
  every path walks, never on a detour a party can skip. That puts most chapters at 80–120
  scenes, and that is fine: most of the count is result scenes (below), which take a few
  seconds each at the table. `estimatedMinutes` 30–45.
- **Every choice lands somewhere that shows its result.** Two choices may reach the same
  place, but never without a scene in between that tells the party what their pick did: a
  troll answers the story you told, the room reacts to the pursuit you declared, the dragon
  answers the thing you held up. A gated shortcut may share an easy check with its siblings,
  because the check's own narration is the result. A `check` branch always carries a
  `narration`. Transitions are caused, not cut to: if a mail sack is going to burst over the
  market, somebody mentioned the overloaded griffins first.
- **`xpAward`**: 01 = 100; 02–07 = 90; 08 = 120. Objectives total ≤ 25% of it
  (≤ 22 for a 90 chapter), pointed at flags the chapter already sets.
- **At least one rest waypoint** (a `rest` scene *with* choices) before the end, and an
  ending (a scene with `"choices": []`). Several endings is normal.
- **A setback ending somewhere** (`"outcome": "setback"`), reached by losing a fight or by a
  bad run of luck — never by a single ordinary failed roll. The campaign tolerates four
  (`setbackLimit: 4`) before it fails, so they must stay rarer than one per chapter on average.
- **A failed roll keeps the story going.** Failure reroutes. Nothing is a retry.
- **The table plays, not only listens** ([content/README.md, "Interactivity"](../../content/README.md#interactivity)).
  The goal is clear in scene 1. Never more than about three scenes in a row without a vote, a
  check or a fight. Most spine checks are things the party does (`might`, `quick`, `clever`, or a check's
  `checkKind: "doing"`), not says. New people arrive with a stake for the party.
  `content:pacing` reports the run and the doing share for every spine.
- **Species gates** where gemfall.md says a species shines, always beside an ungated way.
- **0–2 encounters.** 2–4 enemies total. Name canon creatures: `cinder_wolf`, `mire_mimic`,
  `will_o_wisp`, `river_drake`, `glassback_crab`, `bone_crawler`, `restless_remains`,
  `echo_hunter`, `legend_dragon`. Do not restate canon stats. `legend_dragon` has none and
  must author `hp`, `guard`, `quick`, `steps`, `attack` itself (and still needs a second
  enemy entry or a `count` to reach two figures). Maps: `ford`, `reedbank`, `roadside`,
  `glade`, `switchback`, `gallery`, `thicket`. `onDefeat` always branches somewhere real —
  robbed, rescued, rerouted — and costs stones or time.
- **Field Guide tags.** A fight's creatures and the chapter's biome fill in the Field Guide on
  their own; tag a scene with `discovers` only when the party meets someone or somewhere else
  there (an NPC, a named individual, a location). See
  [`discovers` in content/README.md](../../content/README.md#field-guide-tags-discovers).
- **Choice icons** from the client's set: `might quick clever heart eye ear arrow hand flame
  map scroll rest star crown drop feather lantern leaf note thorn whistle acorn bead boot
  cake charm ribbon swords trophy party travel forward back check` plus aliases `fist wing
  spark gem key shield moon potion`, and species icons.
- **Stats** for checks: `might`, `quick`, `clever`, `heart`. TNs: 8 easy, 12 normal, 16 hard.
- **`voiceGuide`** with `tone`, `vocabulary: "age-8"`, `forbidden` (at least: death, blood,
  permanent loss, weapons that wound, anyone being left behind), and `npcVoices` for every
  chapter-scoped character who speaks.
- **Scene illustrations are optional.** `art: "scenes/gemfall/<illustration>"` selects a WebP backdrop for that scene. Without it, the backdrop comes from `biome`. Combat always uses the biome environment; a missing illustration falls back to it. See [illustration prompts and coverage](./gemfall-illustrations.md).

### Continuity: names a scene uses that some way in never showed

`npm run content:continuity` (and `tools/content/continuity.test.mjs` in `npm test`) sweeps every
campaign in `content/campaigns` and finds **dangling references**: a scene that uses a capitalised name (a person, a place, an item)
which some way into the scene showed and some other way did not. It is a must-analysis. Inside
a chapter it intersects what every path into a scene showed; across chapters it carries
knowledge along every history the road weave allows, so a 4C party that arrived from 3B's
walk-over is judged by what *that* history showed. Routing is read from `gemfall.json` and the
chapters' route-set `setFlag`s, never from a table. A gated choice (`requiresFlag` /
`requiresItem`) counts as proof of whatever the setters of its flag or item showed, and a gate
that cannot hold in a history (a road the party is not on, a facet it never took) is dropped
rather than judged. What a route flag proves comes from the histories that **end** holding it.

A scene may use a name it introduces itself: `a clerk named Pellam`, `called Gullet`,
`Tibbet, a goblin`, `his daughter Posy`, `... , the Deep Hollow choir`, `a tower: Redspire
Citadel`, a `cast` entry. If a scene brings a character on and does not do one of these, the
sweep will say so at the next merge point.

`when` gates count the same way (`flag`, `item`, `count` with `min` of 1 or more); `notFlag`,
`notItem`, a `count` with only a `max`, and `partySize` prove nothing. Narration `variants` are
checked against what their own `when` proves, but are conservatively **not** counted as showing
a name to later scenes, since they appear only for some parties. The exceptions are an
always-true variant, and a `replace` variant, which only guarantees what the base and the
replacement both show. `{facets}` and `{party}` are not names.

**What it cannot see.** Only capitalised names. "The jar", "your goat", "that ledger" and
"the old woman" are invisible to it, so every merge point still needs a human read for
references that are not names. It does not judge ordinary words (a sentence-opening capital
that is also a lowercase word elsewhere is skipped; `STOP_WORDS` in the script covers the
rest), and a name no way in has shown is treated as the scene coining it, not citing it.

**When it fails.** The message names the chapter, the scene, the name and where else the name
appears. Fix the prose (introduce the name where the party first meets it) or, if the finding is
a false alarm, add `chapter/scene/name` with a one-line reason to
`tools/content/continuity-allow.json`. Prefer a fix to an entry. Entries marked `REAL
CANDIDATE` are real continuity questions someone should settle. The list is checked both ways:
an entry that no finding matches any more **fails the test** as stale (delete the line), and an
entry without a reason fails too.

### Voice

Read bramblewood-01 aloud and match it: short sentences an 8-year-old follows when an adult
reads them off the TV, one concrete funny detail per scene, warm and a little spooky, never
scary. Nobody dies. Losses in chapter 8 are grief and consequence, never gore; the realm
endures and every loss ends on a spark. The Hollow Gate is witnessed, never explained.

Never count the party. A table seats one to four players, so "all three of you", "your two
names" and "three pairs of hands" read wrong at most tables; say "all of you", "your names",
"every hand". `gemfall-flow.test.mjs` fails on the common forms. When a line really has to say
who, write the `{party}` token and let the engine count: "The gate opens for {party}." reads
"for you", "for both of you" or "for all four of you" (§5). It is lowercase, so keep it
mid-sentence.

Spell everything players read in US English: color, favorite, harbor, neighbor, center, gray,
traveled, realize, defense, catalog, mom, while, among, cozy. `spelling.test.mjs` scans the
text of every chapter, the generated content JSON, and the canon YAML, and fails with the file,
line, field, and the US spelling to use. It reads text, not ids, so `scene_harbor_wall` style
ids may spell anything. Two documented exceptions: the "Sunbloom Draught" keeps its name, and
"afterwards" is accepted. The word list and exceptions live in `tools/content/spelling-lint.mjs`.

### Priority scenes

Each chapter marks its revelation `priority: 1` and a few supporting clues `priority: 2`
([content/README.md, "Priority scenes"](../../content/README.md#priority-scenes)). The p1s are the
beat ladder's sentences, one per road, and no path through a chapter passes two of them:

| Beat | p1 scene(s) |
| --- | --- |
| 1 | `scene_scholar_theory`: Tidewell's seal of eight facets (optional, so it is a theory, not the reveal) |
| 2 | none; the beat is a road choice, not a revelation |
| 3 | `03a/scene_troll_hum`, `03b/scene_boggart_clue`, `03c/scene_tuned_charm`: the old, old note |
| 4 | `04a/scene_spiral`, `04b/scene_finding`, `04c/scene_spiral`: the land flinches from the stones |
| 5 | `05a/scene_outline`, `05b/scene_knot_cords`, `05c/scene_here_first`: older than the mountain's name |
| 6 | `scene_whole_truth`, or `scene_shut_out` for a party locked outside: seal, titan, rush |
| 7 | none; the beat is the gathering, and its clues are p2 |
| 8 | `scene_seal_chamber`: the seal, its crown, and what is waking under it |

The p2s are the cult's pitch on each road, the bell nobody rings, the wrong-way embermoths, the
Hollow Gate, the forest's pile, and the Seal-Keeper. One reveal cannot be marked:
Tidewell's "the eighth is the crown of the seal" in 7H is the `onSuccess` narration of
`check_tidewell`, and a branch has no priority of its own. `scene_tamsins_offer`, where it
lands, is p2 for the cult's offer.

### Each chapter's goal

Every chapter states what the party is trying to do, on the TV and every phone from scene 1, with
steps that tick themselves ([content/README.md, "The chapter's goal"](../../content/README.md#the-chapters-goal)).
A Gemfall goal follows the beat, never names someone a road in might not have met (a 4B party may
never have met Gullet), never names or counts a great stone, and ticks on flags the chapter alone
sets, or on one of its own quest items: the road, the pursuit and the rest of the route sets
arrive already set, so they cannot be steps. 07l's ledger, chord and true answer are its own quest
items and are optional steps, because the chapter is built to be finished without them (the bend
has a bare-hands way). A step whose roll can fail is worded for what every party does ("Race for
the caravan's stone"), never for the success only some get. The step flags were added for the goals, each a chapter-local `setFlag` on the scene where
the thing happens; none crosses a chapter, so the endings, roads, setbacks and resumed save in
`gemfall-compat.test.ts` do not move. In 02 nothing new is set between the wolves and the plank
bridge, where the pinned mid-fight save resumes.

<!-- goal-table: generated from the chapter files; keep it in step with them. -->
| Chapter | Goal | Steps (what ticks each) |
| --- | --- | --- |
| `gemfall-01` | Get ready for the long trip north. | Hear which roads go north (`heard_of_the_roads`); Pack something for the road (`packed_for_the_road`); Find a bed for the night (`found_a_bed`); Join a caravan going north (`joined_a_caravan`) |
| `gemfall-02` | Travel the Sunward Fields and choose your road north. | Help out at the egg stall (`helped_the_egg_stall`); Help at the broken bridge (`helped_at_the_bridge`); Get through the tall hedges (`got_through_the_hedges`); Choose your road north (`chose_a_road`) |
| `gemfall-03a` | Pay the toll at Stone Crossing and get across the river. | Reach the crossing (`reached_the_crossing`); Pay the troll's toll (`paid_the_toll`); Camp in the queue for the night (`camped_in_the_queue`); Get across the river (`got_across_the_river`) |
| `gemfall-03b` | Ride through the Whispering Marsh and find a way out. | Get past the toll reeds (`passed_the_toll_reeds`); Find a way through the fog (`steered_through_the_fog`); Cross the old sunken steps (`crossed_the_old_steps`); Choose a way out of the marsh (`chose_a_way_out`) |
| `gemfall-03c` | Wait your turn at the river ford, then try to get across. | Deal with the runaway goat (`dealt_with_the_goat`); Help someone stuck in the queue (`helped_in_the_queue`); Spend the night in the queue (`slept_in_the_queue`); Take your turn at the ford (`stepped_into_the_ford`) |
| `gemfall-04a` | Cross pride country and find out why its roads bend the long way round. | Meet the manticore pride (`met_the_pride`); Read the centaurs' road maps (`lined_up_the_sashes`); Find what the roads bend around (`reached_the_bend`) |
| `gemfall-04b` | Find out what the forest is counting, and why. | Answer the forest's roll call (`answered_roll_call`); Help mend a sick glade (`quieted_the_glade`); Find what hurts the forest most (`reached_the_worst_glade`) |
| `gemfall-04c` | Follow the rush up the north road and find out what the road remembers. | Get a stuck mule moving (`moved_the_mule`); Visit the big gem depot (`reached_the_depot`); Learn the centaurs' route-songs (`heard_the_route_songs`); Find a safe place to camp (`passed_the_bend`) |
| `gemfall-05a` | Cross the cracked bridge, and find out what its cracks are saying. | Get down to the bridge foot (`reached_the_bridge_foot`); Help map the bridge's cracks (`laid_out_the_survey`); Decide who to tell (`chose_who_to_tell`); Get across the bridge (`crossed_the_span`) |
| `gemfall-05b` | Find out what the forest town remembers, then climb out to the foothills. | Read the oldest records (`read_the_old_knots`); Decide who to tell (`chose_who_to_tell`); Cross the deep gorge (`crossed_the_gorge`); Climb up out of the forest (`reached_the_foothills`) |
| `gemfall-05c` | Get past the old boundary stones, and find out why they hold the rush back. | Read the old tally books (`read_the_tallies`); Calm the crowd at the stones (`settled_the_crowd`); Decide who to tell (`chose_who_to_tell`) |
| `gemfall-06` | Climb to the tower on the ridge, learn what the stones are, and say what it is all for. | Find somewhere warm to sleep (`slept_on_warm_stones`); Get up to the tower (`reached_the_tower`); Learn what the stones really are (`learned_the_whole_truth`); Say what it is all for (`said_what_for`) |
| `gemfall-07h` | Beat three other crowds to the caravan's loudest stone at the worst bend. | Race the other crowds for stones (`got_ahead_at_the_pinch`); Race for the caravan's stone (`raced_for_the_stone`); Answer Hessa's offer (`answered_hessa`); Climb up, or walk away (`climbed_the_mountain` / `walked_away`) |
| `gemfall-07l` | Gather the ledger, the chord and a true answer, then hold the stone's hum at the bend. | Borrow the wardens' ledger (holds `tether_ledger`, optional); Learn the choir's three notes (holds `tether_chord`, optional); Find a true answer (holds `tether_question`, optional); Face the stone's hum at the bend (`faced_the_bend`) |
| `gemfall-07r` | Turn the road's stones toward home, and send the caravan's big stone home from the bend. | Start turning stones around (`found_help_at_the_pinch`); Meet Hessa's masks on the road (`met_the_masks`); Meet the big caravan at the bend (`met_the_caravan`); Climb the mountain (`climbed_the_mountain`) |
| `gemfall-08` | Climb the mountain everyone else is running from, and give your answer. | Climb up to the mountain's shoulder (`reached_the_shoulder`); Reach the very top (`reached_the_summit`); Go deep inside the mountain (`found_the_deep_cave`); Answer every question you are asked (`answered_every_question`) |

## 5. Writing for the party you have

A scene's words and a choice's visibility can depend on who is at the table and what they
carry: `when` on a choice, `variants` on a scene or a branch, and the `{facets}` / `{party}`
tokens. This section is the house rules for using them. The shapes are `Condition` and
`NarrationVariant` in `packages/shared/src/types/chapter.ts`; `content:validate` rejects a
malformed one (below), so a mistake fails the build, never the evening.

### Two kinds of stone

- **Rush gems.** Every party carries ordinary rush gems. They are loose, uncounted, never an
  item in anyone's pack, and they hum. "Your packs are humming" is always true; never gate it.
- **Great stones (facets).** The `facet_*` quest items from §3. Text that **names** a great
  stone ("the Ember Facet in your pack"), **counts** them ("three stones"), or has the party
  **hand one over** must read the inventory: `when: { item }`, `when: { count }`, or a variant.
  Otherwise the line lies to a party that does not have it.

**No chapter guarantees a facet.** 01's Ember can be sold (`ember_sold` grants nothing; 07
offers a buy-back, so a seller may or may not have it again). 06's Table Stone can be left in
warden custody (`leave_stone`). 07's Caravan Stone is lost if the outbid check fails, and
and so on down the line. So "holds none" is a real
party that reaches 08 and needs its own text. A handing-over scene that should really part
the party from a stone says so with `takeItem` (§3); one that does not leaves the stone in
the bag, and must **not** count on the item having left.

### Patterns

Each example below is checked by `tools/content/authoring-guide.test.mjs`, which pulls the
fenced blocks tagged `guide-variants` and `guide-choices` out of this file and runs them
through `content:validate`. Edit the examples and the test follows.

**Absence.** Give the empty-handed party its own words, and something to do. A `max: 0`
variant that replaces the base, plus a choice only they see:

```json guide-variants
[
  {
    "when": { "count": { "of": "facet_*", "max": 0 } },
    "replace": true,
    "text": "The gate keeper looks at your packs. They hum, but no great stone sits in them. \"Then tell me what you do carry,\" says the keeper."
  }
]
```

```json guide-choices
[
  {
    "id": "nothing_to_show",
    "label": "Tell the keeper about the road",
    "icon": "scroll",
    "goto": "NEXT",
    "when": { "count": { "of": "facet_*", "max": 0 } }
  }
]
```

**Scaling.** Zero, a few and many. Three variants at most per scene, and do not narrate every
number: nobody at the table can tell eight stones from nine. `{facets}` fills the count as a
word.

```json guide-variants
[
  {
    "when": { "count": { "of": "facet_*", "max": 0 } },
    "replace": true,
    "text": "The wall is bare stone and waits for something to answer it."
  },
  {
    "when": { "count": { "of": "facet_*", "min": 1, "max": 3 } },
    "text": "{facets} of the wall's sockets glow back at you, and the rest stay dark."
  },
  {
    "when": { "count": { "of": "facet_*", "min": 4 } },
    "at": "start",
    "text": "The whole wall is bright before you reach it. You carry {facets} great stones."
  }
]
```

**A callback choice with a fallback.** The callback carries `item`; an ungated sibling serves
everyone else. A `when` hides the choice, so a scene of nothing but `when` choices is a dead
end and `content:validate` fails it.

```json guide-choices
[
  {
    "id": "show_ember",
    "label": "Hold up the Ember Facet",
    "icon": "gem",
    "goto": "NEXT",
    "when": { "item": "facet_ember" }
  },
  {
    "id": "speak_plainly",
    "label": "Tell it the plain truth",
    "icon": "heart",
    "goto": "NEXT"
  }
]
```

**Party size.** Do not write a number of people; use `{party}`. Reach for `partySize` only
when the moment really differs, for example a lone hero carried by the dragon:

```json guide-variants
[
  {
    "when": { "partySize": { "max": 1 } },
    "text": "Your dragon pads closer and lets you lean on it. Nobody climbs this alone."
  },
  {
    "when": {},
    "at": "start",
    "text": "The bridge creaks, and it holds for {party}."
  }
]
```

**Avoid: variants that change facts later scenes depend on.** A variant says how something
looks; a choice decides what happened. If a variant says "the warden lets you through", the
next scene must be true for a party that did not see that variant. Anything later scenes rely
on (who is friendly, what was given, which door is open) goes in a choice with a `setFlag`,
not in a variant. Likewise do not hide the only way forward behind a `when`.

### Running the narration audit

Steered parties (empty-handed, full collection, solo, and the 07h/07l runs at no facets and
nine or more) play the whole campaign through the real server and record every composed line
and choice label with the party as it stood. `narration-audit.ts` judges them: stones named or
counted that the party does not hold, party-counted wording ("both of you") shown to a party
of one, unfilled `{tokens}`, and missing band text in the finale. To see every offender, with
chapter, scene and line, instead of a pass/fail:

```
KAD_AUDIT_REPORT=1 npx vitest run packages/server/src/handlers/gemfall-playthrough.test.ts --reporter=verbose
```

Without the variable the same assertions fail the test with that list. The cheap static
version, `tools/content/gemfall-flow.test.mjs`, greps for party-counted phrases; a phrase that
is right because it counts the party *and* an NPC goes in its `PARTY_COUNT_ALLOWED` list with a
reason.

### Semantics

- **Fields are ANDed.** Every field present in a `Condition` must hold; an empty `{}` always
  holds. Use two variants, not one condition, for "either".
- **Distinct counting.** `count` counts distinct item ids the party holds between them, across
  inventories and quest items. Two members carrying the same item is one item. `of` is an
  exact id, a prefix ending in `*` (`"facet_*"`), or a list of ids. Bounds are inclusive and
  `max: 0` means none. `partySize` counts seated members, connected or not. `coins` reads the
  party purse, with the same inclusive bounds.
- **When it is read.** Variants are evaluated once, as the scene opens, **after** its
  `onEnter` effects (and, for branch narration, after the branch's effects). A facet granted by
  the scene's own `onEnter` counts. The result is stored, so a phone that reloads mid-scene
  reads what the table is reading. Choice `when`s are checked as the prompt opens.
- **Composition order.** `at: "start"` variants, then the base narration, then the rest
  (`at: "end"`, the default), each in authored order, joined by a blank line. `replace: true`
  puts its text where the base would have been.
- **One replace per scene.** More than one `replace` on a scene or branch fails the build
  unless the validator can show they never both match: the same flag against its `notFlag`,
  the same item against its `notItem`, disjoint `partySize` ranges, or disjoint `count`
  ranges over the same `of`. Anything cleverer than that, make into a single variant.
- **Tokens.** Only `{facets}` (the number of distinct `facet_*` the party holds, as a word:
  "no", "one", "two") and `{party}` ("you", "both of you", "all four of you") exist. They work
  in narration, variant text, choice labels and check prompts. Any other `{word}` fails the
  build.
- **What the validator checks.** Flags in `flag` / `notFlag` must be set somewhere in the
  chapter or carried by a route set (a `notFlag` on a carried flag is fine). Items and `count`
  prefixes must exist in `content/items.json`. `min` may not exceed `max`. Choices still need
  one ungated choice per scene, and a `when` counts as a gate. In Gemfall, a result scene
  (`<source>_<choice>`) may carry variants but keeps its single exit: a `when` there fails
  `gemfall-flow.test.mjs`.
- **Reading the map.** `npm run content:graph` labels `when` gates on the dashed edges:
  `has 0 facet_*`, `has 2+ facet_*`, `party 2+`, `purse 3+ coins`, `not flag: x`, `holds: item`, `lacks: item`.
