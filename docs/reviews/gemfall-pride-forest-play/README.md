# Gemfall: Pride Roads and forest play

Third gameplay wave from the [campaign audit](../gemfall-play-design/audit.md), using the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). Covers 04A The Pride Roads and 04B The Forest Takes Attendance.

## Choices that change later play

| Preparation | Later consequence |
| --- | --- |
| Carry the pride's marker with a balanced load | Learn the long brace. At the wolf camp, hold a cart-cover windbreak so the wolves can warm themselves away from the humming packs. |
| Ask about the marker line or give the cubs quiet space | Learn the checked route. Use it past the wolf tracks instead of repeating the tracking activity. This does not teach the brace. |
| Help pin sash clues | Steady the frame, then share the road clues and assemble their order. A missed frame falls back to the existing lantern-memory puzzle. |
| Pay for prepared sash tags | Spend one real coin and enter the shared clue task directly. The existing unpaid memory task remains available. |
| Earn the pride's friendship and ask for an escort | The existing escort can answer at camp. Leaving the stone still avoids that camp problem; losing the wolf fight still causes the late setback. |
| Answer the forest's roll call honestly | Every hero contributes to an inventory aloud. The existing beech acknowledgment becomes available; simply saying Here does not earn it. |
| Observe the mosshorns | Track their safe edge. If the echo hunter later wins, rebuild the observed route to reach the hollow. Without that observation, recovery uses the original risky check. Missing the rebuilt route still causes the existing setback. |
| Help the unicorns mend | Hold the moss and carry the hum. Later, guide a quiet crossing over a held moss strip. |
| Guard the unicorns instead | Learn the woodland's answering sounds. Later, each hero adds a sound to that chorus to pass the hunter. This does not earn the mending shortcut. |
| Carry the calf | Balance the sling before receiving the herd's thanks. The trusted leading route and its requirements remain. |

Activities include cooperative support, shared clue sequences, tracking, balance, precision and everyone's spoken contributions. The cub lullaby allows a hum, a gentle beat or a sleepy word. The warden secures her runaway spools in a cup. The forest still has opinions about a squirrel hiding in a hood. Assistance credits the helper and does not claim independent success. Solo players can use the existing support props; no added timers, padding or mandatory retries.

## Session plan

Both chapter targets are approximately 30 minutes. These budgets include reading, discussion, contributions and activity turns:

| Chapter | Planned minutes |
| --- | --- |
| 04A | 6 arrival and pride greeting; 8 cubs and marker priority; 8 sash discovery and rest; 8 tracking, stone decision and camp |
| 04B | 6 roll call and hedge; 8 herd and small mending; 7 unicorn job and calf; 9 beech, crater approach and final decision |

These are plans, **not measured family timing**. The uncalibrated dice-oriented model does not budget authored interaction time. It still warns that optional routes may run longer:

| Chapter | Shortest predicted minutes before → after | Typical predicted minutes before → after |
| --- | --- | --- |
| 04A | 33.9 → 30.1 | 39.0 → 32.8 |
| 04B | 38.7–38.9 → 34.6–34.8 | 42.8–43.0 → 39.0–39.2 |

The modeled shortest routes retain 37/39 scenes, 14/15 votes and 3/4 checks respectively, with no reading run above two scenes. Real timing, especially four-player discussion and optional second fights, remains needed before claiming either evening consistently fits 30 minutes. The tracker from #511 is now integrated from main; use the operator export and revision-aware report in [session timing](../../session-timing.md) when real sessions are available. No production timing was fetched for this review.

## Compatibility and verification

The immutable check fixture was extracted from pre-wave commit `851d1134`. All 21 shipped check definitions remain exactly equal, including prompt, TN, roller, branches, effects and art. Tests serialize open prompts and resume low/high rolls for one, two and four seats. Existing scene and choice ids, ending outcomes, rewards, route flags and fight definitions remain, except that echo defeat now first offers the earned map recovery or the original check. New preparation flags stay chapter-local.

Complete route tests cover successful, missed and assisted interactions, both forest jobs, the lost-fight map recovery, unavailable preparation, paid tags, escort, leaving the stone and the late wolf setback. Art references are checked against the manifest and actual WebP files. Old/new server probes preserve ending, road and setback digests; fight play-on matches after normalizing generated hero ids. The fixed legacy-save test remains unchanged. Only the two chapter file hashes were re-pinned.

Voice cast source lines were refreshed while preserving all existing profiles, voice assignments and review history. Curated voice audition passages remain intact. Content validation retains four existing Riftlight warnings; continuity retains five allowlisted candidates and no new findings.

## Visual review

No new art commissions are needed. Existing environments, cast figures, grass/fern covers, rope, blanket and clue props cover the activities. These are captures of actual TV (1920×1080) and phone (390×844) views, using an isolated temporary solo preview. The preview displays chapter 1 because only the reviewed chapter is staged; campaign ordering is unchanged in shipped content.

- [Sash clues — TV](interaction_sashes_pinned-tv.png) and [phone](interaction_sashes_pinned-phone.png): the barn, warden, shared clues and repeated pride tag remain legible.
- [Mending — TV](interaction_mending_circle-tv.png) and [phone](interaction_mending_circle-phone.png): elder unicorn, moss prop, support action and solo prop alternative are visible.

The phone captures show the actual Your turn controls. All four captures were inspected; ordinary household saves were not used.

## Checks run

After integrating current main: 548 targeted tests passed across Gemfall content/play, fixed legacy-save compatibility, voice cast/bakeoff and session timing; typecheck passed across all packages. Validation: 117 passed with four pre-existing Riftlight warnings. Continuity: five allowlisted candidates, no new or stale entries.

The broader local suite recorded 10,060 passed, 11 skipped and six failed tests (six failing files, including a dev-server cleanup-hook timeout). Three failures were Windows CRLF readers/comparisons: authoring-guide fenced examples, profile-field introspection and generated figure sizes. Re-running those suites against the exact LF Git blobs passed all 22 tests, then the original local bytes were restored. The remaining failures are Windows process launch/shutdown behavior: `npx` and `.bin/tsx` ENOENT in traits/voice-clean CLI tests, and dev-server SIGTERM save/cleanup. These unrelated files were not changed. The full run began before the main integration; the targeted and typecheck results above were run after it. CI is still needed for the complete final branch on its normal host.
