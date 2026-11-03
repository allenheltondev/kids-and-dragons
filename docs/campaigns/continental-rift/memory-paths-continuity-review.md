# Forgotten Paths: crossing and memory continuity review

Continuation after the stone counters. The valley was rewritten in November 2026 (below); the
reading-room notes describe that chapter as it stood before its own rewrite.

## Entry, return and carried knowledge

`stone-counters → the-wrong-valley → reading-room` extends the northern strand. Each link
has a return edge and both new nodes use pass revisits. Returning never replays the temporary
river movement, repeats a clue award or claims the river is still on its temporary course.
The stone counters still connect to Ashspan and keep their development pause.

The existing prerequisite audit checks every incoming edge, including return loops and
negative bypass cases for both new nodes. The chime and first Riftseeker introductions remain
required; the reading room additionally requires the valley's actual witnessed change and
carried account. Those facts are introduced at every valley ending, rather than seeded as
new facts by the fixture. The fact identifiers for the two local arrivals are distinct.

`valley_crossed_high` records the route actually completed, including a fall onto the other
route. Both true and false overwrite stale state. Reading-room arrival callbacks read that flag;
they do not infer the route merely from a class or planned approach.

`fragment_coast_learned` is the only gate for the optional buried-bridge comparison. Tests
verify every bridge ending knows the river evidence, only that chapter can produce the flag,
and no graph edge can mint it. The reading room's conditional entry fact and prose are checked
with the flag both absent and present. A party without the Coast clue never invents a visit.

## Valley scenes (`riftlight-the-wrong-valley`, rewritten November 2026)

Rebuilt to the pilot's bar ([arc.md](arc.md)); the old valley had four checks, nine inert games
and an unnamed route worker. **Beat:** the party has crossed a river running down a valley that
was dry, and warned the next traveler. **Question (scene 1):** where is this river going, and why?
**Carried by** Hummock, the yeti route worker (names his rocks, thaws his frozen eyebrows in his
tea), who wants his warning post lit before the evening sled from the singing hall drives into the
water, and Pip. Grandma Drift drives that sled.

| Movement | What the table does |
| --- | --- |
| A river where the map says dry | Slide down to Hummock (check). Read the valley with Pip's map, from Gertrude, or with Tally's road plan (`stone_route_priority`: TN 8 instead of 12). Up the wet stepping stones (check). |
| Where it turns | Nothing pushed it at the fork. **p2** `old_road`: the oldest marker's wavy line points down the dry valley; the river is running an old course. The chime leans to the glacier. Down the old valley by board or by trail (checks) to a waterfall waking up. |
| Force or understand | Pip's (Olivia's) way: **wall off the old valley** (check). It floods the low ice and the old marker, and the river comes back without it anyway. Or **watch it run** (memory game): the order the pools fill goes in the account. |
| Across | Low ice (check), high rocks (check), wade the flooded ice, or a **thornguard holds the ice**; a fall lands on the other route. Call Hummock's jump (timing game): a miss loses his lantern. |
| Warn the sled | Light the lantern (precision), build a stone arrow, or run and stop it (check). Help Grandma Drift around (checks). At dusk the river turns back (check for Pip's notebook): `wrong_valley_witnessed`. |
| The account | Rest; optional moonlight (check). The account for Elder Murmur at the reading room: how you crossed, the pools, the wall, the moonlit line north. Then the campaign question. |

Any lost time on the way up (a slow look, a slip, a failed wall, a muddled watch) takes the stone
arrow off the table; a missed jump takes the lantern; with both, the party must run for the sled.
`valley_crossed_high` is set on the scene the party actually reaches (`across_high` or
`across_low`), overwriting any stale value; the reading room reads it.

| | scenes | checks | games | inert | echo | quoted | spine scenes | votes + checks | read | spine words |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 52 | 4 | 15 | 9 | 3 | 11 | 26 | 5 + 2 | 5 | 965 |
| After | 46 | 16 | 4 | 0 | 0 | 41 | 30 | 6 + 9 | 2 | 1,573 |

Planned about 30 minutes; family timing is unmeasured. Tests:
`tools/content/riftlight-wrong-valley.test.ts` (route matrix through the real engine).

## Reading room (rewritten November 2026)

The reading-room rows that stood here described the old design. The chapter was rebuilt to the
pilot's bar ([arc.md](arc.md)). Question: *has this river ever run here before?* Elder Murmur
(`cast/yeti_elder`) carries it; Flurry (`cast/younger_keeper`), who will keep the next reading
room, has the stake; Pip voices Lady Olivia.

Rhythm: the squeaky stair (check, or a griffin glides), Flurry's dripping icicle (hat it, a
check, or snap it), the tunnel or the lamp ledge (timing game or check), the listening hole
(drop a pebble or listen to the hall's song), then the old wall. Any noise clouds it and takes
away the easy wait. **Force:** ring the chime at it (Pip's idea): quick, but the copy must be
rushed and the wall frosts white until spring. **Understand:** wait (a precision game, wider
for a quiet party, widest for one that listened to the song; a miss costs the cold).
**p1 `old_river`:** the memory ice shows the river leaving by a different valley. Murmur's "Do
not shout near the old ice. You don't know what you might wake." follows in `deep_sound`, and
the chime tugs toward the oldest ice. Hush Pip (check), then copy the river or save the slates
first (cracked slates, or a rushed copy plus a hundred years of proof). Proving the match: a
clean copy lets a high crosser or a low crosser prove it from what they saw; the buried bridge
gives its own proof; otherwise a check, or Murmur rereads it at the cost of Pip's sketch.
Flurry's courage (check, or the icicle hat), Pip's "send rivers anywhere", rest, the stair out
(check), and the builder's news of a wyrm in Flurry's room. `fragment_paths_learned` is set on
every path; the eight `memory_*` flags are no longer written.

| | Before | After |
|---|---:|---:|
| Shortest spine (scenes) | 36 | 30 |
| Votes + checks on it | 10 + 0 | 9 + 6 |
| Dice checks / games / inert / echo | 0 / 13 / 1 / 5 | 9 / 7 / 0 / 0 |
| Quoted scenes | 15 | 42 of 54 |

Tests: `tools/content/riftlight-reading-room.test.ts`.

## Scope and validation

Both chapters award the agreed 140 XP on first completion, no bonus XP and no combat. A fall
in the valley costs a nonlethal heart, and its rest heals; a party starting at one HP stays on
its feet. The reading room's pacing figures were taken before its rewrite.

The reading-room investigation now retains consequences beyond its immediate response.
Splitting observers unlocks an easier comparison; successful ridge and rock methods retain
different evidence for a later citation. A failed comparison leaves a genuine blank. Players
may ask the elder to co-read and sign her contribution, which unlocks an easier catalog test,
or retain an account that explicitly states its limits.

A successful catalog test permits a public visitor guide; a failed test permits only a
staff-guided copy. Both require the party's permission. The newcomer lesson and final keeper
reaction refer to the resulting record, while private notes remain private. Paths knowledge
is still available on every route; it does not erase differences in evidence or record utility.

`riftlight-reading-consequences.test.ts` plays four complete routes through the engine:
prepared ridge evidence published, rock evidence kept private, failed evidence co-signed and
filed with staff help, and failed evidence kept private without a false citation. These are
automated route validations, not observed family sessions. The refreshed static model gives
the room a typical 35.6 minutes, but neither that estimate nor a decision count establishes
engagement or actual duration. A timed family playthrough remains required.

Existing `ice-shelf-headwaters` and `reading-room` illustrations are establishing backdrops;
the changing course and moving memory view are read aloud, not claimed as literal diagrams
in that existing art. New custom clue art can be commissioned in a later visual pass.

The Coast bridge and Paths memory are authored here; the later
[island continuation](island-continuity-review.md) adds the Sky key node. The preview does
not unlock an unwritten convergence or treat those clues as a completed campaign. The
remaining strand ends, convergence, finale and full XP-route acceptance remain future work.
