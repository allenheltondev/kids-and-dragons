# Riftlight — authored opening

Eighteen playable story nodes and eleven development pause boundaries, using the [design bible](../../../docs/campaigns/continental-rift/README.md).
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
Short arrival episodes give each route a concrete landing. Eleven biome-matched `preview-pause-*`
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

The three prologue chapters remain compact first drafts, not measured 30–40-minute chapters. The uncalibrated pacing
revised model predicts roughly 11 minutes for the Exchange, 15 for survival and 9 for departure, before
extra table conversation. Metadata budgets 15 / 15 / 10 minutes pending a real table playtest.
Keep the departure encounter brief as the character bible requests. Expand the first two
through consequential play if table timing calls for it, rather than adding narration pages.
The [required family playtest gate](../../../docs/campaigns/continental-rift/opening-playtest.md)
is not passed. Record actual times and child engagement in `playtest-observations.json`; no
measurements have been invented. The 30–40-minute ordinary-node goal remains unresolved until
playtests support it or a shorter prologue goal is explicitly recorded.
Each pays the agreed 140 XP, with no extra objectives that could push the campaign over its cap.

The next authoring slice continues with the island due back and the stuttering flats,
then the remaining strand ends and convergence. The first Coast fragment and the initial regional discoveries are now playable. Full-campaign XP-route acceptance remains unfinished. The current preview
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

## Class rooms (#315)

The four class places ([docs/class-mastery.md §2](../../../docs/class-mastery.md)) are side rooms
of existing places, each entered from that place's `rest` scene and leading back to it. Each is a
room scene marked `classPlace` and one short lesson scene.

| Room | Class | Place, off which rest | Teacher, and the detail |
| --- | --- | --- | --- |
| The Rookery | Duskrunner | The Exchange's rooftops, up a ladder from `quay_rest` (new, on the quay after the barge) | The crows, as a flock. A sign on the chimney: NO MESSING. (WITH US.) A tiny doormat. |
| The Conservatory | Songkeeper | Through a glass door off the singing hall's `hall` rest | Aunt Bellow, a yeti who conducts with a carrot; the plants lean toward the best singer. |
| The Dojo | Thornguard | A stone hut up the slope from the Riftseekers' `camp` | Master Dunnick, a bigfoot holding the door shut against the wind for forty years; pillows. |
| The Academy | Starweaver | A roofless tower above the Riftseekers' `camp`, beside the Dojo, until the marsh village is written | Professor Nettle, a dragonling; no roof, homework floats away, the telescope sneezes. |

Every room introduces its teacher on every visit. Leaving it sets a chapter flag (`met_the_crows`,
`met_aunt_bellow`, `met_master_dunnick`, `met_professor_nettle`) that a shorter repeat-visit variant
reads, so only a second visit inside the same chapter reads shorter. `camp` was an ending
and is now a waypoint; `set_out` ends the departure chapter.

The Academy belongs in the marsh village ([docs/class-mastery.md §2](../../../docs/class-mastery.md)).
Riftlight's story does not have that place yet; when it is written, the Academy moves there, and
the camp tower is where it stands until then.

The singing hall's rest heals 2 on every arrival, so a party can walk into the Conservatory and
back to heal again, as often as it likes. That is deliberate: the game always keeps somewhere to heal
for free, and in Riftlight this is it. Do not "fix" it by making the hall heal once. The walker answers
`KEEP_CLASS` at a room by default, or switches (`allPaths(..., "switch")`); see
`tools/content/riftlight-class-rooms.test.ts` and, through the server,
`packages/server/src/handlers/riftlight-class-rooms.test.ts`.

## Regional discoveries

This slice adds `stone-counters`, `whale-road`, and `buried-bridge`.
See the [regional continuity review](../../../docs/campaigns/continental-rift/regional-continuity-review.md).
The stone counters teach shrinking motion and Attune if needed. The whales offer gentle
navigation or Lady Olivia's early opening. The buried bridge gives the first Coast clue,
with optional sharing of chime readings with Orin. All three have explicit development pauses.

Carry `whales_scattered` into the island-due-back navigator problem, `olivia_trusted` into
her eventual epilogue, and `orin_chime_shared` into the convergence's noncombat option.
`fragment_coast_learned` records knowledge; completing `buried-bridge` is the Coast key-node
completion. Neither creates an item. The reading room now provides the Paths key node; convergence and the Sky key node remain unwritten.
The `saltrot_arrival_*` flags identify the latest crossing and are reset together on entry.
These regional chapters now have substantive investigations on every main path, with 14
decisions and six checks each. Their family pacing remains unmeasured. The
[regional pacing report and production gate](../../../docs/campaigns/continental-rift/regional-pacing-gate.md)
records the expansion, shortest-path estimates and real-play requirements before production.

`riftlight-route-prerequisites.test.ts` separately proves the regional entry facts using
actual introductions on every chapter ending and intersection across every incoming graph
edge, including guarded and return edges. The departure chapter grants the chime without the
test fixture seeding it; downstream chapter paths must preserve it. Negative shortcut checks
prove that bypassing the prologue invalidates the regional prerequisite guarantees.

The regional chapters now use dedicated `stone-counters`, `whale-road`, and
`buried-bridge-dry-channel` scene illustrations. The whales' cleared ending uses a matching
`whale-road-cleared` view with the whales gone and the neutral pair open. The original wet-flat bridge
illustration is preserved. [Generation prompts and references](../../../art/source/riftlight/scenes/regional-generation.md)
accompany the source PNGs; runtime exports are 1920×1080 WebP.


Evidence close-ups show the ambiguous chipped count and pictorial slates only after those
objects have been introduced, and the bridge waterline/rounded pebbles only when inspection
reveals them. No definitive count, date or secret explanation is added. The whale aftermath
appears only at the gentle ending; the undecided offer retains the circling-whale scene.
[Evidence/aftermath prompts](../../../art/source/riftlight/scenes/evidence-generation.md) and
source PNGs accompany the runtime WebP assets.


## Forgotten Paths: changed river and memory ice

`stone-counters` now continues through `the-wrong-valley` to `reading-room`. Both are ordinary
35-minute planning budgets with 14 decisions on the shortest modeled path, rather than brief
transitions. The river crossing has seven checks; the reading room has six. Existing glacier
and reading-room illustrations supply the backdrops. Both nodes offer a return route and an
explicit preview pause, and use pass revisits so the temporary river change is not replayed.

`valley_crossed_high` records the route actually used, including a backup after a failed plan;
`wrong_valley_witnessed` records the witnessed change. `fragment_paths_learned` is knowledge,
not an item. `memory_notes_shared` records permission to leave the party's account with the
keepers. A party that already completed the buried bridge gets a checked Coast comparison;
other routes never pretend to have found that clue. The memory remains local, undated and
unexplained. No convergence, wyrm encounter or finale is implied by the development pauses.

See the [northern continuity review](../../../docs/campaigns/continental-rift/memory-paths-continuity-review.md).
Run the new route/producer tests with `npx vitest run tools/content/riftlight-memory-paths.test.ts`.
The shared pacing report now covers five ordinary regional nodes; real family timings remain
pending for all of them.

The reading room retains independent evidence, ridge/rock method, keeper endorsement,
catalog usability and permission to publish as separate flags. Later citations, the newcomer
lesson and keeper reactions use those results. Only a successful catalog trial can produce
a public visitor guide; an assisted copy stays staff-guided. Chapter arrival resets these
local investigation flags. Run `npx vitest run tools/content/riftlight-reading-consequences.test.ts`
for four complete consequence routes; automated play does not replace timed family play.

## The returning island

`whale-road` now continues to `the-island-due-back`, the Sky key node. Welcome the
returning island, choose between recovering sealed letters and readying the lookout,
cross under keeper signals, and compare the old mooring stone with the land below.
Whale history changes a sighting method; preparation and evidence checks affect later
options, keeper help, warning resources and credit. Copying remains voluntary.
Every route learns `fragment_sky_learned` without taking an object or revealing the
islands' origin. Return to the whale-road hub or use the explicit development pause.

See the [island review](../../../docs/campaigns/continental-rift/island-continuity-review.md).
Run `npx vitest run tools/content/riftlight-island.test.ts` for complete engine-played
consequence routes. The pacing report now covers six ordinary regions; family timing
and the production gate remain pending. The temple continuation remains unwritten.

The island's joined-land inference now appears only after a successful comparison
or a player-chosen assisted follow-up. Failed landings offer batch carrying with a
delayed message relay versus borrowing a lighter kit. These recoveries add decisions
without rerolls; incomplete tests stay credited as incomplete.
