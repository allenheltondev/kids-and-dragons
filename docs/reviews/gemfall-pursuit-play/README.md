# Three pursuits, three ways to play

Seventh wave from the [Gemfall audit](../gemfall-play-design/audit.md), using the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). Revises 07R, 07H and 07L. Built on approved #533 and #531, which are still open; this PR targets main and includes those dependencies until they merge. The new wave begins after `8f74c8dd`.

## Decisions that change play

| Pursuit / preparation | What the party does | Reachable consequence |
| --- | --- | --- |
| Return: carry together | Brace sacks while the load moves, then level the pile at the shelter | An ungated practical alternative to the old risky carrying roll. Shelter rewards still come from the existing stacking activity. |
| Return: sign or marked wagon, plus an answered bell call | The sign gets the master's agreement; scouting meets the correct wagon. Each has its own result before the shared handover. | A successful or assisted bell call records `caravan_listening`. With either preparation, brace the wagon and unload the agreed return, without another die undoing the work. A missed call leaves the original negotiations and ally options available. |
| Collection: compare chalk notes | Share cause-and-effect clues: loud hum, worried buyers, lower offers | Success or assistance earns the existing `loud_is_cheap` bargain option at the bend. A miss receives the explanation but misses the changing price; another plan remains. No arithmetic skill is required. |
| Collection: watch the wagon, or befriend the mules | Track the glowing load through three moving wagon positions, or use the existing mule visit | Tracking success/assistance earns `knows_middle_wagon`, used by the existing direct approach. A miss keeps the offer and other preparations. Mule friendship keeps its distinct whistle approach. |
| Collection: sell, refuse, return | Read the cost before voting | Sale grants the existing 30 coins and funds the break with a late clock. Return steadies the clock. Both concern ordinary stones traded at the Pinch; great facets remain in inventory. Empty-handed parties get accurate wording. |
| Collection: climb or Walk | Choose the mountain, or leave the realm to act without you | Climb still leads to chapter 08. Walk still ends here, with both authored epilogues, its 60 XP, campaign completion and committed character progress. Selling is a modifier, never a third exit. |
| Tether: quiet voices | Hear a question, worry or hope from every hero at the evening meeting | Earn `table_works`, then call on the visitors' promised help for a cooperative wagon test. |
| Tether: faces showing | Steady the door-table while a warden and a singer make room | Earn `two_helpers`. They arrive in their own result scene and brace the test with you. |
| Tether: bring something to share | Relay soup across the table | Earn `table_works` through a different job. The table rule is a local preparation, not a new persistent campaign promise. |
| Tether: practice | Aim for the calm part of a small hum | Success/assistance earns `practiced`, opening a wider precision window at the wagon (0.50 versus practice's 0.35). A miss does not invent preparation. The bigfoot work/practice shortcut remains. Successful or assisted practice visits the unchanged legacy result scene; there is no duplicate automatic-practice choice. |
| Tether: ledger or chord | Put listen / hold / release limits in order, or echo the choir's notes | These now play differently instead of selecting the same roll. A supported miss loses the wagon to the masks and sets the late clock; success/assistance earns the original stone and steady clock. |

The original witch-question, road callbacks, borrowed instruments, species/class paths and bare-hands risks remain. No ungated easier normal-hold roll was added beside the hard fallback. All four chapter-08 philosophies remain available; this wave does not change the finale. Only existing route-set flags persist. New `caravan_listening` and all table/practice preparations stay local.

Cooperation, relay and free contribution have no failing player action. Their defensive `onFailure` branches continue the story with help, but are not claimed as executable misses. Incomplete work cannot grant the stone, clock or table agreement. Precision, sequence, tracking and memory tests use actual supported wrong actions, plus success and assistance. Decisions are untimed; no artificial countdown or retry is required.

## A thirty-minute plan, with timing still unresolved

Planned movements (minutes, not measured family results):

| Pursuit | Opening / plan | Road consequences / preparation | Caravan complication / test | Closing decision / payoff |
| --- | --- | --- | --- | --- |
| Return | 6 | 8 | 9 | 7 |
| Collection | 6 | 7 | 9 | 8 |
| Tether | 7 | 8 | 9 | 6 |

The Walk is an intentionally different ending with its own epilogue. An engaged conversation or a second fight can exceed the ordinary budget. These plans include reading aloud, discussion and each hero's activity turns; they are not proof of thirty minutes.

The static model remains materially higher and does not budget interaction time or establish reachability of local preparation shortcuts:

| Chapter | Before shortest / typical predicted minutes | After shortest / typical predicted minutes |
| --- | --- | --- |
| 07R | 41–41.3 / 39.3–39.6 | 41–41.2 / 39.3–39.6 |
| 07H | 34.6–34.8 / 40.8–41.1 | 34.8–35 / 41.5–41.8 |
| 07L | 38.5–39.3 / 41.1–42.3 | 38.3–39.1 / 41–42.4 |

Shortest modeled scene totals remain 39 / 38 / 39 for R/H/L; longest typical reading runs remain 2 / 3 / 2. We did not relabel `estimatedMinutes` as evidence or subtract guessed minutes for shortcuts. Use the [revision-aware family tracker](../../session-timing.md) to measure efficient and engaged routes, including four-player discussion. No observed household timing was fetched for this review. Timing calibration remains outstanding after the authored pass.

## Compatibility and verification

The immutable fixture records all **40 shipped check scenes** from `8f74c8dd`: 15 Return, 12 Collection, 13 Tether. Every prompt, TN, stat, roller, branch, effect and art value is unchanged. Tests serialize open prompts and resume low/high rolls for one/two/four seats. Only the three edited chapter hashes are re-pinned; gameplay digest constants and the fixed pre-epic save remain unchanged.

Old and new content trees, both loaded through the real loader, match endings, roads and setback digests. Resumed fight play matches after normalizing only generated hero IDs. All ending rewards, encounter numbers, old trades and Walk ending effects remain. Ordered Gemfall does not use graph-campaign proof artifacts.

The new suites contain 115 chapter cases and 15 real-server settlement cases. Complete story-control routes cover success, assistance, actual supported misses, missing preparation, original negotiations, earned caravan options, each table rule, each playable instrument, coin spending, food consumption and class/species options at one/two/four seats. Optional instrument goal steps are treated as optional. Acquired ledger/chord routes use the actual old acquisition checks, rather than injecting instruments. These route tests enumerate unchanged combat branches; the separate full-server playthrough suite plays their boards.

Settlement cases exercise the actual assisted handover followed by settlement, replacing each incoming clock member and reaching chapter 08. Walk cases use actual sale/refusal/return choices and continue the authored epilogue through campaign completion, checking all three incoming clocks, retained road flags and committed XP. They use playtest jumps to isolate these contracts; they do not replace complete-route controls or the full-server campaign suite.

Content validation: 117 passes, four existing Riftlight warnings. Continuity: four allowlisted candidates, no new or stale entries. Typecheck passes. The voice cast was rebuilt with every existing assignment, profile and review-history field preserved; there is no derived cast diff and no paid voice rendering.

The pre-review broad run recorded **10,477 passed, 11 skipped and three failed tests**, including all 53 real-server campaign playthroughs passing. The remaining failures are the existing Windows `npx`/`.bin/tsx` launch errors in traits/voice-clean and the dev-server SIGTERM save-flush assertion (plus its cleanup-hook timeout). For this run, the three known CRLF-sensitive inputs were temporarily replaced by their exact LF Git blobs; their tests passed and the original local bytes were restored in `finally`. No unrelated normalization is committed. The pre-review 118 pursuit route/settlement cases also passed separately, including the marked-wagon handover. CI must validate the final branch on its normal host.

## Art and visual review

No new images are needed. New presentation entries reuse the painted wagon wheels, humming stone, stone board, paper scroll, door on barrels, soup bowl and three wagon covers. The tracking target is visible only during the runtime's peek or accessibility hint; distinct moving paintings use positional answer labels. Backgrounds use the existing caravan road and door-table scenes; the unpainted clue comparison uses the chapter environment.

Inspected actual TV (1920×1080) and phone (390×844) captures:

- [Return handover TV](interaction_return_handover-tv.png) / [phone](interaction_return_handover-phone.png).
- [Collection wagon tracking TV](interaction_wagon_watch-tv.png) / [phone](interaction_wagon_watch-phone.png).
- [Tether quiet council TV](interaction_quiet_council-tv.png) / [phone](interaction_quiet_council-phone.png).

The isolated solo preview temporarily stages each chapter at index 1 for screenshots; shipped order is unchanged. Phone images show the actual Your turn controls using normal scrolling. Captures use relaxed mode, so the tracking answer hint is intentionally visible. Ordinary household saves were not used.


## Review fix: practice has to be earned

Removed the ungated `quiet_practice` duplicate rather than charging an invented cost. Ordinary parties now choose between helping the cart (the original bead reward) and playing the small-hum precision activity (preparation on success or assistance, none on a miss). The species-gated bigfoot shortcut remains earned through its existing capability.

The unchanged `scene_returning_cart_practice` is reached after successful or assisted practice. A save already waiting there retains its `practiced` flag and goes straight to tea, without replaying the activity. New regression cases contrast the offered choices, flags, bead rewards and later prepared-test access for success, a supported miss and assistance at one/two/four seats. Three additional serialized-save cases preserve the old result scene and onward choice.

Review verification: 391 tests pass across route, settlement, flow, interaction, compatibility and all 53 full-server campaign playthroughs; typecheck, validation and continuity pass. The shortest static estimate remains 38.3–39.1 minutes; typical moves from 40.9–42.1 to 41–42.4, with 40–41 modeled scenes. This remains uncalibrated and does not establish the thirty-minute family target. No artwork or presentation changed.
