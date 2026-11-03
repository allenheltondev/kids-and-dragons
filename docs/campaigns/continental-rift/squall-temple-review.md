# The Temple in the Squall: design note

**Rewritten November 2026** to the Borrowed Ruins pilot's bar ([arc.md](arc.md)). The Wandering
Sky's strand end.

- **Beat:** the temple is safe or closed for repairs, and the party has seen that creatures from far
  away are being pulled along too.
- **Question (scene 1):** "Can we keep the temple safe as the island drifts in?"
- **Carried by** Keeper Clove, the temple's dragonling keeper (`cast/adult_dragonling`; it is not
  Sorrel's kitsune figure). Pip Thistledown and Fig, a small kitsune keeper, are with him, and
  Tumble appears when her letters were saved.
- **The piece:** bone crawlers from the far-off coast swarm the fresh magic of a tear, and Clove's
  weather book (p2) records three islands that came early. The pull reaches everywhere.

## Rhythm

The party jumps from the skiff to the landing and meets the crawlers. They choose the bell first
(a fight) or the keepers first (a rescue). Then the hall, and Pip runs off to push Notchbrow on his
own; the party fetches him back. After that come the weather book and the rest, where push or
settle is chosen, then the landing fight. The crawlers go home through the shrinking tear, and the
ending is Tumble's flight to the Cairnstep. The chapter has 13 checks and 5 fight scenes (two
fights on any path) and no games.

## Consequences

| Input or choice | Later |
|---|---|
| `island_warning_sent` without `island_relay_delayed` | Keepers are inside, and the bell route can skip the landing. The push poles are already rigged, so push needs no check. |
| `island_relay_delayed` | The warning came late: keepers are outside and nothing is ready. |
| Welcome song (no warning) | Keepers are outside with lanterns. The landing is cleared, so settling is soft and needs no check. |
| `island_messages_saved` | Tumble can lift Fig down and fly you to Pip. |
| Bell first or keepers first | Ringing the bell leaves the crawlers dizzy and the landing fight has fewer of them. A silent bell (keepers first, or a lost bell fight that costs the clapper) brings the whole swarm. |
| Push (force) or settle (understand) | Pushing is quicker, but the island drifts on, still pulled. Settling sets `temple_island_settled`; it takes longer, and without cushions the rail gets crushed. |
| Lose the landing fight | `temple_damaged`: the landing breaks, it is closed for repairs, and the island swings away. |

## Shape and pacing

| | Before | After |
|---|---:|---:|
| Scenes | 51 | 56 |
| Dice checks | 0 | 13 |
| Games (inert) | 17 (11) | 0 |
| Quoted scenes | 14 | 33 |
| Spine scenes / votes + checks / longest reading run | 45 / 14 / 3 | 31 / 14 / 3 |

The model predicts about 30 minutes. This is uncalibrated, and no family has timed the chapter yet.
