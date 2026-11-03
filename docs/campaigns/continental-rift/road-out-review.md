# The road out: Frostfang Shore, the Cairnstep, Boundary Stone Bank, Ashspan Bridge

Revised in November 2026 against [arc.md](arc.md#the-road-out-one-or-two-of-these-per-party)
(depth: *revise*). These four kept their dice, fights, class room and exits; what changed is the
question each asks, who carries it, the piece of the mystery each hands over, and whether a miss
or a choice changes anything later. Tests:
[riftlight-road-out.test.ts](../../../tools/content/riftlight-road-out.test.ts).

## What each chapter is

| Chapter | Question (goal, said in scene 1) | Carried by | Clue-trail piece (p2) | Force or understand |
| --- | --- | --- | --- | --- |
| `frostfang-shore` | Can we find a dry way uphill to the pass? | Tamsin, griffin river keeper ("Down, river! Sit!") | `river_line`: the river is above every line in a hundred years of paint | Push the goats across (keeps the hay; goats sulk, a failed push means hauling the boss goat out) or watch the boss goat (the hay floats away; a good watch finds its dry track, an easier climb) |
| `cairnstep-pass` | Is this pass real, and does it belong on the map? | Brask, griffin pass keeper (licks his pencil, writes everything), and Pebble, his apprentice | `old_page`: the ledger's first page shows a path here long ago, beside a boot-shaped lake and a two-horned peak that are not here | Lean on the moved slab (sure answer, but it cracks the neck: the pass can no longer be written open) or listen to it (finds the hollow and a safe line, but the wolves get a loaf first) |
| `boundary-stone-bank` | Why did the river shove the stones? | Tally, dragonling stone keeper, counts everything aloud; greeted in words true whether or not she was met at the counting stones | `clue`: three counts, none matching the carved eruption, and a carved peak shaped unlike today's. The answer to tonight's question: the flood came above every notch | Heave Splash up now (his top notch chips; the count gets less sure) or dig around him (shows the river came over the top, then a scramble out of the flooding trench; a slow one loses the kettle) |
| `ashspan-bridge` | Can we get everyone across, and the bridge mended? | Old Ossley (few words, long pauses), with Bryn the mender and Tilly the egg farmer | `span_stone`: the stone holding up the middle matches no rock for a hundred miles, and was there before the bridge | Haul the jam at once (chips the span stone; Bryn patches it) or find the key log (a plank floats off; Ossley gives a board from his boat, which the marsh's reed mat covers) |

In each, the Listening Chime leans toward the glacier in one scene every road walks, and the last
scene asks the campaign question with the chapter's piece added ("So here is tonight's piece:
... Something is moving the land. What is it? And can you put things right?"), then names the
graph's exits. Cairnstep's ending says the aerie owes the party a flight, which `pass-to-sky`
pays. Ashspan's greeting reads `ossley_rescued` in words true whichever way the rope went ("You,
me, and a rope"). No chapter sets a journey flag.

## Rhythm

Four movements each, about 7 / 8 / 8 / 7 minutes: arrive and meet the carrier (question, first
vote and roll); the hands-on middle (two to four rolls, the fight where there is one); the
discovery and the force-or-understand choice, with a rest after; the payoff (what was chosen comes
back, the chime, the close). Bookkeeping tails were cut: Frostfang's hay relay and message vote,
Cairnstep's cairn-order puzzle and last-stone toss, Boundary's chalk snap, stone sort, knot and
sighting votes, runner and packing votes, Ashspan's lashing, gift and route votes and the plank
relay.

## Games that can be missed

Only timing, precision, memory, sequence and tracking games can fail in the engine; cooperate,
balance, relay and play always succeed (or are assisted). So the games whose miss should matter
are now failable: Frostfang's kid-goat carry (timing; a miss strains Tamsin's wing, so she cannot
fly the news ahead) and wave gap (timing; a soaking), Cairnstep's old page (memory; the landmarks
are forgotten) and capstone (precision; the cairn is short and Brask stands guard himself),
Boundary's count cord (precision; it sags and the fourth stone is a guess), Ashspan's dock (timing;
the eggs hatch early). The ladder test, the surge relay, the beam carry and the ducklings stay as
together-moments that cannot fail, which is what `shape` reports as inert (the ladder test, the surge relay, the beam carry and the ducklings).

Local flags are all cleared in a fixed order in each entry scene, so the route walkers merge equal
states (the walker's key includes flag insertion order).

## Shape and pacing, before and after

`cohesion.mjs shape` (reachable scenes, checks, fights, games, inert, echo, quoted scenes):

| Chapter | Before | After |
| --- | --- | --- |
| frostfang-shore | 63 / 24 / 1 / 4 / 4 / 0 / 24 | 55 / 24 / 1 / 3 / 1 / 0 / 33 |
| cairnstep-pass | 60 / 15 / 1 / 4 / 4 / 0 / 34 | 55 / 15 / 1 / 2 / 0 / 0 / 42 |
| boundary-stone-bank | 75 / 17 / 0 / 4 / 4 / 1 / 41 | 59 / 18 / 0 / 2 / 1 / 0 / 39 |
| ashspan-bridge | 88 / 22 / 1 / 4 / 3 / 3 / 44 | 72 / 22 / 1 / 3 / 2 / 0 / 48 |

`content:pacing` spine (scenes, votes, checks, longest reading run, words, predicted minutes):

| Chapter | Before | After |
| --- | --- | --- |
| frostfang-shore | 36 / 11 / 6 / 2 / 1,266–1,285 / 26.6 | 30 / 8 / 6 / 2 / 1,371–1,549 / 26.2 |
| cairnstep-pass | 38 / 10 / 5 / 3 / 1,432–1,523 / 27.4 | 34 / 9 / 5 / 3 / 1,632–1,862 / 29.1 |
| boundary-stone-bank | 44 / 12 / 6 / 2 / 1,656–1,710 / 27.1 | 33 / 8 / 6 / 3 / 1,520–1,709 / 23.7 |
| ashspan-bridge | 47 / 12 / 7 / 5 / 1,527–1,558 / 30.6 | 39 / 8 / 7 / 3 / 1,643–1,810 / 29.4 |

`estimatedMinutes` is now 30 for all four, as the arc's contract says. Predictions are
uncalibrated; no family has played these revisions.
