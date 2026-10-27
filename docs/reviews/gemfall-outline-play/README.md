# Gemfall: the outline and who hears it

Fourth wave from the [campaign audit](../gemfall-play-design/audit.md), using the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). Revises 05A The Broken Bridge, 05B MossHome and the High Paths, and 05C The Boundary Stones. This branch includes main with #528 merged; the previous waves are not part of this diff.

## Preparation becomes later play

| Route and choice | Immediate work or cost | Later consequence |
| --- | --- | --- |
| 05A: tension the survey string | Help the apprentices measure the crack; learn their brace | Use a supported rope crossing at the span. Studying the chalk instead does not grant this option. |
| 05A: study the chalk marks | Record the checked interval between carts | A timing activity crosses in that interval. A miss closes the span and sends the party to the existing ford recovery. |
| 05A: check the transfer rule | Share tag, signature and destination clues; the carter consents in return for a song | A checked agreement transfers the same Clerk's Stone. A missed sequence lets the cart leave. The old quick ledger roll remains. |
| 05A: compare evidence | Each hero contributes an observation or asks Brask to read a measurement | The survey reaches the same outline revelation, without a roll grading the child's contribution. The old risky sketch and earned observation/rubbing shortcuts remain. |
| 05B: pass stepping logs | Catch and pass the loads with the flood-warden; learn an ivy brace | Support a checked ledge above the wolves. The water-observation route does not grant this brace. |
| 05B: watch the runoff | The warden marks the collection pockets on the local route record | After losing the wolf fight, track packs through those pockets. A miss still reaches the original compound setback; without the record, use the original regroup check. |
| 05B: read the keeper's key | Share knot clues and check the feeding plan | Spend an actual supper or honeycake to draw wolves into the marked hollow. The plan alone never creates food. Other wolf approaches remain. |
| 05C: inspect gear and act the rule | Every hero names actual gear or acts part of the mountain rule | Finish the inspection and explain the rule directly. The original hurried inventory/rule rolls and their branches remain available. |
| 05C: echo the crab's warning | Remember claws, shuffle, then backing off the warm patch | Guide the prospector away; a missed warning still enters the original crab fight, rescue and real payment/work choices. |
| 05C: carry the kept stone | Balance its wrapping after Ashby agrees to the transfer | Earn the same Unassigned Stone through careful handling. Leaving it and the dragonling approach remain distinct options. |
| 05C: prepare the big-bell crew | Support the dawn pull and practice a passing line | Relay the portable signal bell through the crowd so the grandmothers can organize rows. |
| 05C: polish and prepare the hand bells | Learn how the small notes answer one another | Everyone contributes to an answering chorus at the queue. Neither prepared option appears after merely asking about the unrung bell. |
| 05C: share an account with the crowd | Everyone contributes witnessed evidence or asks for a tally | The grandmothers help the account carry down the line. The child's contribution is not graded by persuasion luck; the original hurried speech remains risky. |

The final disclosure remains a real campaign commitment on every road: tell the wardens, tell the gathering towns, or keep the outline close. Tests assert exactly one corresponding carried ally flag. Brask's existing crossing pass, the MossHome knot shortcut, species/class options, facet decisions, payments, fight numbers and final rewards remain. Preparation flags are chapter-local; they are not advertised as permanent campaign memories.

The stones' age and the land's response remain chapter-five observations. This does not move chapter six's full explanation forward. The unexplained corner bell stays untouched. New writing uses short transitions and small prop jokes: chalk eyebrows, a frog in a flood boot, an uncooperative bookmark and a very stiff sock.

## Session plan

All three declared targets are about thirty minutes. Planned movements include discussion, reading aloud, shared clues, each hero's contribution and activity turns:

| Chapter | Planned minutes |
| --- | --- |
| 05A | 6 queue and relief work; 8 clerk/survey preparation; 7 evidence and disclosure; 9 crossing, recovery and rim |
| 05B | 8 archive and old records; 6 guest tree and disclosure; 8 falls and high-path preparation; 8 drake, wolves/recovery and camp |
| 05C | 6 inspection and rule; 8 tallies and kept stone; 7 supper/night/bell preparation; 9 crowd and disclosure |

These are plans, **not measured family timing**. No added delays or mandatory retries. The uncalibrated model does not budget authored interaction turns and still predicts longer optional routes:

| Chapter | Shortest predicted minutes before → after | Typical predicted minutes before → after | Shortest scenes after |
| --- | --- | --- | --- |
| 05A | 33.8 → 31.5 | 39.8 → 34.0 | 40 |
| 05B | 36.2 → 31.6 | 42.0 → 37.5 | 38 |
| 05C | 37.2 → 31.7 | 37.0 → 33.0 | 38 |

The modeled shortest paths keep 14/16/14 votes, 3/1/4 checks and one fight respectively. No reading run exceeds two scenes. Fewer explanatory words make room for activity; these figures do not prove fun or a consistent thirty-minute sitting. Use the integrated [revision-aware session timing](../../session-timing.md) to calibrate real solo and family play. No household timing was fetched for this review.

## Compatibility and verification

The immutable fixture comes from pre-wave commit `8e816eec`. All **29 shipped check definitions** remain exactly equal, including IDs, prompts, TNs, rollers, branches, effects and art. The tests serialize open prompts and resume low/high rolls with one, two and four seats. Only the three chapter file hashes were re-pinned; gameplay digest constants and the fixed legacy save remain unchanged.

Old/new server probes matched ending, road and setback digests. Fresh-save fight play-on matches after replacing only generated hero IDs. Terminal effects, encounter numbers, ally route sets and original endings stay intact. Wolf defeat in 05B now offers either the earned runoff recovery or the original regroup check. It still takes a lost fight followed by failed recovery to reach the late setback. The bridge setback likewise follows closure then a lost wolf fight; early crab defeat still reroutes at a real cost.

There are 90 new complete-route/art/legacy cases, including solo/two/four seats, assisted and missed activities, both preparation priorities, food consumed versus unavailable, disclosure flags, species/class shortcuts and existing late setbacks. Shared interaction tests also exercise the real controls. Voice source lines were refreshed while preserving every existing profile, assignment and review-history field. Curated audition passages remain intact.

## Visual review and new art

Actual TV 1920×1080 and phone 390×844 captures were inspected:

- [Bridge evidence TV](interaction_survey_evidence-tv.png) / [phone](interaction_survey_evidence-phone.png): Brask, the survey environment and each hero's contribution controls.
- [Keeper's clues TV](interaction_keeper_pages-tv.png) / [phone](interaction_keeper_pages-phone.png): the path-keeper, shared knot key and sufficient readable clues.
- [Bell relay TV](interaction_crowd_bell_line-tv.png) / [phone](interaction_crowd_bell_line-phone.png): grandmother, portable bell, catch action and solo destination behavior.

The isolated preview stages one chapter at index 1 for capture; shipped campaign order is unchanged. Phone captures show actual Your turn controls, with ordinary scrolling for controls below the viewport. Normal household saves were not used.

One new prop was needed: [portable hand bell](../../../assets/story-props/prop_hand_bell.webp). The old bell prop included a stone shrine and could not represent a hand-to-hand relay. Built-in image generation produced the transparent original; it was normalized to the existing 512×512 WebP prop contract, keeping alpha, registered with a gentle swing motion and used in both prepared crowd activities. Existing art covers the remaining scenes. Shared art verification passed 949 checks; the installed bell has transparent margins of at least 45 pixels.

Final generation prompt (built-in image tool):

> Use case: illustration-story. Create one production game prop for the family fantasy game Kids & Dragons. One small portable brass hand bell with a short dark wooden handle, a visible warm gold bell skirt and tiny rounded clapper, slight three-quarter view, centered entirely within frame. Warm detailed hand-painted children's storybook watercolor/gouache style, gentle brown ink outlines, soft golden highlights, worn friendly materials. Strong clear silhouette readable as a tiny game widget. Object only, true transparent background; no person, hand, face, text, lettering, logo, rope, pedestal, stone shrine, scenery, ground shadow, extra bells, UI or frame. Square canvas, generous transparent margins. This is a handheld signal bell passed among helpers at a fantasy town queue.

## Final checks

After main integration and the bell installation, **599 targeted tests passed** across Gemfall play/content, fixed-save compatibility and voice cast/bakeoff. Typecheck passed across all packages. Content validation: 117 passed, four existing Riftlight warnings. Continuity: five allowlisted candidates, zero new, zero stale entries. All speaker profiles, assignments and history match current main; only derived source lines differ.

The broad local run recorded **10,199 passed, 11 skipped, six failed tests** across six files, plus a dev-server cleanup-hook timeout. Three failures were CRLF-sensitive guide parsing, profile introspection and generated figure-size comparisons. Re-running those three suites against the exact LF Git blobs passed **all 22 tests**, then the original local bytes were restored. Remaining failures are the same Windows process issues seen in prior waves: `npx` and `.bin/tsx` ENOENT in traits/voice-clean CLI tests, and dev-server SIGTERM save/cleanup. Those files were not changed by this wave. The broad run started before the final bell hookup/main integration; the targeted, typecheck, schema, continuity and art results above cover those final changes. CI must check the complete final branch on its normal host.
