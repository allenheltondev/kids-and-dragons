# Issue 494 — second delivery

**15 new scene paintings and two figures**, integrated into the expanded opening. The approved first delivery is also present in this worktree. This batch changes art or cast in **337 scenes**; semantic comparison confirms that all other chapter data is unchanged.

- [Scenery contact sheet](scenery-contact-sheet.jpg)
- [Figure contact sheet](figure-contact-sheet.jpg)
- [Exact source prompts and references](sources.json)
- [Explicit scene-to-art assignments](scene-assignments.json)
- [Chapter, manifest and height-table changes from the start of batch 2](chapter-changes.patch)

## Delivered paintings

Every painting is an opaque 1920x1080 WebP under `assets/scenes/riftlight/`.

| Location | New assets |
| --- | --- |
| Hidden glacier | `hidden-ticking-ridge`, `hidden-ice-tunnel`, `hidden-sealed-seam`, `hidden-ticking-fold` |
| Saltrot | `tidepocket-buried-hatch`, `tidepocket-open-hatch`, `saltrot-ossley-aground`, `saltrot-high-shells` |
| Frostfang shore | `frostfang-ladder`, `frostfang-gravel-bar` |
| Cairnstep | `cairnstep-survey-slab`, `cairnstep-capstone` |
| Boundary bank | `boundary-river-row`, `boundary-river-row-aligned`, `boundary-mountain-carving` |

The hatch stays closed through the excavation checks and opens on either rescue outcome. The aligned row is reserved for `fourth_ok`, the successful final adjustment; it is not shown on the failed adjustment. The capstone painting shows the stone waiting to be lifted and is used only for that check; the completed-cairn scene retains its existing finished landscape.

The first fold study resembled an outdoor mountain opening. The selected revision is an enclosed chamber with a thin fold, coastal glimpse and tally scratches. Its selected source is `hidden-ticking-fold-v2.png`; the first source remains an unregistered study. Both boundary-row paintings were inspected at full size and contain nine stones.

## Delivered figures

- `cast/yeti_grit_seller`: a young yeti with a sack of coarse grit, copper scarf, brown waistcoat and GRIT sign, appearing in `hidden-glacier-rift/footing_buy`. Manifest height: 145cm. Existing herder and goat remain on stage.
- `entities/duckling`: one transparent yellow duckling, used as a group of three in seven Ashspan hatch/rescue scenes. It occupies Bryn's third stage slot during that sequence, alongside Tilly and Old Ossley; Bryn has no dialogue in those scenes and returns afterward. This is an ordinary `stageFigures` animal, following the existing donkey/mule/pony convention, not a new mythical canon species. Manifest height: 20cm; the existing stage readability floor applies.

Both figures have 1024px RGBA exports grounded at y900, plus 512px WebP portraits. Source PNGs are in `art/source/issue-494/batch-2/`. The generated height table includes both entries.

The art verifier and inventory now include ordinary `stageFigures`, so the duckling and existing ordinary animals cannot silently escape delivery/format checks. Three regression tests cover a valid cutout, a missing animal and an opaque cutout. Ground registration was separately checked for both new exports; existing stage animals were not altered.

## Validation

- `python tools/art/verify.py`: **1,071 checks passed**.
- `node tools/art/inventory.ts`: **0 outstanding**, including **6/6 stage animals**.
- `node tools/content/validate.mjs`: **117 passed, 2 warnings**.
- Cast, art paths, generated figure sizes, cast reports/gaps, entity states, stage animals and environment coverage: **72 tests passed across 8 suites**.
- [Semantic comparison](semantic-check.txt): only `art` and `cast` changed in chapter data; all referenced files exist and every stage stays within three cast entries.
- `git diff --check`: clean.
- Both integration helpers are idempotent. Final contact sheets and revised fold/hatch/row states were visually inspected. No live device playthrough is claimed.

Detailed validation logs are beside this file. The sandbox prevents npm's workspace symlinks; verification used the existing installed test runner with explicit aliases to this worktree's local canon/shared sources, plus local parser dependencies. That temporary validation setup is under ignored `staging/` and does not alter the committed project configuration.

## Remaining work

- Exchange Rift market/dock vignettes and its missing story plate.
- Glacier Survival herd, cairn tin and snow-lip/stream material.
- Riftseekers' Departure sledge, tea rest and chime/ring scenes.
- Finer shelf/river sublocations beyond the first batch's broad establishing paintings.
- Interaction props, relay objects, snow mounds, note glyphs, hero poses and water-cue animation.
- Duckling animation/reaction states, richer Skupper family/weaver variants, and other requested reaction figures.
- Item icon review and the optional coins-found flourish.

These are stills and production cutouts, not a completed interaction-animation delivery. Keep issue 494 open.
