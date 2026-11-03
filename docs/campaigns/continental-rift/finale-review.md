# The Glacier Remembers

The campaign's last chapter (`riftlight-finale`), rewritten in November 2026 against
[arc.md](arc.md#endgame-every-party), [story.md](story.md#finale-and-endings--agreed) and
Corvane's voice in [characters.md](characters.md#corvanes-voice--agreed). The earlier version had
no dice, 12 inert games and three echo votes; its anchoring was a page held for Orin.

**Beat.** The party has met the one moving the land, anchored the present with what it learned,
and chosen what becomes of him. **Question** (the goal, said in scene 1): *Who is moving the land,
and can we keep today's places where they are?* **Adds:** the p1 (`reveal`): Corvane, an old
faun king of Pangea who slept a thousand years in this ice until the mountain woke, is putting
every place back where it was in his day. Nothing before it names him; today's fauns are never
mentioned.

**Full circle.** The chime that leaned toward the glacier all campaign points straight down into
it, rings when it finds him, and hangs straight when it is over. The herder who took the party in
on its first night, and the very same goat kid (chewing Orin's map case), come back. Snow drifts
uphill; things frozen mid-slide include a FRESH NOODLES board from the Exchange quay; the joining
lines Orin drew at the convergence match Corvane's old map. "Moved things go home" becomes
Corvane's "I only want to go home".

## Rhythm

| Movement | What the table does |
| --- | --- |
| The climb (≈8 min) | The quick ice stair (roll; from the bottom you see the ridge, so the brace is ready) or the crevasse rope (safer roll); a griffin glides; the goat kid on a snow bridge: fetch it (roll), sing it back (songkeeper) or let the herder take it home (then no broth at the rest); rest behind an ice rib: get warm (heal) or study the ridge (the brace) |
| The reveal (≈7 min) | Cross the old ice without a crunch (roll); things frozen mid-slide; the figure and his question; **Corvane**; ask him why, or tell him no |
| Force or understand (≈4 min) | Haul the tear shut (hard roll; or with Bram, if you told him no) and pin it, or show him the homes on today's map (roll; or ask what home looked like; or a redeemed Olivia tells him what happened to her). His tear flares colors he did not choose |
| The anchors (≈6 min) | Two rolls, each a piece the party learned, in its own words ("Those stones are mine." "It listens to you?"); a third anchor from the third piece, the frost wyrm or an ally Olivia, capped at one; or keep Orin and Seren on the rescue lane, or bring them to the ridge |
| The last seam (≈6 min) | The board fight ("I only want to go home"), standard or weakened, braced or not |
| After (≈5 min) | "It was a very good map"; the blanket; wrap him or lay the maps side by side; the chime hangs straight; the ice keeps him, or he lives and learns |

## Consequences

| Choice | Immediate | Later |
| --- | --- | --- |
| Stair (pass) / ridge study / pin the tear / bring Orin and Seren to the ridge | You know where a brace holds | "Brace the ridge" opens the three-turn fights |
| Show him the homes (pass) / ask what home looked like / Olivia's story | His hands lower | "Ask Corvane to let go" after a lost fight (an easy roll) |
| Keep Orin and Seren on the rescue lane | No third anchor | "Let Orin and Seren hold the ridge with you" after a lost fight |
| Third piece / wyrm / ally Olivia | Weakened fight: one crawler fewer, Corvane at 18 not 24 | Their own lines in the seam and the endings |
| A failed anchor or a failed showing | The land settles a field's width off | "A few places settled a little crooked" in the ending |
| Let the herder take the kid home | No broth at the rest | She comes back with the blankets |
| Wrap him / lay the maps side by side | His thanks / "So many roofs" | His last line in the chosen ending |
| The ice keeps him / he lives and learns | *The Glacier Keepers* / *The Ones Who Listened* | The epilogue plates |

Earlier strands read as real differences: an ally Olivia or wyrm is a third anchor; a redeemed
Olivia can tell him her story; Pip, if he stayed back, can run Bram's rope to the ridge after a
loss; a settled temple island is a fixed star to steer by; a damaged one lurches in the sky
anchor; each status, the wyrm and the temple have their epilogue line.

**A lost fight** sets `final_fell_back`, heals 3 and reroutes behind the ridge: one recovery roll
(easier with whatever the party earned). Success closes the seam with a scar on today's map; only
a second failure sets `final_battle_lost` and reaches *Rivers Wander* (the setback; Orin's "Then
we learn the new map"). No setback comes from one ordinary roll. The three endings keep their ids,
flags and epilogue plates; their own words now say "the Riftseekers", the blanket, the plain
walking door, the broad table and the watcher that the plates show.

## Shape and pacing

| | Before (Nov 1) | After |
| --- | ---: | ---: |
| Reachable scenes | 71 | 59 |
| Dice checks | 0 | 17 |
| Fights | 4 | 4 (same boards and objectives) |
| Games / inert | 21 / 12 | 0 / 0 |
| Echo votes | 3 | 0 |
| Scenes with a quoted line | 15 | 43 |
| Spine scenes / votes / checks / fights | 28 / 7 / 0 / 1 | 30 / 8 / 6 / 1 |
| Spine words | 1,039–1,200 | 1,891–2,304 |
| Longest reading run | 3 | 3 |
| Predicted minutes (uncalibrated) | 19.8 | 32.1 |

Corvane keeps two authored stat blocks (24 and 18 HP) rather than a bestiary entry, so the
validator's four missing-creature warnings are expected. The cast figure `cast/deep-ice-figure`
is now labeled "Corvane"; the scene before the reveal draws it with no nameplate.

Tests: [riftlight-final-play.test.ts](../../../tools/content/riftlight-final-play.test.ts) (route
matrices: pieces, allies, temple, every way to the brace and the recovery, every ending),
[riftlight-finale.test.ts](../../../tools/content/riftlight-finale.test.ts) (the reveal, his lines,
the capped anchors, the strands' differences, the endings and the journey) and
[riftlight-finale-combat.test.ts](../../../tools/content/riftlight-finale-combat.test.ts) (the four
boards turn by turn, the loss and both recovery rolls). Family timing and combat balance remain
unmeasured.
