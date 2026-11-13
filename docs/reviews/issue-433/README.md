# Riftlight character art (#433)

18 new transparent figures: 17 commissioned cast members and one ordinary gull
registered as a stage figure. Prepared on main after PR #431 merged, in the
separate `codex/issue-433-cast-art` worktree. The #429 work in the original checkout is
preserved separately.

![All figures, with 120px light and dark previews](https://assets.kd.readysetcloud.io/sha256/09/095ff2daea96cecccde63625c5300d15b5f92af8e2b8e3f56fc90e8fc4e562cf.png)

Sources, exact final generation prompts, height records and repeatable
packaging/install commands are in `art/source/riftlight-433/`. Generation used
the built-in image tool and the existing figures as species/style references.
The traveler was corrected to remove scenery; the allied wyrm was corrected
to face the party with a complete, uncropped silhouette.

The new art replaces stand-ins and fills the newly drawable roles across 14
Riftlight chapters. Existing nameplates are preserved. All chapter fields
outside `cast` are unchanged, including narration, choices, flags and graphs.

## Decisions and remaining constraints

- The temple keeper retains her original gray-cloaked figure in Sky Islands
  Arrival and Squall Temple. She is explicitly a different kitsune from the
  green-cloaked lookout keeper; a regression test checks both her continuity
  between temple visits and her distinction from the lookout.
- The Stuttering Flats goat stays an adult: `glimpse` explicitly distinguishes
  it from the rescued kid. The new kid is used in Exchange, glacier survival
  and the finale loss epilogue.
- The other two finale epilogues already have three cast members. The goat
  figure is ready, but showing it there still requires an authored scene split
  or a change to the cap. No fourth entry is added for the renderer to drop.
- Convergence's seven requested rift-opening scenes already use the dedicated
  `rift` stage effect, so no character PNG is added for the opening.
- Dock workers and the fisher are frogfolk; travelers are burrowfolk. Memory
  readers are yetis. These visual choices do not extend the creature canon.
- The gull uses `stageFigures`/`entities/quay_gull`, like ordinary donkeys and
  ponies. It is not assigned an incorrect creature basis.

## Verification

- Content validation, continuity and graph proofs pass. Proof files unchanged.
- 253 tests pass across the cast/scale and Riftlight content suites (24 files).
- Keeper-identity follow-up: 27 targeted tests pass, including a regression
  check for separate temple/lookout identities and consistent temple visits;
  content validation and continuity were rerun and pass.
- Art verification passes; all 18 outputs independently pass 1024px RGBA,
  transparent-margin and y=900 registration checks.
- The real TV/phone screenshot review passes. The review tool now supplies
  the creating device's binding when opening its second display surface,
  satisfying the existing room-watch access rule without copying a player seat.

These screenshots temporarily inject three representative figures into the
Gemfall tavern to check height, layout and phone guest paging. Gemfall files
are unchanged. This is an art/layout check, not the outstanding full Riftlight
visual playthrough tracked in #429.

![TV scale comparison](https://assets.kd.readysetcloud.io/sha256/2b/2b759aaf9bd0447078258d1fd80e9ba09c95718e6266849003054154bd03c2f1.png)

| Adult dragonling | Watcher | Goat kid |
|---|---|---|
| ![Phone dragonling](https://assets.kd.readysetcloud.io/sha256/5d/5d41eb690460f7c1c1acad37ca6604c5ba177fc679d0c01aa4dd005e8e978124.png) | ![Phone watcher](https://assets.kd.readysetcloud.io/sha256/36/36d65efce4a9986a402936c108cfc8bdeaa90aab172253948440539e08e042b2.png) | ![Phone goat](https://assets.kd.readysetcloud.io/sha256/6b/6bc5e832578e2331e14db61e5224bc50f760cdff1229410099ae3accb160792d.png) |
