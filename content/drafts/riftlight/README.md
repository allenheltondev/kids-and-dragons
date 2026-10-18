# Riftlight — authored opening

Fifteen playable story nodes and eight development pause boundaries, using the [design bible](../../../docs/campaigns/continental-rift/README.md).
Gemfall anchors the read-aloud rhythm, tangible choices and visible consequences. The narrator
describes what happens instead of telling the table what sort of thing it is or how to feel.

## Play locally

```sh
npm ci
npm run riftlight:preview
```

Open http://localhost:5173 and start a Party or Travel game. Stop other dev servers first so
the preview uses the normal ports. The launcher selects **Riftlight — opening preview**, stages
the chapters and Listening Chime catalog in a temporary content tree, and uses a separate
temporary save directory. Each launch starts fresh; leave it running to resume between sessions.
Stopping the preview removes its staged content and saves after both dev processes close.
The preview skips the Gemfall prerequisite so you can test immediately. New preview characters
are stand-ins at the usual creation level; tests also walk the content as Sworn characters.

Nothing in this directory is loaded by the normal lobby, deployed, or projected into the normal
item catalog. The staging helper merges the chapter's `props` only into the temporary catalog.
These files are ordinary chapter JSON, validated with the same gate as shipped content.

## Written

| Node | Chapter | What the party does |
| --- | --- | --- |
| `exchange-rift` | `riftlight-exchange-rift` | Help a supply barge whose landing moved, investigate displaced arrivals, see kindness repaid during the kid rescue, and cross the first rift together. |
| `glacier-survival` | `riftlight-glacier-survival` | Navigate an unmarked drift, protect the kid, cross a melt channel, and test the singing seam after learning its note. |
| `riftseekers-departure` | `riftlight-riftseekers-departure` | Choose a priority in Orin and Olivia's practical disagreement, hear two purposeful leads, and receive the Listening Chime. |

The preview now plays the first fork. The shelf leads to the Cairnstep or the river challenge;
the hidden opening leads to the Saltrot and offers a linked return. River escapes reach
Frostfang shore, the boundary stones, Ashspan Bridge, or a one-way Sky Islands crossing.
Short arrival episodes give each route a concrete landing. Eight biome-matched `preview-pause-*`
chapters are explicit development boundaries, pay no XP, and must never enter production.
Their five-minute metadata is the schema minimum, not a measured duration.

Failed rolls cost a little harm and change the immediate result; every path continues. No
setback ending, early antagonist reveal, or assumption about the party's Gemfall ending.
The wing, Smash, Brace and Songkeeper options enable team checks: the qualified hero supplies
the ability while the best roller handles the line or guides the group. Failure harms that
roller, without pretending they have their teammate's wings or class ability.
Story narration never announces diagnostic rift colors. The first rift's colors appear through
the existing private Starweaver view at the exit; the in-chapter reading records the choice
for Seren's callback without duplicating that private view in shared text.

## The route slice

See [route implementation and review](../../../docs/campaigns/continental-rift/routes-continuity-review.md)
for all new nodes, the river rift placement, nonlethal harm, linked-rift return and first-crossing
Riftspark behavior. Ordinary story damage is unchanged. The short regional arrivals teach Attune
once, as journey state, whichever region is visited first. The Saltrot uses its canonical biome
with explicit existing scene art; it has no invented combat tileset.

## Continuity to carry into the next nodes

| State | Meaning / later use |
| --- | --- |
| `noticed_the_sky_ship` | Met Captain Thimble, a chapter-scoped kitsune captain. Reintroduce her at Sky Islands arrival, with a callback if this flag is set. |
| `starweaver_read_first_rift` | Voluntarily read the first opening. Seren recognizes this at departure. |
| `learned_glacier_note` | Guaranteed on every survival path. The hidden glacier rift's sung-note requirement can read it. |
| `helped_glacier_herder` | Stayed to help with the blankets; use for a later local recognition. |
| `made_glacier_shelter` | Built a windbreak; optional return detail. |
| `crossed_melt_dry` | Crossed the melt channel without the herder's rescue. |
| `helped_fish_seller` | Moved the fish under cover; optional Exchange callback. |
| `saved_barge_supper` / `found_barge_mooring` | Which immediate supply rescue the party chose; the pilot helps during the quay rescue. |
| `marked_glacier_drift` / `sheltered_kid_on_detour` / `found_drift_hollow` | Which self-directed route got the party through the drift. |
| `tested_singing_seam` | Every route repeats or observes the note response. The ice remains sealed. |
| `listening_chime` | Guaranteed quest prop from departure. Sour means not ready; echo means an open return route. |
| `riftspark` | Granted on crossing the one-use rift: +2 on one chosen check; expires after the next chapter. |

The goat reaches the glacier on every path and is returned to its herd on every survival path;
there is no goat outcome flag. Attune is earned at the first regional lesson. Olivia has **not** summoned anything.

## Pacing and remaining work

These are compact first drafts, not finished 30–40-minute chapters. The uncalibrated pacing
revised model predicts roughly 11 minutes for the Exchange, 15 for survival and 9 for departure, before
extra table conversation. Metadata budgets 15 / 15 / 10 minutes pending a real table playtest.
Keep the departure encounter brief as the character bible requests. Expand the first two
through consequential play if table timing calls for it, rather than adding narration pages.
The [required family playtest gate](../../../docs/campaigns/continental-rift/opening-playtest.md)
is not passed. Record actual times and child engagement in `playtest-observations.json`; no
measurements have been invented. The 30–40-minute ordinary-node goal remains unresolved until
playtests support it or a shorter prologue goal is explicitly recorded.
Each pays the agreed 140 XP, with no extra objectives that could push the campaign over its cap.

The next authoring slice continues through the wrong valley, the island due back and the
stuttering flats. The first Coast fragment and the initial regional discoveries are now playable. Full-campaign XP-route acceptance remains unfinished. The current preview
graph is linted and replayed with no softlocks; its pauses are not campaign endings.

For production integration:

1. Create `content/campaigns/riftlight.json` using the agreed full graph and `requires: ["gemfall"]`.
2. Move approved chapters to `content/chapters/`, changing their `campaignId` to `riftlight`.
3. Keep these node and chapter ids; replace the preview pause nodes with the agreed regional edges.
   Revisit policies in the preview are temporary too: implement the bible's changed glacier
   visits and `pass` departure hub in the full graph.
4. Generate the real item catalog from the departure prop with `npm run canon:items`.
5. Validate full routes, revisits, class-free access, progression and no-softlock coverage.

## Verification

```sh
npx vitest run tools/content/riftlight-opening.test.ts tools/content/riftlight-routes.test.ts tools/content/riftlight-continuity.test.mjs
```

Tests stage the content alongside Gemfall, run the actual content gate, walk the journey through
the graph runtime, and exhaust chapter choices with low/high dice across all six species and
all four classes. They check the guaranteed song/chime and Seren's carried-flag callback.

The [scene-by-scene continuity review](../../../docs/campaigns/continental-rift/opening-continuity-review.md)
covers the initial 80 scenes; the [route review](../../../docs/campaigns/continental-rift/routes-continuity-review.md) covers the 83 added scenes, including ordinary objects and actions the proper-name sweep cannot detect.
`continuity.json` records their narrative dependencies and introduction wording. The real-engine
walker checks that each path establishes what later scenes refer to, including across chapter
boundaries and conditional callbacks. New scenes require an explicit review entry.

## Regional discoveries

This slice adds `stone-counters`, `whale-road`, and `buried-bridge`.
See the [regional continuity review](../../../docs/campaigns/continental-rift/regional-continuity-review.md).
The stone counters teach shrinking motion and Attune if needed. The whales offer gentle
navigation or Lady Olivia's early opening. The buried bridge gives the first Coast clue,
with optional sharing of chime readings with Orin. All three have explicit development pauses.

Carry `whales_scattered` into the island-due-back navigator problem, `olivia_trusted` into
her eventual epilogue, and `orin_chime_shared` into the convergence's noncombat option.
`fragment_coast_learned` records knowledge; completing `buried-bridge` is the Coast key-node
completion. Neither creates an item. Convergence and the other two key nodes remain unwritten.
The `saltrot_arrival_*` flags identify the latest crossing and are reset together on entry.
These compact chapters have unmeasured pacing; the family playtest gate remains open.
