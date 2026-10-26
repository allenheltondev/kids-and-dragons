# Issue 494: Riftlight opening art and live integration

The eight deliveries are connected to **12 chapters, 50 story interactions and six nonlethal fights**. The current worktree includes the merged interaction/fight foundation from PRs 495 and 496, with the earlier approved art and cast assignments preserved.

The delivered catalog contains **39 figure exports, 10 alternate creature poses, 46 scene paintings, 78 transparent props, five terrain atlases and seven native SVG rhythm/coin glyphs**. The hen entity reuses the camp-hen painting. Sources and discarded revisions are preserved under `art/source/issue-494/`; each batch's `sources.json` records the selected raster prompts and references. Raster creation used built-in imagegen; SVG glyphs follow the native icon system.

## Live behavior

- Interaction props follow the authoritative relay holder, balance levels, support leases, authored stages, timing marker and reactions. They do not score actions or advance the story.
- Tracking covers use identical mound art, conceal the kid while moving, and reveal the final cover in relaxed/reduced-motion play. Memory and sequence rhythms have distinct glyphs.
- Location-specific combat skins retain the original generic board geometry. Terrain props occupy existing blocked squares and keep the grid outlines visible. Saltrot uses its completed Sallow Wastelands tactical biome.
- Creatures retreat upright and healthy. A persisted, scene-scoped fight receipt selects victory pickups, rescue poses and coin flourishes, including the two fights whose outcomes share one destination. Leaving the destination clears that receipt.
- Goat, duckling, singer and other NPC reaction paintings are selected from the current interaction. Hero gestures retain the original species/tier/class illustrations and use whole-figure transforms; this delivery does not add frame-by-frame hero rigs.
- Cast, props, pose variants, glyphs and board skins join chapter warming and the installed worker's offline cache. Full chapter warming remains idle and lazy.

## Review

- [Final verification and screenshots](final/README.md)
- [Scene and interaction catalog](../../../packages/client/src/world/riftlight-art.generated.json)
- [Final catalog additions](final/catalog-additions.json)
- [Latest story paintings](batch-8/final-1.jpg)
- [Reaction figures, first sheet](batch-7/final-1.jpg), [second sheet](batch-7/final-2.jpg)
- [Fight terrain](batch-5/tiles-contact-sheet.jpg)
- [First fight-art delivery](batch-4/README.md)
- Earlier approved deliveries: [batch 1](batch-1.md), [batch 2](batch-2/README.md), [batch 3](batch-3/README.md).

Earlier batch reports describe the checkout at their delivery time. Their notes about missing gameplay wiring are historical; the combined current result is the integrated delivery. Historical chapter patches should not be applied over it.

## Verification

**372 tests across 20 suites**, **1,344 mechanical art checks** and **117 content checks** pass (two existing content warnings). Production TypeScript and the client/service-worker build pass. Payload remains within the merged budgets: **320 KB first paint / 320 KB**, **1,441 KB total / 1,460 KB**.

Real Chromium checks cover **56 cases at desktop and 390px phone widths**, 918 loaded-image checks, all 12 fight outcomes, concealed tracking and reduced motion, with no page errors or horizontal overflow. All non-presentation chapter fields match the merged authoring snapshot; only Saltrot's biome changes intentionally. Original creature paintings and portraits remain byte-identical.

## Reproduction

With normal repository dependencies installed:

```text
python docs/reviews/issue-494/install.py
npm run art:figures
npm run content:validate
npm run art:verify
```

Pass `--export` to `install.py` to re-export the selected raster sources before registration. `wire.py` applies the reviewed chapter presentation assignments; `runtime-catalog.py` projects the small client catalog and import-free offline URL list. Replaying these assignments preserves narration, choices, effects, routing and combat geometry.
