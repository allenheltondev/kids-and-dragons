# Riftlight mini-game implementation pass

November 16, 2026. This follows the design audit in `minigame-design-2026-11-16.md`.

## Scope and behavior

The final inventory is 69 interaction scenes. New attempts started by current phones use version 3 in Riftlight. Older saved attempts retain their original rules. A cached phone can negotiate the whole room back to the earlier controls; stale rounds remain rejected. Story branches, rewards, assistance, and the relay's existing flight rules remain intact.

| Kind | Scenes | Result of this pass |
| --- | ---: | --- |
| Timing | 33 | Score whether a complete move fits in an opening. The next footing changes the opening. A slip gives a slower, wider recovery. Rift openings include two short blinks before the usable long one. Authored duration distinguishes a quick action from a crossing. Water, wind, shelter, and rift presentation follow the scene. |
| Precision | 6 | Choose height and strength, account for wind, and clear an edge before landing. The shared flight rules drive the preview and scoring. Low, short, and overshot actions have distinct feedback. Successful stages change the situation and hand off to a friend. |
| Balance | 1 | Opposite support positions affect tilt differently. Uneven footing changes what the team needs to supply. Solo play gets a prop. Corrections preserve safe progress. |
| Sequence | 5 | Test a complete plan. Feedback reports how many parts respond without exposing the exact correct prefix. Distributed clues remain useful. |
| Memory | 14 | Separate the stationary reference from the submitted answer. Restore authored cast/reaction paintings alongside the pattern, add pad notes on input, and improve phone layout. Existing playback, retained prefixes, and failure rules remain. |
| Tracking | 4 | Retain the moving-cover and recoverable-elimination rules. Correct the hidden kid's target painting and avoid drawing a second default creature over an authored target. |
| Free play | 4 | Choices add their authored paintings to the shared scene. Restore creature reactions, reduce phone duplication, validate option-to-art declarations, and warm those images offline. No failure scoring added. |
| Relay | 2 | Retain the existing aimed-flight, catch, save, and drop rules. Shared layout cleanup applies; this pass does not replace the accepted relay design. |

The previous three-successes-per-person quota is removed from revised precision/timing games: a team plays two to four shared stages, with a different situation after each success. Non-throwing precision scenes (lamp lifting, cord tying, mud loosening, lighting a lantern) now use timing instead of pretending to launch a projectile.

Small-screen work removes duplicate result stamps, puts continuation controls above navigation, keeps the pattern's submit button visible, and moves restart into the help fold. The real cast, landscape, props, and targets carry the action. No new bitmap assets were generated or uploaded.

## Verification

- The new engine suite completes every scene at one, two, and four seats and follows its success branch. Revised failure-capable scenes also exhaust recoverable mistakes and follow their authored failure branches.
- Focused checks cover whole-move timing, misleading short openings, near versus rough misses, recovery, height and strength, obstacle clearance, wind changes, invalid inputs, stale rounds, disconnect handoff, serialized saves, cached-phone fallback, opposite supports, and sequence feedback.
- 317 tests passed across 11 affected gameplay, content, rendering, offline-prefetch, art-contract, and Gemfall compatibility suites. Typechecking, content validation, and production build passed.
- Live browser review exercised eight representative scenes on the TV and 360 × 640 phones: `barge_toss`, `cross_rhythm`, `floe_hop`, `carry_beam`, `camp_play`, `shell_path`, `note_try`, and `pebble`. It included a poor throw, reload and recovery, normal animated timing, stationary timing, multiplayer lifting, camp contributions, clue tests, memory entry, tracking, results, and continuation. Captures live under ignored `test-results/playtest/riftlight-revision/`. The repeatable local harness is `tools/playtest/riftlight-review.ts`.
- A second visual sweep captured all 69 activities on the TV and two small phones, with zero failed image loads. All twelve contact sheets were inspected. That sweep corrected the river tracking game's log covers, the reading-room lamp, the fuel delivery basket, and the missing frost wyrm. Its index and screenshots are under `test-results/playtest/riftlight-catalog/`; its harness is `tools/playtest/riftlight-catalog-review.ts`. The wyrm was recaptured separately after its fix.
- `voice:verify --fix` removed 11 stale cue recordings after instruction changes. Their new wording uses the existing fallback until recorded; old instructions will not play.

The complete `npm test` run was stopped after reporting unrelated failures in untouched asset/infrastructure suites. Separate reproduction confirmed CRLF-sensitive YAML assertions in `tools/mcp/template.test.ts` and `tools/assets/deploy-guard.test.ts`, and a Windows path-separator expectation in `tools/assets/mcp-store.test.ts`. The full suite is not green.

## Remaining review

This is implementation and browser evidence, not evidence from a family sitting. Observe whether children anticipate openings, choose and revise a throw deliberately, explain a clue, and help rescue a teammate. Adjust pacing from that observation. All 69 received an active-phase visual review and authoritative engine coverage; eight representative scenes received full browser interaction flows. Long-form campaign pacing still warrants a family walkthrough. Other campaigns have not received the Riftlight rules redesign.
