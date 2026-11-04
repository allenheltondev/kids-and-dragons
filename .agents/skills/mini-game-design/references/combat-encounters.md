# Narrative combat encounters

Use for an encounter redesign or a combat presentation pass. Preserve the requested scope: visual-only work does not authorize changing damage, victory rules or player abilities.

## Establish one complete situation

Read the authored scene, board, authoritative turn resolution, available abilities and running phone/TV experience. Identify a decision the player can explain: draw a wolf away while a friend holds a lane, leave marked ground before a strike, or risk a reward instead of crossing safely.

Test the proposed tactic against actual turn order, movement, target selection and recovery. A handoff that works only when enemies politely wait is not a cooperative mechanic. A poor retreat may let an enemy occupy the post; show that consequence and verify a way to recover or reach the authored setback. Do not add gestures, cards or timers merely to increase activity.

Focus the next pass on one encounter until its read → decision → consequence → recovery → payoff forms a coherent sequence. Adapt the principles to the next fiction rather than copying a hold counter, windup or escape gate into every fight. Keep broader catalog coverage distinct from the quality of the benchmark.

## Let the battlefield carry meaning

- **Anticipation:** show an enemy's target or committed ground before resolution. A current-board forecast can change after movement; a committed strike retains its saved tiles. Derive both from the authoritative planner/state and label the distinction honestly.
- **Action and response:** make movement, protection, interruption, impact and empty strikes visible at the relevant figures or ground. Cues should fit the creature: a rearing plank mimic is different from a lantern gathering sparks.
- **Consequences:** change the situation itself. A wagon advances for earned progress; a freed route becomes usable; an interruption removes the impending threat. Decorative looping motion must not imply progress that has not been earned.
- **Recovery:** preserve earned progress where the rules promise it. Show the exposed post, threatened friend or missed opportunity so a player can correct deliberately. Verify solo/support play as well as different cooperative contributions.
- **Payoff:** finish the action in the world. Do not let success disappear into a new paragraph with no visible resolution. Use persisted outcome receipts to choose the presentation and measure the space around story text.

Inventory existing art and creature poses first. If the focal prop does not match the story, use the image-generation workflow for a proper asset rather than silently substituting hay for sausages or a magical portal for an ordinary bank. Preserve source, alpha, provenance and offline warming. Use code for precise targets, routes and progress; use painted art for the subjects.

## Hierarchy and access

Spend space on the playable scene and the immediate decision. A clear turn heading plus a consistent regular-weight body style is often enough for the shared combat column. Avoid independently framed messages and repeated mission/goal/result copy. Quiet supporting text through placement and color rather than many sizes and weights.

Give readable action labels and descriptions priority over permanent inspection details. Keep inspection and map enlargement available. Exercise short phones, large text and an opening enemy turn: the extra result row can expose a fit problem that an empty-log screenshot misses.

Reduced motion should preserve information with stationary poses/positions. Reload should restore saved progress and committed threats without replaying fictional progress. The TV remains read-only.

## Evidence and compatibility

Play an ordinary success, a poor position, a recovery or handoff, interruption/protection when relevant, and the actual ending. Review a short recording of the running encounter as well as stills; screenshots alone cannot establish anticipation, impact or pacing. Keep automated success distinct from evidence that children find the fight satisfying.

In this repository, inspect shared combat rules, authored chapter/map contracts, phone controls, the Pixi stage, art warming and persisted encounter receipts together. When authored environments are added, update narrow exceptions in **both** `packages/server/src/handlers/ordered-campaigns.test.ts` and `tools/content/encounter-environment.test.mjs`. Preserve default restrictions for other encounters, plus legacy save/arithmetic/rendering goldens. Repin only intentionally changed content-file hashes. Run the complete unit suite before declaring the encounter ready for review; focused tests missed this compatibility gate in the roadside pass.

Keep first-paint and total-payload costs explicit. In this repository, measure with a production-length `KAD_BUILD` (for example, the current commit SHA; the build takes its first 12 characters). The shorter local `dev` label can conceal a CI overage near the limit. Include final captures, the actual checks run and any remaining player-observation questions in the PR.

## Calibrate against the wagon

See [the design notes](../../../../docs/briefs/combat-roadside-depth.md), [the recorded flank handoff](../../../../docs/reviews/combat-roadside/wagon-sequence.webm) and [the in-play TV capture](../../../../docs/reviews/combat-roadside/wolves-tv-in-play.png).

The wagon demonstrates saved progress moving a physical subject, state-derived targeting, a deliberate flank handoff and a departure payoff. It is evidence of implementation and presentation review, not a universal recipe or a claim that the entire combat catalog is finished.

The [mimic crossing](../../../../docs/briefs/combat-mimic-benchmark.md) applies those principles to a different problem: fixed dangerous ground, a physical rearing/slapping tell, separate friends crossing, and a reward left behind. Its presentation metadata does not alter the authoritative attack.
