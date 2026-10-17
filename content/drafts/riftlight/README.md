# Riftlight — authored opening

Three playable first drafts, using the [design bible](../../../docs/campaigns/continental-rift/README.md).
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
The three files are ordinary chapter JSON, validated with the same gate as shipped content.

## Written

| Node | Chapter | What the party does |
| --- | --- | --- |
| `exchange-rift` | `riftlight-exchange-rift` | Investigate snow and displaced arrivals at the quay, help the dockside locals, rescue a snowhorn kid, cross the first rift together. |
| `glacier-survival` | `riftlight-glacier-survival` | Find shelter, cross a melt channel, return the kid, warm up in a yeti singing hall, learn its note. |
| `riftseekers-departure` | `riftlight-riftseekers-departure` | Meet Orin, Olivia and Seren as they pack up, hear the Cairnstep lead, receive and test the Listening Chime. |

The preview stops beside the singing hall **before the regional fork**. Its terminal graph
node exists only to make this development preview complete. It is not a Riftlight ending and
must never be copied into the production graph. The departure chapter itself ends normally;
the full graph will supply its onward exits.

Failed rolls cost a little harm and change the immediate result; every path continues. No
setback ending, early antagonist reveal, or assumption about the party's Gemfall ending.
The wing, Smash, Brace and Songkeeper options enable team checks: the qualified hero supplies
the ability while the best roller handles the line or guides the group. Failure harms that
roller, without pretending they have their teammate's wings or class ability.
Story narration never announces diagnostic rift colors. The first rift's colors appear through
the existing private Starweaver view at the exit; the in-chapter reading records the choice
for Seren's callback without duplicating that private view in shared text.

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
| `listening_chime` | Guaranteed quest prop from departure. Sour means not ready; echo means an open return route. |
| `riftspark` | Granted on crossing the one-use rift: +2 on one chosen check; expires after the next chapter. |

The goat reaches the glacier on every path and is returned to its herd on every survival path;
there is no goat outcome flag. Attune is **not** earned yet. Olivia has **not** summoned anything.

## Pacing and remaining work

These are compact first drafts, not finished 30–40-minute chapters. The uncalibrated pacing
model predicts roughly 8 minutes for the Exchange, 10 for survival and 7 for departure, before
extra table conversation. Metadata budgets 15 / 15 / 10 minutes pending a real table playtest.
Keep the departure encounter brief as the character bible requests. Expand the first two
through consequential play if table timing calls for it, rather than adding narration pages.
Each pays the agreed 140 XP, with no extra objectives that could push the campaign over its cap.

Next authoring slice: `ice-shelf-traverse`, `hidden-glacier-rift`, then `headwaters-washout` and
its arrival nodes. Connect the two-way glacier/Saltrot rift with a linked pair, and give every
river branch an onward route. Full graph coverage and XP-route acceptance remain unfinished.

For production integration:

1. Create `content/campaigns/riftlight.json` using the agreed full graph and `requires: ["gemfall"]`.
2. Move approved chapters to `content/chapters/`, changing their `campaignId` to `riftlight`.
3. Keep these node and chapter ids; replace the preview ending with the agreed onward edges.
   Revisit policies in the preview are temporary too: implement the bible's changed glacier
   visits and `pass` departure hub in the full graph.
4. Generate the real item catalog from the departure prop with `npm run canon:items`.
5. Validate full routes, revisits, class-free access, progression and no-softlock coverage.

## Verification

```sh
npx vitest run tools/content/riftlight-opening.test.ts tools/content/riftlight-continuity.test.mjs
```

Tests stage the content alongside Gemfall, run the actual content gate, walk the journey through
the graph runtime, and exhaust chapter choices with low/high dice across all six species and
all four classes. They check the guaranteed song/chime and Seren's carried-flag callback.

The [scene-by-scene continuity review](../../../docs/campaigns/continental-rift/opening-continuity-review.md)
covers all 67 scenes, including ordinary objects and actions the proper-name sweep cannot detect.
`continuity.json` records their narrative dependencies and introduction wording. The real-engine
walker checks that each path establishes what later scenes refer to, including across chapter
boundaries and conditional callbacks. New scenes require an explicit review entry.
