# Forgotten Paths: crossing and memory continuity review

Development-only continuation after the stone counters. Two ordinary-node drafts add 174
scenes across alternate methods, checks and outcomes. A party visits 44 scenes in the valley
or 42 in the reading room, rather than reading all alternatives. Two biome-matched pause
chapters keep the unfinished wyrm/convergence boundary explicit.

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

`valley_crossed_high` records the route actually completed, including a switch to the backup
after failure. Both true and false overwrite stale state. Reading-room arrival callbacks
read that flag; they do not infer the route merely from a class or planned approach.
The stone-record priority callback describes what Pip carries, not an unexplained river cause.

`fragment_coast_learned` is the only gate for the optional buried-bridge comparison. Tests
verify every bridge ending knows the river evidence, only that chapter can produce the flag,
and no graph edge can mint it. The reading room's conditional entry fact and prose are checked
with the flag both absent and present. A party without the Coast clue never invents a visit.

## Valley scenes

Every task below introduces its equipment and limits in its decision scene. Its numbered
method scenes, checks, success and changed-plan outcomes require that task's introduction;
all continuing paths then reach the next task. The exact literal evidence is in `continuity.json`.

| Scene family | Dependency and consequence checked |
| --- | --- |
| `arrival` | Reintroduces Pip locally, establishes the northern approach and a yeti stop signal. |
| `look_again` | Introduces chipped route marker and two ridges before comparing the moved water. Failure corrects a hidden-ridge reading. |
| `worker_signal` | Introduces the wet seam and a safe longer approach; nobody jumps it to begin talking. |
| `two_jobs` | Establishes the worker's role, near-bank supplies, far tools/lantern and another worker due along the path. Warning choices protect different approaches. |
| `test_flow` | Introduces board, central rock and hidden footing before testing from the bank. Failed visibility reduces the plan instead of licensing an unseen foothold. |
| `bundle_plan` | The second worker arrives and waits before either hauling or crossing. Two rope coils and the carrying board are supplied explicitly. |
| `anchor` | Tests support from firm ground before weight is carried. Brace assistance steadies the board and cannot certify untested ice. |
| `signals` | Rehearses stop/wait/proceed before the far worker or tools move. |
| `tools_return` | Introduces packed tools and straps on the line. A catch stops the haul; tools are recovered by the higher reach without a reroll. |
| `crossing_choice` | Both checked routes and a backup exist before the choice. Every outcome keeps the party together and records the route used. |
| `river_turn` | Preserves old and current observations without erasing a map or claiming permanence. |
| `return_water` | Introduces the returning tongue of water before withdrawing equipment. Failure leaves an honestly marked low marker, not a missing hero or lost quest item. No dam changes the river's rules. |
| `tell_together` | Collects each bank's account after the observed return; unseen moments remain uncertain. |
| `next_witness` | Introduces the nearby memory inquiry as a lead, not as an answer already known. Witness/copy choices retain their provenance. |
| `last_check` | Rehearses the new upper warning and corrects a misunderstood approach before handover. |
| `rest` | Records the witnessed course change and account on every path. The river is back in its older bed; return and onward routes are explicit. |

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

Both chapters award the agreed 140 XP on first completion, no bonus XP and no mandatory
combat or damage. Pause chapters award zero. A three-person party starting at one HP retains
its health. Contextual assistance lowers an existing check from TN 12 to TN 8; no class is
required and the best roller need not supply the enabling ability.

The five-node pacing report includes the new shortest paths: about 34 and 34 minutes in the
uncalibrated default model, about 25 in a brisk-table sensitivity. Both have 14 decisions;
the valley has seven checks and the room six. These are planning estimates, never family
observations. The production pacing gate remains open.

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
