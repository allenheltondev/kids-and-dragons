# The Island Due Back: design note

**Rewritten November 2026** to the Borrowed Ruins pilot's bar ([arc.md](arc.md)). The Wandering
Sky's key node.

- **Beat:** the party has met the island due back and copied its mooring stone.
- **Question (goal, said in scene 1):** "Why has the island come back early?"
- **Carried by** Keeper Juniper (`cast/island_keeper`), with Pip Thistledown and Tumble, a griffin
  island courier who is bad at landing. A hen who lives on the island all alone is the running joke,
  and she shows the theme that moved things try to go home.
- **p1 (`mooring_stone`, its own scene):** the carving is a map of the land below in an older
  shape. That is the Sky fragment, and `fragment_sky_learned` is set on every path. The chime leans
  hard toward the glacier in `pull` (p2), where Juniper answers the chapter's question: the island
  is being pulled.

## Rhythm

The lookout (spot the island, Tumble's gust) leads to the crossing, the island and the hen, then
the stone (copy it, p1, the pull) and the force-or-understand choice. After that come the return,
the rest and the word sent ahead, and Pip's farewell. The close asks the campaign question again
with the island's piece added. There are no fights. The risk is in 14 dice checks and two games,
and each miss costs something.

## Consequences

| Choice | Later |
|---|---|
| `whales_guided` (from the map) | The whales' curve gives a free sighting and their note gives a safe crossing. Scattered or still-circling whales leave both to the dice, and a lost calf drifts past. |
| Catch Tumble's letters or the signal frame | `island_messages_saved`: Tumble can fly you a line and carry the warning, and she is at the temple. A saved frame can flash the warning. |
| Tie the island to the lookout (force) or let it go (understand) | Tying makes the return safe, but it cracks the stone's eye and flattens the frame. Letting it go means a risky run back. |
| Warning or welcome song (rest) | `island_warning_sent`. A warning with no quick carrier goes by hand, which sets `island_relay_delayed`. The welcome song travels from bell to bell and is never late. |
| Pip's hen and Pip's question | The hen flies home on her own. Pip's answer is paid off in the ending. |

The old `island_*` bookkeeping flags are no longer set. The integration pass should drop them from
`graph.flags` when it regenerates the proofs.

## Shape and pacing

| | Before | After |
|---|---:|---:|
| Scenes | 110 | 55 |
| Dice checks | 3 | 14 |
| Games (inert) | 23 (8) | 2 (0) |
| Quoted scenes | 13 | 41 |
| Spine scenes / votes + checks / longest reading run | 43+ / 14–16 / 3 | 31 / 14 / 2 |

The model predicts about 26 minutes on the shortest path and 27 on a typical one. These figures
are uncalibrated, and no family has timed the chapter yet.
