# The road out: shelf, hidden rift, washout

Revised in November 2026 against [arc.md](arc.md#the-road-out-one-or-two-of-these-per-party)
(depth: *revise*). Dice, fights and class rooms kept; people, voice, the arc piece and
consequences fixed. Route-walk tests: `tools/content/riftlight-road-out.test.ts`.

## The Path Beside the River (`riftlight-ice-shelf-traverse`)

**Question:** can we get everyone along the shelf to the cairns, and what did the river do?
**Carried by Skerry**, a griffin who keeps the shelf's iron rings as her mother did (figure
`cast/ridge_griffin`, relabeled). She names the rings (Grumble, Old Clank), cannot carry the
party, and wants to know what to tell the herder about her goats' road. **Adds (p2, `gap`):**
the old boot marks walk straight into the river; its edge moved in one night. The chime leans
back toward the glacier.

Rhythm: rope and rings, the squeeze, rest, crack, icicles (knock them down or listen: force or
understand), wind, slope, the drowned path, a way past (high, low, rail, wings), then **watch
the river breathe** (cold, 1 HP) **or go now**. Watching adds a TN 8 crossing and reads at the
ending. A missed throw at Grumble loses the clip-on at Old Clank; a missed knot loses the tight
line. The crossing sets `traverse_made` or `traverse_failed` (into the river, nobody lets go).
The close asks the campaign question in Skerry's words.

## The Note Under the Ice (`riftlight-hidden-glacier-rift`)

**Question:** what is ticking under the ice? The herder and the kid carry it; her grandmother
kept the listening post and left the tally marks by the fold. **Adds:** the chime rings by
itself, answering the opening. At the seam, **pry it open** (quick, a roll, the fold flinches)
**or answer it** (memory game); only an answered seam lets the waking song roll at TN 8, else
TN 12. Spotting the kid in the mounds offers an easy catch; losing it costs the herder's lunch.
`glacier_rift_woken` only when the party sings; `leave` goes home unsolved.

## The River Chooses a Road (`riftlight-headwaters-washout`)

**Question:** can we hold on and find a way out? Skerry flies above every stretch (not under the
echoing arch or down the chute); each stretch has its own sight and joke (her road's floes, the
arch that repeats you, a forest that fell in overnight, smug goats, a toll-taking drake).
**Kick for the bank** (force) opens a TN 12 near lip at the ledge; **float and read the river**
(understand) opens the curl at the tree. A missed hop costs the dry honeycake; a snagged loop
lost on the jam or to the drake costs the loop option. One `river_exit` member on every path;
`ossley_rescued` only on the late rescue, where Old Ossley wants help ferrying at the broken
bridge. Each ending is somewhere new, and Skerry asks the question.

## Numbers (`cohesion.mjs shape`, then `content:pacing` spine)

| Chapter | | scenes | checks | games | inert | echo | quoted | spine | votes+checks | read | words |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| shelf | before | 81 | 27 | 4 | 2 | 3 | 1 | 38 | 22 | 2 | 1,321 |
| | after | 70 | 30 | 3 | 0 | 0 | 70 | 31 | 22 | 1 | 1,643 |
| hidden | before | 93 | 21 | 4 | 3 | 1 | 19 | 46 | 19 | 4 | 1,514 |
| | after | 95 | 26 | 4 | 0 | 0 | 85 | 44 | 20 | 3 | 1,926 |
| washout | before | 84 | 36 | 4 | 3 | 1 | 3 | 38 | 24 | 2 | 1,226 |
| | after | 81 | 37 | 3 | 0 | 0 | 80 | 35 | 23 | 2 | 1,530 |

Predicted minutes 28 / 30 / 32; no family timing yet. Chapter-local flags start false in a
fixed order at entry so the route walker keys one state per real state.
