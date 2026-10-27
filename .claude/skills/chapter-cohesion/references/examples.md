# Worked examples

Findings from the #368 audit (main `119517f`) and the chapter 7 fixes, filed by check. Scene ids
and quotes are as they stood then; later fix PRs may have changed them. Use them to calibrate what
a finding looks like, not as a to-do list.

## The worked fix: #364 and #365

**#364, "open on the party's promise, say who the masks are"** (06, 07l, 07r, 07h). Wording,
labels and check prompts only; no scene, edge, flag, effect, stat or TN moved.

- **Check 2.** Each 07 opening says its goal word for word: 07l `scene_the_table` has Pellam
  restate the party's own declaration ("You said hold it. Not break it, not bury it.") and then
  the goal ("gather the ledger, the chord and a true answer, then hold the stone's hum at the
  bend"). The long first draft overflowed the TV (`layout-fit`); it was split to 528 characters.
- **Check 1, lowercase.** "The masks" and "the cult" were used before anyone said who they were.
  06 `scene_soup_tent` went onto the spine with masked helpers and Hessa saying "My friends from
  the Deep Hollow. The masks are for singing to the mountain." Each 07 variant says it again in
  its own first mention. "Cult" was dropped from the text entirely. Proof was the removal sweep,
  now `cohesion.mjs concept '\b(masks?|masked|cult|deep hollow)\b' --introduced-by
  gemfall-06/scene_soup_tent,gemfall-07l/scene_the_table,gemfall-07r/scene_masks,gemfall-07h/scene_price_board_ask,gemfall-07h/choice_the_race`,
  then a human read of the merge points carrying a mask reference.
- **Check 4.** `scene_ledger`: Pellam remembers the party instead of meeting them. Each
  `scene_road_gifts` got an ungated line reading back the party's record.
- **Check 3.** Four talking checks were rewritten as actions at the same stat and TN:
  `check_ledger` (carry the chained ledger, desk and all), `check_two_scouts` (hold the middle of
  the tug-of-war), `check_chord` (hum three notes back), `check_who_keeps_table`.
- **Pins.** Four hashes re-taken with a "Re-pinned for ..." comment; digests unchanged.

**#365, "mark the physical heart checks as doing".** Four `heart` checks whose prompts #364 made
physical got `"checkKind": "doing"`; 07l's spine went from 5/9 to 8/9 doing. Two calls worth
copying: `check_ledger` got no mark because `clever` already reads as doing, and
`check_who_keeps_table` stayed talking because the party asks and two others lift.

## Audit findings by check

| Check | Scene | Quote or finding | Kind |
|---|---|---|---|
| 1 | `gemfall-03b/scene_poling_in` | The boggarts appear before anyone mentions them | wording |
| 1 | `gemfall-03b` p1 | Relies on "the Gate", not shown until 12 scenes later | wording |
| 1 | `gemfall-03a` | "drake" is never explained | wording |
| 1 | `gemfall-04a` | An unannounced waystation | wording |
| 1 | `gemfall-05b/choice_elders` | "The Skywardens at Redspire Citadel": a Wild Road party never heard of either | wording |
| 1 | `gemfall-06` | "that seal" before the seal is shown | wording |
| 1 | `gemfall-08` | "cult" still used | wording |
| 2 | nearly every chapter | The opening has no goal; 02's has no destination; 04b's goal waits about 15 scenes | wording |
| 3 | `gemfall-02/check_wolf_kind`, `03b/check_ford_song`, `03b/check_patience`, `03c/check_play_mountain`, `04a/check_greeting`, `04b/check_calf_call` | `heart` checks whose prompts are physical: `checkKind: "doing"` | wording |
| 3 | `gemfall-02/check_reroute` | A talking check; making it doing means a new stat | graph |
| 4 | 03a, 04c, others | Ossley, Fennick, Wend, Pellam and the bell-code expert re-met as strangers | wording |
| 4 | `gemfall-04b` | Nothing on the ungated spine remembers 3B or 3C | wording |
| 4 | `gemfall-06` | The "whole truth" beat never reads the party's own choices back | wording |
| 4 | `gemfall-08` | The dragon never answers the verdict; no ending reads motive, allies or cult | graph (a reply scene per answer) |
| 5 | `gemfall-03c` | The middle is heavy with strangers; the p1 is diluted | wording |
| 5 | `gemfall-02` | Hesper's caravan vanishes | wording |
| 6 | `gemfall-01/scene_motive_duty` | "He just fills a fourth bowl": counts the party | wording |
| 6 | `gemfall-05a` | "spiralling": UK spelling | wording |
| 6 | 02 and others | "round" for around, crisps, teatime (`cohesion.mjs idioms`) | wording |
| setback | `gemfall-08` | A first failed tether check reaches Broken Tether; a failed `check_keystone` reaches Turned Back. Last Ring should come only from `clock_late`, Turned Back only from empty hands | graph |
| setback | `gemfall-05c` | Failed `check_one_rule`, lost `encounter_crabs`: `end_rolled_down` in 8 scenes, beat skipped. Reroute at a cost | graph |

## What a good ungated callback looks like

The audit's model is Marda's rumor board in 02 (`rest_marda_inn` and the scenes off it): a
callback every party can safely get, with no gate. Pellam's record lines in 07
(`scene_road_gifts`) do the same with the party's own declaration. Gated callbacks on top of
those are a bonus.

## Riftlight: a full session with varied play

The buried bridge's first draft repeatedly explained a task, offered two plans,
rolled, described the result and repeated. There were 84 authored scenes. The
first rewrite removed that repetition but cut the adventure to 16 scenes and
an 18-minute target. That solved the wrong part of the owner's complaint: they
still wanted about thirty minutes, with different elaboration and better play.

The next revision designed a full expedition with 37 scenes across its branches:
preparation, investigation, an incoming tide, recovery and a useful handoff.
The important change was what occupied the time:

| Decision | Play and consequence later in the chapter |
| --- | --- |
| Build a fixed viewing rail or a portable sled | Relay or balance during construction; rail-supported lifting or sled balancing/carrying during recovery. A later explicit change of plan can dismantle the rail. |
| Save drawings or secure the return path first | Keep precise drawings but rebuild washed-out route markers, or keep the path marked but reconstruct wet notes with fine measurements still missing. |
| Give the careful copy to local visitors or to Orin's research | Build and test a public viewpoint, or prepare and relay a research copy while closing the work area for a later visit. |
| Share chime readings or keep them private | Preserve the existing campaign consequence; neither copy destination silently shares private readings. |

The class-assisted paths retain ten activities across at least five mechanics.
Those counts describe this implementation, not a template for other chapters.
The controls include shared clues, observation timing, tracking a sample pot,
cooperation, balance, memory, relay and playful contributions. Humor comes from
Orin's brush, sample labels, notebook and sandwiches rather than longer speeches.

Sixteen route tests cover equipment, rescue priority, copy destination and party
size, including missed timing and memory challenges. They check different tasks
and conclusions, not merely different flags. Continuity tests cover the other
routes and protect the required river discovery. The thirty-minute time budget
is still a planning estimate until a family playtest measures it.

See the [playtest plan](../../../../docs/campaigns/continental-rift/buried-bridge-playtest.md),
[design audit](../../../../docs/reviews/riftlight-play-audit.md), and
[engine route tests](../../../../tools/content/riftlight-bridge-play.test.ts).
