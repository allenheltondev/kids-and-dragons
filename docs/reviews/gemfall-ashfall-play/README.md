# Ashfall: compare the evidence, then choose a purpose

Sixth wave from the [campaign audit](../gemfall-play-design/audit.md), using the [chapter-cohesion skill](../../../.claude/skills/chapter-cohesion/SKILL.md). Revises chapter 06 at the convergence of all three roads. Built on the opening wave (#531); until that PR merges, a main-targeted diff also includes its approved changes. This wave's authored content changes are in `gemfall-06.json`.

## Play and consequences

| Choice or preparation | Immediate play | Later consequence |
| --- | --- | --- |
| Stand with the grandmother | Hold the doorstep clear while the pick is guided away | Dunmore remembers your voice; the existing named appeal can avoid the crab confrontation. The original risky quick stand and other doorstep solutions remain. |
| Learn the traveling bell call | Echo one / two quick / one; earn the existing cake and learned-ring flag on success or assistance | After losing the crab fight, call the ridge watch instead of relying on the original sprint roll. A checked/assisted call reaches the gate with `clock_stirring`; a missed call retains the late outside-the-gate setback. |
| Deliver the call as a griffin | The existing delivery job now records that the flyer knows the pattern | The same recovery option becomes available. The original successful bell roll also earns it, including resumed old prompts. No cake is invented for the flyer route. |
| Compare the timeline yourselves | Share dated watch-log, eruption and road-account clues; arrange oldest to newest | Voss opens the explanation beside the checked evidence. A miss receives Pellam's correction; assistance credits his contribution. Every route still reaches the full reveal. |
| Hear the logs read | Each hero asks a question or adds an observation | The wardens compare the evidence aloud. Reading confidence is not a gate to the major revelation. Road-specific accounts feed the dated comparison; the odd-ledger shortcut and original quick theory roll remain. |
| Keep or change the audience | Choose the wardens, gatherers or continued secrecy | Real server settlement replaces the old ally member with exactly the selected one. Earlier promises remain available as explicit choices. |
| Hear every hero before deciding | A shared council makes room for hopes, questions and concerns | Return, Collection and Tether remain available, with an untimed party decision. Silence still starts the Return road; the label now says so before selection. No hidden ally penalty is invented for silence. |

The bell recovery adds an earned alternative; it does not make the original gate sprint easier. It still takes a lost crab fight and a failed recovery to produce the late setback. The late route keeps its own full reveal and pursuit choice. The council does not score children, choose an individual pursuit from their contributions, or replace the party vote. Players can pause and talk; a narrated closing gate is not a client countdown.

## Reveal and continuity review

The two existing priority-one scenes remain **`scene_whole_truth`** and **`scene_shut_out`**. The full seal/titan explanation stays there. Timeline clues establish dates and a matching note, not a titan explanation in advance. The ancient western gate still hums the same note, and nobody claims to know why. The Table Stone remains optional and is granted only by the existing take choice.

All three roads can enter with their own evidence. The arrival introduces Redspire and the Skywardens locally; the town introduces Tull before later references. An empty-handed party can ask for logs and contribute observations. The source still reads actual facet counts and prior motive/road flags. Existing Ember, sprite, glade and conduct readbacks remain, in shorter wording. Hessa's pitch remains hers, and her curated audition passage is unchanged. Voss's plan can be questioned without a die deciding whether the child's concern counts.

The silence response still records Return and preserves the existing ally effects. Its new wording describes that starting road and leaves the question open; it no longer implies a helper penalty the data does not implement. The choice at the mountain remains a later decision.

## Session plan and timing risk

The ordinary target is approximately thirty minutes, budgeted as 6 minutes camps and warning signs; 7 town/bell/ridge choices; 8 citadel, crawlers and evidence; 9 reveal, tea, audience and purpose. Reading aloud, discussion and each hero's activity turns belong inside those movements. No artificial waits or mandatory retries were added.

These are **plans, not observed family timing**. The uncalibrated model remains substantially higher:

| Route metric | Before | After |
| --- | --- | --- |
| Shortest predicted minutes | 44.6–44.7 | 39.4–39.5 |
| Typical predicted minutes | 42.4 | 40.3–40.4 |
| Shortest modeled scenes / votes / checks / fights | 40 / 15 / 4 / 2 | 42 / 15 / 2 / 2 |
| Typical longest reading run | 3 | 3 |

The synthetic model excludes local flag-gated shortcuts, so its two-fight route differs from the tested prepared route that calls Dunmore by name and faces only the required cellar crawlers. This is not permission to subtract guessed minutes from the report. The model also does not budget authored activity time. Four-player conversation and repeated evidence explanations remain material timing risks. Use the [revision-aware session tracker](../../session-timing.md) to measure both roads before calling this a reliable thirty-minute chapter. No household timing was fetched for this review.

## Verification and save contracts

The immutable fixture comes from pre-wave `8081432b`. All **seven shipped check definitions** remain exactly equal: IDs, prompts, TNs, rollers, branches, effects and art. Tests serialize open prompts and resume low/high rolls for one/two/four seats. Only chapter 06's file hash was re-pinned. Existing terminal effects, encounter numbers and original route commitments remain; gameplay digest constants and the fixed legacy-save fixture are unchanged.

Old/new content trees loaded through the real loader match ending, road and setback digests. Fresh-save fight play-on matches after normalizing only generated hero IDs. The fixed pre-epic save replay passes independently.

There are 65 chapter route/art/legacy cases and nine server settlement cases, the latter exercising all 36 old-ally/new-ally/purpose combinations. Routes cover successful, missed and assisted comparisons/calls, missing preparation, old-roll/flyer access, all four purpose responses, Table Stone leave/take and actual priority-scene placement. Settlement checks keep the road and motive, select exactly one ally/pursuit/clock, and do not persist local preparation.

`miss-supported` uses genuinely incorrect memory/sequence/tracking answers, including palindromic patterns. Cooperation and free contribution activities cannot produce a failing player action; these complete successfully in that mixed profile. Their defensive `onFailure` graph edges are not claimed as executable failure coverage. Premature completion tests assert no preparation or council completion. The seven legacy rolls still exercise both outcomes.

790 targeted content/voice/compatibility and full-campaign tests pass, including all 53 server playthrough cases; typecheck passes. Content validation: 117 pass with four existing Riftlight warnings. Continuity: four allowlisted candidates, no new or stale entries. Voice source lines were refreshed while every existing profile, assignment and review-history field matches main. No paid voice rendering was performed.

The broad local run recorded **10,339 passed, 11 skipped, six failed tests**. These are the known Windows process-launch/SIGTERM and CRLF-sensitive tests, with the dev-server cleanup-hook timeout. The three CRLF-sensitive suites pass all 22 tests against exact LF Git blobs, then the original local bytes were restored. CI must validate the final branch on its normal host.

## Visual review

Existing environments, cast and props cover this wave: the facet table, tea table, morning bell, hand bell, paper records and door support. No new artwork was commissioned. The doorstep uses its chapter biome, avoiding an unrelated soup-tent painting before meeting Hessa.

Actual TV 1920×1080 and phone 390×844 captures were inspected:

- [Evidence timeline TV](interaction_truth_timeline-tv.png) / [phone](interaction_truth_timeline-phone.png): dated records, sufficient shared clues and readable choices.
- [Purpose council TV](interaction_purpose_council-tv.png) / [phone](interaction_purpose_council-phone.png): each hero's contribution, tea-table setting and unscored discussion controls.

The isolated solo preview stages one chapter as index 1 for capture; shipped ordering is unchanged. Phone captures show the actual Your turn controls with normal scrolling. Ordinary household saves were not used.

## Prior-PR CI follow-up

While this wave ran, #531's staging job failed before deploying: its separate test run timed out at the 04C shortest-path assertion. That gate unnecessarily calculated 500 typical random walks per scenario even though it only inspected shortest paths. Commit `1e8d127d` skips the unused walks, retaining every assertion and scenario. All 112 interactivity assertions passed on both the opening and Ashfall content in about a second. The isolated fix was pushed to #531, without Ashfall content. Its new CI must complete; this is not a claim that staging is green.

## Review clarification: the shorter late route

The everyone-contributes council is intentionally limited to the successful indoor citadel route. After a lost crab fight and failed gate recovery, `scene_shut_out` is the shorter setback route: Pellam reads the full revelation through the hatch, explicitly asks the party to hear one another, then presents the original four purpose responses directly. The vote is untimed, but this route does **not** enforce an individual contribution through an interaction widget. This preserves a save already waiting at that decision and avoids extending a compound-loss ending with the indoor ceremony.

Twelve route-specific cases cover every purpose at one/two/four seats. They assert the council is absent, all four choices are offered after the full reveal and discussion prompt, the selected pursuit is retained (including Return on silence), and the late clock/setback remains. Each also serializes the pending `scene_shut_out` vote and resumes it directly to its existing ending. No chapter data changed in this review clarification.

The review follow-up passed all 85 Ashfall route, settlement and compatibility tests, plus typecheck. The earlier full-suite counts above predate these twelve added cases. CI must recheck the pushed revision.
