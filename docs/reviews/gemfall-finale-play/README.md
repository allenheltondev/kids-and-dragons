# Gemfall finale: answer together, then live with the answer

Eighth authored wave from the [campaign audit](../gemfall-play-design/audit.md), reviewed against the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). The draft's four new activities fit the intended direction, but its timing exception, empty-handed Restore route and verification were incomplete. This revision completes the local authored review, preserving the shipped endings and pursuit advantages. The upstream opening, Ashfall and pursuit PRs are merged; the branch includes current main and #534's CI proof-timeout fix.

## Alignment audit and corrections

| Finding in the draft | Correction |
| --- | --- |
| Declared 55 minutes and planned 39–52, despite the family's approximately thirty-minute brief | Restore the declared target to 30, budget a thirty-minute sitting and shorten repeated approach/result prose. This is intent, not evidence of achieved timing; the model still predicts longer routes below. |
| Carried-stone Restore gains an activity, but empty-handed families still only have old rolls | Add a cooperative brace specifically for empty-handed parties. Carried facets instead open matching by hum. Old rolls remain available, and every party can finish. |
| Verdict tests only check entry, not whether one hero can submit for silent friends | Exercise premature completion after one contribution, then require every connected hero's contribution before ordinary completion at two/four seats. Solo completion and assistance remain supported. |
| A generic carried-object response praises care regardless of what the player says | The dragon asks what changed because they carried it. Reflections are heard, not assigned an invented moral answer. |
| New tests inherit Riftlight's auto-seeded chime | Remove the unrelated quest item from Gemfall fixtures; whole-route tests assert it is absent. |
| New activities have mostly isolated tests; no local server/save evidence | Add complete one/two/four-seat routes, real supported misses, damage and resource assertions, philosophy closure/recovery tests, real-server settlement and old/new loader-based campaign probes. |
| Wheel activity paints an unrelated board; handover crowds dragon and helpers' labels | Use an existing pry bar at the latch and a rope loop for the relay. Put the relay participants Voss and Pellam before the large Keeper in the cast layout, preserving the commissioned figure. Inspect all five activities on TV and phone. |
| Cairn snack implies giving up an inventory item without a consuming effect | Make it explicitly pocket crumbs, a flavor contribution with no claimed item cost. |

The approach retains its route callbacks, faun's promise, wolf encounter, warden log, bell message, crab complication, moth rescue and last reflection. Shorter sentences reduce repeated elaboration; no new mandatory errand or timer was added. The opening activity now states the actual chapter goal before the first controls appear. The titan's question and the central priority-one revelation remain in the seal chamber.

## Decisions and consequences

| Moment | Real action / prior preparation | Result |
| --- | --- | --- |
| Keeper's verdict | Each connected hero contributes a memory, helper or intended choice | Ordinary completion waits for everyone; success/assistance records the existing `dragon_satisfied` flag and admits the party. The original honest roll, earned surprise/gatherer responses and explicit fight remain. Assistance can resolve the council together; it does not enforce individual contributions. |
| Restore with facets | Compare shared clues, then listen / fit / steady | Success/assistance reaches the last gap. An actual wrong sequence also moves forward, with the old one-point nonlethal sting on the resolving hero. |
| Restore without facets | Brace loose pieces while the Keeper joins them | Cooperation and solo props supply an ungated-for-empty-hands practical job. A carried-stone party uses its own matching option instead. Original Clever/Might risks remain. |
| Last gap | Give the rush gems, sing the lullaby, or honor the carried little stone | Existing final choices, Keeper response, quiet ending and epilogue remain. No die undoes an already completed matching/brace activity. |
| Destroy | Release the moving latch with a precision action | Success/assistance turns the wheel; a miss proceeds with the Keeper's help and the existing nonlethal sting. Before voting, the party is told this ends the titan's song permanently. |
| Prepared warden control | The carried `told_wardens` flag brings a relay line | Pass the leash into Voss's hands and reach the existing cage/oath ending. The ordinary warden handover retains its old risk. The new relay has no failing player action. |
| Self / choir control | The declared Tether pursuit retains its easier old checks | A first failed hold offers release or a further risk. Release closes Control and preserves other philosophies; deliberately risking another failed hold reaches Broken Tether. |
| Exploit | Collection pursuit retains its direct Keystone lift; others must pry | The crown is actually granted on success. A failed pry stings, closes Keystone and lets the party choose another philosophy. The Keeper's resulting burden is stated before taking it. No extra activity taxes the earned collection advantage. |
| Late door recovery | Spend a carried facet to wedge the door, or use remaining time | The old consuming effect removes a real facet. A late, empty-handed party retains Last Ring. Lost stones do not reappear through the new activities. |

All four philosophies are offered initially for every pursuit and inventory size. A failed and abandoned Control/Keystone route closes exactly as shipped. No new persistent flags, encounter numbers, terminal rewards or ending semantics changed. Existing motif/ally/road/clock readbacks remain. The final quest inventory continues to serve the shipped historical collection/recap convention; this pass does not delete those historical facet records after Restore. Actual costs verified here include damage, the door wedge, Keystone acquisition/refusal and the preparation-dependent risks.

Cooperation, relay and free contribution cannot produce a failing player action. Their defensive `onFailure` branches are not claimed as executable misses. The mixed miss profile uses genuine wrong sequence/memory/precision/timing actions and completes the other kinds. Assistance is an explicit alternative. Story decisions remain untimed.

## Timing: thirty-minute target, unresolved measurement

The draft's 55-minute declaration and 39–52-minute planning envelope were not an authorized exception to the user's target. The new **planned** budget is 6 minutes climbing and helping; 7 gallery and Keeper; 9 seal and philosophy; 8 result, recovery and goodbye. `estimatedMinutes: 30` records that intent only.

| Static diagnostic | Draft before this review | After |
| --- | --- | --- |
| Shortest predicted minutes | 46.6–47.1 | 45–45.4 |
| Typical predicted minutes | 50.8–51.9 | 49.1–50.3 |
| Shortest scenes / votes / checks / fights | 46 / 19 / 9 / 1 | 46 / 19 / 9 / 1 |
| Typical longest reading run | 2 | 2 |
| Shortest composed words | 2552–2970 | 2340–2758 |

**Outstanding design acceptance: [issue #536](https://github.com/allenheltondev/kids-and-dragons/issues/536)** tracks structural consolidation of mandatory approach beats and efficient/engaged 1/2/4-seat family calibration. Code approval of this PR does not close that issue or accept the duration target.

**The thirty-minute duration is not established.** The static model excludes some flag-gated shortcuts and authored interaction time. It also includes synthetic repeated voting and dice estimates. These limits do not justify subtracting guessed minutes. Optional dragon/gallery combat and four-player reflection can make the sitting substantially longer. Use the [revision-aware session tracker](../../session-timing.md) to time efficient and engaged routes before claiming the target is met; further compression may be needed. No household timing was fetched, and no playtest fun or timing result is claimed.

## Verification and legacy saves

The immutable fixture retains all **27 original check definitions**, including IDs, prompts, stats, TNs, rollers, art, branches and effects. Low/high rolls resume serialized prompts at one/two/four seats. Only chapter 08's file hash is re-pinned; fixed legacy saves and gameplay digest constants remain unchanged.

Old/new trees loaded through the real loader match endings, roads and setback digests against pre-wave `d8296310`. Resumed fight play matches after normalizing only generated hero IDs. Content graph generation and merge/setback review completed. Structural setback lower bounds remain compound failures: lost dragon plus failed claw hold for Turned Back; lost gallery/race pressure plus failed last door for Last Ring; failed hold plus chosen failed haul/chord recovery for Broken Tether. Existing resource/time escape choices remain.

The chapter suites exercise complete entry-to-ending story controls for all philosophies at one/two/four seats, successes, supported misses and assistance; carried and empty-handed Restore; all pursuit access/advantages; council participation; nonlethal damage on the resolving hero; real door-wedge consumption; failed Control release versus further risk; and failed Keystone closure. Combat branches in these walkers are enumerated. The separate 53-case real-server playthrough suite plays the unchanged boards, including empty and full collections.

Twelve new real-server cases start each pursuit, use actual new verdict/philosophy controls and commit the reached ending. An unprepared failed Keystone route recovers through Destroy and still completes. The cases isolate the finale with playtest jumps; they do not replace complete-route tests. They assert campaign completion at beat eight, retained campaign flags/coins and no leaked local verdict flag.

422 focused content/flow/interaction/save/voice tests pass; typecheck passes. Content validation: 117 passes with four existing Riftlight warnings. Continuity: four allowlisted candidates, no new or stale entries. Voice source metadata was rebuilt; all existing profile, assignment and review-history fields match main, with only derived chapter membership refreshed. Curated voice sample scripts pass unchanged. No paid voice generation occurred.

The broad local run recorded **10,626 passing tests, 11 skipped and three failing tests**, plus the existing Windows dev-server cleanup-hook timeout. Two failures were the known Windows `npx` / `.bin/tsx` launch errors. The third exposed the old artwork appearance count (82); the five new Keeper activities make it 87. That assertion is updated, with every commissioned Keeper figure retained. After the correction, **497 targeted tests pass**, including all 53 server campaign playthroughs, content/flow/interactivity, save compatibility, voice samples and the artwork assertions. The three CRLF-sensitive inputs were tested using exact LF Git blobs and restored in `finally`; no unrelated normalization is committed. The full suite was not repeated after that count-only test correction. CI must validate the pushed head. Gemfall is ordered, so no graph-campaign proof artifact is changed.

## Art and device review

No new artwork is needed. Existing seal chamber, Keeper, Voss, Pellam, humming stone, stone board, pry bar and rope loop cover the jobs. The relay places Voss and Pellam before the large Keeper in the cast layout, so their names stay readable. All new art IDs and files are checked.

Actual TV 1920×1080 and phone 390×844 captures were inspected:

- [Council TV](interaction_verdict_council-tv.png) / [phone](interaction_verdict_council-phone.png).
- [Carried-facet matching TV](interaction_restore_fit-tv.png) / [phone](interaction_restore_fit-phone.png).
- [Empty-handed brace TV](interaction_restore_brace-tv.png) / [phone](interaction_restore_brace-phone.png).
- [Wheel latch TV](interaction_wheel_latch-tv.png) / [phone](interaction_wheel_latch-phone.png).
- [Prepared handover TV](interaction_leash_transfer-tv.png) / [phone](interaction_leash_transfer-phone.png).

The isolated solo preview temporarily stages chapter 08 as index 1 for capture; shipped campaign order is unchanged. Phone captures show actual Your turn controls with ordinary scrolling; longer clue controls continue below the fold. Relaxed-mode screenshots show the wider precision window. Ordinary household saves were not used.
