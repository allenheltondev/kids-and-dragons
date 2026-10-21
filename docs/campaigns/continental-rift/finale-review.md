# The Glacier Remembers

The ordinary passage from convergence reaches the deep glacier. The opening
states the rescue goal before a voice questions the present river. Corvane's
identity, Pangea and the prison's loosened ice appear together on the chapter's
single priority-one reveal scene. Nothing before that scene names him. His
voice stays courtly and confused; he wants his rivers home and never threatens
the party. The eruption's tremors are independent of every Gemfall ending.

The party first marks a retreat route and protects the old map. A missed map
check blurs a corner rather than pretending the map stayed dry. Two learned
places anchor today's land, without giving an item or moving the actual bridge,
memory ice or carved stone into inventory. A third completed regional key, an
allied wyrm or an allied Olivia can add one support, capped at three. The player
chooses that support or keeps the reserve team on the rescue lane. More support
weakens Corvane and removes one crawler; reserves improve rescue healing after
a loss. Two allies never stack into a fourth anchor.

Both authored fights have pulling-seam hazards and a four-turn close objective
at the ridge brace. Heroes can use the condition learned at convergence without
changing a rift's behavior or needing a Starweaver. Real-engine board tests start
each encounter, move heroes and end turns to objective victory. Separate runs
let enemies knock the whole party down and verify the rescue branch heals them.
These isolate mechanics with fixed dice; they are not balance measurements.

Corvane is a campaign character with two deliberately authored stat blocks,
not a generic creature projected into the public bestiary. The draft validator
therefore emits two expected missing-creature warnings, one per fight version.

Victory closes the seam and spends Corvane's strength. The party can choose the
quiet ice, The Glacier Keepers, or life with the yetis, The Ones Who Listened.
A first whole-party loss leads to a shelter checkpoint, partial healing and a
different brace attempt using the observed pull and practiced retreat signal.
Extra support is spent, and some lands have already shifted. Success reaches either
chosen future with that map scar. Only a second failure reaches Rivers Wander,
a completing setback with the agreed half award and work for tomorrow. All endpoints complete the
campaign. Olivia's three outcomes, Pip's decision, the wyrm and the temple work
appear as specific epilogue callbacks. The loss epilogue never claims displaced
lands returned home.

## Full route integration

All 24 story nodes are now authored. Development pauses and their chapter files
are removed, so a normal preview reaches a real ending. Corvane remains a
campaign character using the existing neutral-named figure; no field-guide
entry exposes him early.

The final graph check found a real trap after late washout arrivals took the
downriver ferry: the shelf was already closed and neither dormant rift supplied
a new regional route. The Bone Yard guide now explicitly supplies the checked
next-tide route for Old Ossley's upriver ferry. Its edge requires the completed
Bone Yard, so the return is introduced before it is offered. It preserves the
planned river route and does not change a rift condition. With this return and relevance-based state tracking, the
exhaustive search completes at 114,507 states with no findings; the search cap
is 250,000, half the previous limit. Immutable chapter metadata and unchanged graph
proofs are reused by content signature. Changed negative fixtures invalidate the
cache; smaller art fixtures avoid unrelated campaign searches. This is a complete check, not a truncated search treated as success.

## Pacing and progression limits

The finale's shortest success spine is 48 scenes, 14 decisions, six physical
checks and one encounter, about 34.1 uncalibrated minutes. The 40-minute metadata
is a budget. Family timing and combat balance still need actual play.

The agreed 140 ordinary / 650 convergence / 140 finale XP awards are preserved.
The completed graph can visit more paying places than the original 11–16-node
budget assumed. Therefore full-route progression acceptance is not passed and
this remains an isolated preview. No claim is made that every optional route
stays below level 8. Production integration must resolve that budget separately
and retain Gemfall's prerequisite. Existing Gemfall files and saves are untouched.

## Review follow-up

All three clue pairs can reach both success endings without assuming the reading
room was visited. The yeti readers introduce their work where they appear. Olivia,
the builder and the wyrm arrive before their support is offered. Orin supplies the
rest before the watcher appears. Failed map protection is read back after success.
The Bone Yard ferry account names known Old Ossley and identifies the checked tidal
channel to his landing. All five preceding chapter fixes are carried into this PR.

Five new checkpoint scenes extend the existing rescue branch. Its ordinary path has
six loss-only scenes before recovery, or seven before the second failure. The
brace check is physical (`checkKind: doing`) and never repeats the lost battle.
`final_battle_lost` is set only by that second failure. Real board-loss tests now
continue through both outcomes of the second attempt, and route tests exercise
both success futures on each of the three clue pairs.


### Pacing before and after review fixes

| Shortest success spine | Before | After |
|---|---:|---:|
| Scenes | 48 | 48 |
| Decisions | 14 | 14 |
| Physical checks | 6 | 6 |
| Encounters | 1 | 1 |
| Longest reading run | 3 | 3 |

## Final verification after review

Typecheck, production content validation and continuity pass. The complete local
coverage run passed 4,940 tests with 11 skipped, and every coverage threshold passed
(77.77% statements, 75.30% branches, 79.31% functions, 79.61% lines overall). One of
those skips excludes the Unix Ctrl-C process test on this Windows host; GitHub CI
runs the complete suite on Linux. The original Windows LF-only fixture readers were
run with local LF line endings; no fixture or Gemfall change is included in this PR.

The staged draft gate, real board outcomes, checkpoint continuations, all clue pairs
and exhaustive route replay pass. The setback audit requires two failures and reaches
Rivers Wander in at least 49 scenes. Focused coverage runs also pass independently
at every earlier chapter head; the final full run includes all their fixes.
