# The Stone That Moved (`riftlight-stone-counters`)

Rewritten in November 2026 to the pilot's bar ([arc.md](arc.md), *The Borrowed Ruins*). The
earlier version had no dice, twelve inert games out of thirteen and a water-cart chore at its
centre; it is replaced.

**Beat.** The party has proven a counting stone moved itself, and got the neighbors past it.
**Question (the goal, scene 1).** How can a stone that never moves have moved?
**Who carries it.** Tally, the dragonling stone keeper, who counts everything aloud and wants her
count true: a counter's stones must never move, and one has. She introduces herself in words true
whether the party met her at the boundary-stone bank or came from Ashspan. Pip Thistledown is
caught prying the stone with his spoon ("Lady Olivia says a moved stone is the best sample in the
world!") and needs his name cleared. Seren teaches Attune when no strand has yet (`lesson`,
"taught you before" otherwise). Farmer Gourd and his goat Mustard are the neighbors who must get
past.

## Rhythm

| Movement | What the table does |
| --- | --- |
| The missing stone | Tally's ring is one short; the Eldest stands in the road beside a fold, with Pip under it. Grab the spoon or calm Tally (checks). Seren, Attune, and the fold that shrinks. |
| Prove it moved itself | No drag marks (check or a timing game), the dent's edge saved from a trickle (check), a look under the stone (check): the **p2** `old_socket`, a socket older than the ring. The chime points to the glacier. A pebble hops while you watch (tracking game). |
| Clear Pip, then force or understand | Tally's verdict. **Push the Eldest home** (Pip's, and Olivia's, way) or **leave it in its old socket** and count it there. Get the turnip cart past. |
| The shrinking fold, and the way on | Peek through (Pip, held by the tail) or count how fast it closes; rest; choose Pip's page; Tally's goodbye; the campaign question with this piece. |

The fold is the strand's **timed** signal: a door at the road, a pony at the stone, a cartwheel
at the cart, a window (or a dinner plate) at the end, and the ending says to take it now or lose
it. It is the graph's `counters-shrinking-fold`, which lasts one visit.

## Consequences

| Choice or roll | Later |
| --- | --- |
| Any slip gathering the proof (spoon, grass, trickle, dig, pebble) | Tally is unsure: no "show the proof", only a heart check to vouch; a failed one costs Pip his spoon until the goodbye. |
| Push home (or a bigfoot's carry) | Easy cart, but Mustard lunges at the fold (check: her hat); the Eldest creaks back; Tally will push it every morning. |
| Push fails / leave it with a bad bend | The tight squeeze: a narrower timing window. |
| Roll the cart between tugs, or carry the turnips | Rolling risks a sack of turnips through the fold; carrying is safe and slow, and the fold is then too small to peek. |
| Peek or count | The ending can say where the fold opens or how long it lasts, or neither. |
| Road plan or carving rubbing | `stone_route_priority`; the road plan gives an easier reading (TN 8) in the wrong valley. |

Contract: sets `attune_taught` (gate-and-set) and `stone_route_priority`; nothing else crosses.

## Shape and pacing

| | scenes | checks | games | inert | echo | quoted | spine scenes | votes + checks | read | spine words |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 38 | 0 | 13 | 12 | 1 | 22 | 25 | 5 + 0 | 4 | 1,058 |
| After | 55 | 12 | 5 | 1 | 0 | 48 | 32 | 6 + 8 | 3 | 1,653 |

The one inert game is the turnip relay: a relay cannot be missed in the engine, and its cost
(the slow carry shrinks the fold past peeking) comes from choosing it. Planned about 30 minutes;
family timing is unmeasured. Tests:
`tools/content/riftlight-stone-counters.test.ts` (route matrix through the real engine).
