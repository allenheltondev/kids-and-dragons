# Issue 494 — third delivery

**10 new scene paintings and 13 transparent reusable props**, plus a standalone motion review. Chapter assignments change art or cast in **87 scenes**. The earlier two deliveries remain intact.

- [Scenery contact sheet](scenery-contact-sheet.jpg)
- [Prop contact sheet](props-contact-sheet.jpg)
- [Offline motion preview](motion-preview.html)
- [Desktop motion review screenshot](motion-preview-desktop.png)
- [Phone review screenshot](motion-preview-mobile.png)
- [Exact final prompts, source PNGs and reference inputs](sources.json)
- [Scene assignments](scene-assignments.json)
- [Manifest/chapter changes](chapter-changes.patch)

Generation used the built-in `image_gen` tool. All selected sources are saved under `art/source/issue-494/batch-3/`. Runtime scenery is opaque 1920x1080 WebP; props are 512px RGBA WebP with at least 24px clear margins.

## New paintings

| Chapter/location | Assets under `assets/scenes/riftlight/` |
| --- | --- |
| Exchange Rift | `exchange-noodle-awning`, `exchange-barge-sacks`, `exchange-leaning-crates` |
| Glacier Survival | `glacier-snow-lip`, `glacier-meltwater-step`, `glacier-herd-rest` |
| Riftseekers' Departure | `departure-loaded-sledge`, `departure-chime-rest` |
| Shelf crossing | `ice-shelf-roped-gap` |
| River log jam and chute | `headwaters-log-chute` |

The barge painting was revised to make the shifted lower steps visibly unsafe and remove sack lettering. Its selected source is `exchange-barge-sacks-v2.png`; the original remains a source study. The glacier herd painting contains adults only, leaving the rescued kid to the cast layer. Exchange and Glacier scenes now use the approved `cast/snowhorn_kid`, matching the same kid in Hidden Glacier Rift.

The rope-crossing painting is reserved for the ready/crossing scenes, after the line is in place. Interior hall and class-school scenes keep their existing art.

## Reusable props and motion

The new manifest section `storyProps` declares 13 objects under `assets/story-props/`:

- `rope-loop`
- Relay cargo: `relay-sack`, `relay-log`, `relay-plank`, `relay-hay`, `relay-oil-jar`, `relay-scarf`, `relay-trunk`
- `snow-mound` and `water-surge`
- `note-low`, `note-middle`, `note-high`

The bronze note glyphs use one curl, two arches and three rays, so their identity is carried by shape rather than color. The mound is unmarked, allowing identical tracking covers. The review composites the already-approved goat kid behind the middle cover.

`assets/story-props/motion.css` supplies whole-object swing, relay travel, sway, surge, pulse and peek presets. Duration and preset are declared per asset in the manifest. The production CSS respects `prefers-reduced-motion`; the review additionally provides pause and reduced-motion controls. These are decorative motion primitives and compositing studies, not new hero poses, sprite-frame animation or authoritative interaction timing.

### Gameplay connection still required

This worktree predates the merged [interaction mechanics PR 495](https://github.com/allenheltondev/kids-and-dragons/pull/495): it has no `StoryInteraction` screen or interaction scene type. The scenery is wired to the chapter IDs available here. Props are registered, exported, mechanically checked and previewed, but **are not yet hooked into live interaction gameplay**.

Once the interaction renderer is present, it can consume `/assets/story-props/<id>.webp`, the declared motion preset and `motion.css`. Gameplay must continue to own attempts, timing, success/failure, readiness and reduced/relaxed participation; the preview loops do not supply any of those decisions. No engine or protocol changes were imported merely to display the art.

The early three chapters in this checkout also precede their latest interaction authoring. The assignment file names actual local scenes; it does not claim to wire newer scene IDs that are absent here.

## Entry painting

Exchange Rift is the campaign entry. It already has four full-screen prologue paintings, and the story-plate contract intentionally omits a separate chapter plate at that entry. All story-plate tests pass. A fifth opening image was not added to duplicate that existing opening flow; the new Exchange paintings enrich the playable scenes instead.

## Verification

- Art verifier: **1,107 passed**, including prop size, real alpha, margins, catalog membership and supported motion metadata.
- Inventory: **0 outstanding**, including **13/13 interaction props**.
- Content validation: **117 passed, 2 warnings**.
- Targeted tests: **86 passed across 10 suites**. New prop regressions reject missing files, opaque backgrounds, wrong dimensions, unknown motion presets and unregistered exports.
- Browser review: **passed** in installed Chromium headless shell. All images loaded; rope movement changed over time; pause worked; manual and OS reduced-motion settings stopped animation; 390px layout had no horizontal overflow; no page errors.
- Semantic comparison: **87 art/cast updates**, with every other chapter field unchanged, all scene art files present and no cast exceeding three entries.
- Batch integration is idempotent. `git diff --check` is clean.

Final contact sheets and rendered desktop/mobile screenshots were inspected. The preview's moving objects were kept inside their cards, and the goat's body is masked behind the snow cover rather than leaking below it. Detailed logs and [semantic results](semantic-check.txt) are alongside this file.

To rebuild exports and the offline review:

```text
python docs/reviews/issue-494/export.py docs/reviews/issue-494/batch-3/sources.json
python docs/reviews/issue-494/batch-3/integrate.py
python docs/reviews/issue-494/batch-3/preview.py
```

The HTML embeds its assets and can be opened directly. A local review server can also be started with:

```text
python -m http.server 8494 --bind 127.0.0.1 --directory docs/reviews/issue-494/batch-3
```

## Still open

- Connect the prop catalog and motion states to the merged interaction renderer.
- Creature/hero catch, throw, feed, pet and reaction poses; duckling reaction/sprite states.
- Authored scene-specific water, drip, floe and banner animation beyond the reusable surge study.
- Additional Skupper family/weaver variants and other specialized figures.
- Optional item badge readability review and coins-found flourish.

Keep issue 494 open. The three remaining opening locations now have additional paintings, but the whole animation wishlist is not complete.
