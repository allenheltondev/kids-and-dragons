# Riftlight balance revision

## Finding and scope

Initially screened all 24 Riftlight chapter files. The previous correction replaced repeated roll chains with repeated activity chains in twelve chapters. Tests required ten games across five mechanics on the bridge and similar floors elsewhere. Different widgets still produced the same repeated demand for a performance before the next story beat.

Revised those twelve chapters. The other twelve opening/travel chapters were only screened in this pass. They have since received a detailed review and revisions in [the remaining-chapter review](riftlight-remaining-balance.md). Neither pass claims measured ideal pacing. No chapter must include all five modes or an equal share of each.

## Changes

Routine sorting of stated answers, report handoffs, cleanup and several participation gates become story or ordinary expressive choices with character replies. The equipment, rescue priority, evidence quality, privacy, ownership, resource costs, discoveries, combat and endings keep their actual consequences. Expressive choices receive different replies but are not counted as major consequential branches.

The bridge retains construction, looking under the arch, watching the tide and using its selected equipment as direct play. Sample comparison, reconstructing wet notes and the research handoff now unfold as story. The local viewpoint has a trial conversation. Original measurements stay dry only if rescued; reconstructed notes do not regain their lost precision. Private chime readings are not shared by the copy handoff.

Four uncertain observation scenes become dice checks: the spray-obscured river observation and three alternate island-measuring approaches. A route uses one of those island rolls, not three. Existing success/failure state and destinations remain: a missed river view leaves gaps in the record; a missed island measure requires an alternate landing plan. No completed game result is rerolled. The quiet bridge mystery needs neither a fight nor a dice roll to approve evidence already earned. Existing fights elsewhere remain.

Counts below cover authored alternate branches, not the activities required of a family, and are not balance targets.

| Chapter | Games before | Games after | Dice checks after |
| --- | ---: | ---: | ---: |
| A Bridge Without a River | 19 | 9 | 0 |
| The Whales' Turning Place | 19 | 14 | 0 |
| The Stone That Moved | 20 | 13 | 0 |
| The River Takes Another Valley | 21 | 15 | 4 |
| The River in the Memory Ice | 19 | 13 | 0 |
| The Island Due Back | 35 | 23 | 3 |
| The Stuttering Flats | 21 | 18 | 0 |
| The Temple in the Squall | 20 | 17 | 0 |
| A Room Already Taken | 18 | 16 | 0 |
| The Borrowed Ruins | 23 | 17 | 0 |
| The Maps Come Together | 21 | 17 | 0 |
| The Glacier Remembers | 28 | 21 | 0 |

## Route rhythm and timing

Some revised shortest routes contain four or five brief reading scenes, notably meeting the whale keeper, closing the island dispatch, and recording the valley recovery. These breathing spaces should be assessed in family play rather than filled with token votes. Continue controls remain; discussion can happen aloud without a timed prompt or widget. The major tradeoffs still change later tasks and outcomes.

The thirty-minute metadata remains a target. Removing routine games may shorten actual sessions. The uncalibrated pacing model omits authored game time; it cannot establish a thirty-minute sitting either before or after this revision. Fresh family measurements are needed, especially on the bridge and convergence. Do not fill a short session with replacement chores.

### Static pacing before and after

Shortest-path diagnostics below omit game time. Predicted increases can reflect ordinary dialogue choices replacing uncounted widgets. They are not observed family durations.

| Chapter ID | Scenes before -> after | Longest reading run before -> after | Predicted minutes before -> after |
| --- | ---: | ---: | ---: |
| buried-bridge | 25 -> 26 | 2 -> 3 | 18.6 -> 18.2 |
| whale-road | 23 -> 23 | 3 -> 5 | 13.3 -> 13.4 |
| stone-counters | 25 -> 25 | 3 -> 4 | 17.6 -> 16.7 |
| the-wrong-valley | 25 -> 26 | 2 -> 5 | 15 -> 16.6 |
| reading-room | 35 -> 36 | 3 -> 4 | 22.6 -> 23.2 |
| the-island-due-back | 43 -> 45 | 2 -> 5 | 24.8 -> 27 |
| stuttering-flats | 27 -> 29 | 2 -> 3 | 13.7 -> 15.3 |
| squall-temple | 26 -> 27 | 2 -> 2 | 19.5 -> 20.4 |
| wyrm-nest | 25 -> 27 | 2 -> 2 | 18.4 -> 20 |
| bone-yard | 28 -> 31 | 1 -> 2 | 20.1 -> 22.4 |
| convergence | 24 -> 26 | 2 -> 3 | 12.1 -> 13.6 |
| finale | 25 -> 28 | 3 -> 3 | 19.9 -> 22.3 |

## Authoring and verification

The chapter cohesion skill now reviews story, dice risks, choices without games, choices with games and combat along efficient, engaged and recovery routes. It rejects mandatory mode coverage, equal shares and game/mechanic quotas. Its worked bridge example and playtest plan no longer teach the ten-game requirement. The earlier audit is explicitly labeled historical.

Removed activity and mechanic floors from tests while retaining route, equipment, evidence, privacy, costs, goals, combat, recovery and ending assertions. Added continuity reviews for the new response scenes and updated evidence quotes where rewritten introductions still establish the same facts. Existing engine matrices exercise solo and multiplayer, misses and assistance. Graph proofs were regenerated; the campaign-level proof remains unchanged because this revision does not change its reachable journey states.

Verification outcomes are recorded in the PR. No family timing observations were collected for this revision.

### Verification result

- Type checking, content validation (117 passes, four existing warnings), continuity (zero new/stale findings), graph-proof regeneration and skill validation pass.
- Final full test run: 10,618 passed, 11 skipped, six failed tests plus the dev-server suite cleanup error. All Riftlight tests pass.
- All six failing tests reproduce in the original checkout: figure-size generated-file CRLF comparison; `npx` spawn on Windows; authoring-guide fenced-example extraction; dev-server saved-location assertion and cleanup timeout; voice-clean `tsx` executable lookup; profile-field extraction expecting LF source endings. They are outside this chapter change and are not suppressed.
- The complete Riftlight matrices cover 3,680 tests, including response-scene continuity, real interaction controls, all route combinations used by the existing suites, misses, assistance and solo/multiplayer. The final full run includes the corrected ordinary handoff test.
- Family enjoyment and thirty-minute duration remain unmeasured. The old and new static pacing results above are diagnostics only.
