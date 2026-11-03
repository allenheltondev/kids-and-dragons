# Land Under an Unfamiliar Sky

The Wandering Sky's arrival (`riftlight-sky-islands-arrival`), revised in November 2026 against
[arc.md](../arc.md#wandering-sky-teaches-linked). A *revise*: its dice, wisp fight, Dojo, Attune
lesson and arrival variants were kept; its question, people, clue and games were fixed.

**Beat.** The party has found its feet on an island in the wrong part of the sky. **Question**
(said in scene 1): *Why is this island where it should not be?* **Adds:** the island's mooring
rope did not fray, it snapped toward the hum (`mooring`, p2), and the Listening Chime leans back
toward the glacier. The close asks the campaign question with the piece "this island did not
drift; something pulled it loose, and the whales' song has moved too". Seren teaches Attune when
`attune_taught` is unset and acknowledges it when set.

**Who carries it.** Keeper Sorrel, the temple keeper (`cast/kitsune_temple_keeper`, relabeled in
the manifest; the squall temple's keeper is someone else). Pip Thistledown is introduced in words
true whether or not the party has met him ("the young manticore scout who runs errands for Lady
Olivia"), with his notebook, his prying spoon and "Lady Olivia says...". At dawn Sorrel names a
keeper called Juniper at the whales' turning place, where the strand goes next.

## What changed

| | Before | After |
| --- | --- | --- |
| Goal | "Find your feet on an island high in the sky." | The question, with a fourth step: find what pulled the island loose |
| Keeper | "Temple keeper", unnamed | Keeper Sorrel |
| Clue | None of its own | The snapped mooring and the chime's lean, on every path |
| `gust_lull` (timing) | Miss changed nothing | Miss costs a heart |
| `fuel_chain` | Relay (cannot miss), inert | Aim game: a miss knocks the supper bundle off the edge, so the ferry's "share your supper" is gone |
| `song_track` | Inert bell game | Cut; the night's clues are gathered in story |
| `song_echo` (memory) | Miss changed nothing | Miss leaves the whales silent: Fenwick will not fly ahead, so only Thimble's ferry is offered |
| Close | A summary | The campaign question with this chapter's piece |

## Shape and pacing

| | Before | After |
| --- | ---: | ---: |
| Reachable scenes | 87 | 87 |
| Dice checks / fights | 25 / 1 | 25 / 1 |
| Games / inert | 5 / 5 | 4 / 1 (the camp, an expressive beat) |
| Echo votes | 1 | 1 (the passengers) |
| Scenes with a quoted line | 43 | 43 |
| Spine scenes / votes / checks | 46 / 12 / 8 | 46 / 11 / 8 |
| Spine words | 1,865–1,957 | 1,969–2,087 |

Tests: `tools/content/riftlight-sky-islands.test.ts`, with the fight and the Dojo still pinned by
`riftlight-sky-islands-fight.test.ts` and `riftlight-class-rooms.test.ts`.
