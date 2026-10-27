# Strand endings: planned thirty-minute playtest

Wyrm Nest and Squall Temple target thirty minutes each. These are planning budgets,
not measured family timing. Neither the scene count nor `estimatedMinutes` proves
duration. The older pacing model omits authored interaction time: it predicts about
18 minutes for the nest and 19 for the temple before accounting for that play.

| Movement | Wyrm Nest | Minutes | Squall Temple | Minutes |
| --- | --- | ---: | --- | ---: |
| Discover the job | Observe the tail; clear the margin; choose furniture | 7 | Observe approach; bring keepers inside; use earlier warning | 6 |
| Prepare something useful | Check hollow, prepare bedding, clear lanes and practice signals | 7 | Rig turning rope or wind cover; practice signals and rest | 7 |
| Commit through play | Play the encounter: hold the hollow or drive creatures away | 8 | Play turning or shelter objective with the prepared kit | 9 |
| Live with the outcome | Build furniture for the actual room; bring readers through | 8 | Inspect actual damage, redirect runoff, hand over kit and record | 8 |
| Total | | 30 | | 30 |

Reading, discussion, shared clue turns and seeing results are included in these
budgets. Do not add timers, mandatory replays or extra prose to fill a short session.
Time the shortest starweaver/portable-table and warning/thornguard routes as well
as an engaged party. These advantages deliberately save specific jobs.

## Decisions and later consequences

| Choice or preparation | Later work or available capability | Limit or cost |
| --- | --- | --- |
| Nest: folded table / shelf parts | A folding table can open directly in the old room after retreat; fixed parts can become a low shelf after victory | A temporary tabletop from shelf parts needs a relay; a folding table on the new threshold needs its stand handled |
| Nest: shaped snow / resting slab | The soft-bed board offers a one-round hollow hold instead of two; an unused slab can become a reader step | A slab beneath an allied wyrm stays there; the step requires an actual recovery task |
| Nest: starweaver survey | Replaces the separate clear-view activity | Builders still check ground and return; no command over the rift is invented |
| Nest: remembered / helped builder signals | Successful recall unlocks teaching the signal round; otherwise visible markers and bundle passing carry readers through | A missed teaching round reroutes to the marker relay; assistance never becomes independent recall |
| Nest: hold / drive off / retreat | Hold grants the existing ally and uses its bed; driving off clears the doorway without an ally; retreat keeps the nest and uses the old room | Retreat still costs the builders their next free morning and keeps the unfinished room closed |
| Temple: earlier warning | Opens a direct lane-check route, skipping the screen-handling job already done | The party still checks the yard and brings the last keeper inside; remaining small gear may be moved if chosen |
| Temple: long rope / wind cover | Long rope shortens push work from three turns to two; cover removes the party Guard penalty in either plan | Neither removes crawlers or crosswind pushes; rope does not shorten the shelter hold |
| Temple: rope alignment miss | Rig a shorter store line through a relay | Push stays three turns; no repeated alignment attempt |
| Temple: thornguard Brace | Replaces the separate wind-cover holding task | It supplies the cover advantage, not both preparation advantages |
| Temple: push / shelter | Distinct close-work / held-ground objectives lead to diverted / settled island | Defeat damages the empty landing; later inspection cannot reopen it |
| Temple: leave / recover spare kit | Actual relay leaves kit for the crew; support-and-pack returns unused kit | Damage requires leaving it and keeps the landing closed tonight |
| Temple: signal account / boundary map | Signal account unlocks a cloth drill; a fixed observation station remains available | Missed drills reroute to keeper-led demonstration or a nearer station, not a guessed handover |

Party preparation advantages are offered beside an ordinary ungated way forward.
Choosing the ordinary board means forgoing that optional advantage. Local expedition
kit is tracked in chapter flags and endings; it is not a new inventory item or a
promise that a later chapter will replenish it. Existing campaign ally, settled and
damaged flags retain their meanings. No new knowledge about the old ice is revealed.

## Family observation

Try solo, two-player and four-player tables, including relaxed and helped inputs.
Ask a child to explain the furniture/bed choice and the rope/cover choice before
tapping. Note when the group wants to confer, when instructions need repeating,
and whether every player contributes. Observe the rest waypoint without imposing
a delay. Time encounter turns separately from setup and read-aloud.

After the encounter, ask which room or boards can actually be used. Check that a
retreat feels like a changed plan, that a lost preparation advantage is understood,
and that the account names help without shaming anyone. The builders' chisel hats,
insistent rain and the bell rope's raincoat should support the action, not obscure it.

The future [family-session tracker (#511)](https://github.com/allenheltondev/kids-and-dragons/issues/511)
remains separate. No observed family timing has been collected by these tests.

## Automated verification

The route suite drives complete interactions across party sizes, kit, bedding,
warning, classes, records, assistance and declared battle results. Separate combat
tests use real READY, MOVE, COMBAT_ACTION and END_TURN intents on the authored boards.
They check all eight objective and defeat configurations, actual wind-cover buffs,
actual two-versus-one held rounds, push work counts and drive-off without an ally.
No test result is presented as a measurement of family enjoyment or duration.

Existing character-free scene backdrops and separately rendered cast are reused;
this pass adds no raster illustrations or baked-in characters.
