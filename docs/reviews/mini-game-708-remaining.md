# Mini-game gameplay pass: the remaining #708 activities

Completes the reading list left by #766. This pass reviews all 36 named activities:
21 have revised controls or consequences, and 15 deliberately retain their gentle
outcomes. The earlier tooling and 7L work remains covered by its original report.
The user authorized completing the remaining pass on 2026-11-13.

## Revised playable situations

Every game continues to use the shared controls, feedback, near-miss recovery,
reduced-motion controls, relaxed mode, help and retry. No shared scoring rule or
new game kind is introduced. Bruises apply only on continuation after exhausting
the attempt, not on each recoverable error; they cannot down a one-HP hero.
The two tips are one shared coin each, not a coin per seat. Help earns the same
benefit as success. The new crossing option uses an existing check and never
removes the ordinary crossing choices.

| Activity | Decision and consequence |
| --- | --- |
| `gemfall-07r/interaction_haul_team` | Smooth shared pulls; exhausted strain costs one nonlethal HP per hero. |
| `gemfall-07r/interaction_return_handover` | Smooth wagon bracing; a failed handover bruises knees but preserves the earned stone. Rope replaces the hoisted wheel. |
| `gemfall-07r/interaction_trickle` | Read gaps between stones; a rough crossing stings shins for one nonlethal HP. |
| `gemfall-08/interaction_chimney` | Timed climbing replaces the unsupported split-role rope promise; a rough climb scrapes knees. |
| `gemfall-08/interaction_restore_brace` | Shared bracing-cord pulls; a failed brace has the same one-HP scale as the nearby hold check. |
| `gemfall-08/interaction_leash_transfer` | Aim passes along the line; exhausted chances drag the party for one nonlethal HP, without closing a finale philosophy. |
| `gemfall-01/interaction_letters` | The clerk tips the crew one coin for a clean or assisted rescue; a missed rescue earns no tip. |
| `gemfall-01/interaction_newcomer_load` | The family gives one thank-you coin after a clean or assisted carry; a spilled trunk spends their spare coin on string instead. |
| `gemfall-03b/interaction_reed_gap` | A rough raft crossing scratches arms for one nonlethal HP; Gullet still gets the party through. |
| `gemfall-04c/interaction_gate` | A mistimed crossing bruises shoulders for one nonlethal HP; the road remains open. |
| `gemfall-05a/interaction_crossing_signal` | Correct or assisted flags earn a visible flag-guided choice to the existing quieter crossing check. Failure now has words and retains all ordinary crossing options. |
| `gemfall-05b/check_bridge_test` | A lost balance jolts shoulders for one nonlethal HP; the plank and route remain usable. |
| `gemfall-05b/interaction_stones` | A badly timed hop knocks shins for one nonlethal HP; recovery reaches the bank. |
| `gemfall-05c/interaction_bell_cart` | A rough push bruises elbows for one nonlethal HP; the grandmother recovers the cart. |
| `gemfall-07h/interaction_hairpin` | A mistimed dash bruises shoulders for one nonlethal HP; the next gap gets everyone through. |
| `riftlight-ashspan-bridge/carry_beam` | Shifting-load balance; a failed carry pinches fingers for one nonlethal HP, without injuring the goat. |
| `riftlight-boundary-stone-bank/surge_check` | Failed relay loses the kettle and sets the existing kettle_lost consequence, including Tally's downstream response. |
| `riftlight-frostfang-shore/ladder_hold` | Timed climbing replaces the nonexistent hold/climb role split. Tamsin secures the ladder; a rough climb bruises shins. |
| `riftlight-glacier-survival/shelf_cross` | A mistimed stream crossing bumps shins for one nonlethal HP; the herder plants the pole. |
| `riftlight-stone-counters/turnip_relay` | A lost relay sends turnips into the fold, sets the existing loss flag and reaches past instead of the every-last-turnip story. |
| `first-steps-01/interaction_roots` | Everyone makes smooth shared pulls; Bun fetches her own ribbon. Practice remains forgiving. |

## Gentle scenes retained after review

A soft miss is not always a defect. These games already give a readable response
and serve a lesson, joke or relationship. The underlying v2 controls still allow
mistakes and recovery. This pass does not attach an injury or charge to a playful
calf, a teaching elder or a friendly answer to the creature under the seal.

| Activity | Reason to retain its authored outcomes |
| --- | --- |
| `gemfall-08/check_hum_note` | A friendly reply to a sleepy creature, not a punishment gate; a squeak gets a warmer answer. |
| `gemfall-08/check_hear_titan` | Listening reveals a question; the Keeper explains a missed interpretation without changing access to the finale. |
| `gemfall-03b/interaction_runes` | The protected Gate demonstrates its pattern again; this is a clue lesson, not a lock. |
| `gemfall-03b/interaction_ribbon_duck` | The jingling hats and polite cousins are a short comic crossing, not another toll. |
| `gemfall-04a/interaction_ridge_creep` | The hidden cubs laugh at a snapped twig; the scene introduces their playfulness. |
| `gemfall-04a/interaction_wolf_trail` | A cub corrects the mistaken tracks; the essential crater clue stays available. |
| `gemfall-04b/interaction_calf_hide` | The calf deliberately plays hide-and-seek; finding a frog is the joke. |
| `gemfall-04c/check_relay` | Telephone-game confusion is the joke; finding Tib is not withheld after the family asks for help. |
| `gemfall-04c/interaction_verses` | Corran is teaching the road verse and corrects it kindly. |
| `gemfall-04c/interaction_courier_pattern` | The mistaken cake message is the authored comic consequence. |
| `gemfall-05a/interaction_level` | An engineering calibration demonstrates the uneven approach; spilled water is feedback, not injury. |
| `gemfall-06/interaction_moth_trail` | A playful moth reveals itself; its trail clue remains available. |
| `gemfall-06/interaction_tags` | Pellam corrects a clerical mistake before the truth-table conversation. |
| `gemfall-02/interaction_jackalope_hats` | The sneezing wrong hat and obliging leader are a deliberate joke. |
| `riftlight-glacier-survival/kid_burrow` | A rescued kid plays in the snow and sneezes; rescue is never undone by losing hide-and-seek. |

## Riftlight's result narration

The additional cases in the issue were read through their destinations:
Stuttering Flats `watch_blink`, `float_dig`, `cross_rhythm`, `cross_crest` and
`cross_float`; Buried Bridge `wash_out`; Exchange Rift `ridge_walk`.
Their success and failure branches already reach distinct, narrated scenes:
`read_done/read_rough`, `floated/floated_late`, `goat_home/goat_bolts`,
`washed/washed_twice` (Buried Bridge), and `ridge_ok/ridge_drift`.
The following scene gives the result before the routes rejoin, so no duplicate
result sentence or new game was added. Existing real-action and route suites
exercise these outcomes.

## Compatibility and voice

All 21 revised activities keep their original scene, controls, branches and effects
in `resumeInteractions`. Each revised spec has a distinct cue so fresh and saved
attempts cannot be confused. Original archive hashes are pinned independently;
existing Gemfall archive hashes were not replaced. Serialized saved attempts are
played through success, failure, assistance and retry at one, two and four seats,
including storage-reordered spec keys. The same continuation flags, party health,
items and purse are compared with the original contract.

Nine Gemfall chapter play pins intentionally change for new consequences, controls
or the flag-guided choice. Ending, road, setback and resumed-game digest expectations
are untouched. Retired activity controls and continuation targets are retained.
Changed scripts are refreshed; stale recorded takes are removed from active manifests
so old words never play over new ones. Approved clip-lock entries and stored audio
bytes are retained. No ElevenLabs key is available here, so affected new words use
device voice until replacement takes are recorded. This is not a fully re-recorded
voice delivery.

## Shape diagnostic

Before and after use the same corrected v2 classification from #766.
Counts are diagnostics; intentionally gentle scenes need not reach zero inert games.

| Chapter | Inert before | Inert after |
| --- | ---: | ---: |
| `gemfall-01` | 3 | 1 |
| `gemfall-03b` | 3 | 2 |
| `gemfall-04c` | 4 | 3 |
| `gemfall-05a` | 3 | 2 |
| `gemfall-05b` | 3 | 1 |
| `gemfall-05c` | 2 | 1 |
| `gemfall-07h` | 1 | 0 |
| `gemfall-07r` | 3 | 0 |
| `gemfall-08` | 5 | 2 |

## Presentation and verification

All 36 activities were rendered on a 1280x720 TV and a 320x640 phone: 72 screens.
All visible board images decoded; none of the TV boards scrolled or overflowed.
The contact sheets were visually reviewed, as were full-size climbing controls and
the corrected wagon-bracing foreground. Captures use reduced motion to keep the
subject still; interactive browser cases separately exercise actual controls.
The following sheets cover the inventory in order, with TV and phone paired:

- [7R, finale and letters](https://assets.kd.readysetcloud.io/sha256/fe/fe869bb047a144dfd7fbf44a013e0e7c2e9002fe0c31bd1f9cdadc04b9e62261.png)
- [Early Gemfall and the Rush Road](https://assets.kd.readysetcloud.io/sha256/e6/e63f4eca6649bc8295eb487229ed6016cc3d2febe0e32538e8cff0b981840b56.png)
- [Verses, crossing and foothills](https://assets.kd.readysetcloud.io/sha256/79/799a77425a0ee135d4df85fb737ae9889a4cab2a03d8aa0cc5b26b329f0f5293.png)
- [7H, Riftlight and Practice Meadow](https://assets.kd.readysetcloud.io/sha256/11/11a82a6a58714be12f9eb3c9ad018f786928586467e011d80df3fe2fb2008ac1.png)

The screenshots are stored through MCP; Git keeps their lock entries only.
No game art or generated painting was added.

Browser regressions drive the two new climbing games and the crossing-signal lesson
through real phone controls. They cover poor and clean climbs, reload during recovery,
health applied only on continuation, the short phone, TV board containment and the
earned crossing option. Three new browser cases pass. The final focused engine/save/
audit group passes 52 tests. Content validation passes (218 checks, five existing
warnings); continuity has zero new candidates. Typecheck and production build pass.
Asset-store verification passes for all 3,740 lock entries, including the four
review sheets, and all 17 Gemfall play pins match.

Full Windows `npm test`: 12,166 passed, 27 skipped, 17 failed and one collection
error. One failure was the outdated active-kind coverage assumption after replacing
Riftlight's last cooperation scene; the corrected test retains coverage through its
saved ladder and passes in the final 52-test focused run. The remaining 16 failures
and collection error are in unchanged asset file-URL/provenance and CRLF-sensitive
infrastructure tests. No all-green local full-suite result is claimed; Linux CI is
the merge gate.

These are engine, browser and visual checks. They are not family-playtest evidence.
Timing fairness's real-device acceptance remains separately tracked in #566.
