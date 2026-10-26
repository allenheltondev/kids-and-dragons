# Fight art: first delivery

The [new fight wishlist](https://github.com/allenheltondev/kids-and-dragons/issues/494#issuecomment-6404846783) adds six nonlethal encounters. This delivery contains **20 assets: 10 alternate creature poses, 8 props and 2 scene paintings**.

- [Creature poses](pose-contact-sheet.jpg): river drake warning, proud recovery and retreat; crab warning and retreat; wolf cache sniff and retreat; mimic little variant and retreat; wisp retreat.
- [Props](props-contact-sheet.jpg): five existing-item pickups, supply cairn, warm mud hollow and disguised planks.
- [Paintings](scenery-contact-sheet.jpg): Headwaters gravel ford and Saltrot surfacing crabs' silt bank.
- [Exact prompts and references](sources.json); production files are under `assets/entities/`, `assets/story-props/` and `assets/scenes/riftlight/`.

The built-in imagegen tool produced every source; selected source PNGs are preserved under `art/source/issue-494/batch-4/`. The river charm follows the existing item's canonical holed pebble and grass cord. Every exit shows a healthy creature retreating. New crab cutouts have continuous shells; the originals and portraits are unchanged.

## Encounter mappings

| Chapter | Encounter | Board | Victory | Rescue |
|---|---|---|---|---|
| Headwaters | drake_fight | ford | ledge_ahead | drake_rescued |
| Frostfang | bar_crab | ford | bar_carry | bar_carry |
| Cairnstep | cache_fight | switchback | neck | neck |
| Saltrot | crab_fight | reedbank | crab_done | crab_rescued |
| Ashspan | mimic_fight | reedbank | mimic_won | mimic_shooed |
| Sky Islands | wisp_fight | glade | wisps_shooed | wisps_rescued |

[Bindings](fight-bindings.json) were checked against the exact merged PR 496 head, `50388e4865b763e6f212fb4fe85f8ca76ee7a70f`. Two encounters share victory and rescue destinations. Pickups and outcome poses must therefore follow the authoritative fight outcome, never the destination alone.

At this delivery's validation point, the worktree predates those fights: registration applies zero chapter changes and records six pending definitions in [the integration report](integration-report.json). Later integration must reconcile the merged gameplay foundation. The two paintings are backdrops, not tactical tile skins.

## Validation at delivery

- **1,135 art checks** passed; inventory reports zero outstanding declared resources.
- **117 content checks** passed, with two existing warnings.
- **90 tests across 11 suites** passed, including four new fight mapping tests.
- Ten original assembled/portrait hashes and all 24 chapter files were unchanged by this batch; registration is idempotent.
- All three contact sheets were visually inspected.

[Art log](art-verify.log), [test log](tests.log), [content log](content-validate.log), [semantic check](semantic-check.txt).

## Follow-on work

Batch 5 supplies tactical tile skins, gravel/floe/burrow/ferry/yard props and NPC rescue poses. Interaction-specific props, reactions and production integration remain part of the ongoing issue 494 work. This delivery does not close the issue.
