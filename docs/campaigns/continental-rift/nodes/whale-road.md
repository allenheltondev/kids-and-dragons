# The Whales' Turning Place

The Wandering Sky's middle (`riftlight-whale-road`), rewritten in November 2026 against
[arc.md](../arc.md#wandering-sky-teaches-linked). The earlier version had no dice, eight inert
games of fourteen, a goal that was a chore ("get the whales' island ready"), and two unnamed
kitsune keepers.

**Beat.** The party has met Lady Olivia's shortcut and learned what the whales know; the choice
to force or guide is now theirs to make on the map. **Question** (the goal, said in scene 1):
*Why are the whales circling, and how do we let them go?* **Adds** to the clue trail: the two
openings are *linked* (Olivia's feather, the party's hum or pebble), the whales follow their own
song's echo through the pair, the pair tugs things toward it, and the Listening Chime leans past
both openings toward the glacier (`chime_lean`, p2). The close asks the campaign question with
the piece "the openings come in pairs, and something keeps pulling them". No p1: the island due
back has the strand's.

**Who carries it.** Keeper Juniper (`cast/island_keeper`, relabeled in the manifest), who knits
one row of scarf for every circle the whales swim and wants the whales and the island due back
home safely; she goes on to the island's lookout. Lady Olivia arrives with Pip at her heels:
sympathetic (the whales are tired; her river went the wrong way one summer and never came back),
a little too sure ("free by breakfast"), and right that the pair is linked and that its tug will
get worse. Hiccup (the nosy calf) and Auntie Billow (the leader) are the whales the party knows
by name. The whales are never fought or ridden.

## Rhythm

| Movement | What the table does |
| --- | --- |
| The bowl (≈6 min) | Meet Juniper and the question; hold on as Hiccup tips the island (roll); meet Billow; find what turns the whales (listen, rope walk, a duskrunner's leap or a starweaver's reading, rolled) |
| The pair (≈8 min) | See two openings beat as one; Olivia and Pip; test the link (hum roll or pebble aim game); work out the echo; **force or understand** Hiccup out of the pull |
| The offer (≈7 min) | Olivia's shortcut; the island lurches (roll); Juniper's costs; Pip's choice: hang Olivia's bell or learn Juniper's lanterns; rest; the chime's lean |
| Dawn (≈9 min) | Lead Billow out the slow way (road-song memory game, lantern roll, Pip's count or Hiccup); Olivia's case and Juniper's; the promise to carry news; stay all night and guide the herd, or sleep on it and choose on the map |

## Consequences

| Choice | Immediate result | Later |
| --- | --- | --- |
| Haul Hiccup out (force) / sing him out in the quiet beat (understand) | Freed fast, herd scatters, Olivia and Pip stay / slow, Olivia leaves to set up her bell | Forcing startles the herd (a longer road song at dawn) and a failed haul notches Hiccup's fin; a sung-out Hiccup trusts the party: he can lead Billow at dawn and the whole herd that night |
| A failed hum, pebble or bell carry | The herd remembers | Same as forcing: the dawn's road song is longer |
| Hold the island (ropes, stones, a thornguard's brace) | Held / supper lost over the edge | The rest: oat bars instead of barley cakes, and sharing your own supper heals |
| Pip hangs Olivia's bell / helps Juniper | Pip proud of the bell / Pip with a lantern | Lanterns: "Let Pip count the beats" makes the dawn roll easier; both color Olivia's case and the decision |
| Promise to carry news, or not | `sky_followup_promised` true / false | The island due back offers the whale report only to a party that promised |
| Stay and guide the herd / sleep on it | A long night (rolled; a miss costs a heart) or Hiccup leads them / a night's talk with Olivia or Juniper | Stay: `whales_guided`, the pair opens now, Olivia's way is closed. Sleep: both rift actions stay on the map (`olivia` sets `olivia_trusted` + `whales_scattered`; `guide` sets `whales_guided`) |

Failed rolls cost a heart (tether post, yarn, rope walk, haul, bell, the long night), reroute
(a failed listen sends the party out on the rope walk) or change a later task (a startled herd,
a lost supper, a slow dawn). No fight, no setback ending. The chapter sets no journey flag but
`whales_guided` (gentle ending only) and `sky_followup_promised` (every path). Local flags start
false at the entry and are cleared once their last reader is behind every party, which keeps
the route walkers finite.

## Shape and pacing

| | Before (Oct 31) | After (Nov 2026) |
| --- | ---: | ---: |
| Reachable scenes | 38 | 57 |
| Dice checks | 0 | 17 |
| Games / inert | 14 / 8 | 4 / 0 |
| Echo votes | 2 | 0 |
| Scenes with a quoted line | 19 | 36 |
| Spine scenes / votes / checks | 23 / 5 / 0 | 32 / 9 / 6 |
| Spine longest reading run | 5 | 2 |
| Spine words | 847–850 | 1,812–2,033 |

Planned minutes only; no family has played this version. Tests:
`tools/content/riftlight-whale-road.test.ts`.
