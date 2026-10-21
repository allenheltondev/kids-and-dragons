# Riftlight: complete story preview

All 24 story nodes are authored, from the Exchange to three glacier endings.
The six final chapters are Stuttering Flats, Bone Yard, Wyrm Nest, Squall Temple,
Convergence and Finale. Their PRs are stacked in that order. There are no
development pause nodes or placeholder endings in this preview.

This remains an isolated draft. It is not listed in the production lobby and
does not change deployed content, Gemfall or existing saves. Timed family
playtests and the full-campaign XP-route acceptance gate remain unfinished.
The current graph admits longer paying routes than the design bible's original
11–16-node estimate. The agreed 140 / 650 / 140 awards have been preserved, not
claimed to meet the level-8 cap on every route.

## Play locally

```sh
npm ci
npm run riftlight:preview
```

Open http://localhost:5173 and start a Party or Travel game. Stop other dev
servers first. The launcher stages chapters, encounter maps and the Listening
Chime into temporary content and uses temporary saves. It skips Gemfall only
for this isolated preview. Each launch starts fresh; keep it running to resume
between sessions. Closing the launcher removes its staged files and saves.

Production integration must retain `requires: ["gemfall"]`. Preview heroes start
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

The [design index](../../../docs/campaigns/continental-rift/README.md) links the
opening and regional continuity reviews. The final chapter reviews are:

- [Stuttering Flats](../../../docs/campaigns/continental-rift/stuttering-flats-review.md)
- [Bone Yard](../../../docs/campaigns/continental-rift/bone-yard-review.md)
- [Wyrm Nest](../../../docs/campaigns/continental-rift/wyrm-nest-review.md)
- [Squall Temple](../../../docs/campaigns/continental-rift/squall-temple-review.md)
- [Convergence](../../../docs/campaigns/continental-rift/convergence-review.md)
- [Finale](../../../docs/campaigns/continental-rift/finale-review.md)

```sh
npx vitest run riftlight
npm run typecheck
npm run content:validate
npm run content:continuity
```

Tests stage the draft alongside Gemfall and use the real content gate. Chapter
walkers exhaust choices and dice extremes, check literal introductions and
prerequisites, and enumerate declared encounter outcomes. Separate finale board
tests run READY, MOVE and END_TURN through both real fights to objective victory
and whole-party defeat. They do not claim to measure combat balance or family
elapsed time. Every new chapter has an on-screen goal and a rest waypoint.

## Production gates

Keep this campaign in drafts until family timing and route XP are accepted.
The original opening gate and `playtest-observations.json` still contain no
invented measurements. The short prologue remains a compact draft. New ordinary
chapter metadata budgets 35 minutes (finale 40); model predictions are explicitly
uncalibrated. Preserve the four class rooms and the singing hall's repeatable
free healing when integrating approved content.
