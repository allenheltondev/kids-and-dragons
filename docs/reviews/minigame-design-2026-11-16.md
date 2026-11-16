# Mini-game design review, November 16, 2026

The current games often extend a simple input into several rounds without introducing a new decision. Their generic staging also contradicts some authored situations. This explains both the simplicity and the strange feeling; increasing difficulty alone would preserve those problems.

## Evidence and limits

Reviewed shared interaction and skill rules, the integrated SkillGame renderer, instructions, Practice Meadow content, and counts across all 42 chapter files. Captured and inspected actual running TV/phone composites for the two-player branch lift and four-player seed toss using `play:jump --start`. Assets were pulled and current. This was a design audit, not a full campaign playthrough, device latency test, or observed family playtest. No gameplay rules changed.

Local captures (ignored test outputs):

- `test-results/playtest/first-steps-01-interaction-roots-started.png`
- `test-results/playtest/first-steps-01-interaction-bell-started.png`

## Findings, in priority order

1. **Precision and timing are substantially the same game, repeated widely.** There are 28 precision and 64 timing scenes among 202 interaction scenes. Both use the same triangular repeating position and target test. `skillAim` returns the unchanged authored spec. Each participant must succeed three times, so a four-player seed toss shows twelve stages. Successes do not change the target, speed, obstacle, or next player's situation. Reduce repetition and distinguish aiming a throw from choosing a safe crossing interval. A team should advance through a small authored situation rather than repeat a per-person quota.

2. **Recovery promises more than the rules deliver.** Precision/timing text says rough misses make recovery harder, but misses add strain while leaving the aiming situation unchanged. Near misses are smaller deductions, not a different recovery opportunity. Either make the next state visibly respond (a reachable lower landing, a wobble to save, a changed opening) or describe the existing consequence accurately. Avoid another generic life counter as the main redesign.

3. **The lift's instruction is not its scoring rule.** Practice Meadow asks for smooth branch pulls. The actual action submits a single strength value; jerk is inferred from excessive strength, with no measurement of smoothness. The live board shows a rope coil ascending floating ledges, with no branch or ribbon to explain progress. Build the branch, clearance, and support into one visible situation. Players should read flex and coordinate support while Bun retrieves the ribbon; excess effort bends the branch and easing can save it. The explicit strength alternative should preserve those decisions.

4. **Balance is a target-matching exercise.** Targets follow the fixed sequence 50%, 75%, 25%. Individual lift values are averaged; which side a hero occupies has no mechanical effect, despite controls saying “my side.” It offers coordination but little leverage or spatial reasoning. A redesign should give support positions meaningful influence over tilt, show load movement, and allow a team to correct a slip before committing its next footing. Verify solo reachability separately.

5. **Sequence testing can replace deduction with an answer oracle.** Tests reveal the exact correct prefix without spending strain or committing the crossing. Children can build the answer incrementally without using distributed clues. Preserve safe experimentation, but have tests show the mechanism's behavior or a violated relationship rather than simply the first wrong index. Clues should explain why a trial failed.

6. **Free play needs different acceptance criteria.** Its lack of failure is appropriate. The current shared icon clusters record counts, but are weaker than seeing a camp, meal, or celebration take shape from the group's choices. Improve visible composition and reactions without imposing reflex scoring on expressive scenes.

7. **The subject needs to survive the reusable renderer.** The four-player bell lesson shows a seed pile moving toward an abstract gold perch; the bell the party is supposed to ring is absent from the gameplay surface. The branch lesson similarly loses its story subject. Authored objects, destinations, and state changes should be explicit presentation inputs, rather than treating the first non-note prop as a universal moving object.

## Recommended implementation order

Start with one complete cooperative branch-lift benchmark: authored subject, readable support and strain, distinct over/under effort, recoverable mistakes, solo and stationary controls, and a clear ribbon retrieval. Verify it on a small phone and the TV before spreading its principles.

Next split precision from timing and replace the three-successes-per-person quota with situation-based progression. Then redesign balance around leverage. Review memory/tracking and sequence in their chapter contexts before changing their rules; this audit does not establish that every instance of those games needs replacement. Keep free play expressive.

For each redesigned game exercise a clean action, near miss, poor action, recovery, and conclusion through authoritative state. Check stale inputs, reconnect, participant changes, relaxed mode, stationary controls, and shared-screen consistency. Separately observe whether a family can explain its next move and deliberately improve; automated completion is not evidence of fun.
