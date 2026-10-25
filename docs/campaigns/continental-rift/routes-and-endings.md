# Riftlight: routes and endings

All 24 story nodes are authored, from the Exchange to three glacier endings.
The six final chapters are Stuttering Flats, Bone Yard, Wyrm Nest, Squall Temple,
Convergence and Finale. There are no development pause nodes or placeholder
endings.

Riftlight is shipped: `content/campaigns/riftlight.json`, its chapters in
`content/chapters/riftlight-*.json` and its battle maps in `content/maps/`. It
is `listed`, so every household's lobby offers it beside Gemfall, locked by
`requires: ["gemfall"]` until Gemfall is finished. The owner published it ahead
of timed family playtests (see Production gates).

**XP.** The agreed 140 / 650 / 140 awards are kept: 140 for each ordinary
chapter and 650 at the convergence, paid once per chapter per attempt. The
graph admits longer routes than the design bible's original 11–16-node
estimate. An abstract search of the graph (review on #405, not an
engine-driven playthrough) found a route through all 24 places, and every
chapter's award once is 3,870 XP, the most any route can pay. That is welcome: level 8 is not a cap (the curve
runs to 10 today and is meant to grow, perhaps toward 30), and exploring a
new place should pay. `tools/content/riftlight-xp.test.ts` pins the awards.
The open progression question is replay, not height: a new attempt after
finishing a campaign pays its chapters again (#407).

## Play locally

```sh
npm ci
npm run riftlight:preview
```

Open http://localhost:5173 and start a Party or Travel game. Stop other dev
servers first. The launcher copies the shipped content into a temporary root
with temporary saves and drops Riftlight's Gemfall prerequisite there only.
Each launch starts fresh; keep it running to resume between sessions. Closing
the launcher removes its staged files and saves.

The shipped campaign keeps `requires: ["gemfall"]`. Preview heroes start
at ordinary creation level, so use an appropriately developed party when
assessing combat balance; automated board tests do not replace that playtest.

## The completed routes

| Part | What the party does |
| --- | --- |
| Exchange, glacier and departure | Rescue the kid, survive the glacier, learn its note and receive the Listening Chime. |
| Shelf, hidden opening and washout | Choose an ice-shelf route, discover the sung-note opening, or reach different river exits. |
| Forgotten Paths | Count a moved stone, cross a changed valley, compare memory ice, and make room for readers and a frost wyrm. |
| Wandering Sky | Meet the island keepers, guide or scatter the whales, investigate the island due back, and shelter a temple in a squall. |
| Restless Coast | Study a buried bridge, return a stranded goat through an unstable opening, and clear a route past displaced Bone Yard ruins. |
| Convergence | Bring two completed regional discoveries together, respond to Olivia's experiment and learn Manipulate. |
| Finale | Learn who is moving the land, anchor its present shape, close the last seam and choose a future after the battle. |

Every strand has an onward route after its local challenges. The Bone Yard
guide's checked route allows Old Ossley's next-tide ferry upriver to Ashspan.
The Sky temple has a griffin flight back to the Cairnstep; the glacier builders
join that rescue network. Existing rift conditions and single-use rules stay
intact. Keys are the reading room, buried bridge and island due back; completing
any two unlocks convergence from the appropriate strand end. The third remains
optional. Fragments are knowledge, never inventory items.

## Consequences and endings

The wyrm can become a neighbor and later ally, be driven away, or keep its nest
while the builders relocate. The temple's landing can be diverted, safely
settled beside the island, or damaged and closed for morning repairs after a lost fight. Ordinary
failed checks change methods and costs, then continue; they do not end a chapter.

At convergence, trust from the whale opening plus stopping Olivia yields her
redeemed path; trust plus standing beside her yields an ally; without that trust
she leaves as a rival. Orin's intervention requires the earlier shared chime
readings and counts as helping Bram. Pip mirrors the party's intervention.
Olivia makes one summoning; heroes never summon rifts. Manipulate holds a
condition and cannot change a destination, use limit or return behavior.

The finale offers **The Glacier Keepers**, **The Ones Who Listened**, and the
completing setback **Rivers Wander** after a lost battle and a failed recovery attempt.
The first loss brings everyone to the watcher, spends the extra support and leaves
some places shifted. A different attempt uses the retreat signals and ridge brace;
success still offers both futures, with a scar on the map. Only its failure ends
the campaign at Rivers Wander.
Two discoveries anchor the present land. A third discovery or either allied
Olivia or wyrm can supply one additional anchor, capped at three; choosing that
support selects a weaker opponent with one fewer crawler. The party can instead
keep the reserve team on the rescue lane. Combat can end by closing the seam's
actual board objective, without knocking Corvane down.

## Review and verification

The [design index](README.md) links the
opening and regional continuity reviews. The final chapter reviews are:

- [Stuttering Flats](stuttering-flats-review.md)
- [Bone Yard](bone-yard-review.md)
- [Wyrm Nest](wyrm-nest-review.md)
- [Squall Temple](squall-temple-review.md)
- [Convergence](convergence-review.md)
- [Finale](finale-review.md)

```sh
npx vitest run riftlight
npm run typecheck
npm run content:validate
npm run content:continuity
```

Tests read the shipped files alongside Gemfall and use the real content gate. Chapter
walkers exhaust choices and dice extremes, check literal introductions and
prerequisites, and enumerate declared encounter outcomes. Separate finale board
tests run READY, MOVE and END_TURN through both real fights to objective victory
and whole-party defeat. They do not claim to measure combat balance or family
elapsed time. Every new chapter has an on-screen goal and a rest waypoint.

## Production gates

Published by the owner before these were measured: family timing and route XP
are still to be checked at real tables. `playtest-observations.json` (beside
this file) still contains no invented measurements; record real ones there. The short prologue remains a compact draft. New ordinary
chapter metadata budgets 35 minutes (finale 40); model predictions are explicitly
uncalibrated. Preserve the four class rooms and the singing hall's repeatable
free healing.

## Canon class hubs (#483)

The Rookery stays at the Exchange and the Conservatory stays on the Glacier of Origins.
The Dojo and its pillow lesson now sit off the sheltered rest path in `sky-islands-arrival`,
in the Sky Islands. Its keeper's welcome and edge-marking beat still finish that chapter.

`ashspan-bridge` spans the bridge and a village in the Whispering Marsh. After helping
travelers board, the party follows a posted raised footpath into the marsh to fetch a dry
reed mat for the ferry deck. The village bench is a rest with a side door to the Academy
and its telescope lesson. Every path carries the mat back to Ossley before the ferry-route
ending. No hub remains at the glacier camp. The campaign keeps 24 nodes and its XP budget;
these visits are inside their host chapters. The singing hall still heals for free.

The ungated long bank road runs from the departure camp to Ashspan Bridge. An upper bank
road connects the bridge to Frostfang Shore and its Cairnstep path, where the griffins offer
a flight to the Sky Islands. These routes keep both relocated hubs reachable for every party,
including parties that decline a rift or lose the shelf crossing.
