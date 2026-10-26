# Issue 494: Riftlight opening art, first delivery

This priority batch delivers **eight cast cutouts (seven identities, two Tilly states)** and **nine scene paintings**. Generated with the built-in `image_gen` tool; exact final prompts and reference inputs are in [sources.json](sources.json). Raw source images are in `art/source/issue-494/`. This is a partial delivery of the issue's wishlist, not a claim that every requested painting or animation has shipped.

- [Cast contact sheet](cast-contact-sheet.jpg)
- [Scenery contact sheet](scenery-contact-sheet.jpg)
- [Changes against this workspace's starting files](workspace-chapters.patch)
- [Changes against the expanded opening branch](expanded-chapters.patch)

## Delivered cast

| Asset ID under `assets/cast/` | Role |
| --- | --- |
| `dob` | Cheerful kite seller, cart and upside-down map. The story does not specify a species; this illustration uses a bigfoot. |
| `tamsin_river_keeper` | Griffin river-line keeper, green feathers, rope and bell. Separate from Gemfall's existing kitsune `tamsin` (Tamsin Three-Cards). |
| `pebble` | Young griffin apprentice, inked beak and wing, rolled survey page. |
| `bryn` | Dragonling bridge-mender with apron, timber and wedges. |
| `tilly_eggs` | Griffin egg farmer before the eggs hatch. |
| `tilly` | Same character with a duckling after the hatch scene. |
| `boundary_runner` | Breathless young dragonling messenger with scarf and satchel. |
| `snowhorn_kid` | Distinct small goat with short horns and a bell collar. |

Each directory contains a transparent 1024px `assembled.png`, grounded at y900, and a 512px WebP portrait. Sizes are declared in the manifest and projected into the generated stage height table.

Brask is the existing griffin pass keeper: the expanded content now names that figure Brask instead of commissioning a duplicate. The Saltrot guide already has a staff, shoulder wrap, shells and basket, distinguishing him from the unadorned Skupper cousin; an existing puffed Skupper state is also available. State animation remains outside this batch.

## Delivered scenery

All files are opaque 1920x1080 WebP under `assets/scenes/riftlight/`:

- `sky-landing`: windy island edge and broken rope road.
- `signal-pole`: unlit signal basket and pole repair site.
- `signal-gale`: successfully lit signal basket at dusk.
- `sky-ferry`: ferry alongside the island landing.
- `windbreak-camp`: sheltered night camp, tea and hanging bells.
- `shelf-icicles`: iron ring, rope, narrow shelf and icicle curtain.
- `headwaters-floes`: river floes, ice arch, log jam and bank tree.
- `ashspan-broken-deck`: broken timber deck, muddy landing, cart and boat.
- `ashspan-mended-deck`: continuous repaired deck, sound braces and upright cart.

The repaired bridge source was revised after visual inspection to remove a remaining broken support. `ashspan-mended-deck-v1.png` is a superseded source study, never a registered runtime asset.

## Integration and validation

The current workspace contains the assets, manifest declarations, generated height table, and 30 compatible scene art assignments. Its shorter opening chapters were preserved. The expanded opening was separately verified in `tmp/issue-494-art`, based on `origin/claude/gameplay-feedback-notes-i5loy0` at `cc268c95`: 452 scenes receive art or cast changes there. No narration, choices, rules, effects, routing, rewards or pacing were changed in either version.

`expanded-chapters.patch` contains the expanded branch's manifest, chapter and generated-height changes. It expects the artwork from this delivery to be copied alongside it. It is an alternative to the workspace patch, not an additional patch to stack on it. The idempotent helper `python docs/reviews/issue-494/integrate.py <target-root>` applies matching assignments to either chapter version; regenerate the target's stage table with `npm run art:figures` afterward. `export.py` reproduces runtime art and portraits from the saved source PNGs using Pillow.

Verified:

- Mechanical art verifier: **1,047 checks passed**.
- Art inventory: **0 deliverables outstanding**.
- Current content validation: **116 passed, 2 warnings**.
- Expanded content validation: **117 passed, 2 warnings**.
- Current cast, art paths, generated sizes, cast report and cast gaps tests: **59 passed**.
- Same targeted suites on expanded content: **60 passed**. The isolated test config explicitly resolves that snapshot's local workspace packages; otherwise parent workspace dependencies read the older canon with newer schemas.
- All changed scene art paths exist, no stage exceeds three cast entries, and semantic comparison confirmed all non-art/cast chapter data stayed unchanged.
- Existing Gemfall Tamsin artwork was restored and checked byte-for-byte against the original Git blob.

Visual QA inspected exported cutouts and scene sheets, Tilly's pre-hatch state, and the revised repaired bridge. It did not include a live device playthrough. Detailed logs are beside this file.

The two Memory readers findings were reviewed as offstage mentions: `arrival` describes builders below the reading room, and `departure` offers returning to the readers. They were left off those stages intentionally. Existing Ossley assignments were retained, and missing Ossley cast entries were added to the expanded Ashspan work sequence, where he remains physically present.

## Remaining wishlist

Additional paintings for the other eight opening chapters, finer shelf/river sublocations, the exchange-rift plate, duckling entities/animation, the grit seller, interaction props and hero poses, water cues, note glyphs, item badge review, and coin flourishes remain. No interaction animations or new item art are delivered here. Keep issue 494 open for these follow-ups.

Git metadata is read-only in this session, so this delivery is saved locally with reviewable patches; no commit or pull request was created.
