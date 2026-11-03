# Node design — Glacier of Origins (`glacier-survival`)

**Status:** revised in November 2026 against [arc.md](../arc.md) (Opening). Depth: revise.

**Question:** *Can we get the kid home and find somewhere warm?* **Beat:** the yetis have taken the party in; the kid is home; the party knows the snow came from here and has learned the low song.

**What it adds to the clue trail.** Every party hears where the snow went (the arrival says it; the herder says "so that is where my snow went" whichever way the party greets her), sees loose snow and the harbor slush on their own boots drift back *uphill* at the drift (the campaign's first "moved things go home" image), and hears the herder say "The melt has been strange since the mountain woke": true after every Gemfall ending, and it names none. The close asks the question again with this piece added ("why is a glacier spilling onto a harbor, and why does its snow walk uphill?") and greets the cloaked griffin and unicorn for the departure.

**Rhythm.** Alone with the kid in the snow (the herder's distant "Hoo-up!" carries the lonely stretch), the drift and the tin, the herder, the channel, settling the herd, the door, the singing hall (rest, the Conservatory), the low song and the seam, the changing melt, the ledge, the travelers.

**Consequences.**
- *Tell the herder about the fold* earns a honeycake; *ask for help* earns her warm blanket (heal 1).
- *The door* is the force-or-understand choice: carry the kid in (sure, but every hoof finds a shin: 1 damage) or hum along with the hall's note (a heart check; success costs nothing and the hall greets "the one who hummed at the door"; a squeak means a cold wait, 1 damage).
- *The tin* is a real try (dig or pry): a miss leaves its four coins for the next lost traveler. A collapsed snow lip (`crust_hold` miss) costs everyone a collar full of snow.
- *A wobbly note* (`note_try` miss) cracks the seam: the herder will not let you hum at it again; the note is still learned.
- Kept: `learned_glacier_note`, `tested_singing_seam`, one of `marked_glacier_drift` / `sheltered_kid_on_detour` / `found_drift_hollow`, `made_glacier_shelter`, `crossed_melt_dry`, `helped_glacier_herder`, the Conservatory. The hall now heals 4: it is where the yetis take the party in, and it lets the route walk merge the many small bruises before it.

| | scenes | checks | games | inert | echo | quoted | spine | votes+checks | read | words |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| before | 68 | 11 | 5 | 5 | 3 | 30 | 39 | 17 | 2 | 1518–1613 |
| after | 66 | 14 | 4 | 2 | 0 | 62 | 38 | 17 | 3 | 1775–1928 |

The two inert games left (`kid_burrow`, the kid's hide-and-seek, and `shelf_cross`) are free play with the kid and the herder, kept on purpose.
