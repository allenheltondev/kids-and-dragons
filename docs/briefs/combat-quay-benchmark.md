# Ferry quay: a complete combat benchmark

This follows the readability work in #611. It changes one authored encounter and adds an opt-in enemy verb; it does not declare the full combat catalog finished.

## Playable loop

- **Read:** the Spark Lantern gathers a burst on fixed, cross-marked ground. The Rope Tugger pursues the nearest standing hero. The ferry clock and rope progress remain visible.
- **Act:** bait the burst away from the rope, leave the marked ground before the lantern's next turn, use a dazing ability to interrupt it, protect or heal a friend, or concentrate on shooing the wisps.
- **Consequence:** the lantern releases on the original ground, even if its original target moved. Standing there risks an ordinary attack roll with normal protection, wards, and evasion. Interrupting clears the charge. Defeating its caster removes the warning.
- **Recover:** friends can protect, heal, or help up. Two helping turns beside the mooring post secure the ferry; any heroes can share them. Alternatively, defeating both wisps wins. After five rounds, the ferryman returns and the story continues through the authored timeout branch.

Securing the ferry sets `secured_ferry`; the victory narration acknowledges the party's knot and teamwork.

## Rules and compatibility

`EnemySpec.windupAttack` is opt-in and copied into the persisted combatant. The marked tiles are persisted when preparation spends the creature's turn. Release never retargets or follows a moved hero. Rooting restricts movement; dazing cancels the charge. No reaction-speed input or client clock determines an outcome. The ordinary-enemy planner and old saves keep their previous defaults.

The shared `committedAttacks` view drives phone hatching, accessible tile warnings, TV markings, and the priority threat description. The TV's warm gathering ring and sparks stop moving under reduced motion. Result events distinguish a burst, an empty blast, and an interruption.

## Presentation

The small encounter uses the existing Exchange tile painting, lantern-lit quay backdrop, painted characters, and `assets/story-props/fight-mooring-post.webp`. Objective authors can select an existing story prop; the asset is included in chapter warming and retains a glyph fallback. No new raster art was generated.

Turn ownership now lives in the measured fight column so it cannot cover the charging enemy. Environmental fights show the latest result alongside mission rules. Mission phones show two action cards per page, with class/species moves before basic actions; the normal encounter defaults remain three cards. Threats, health, and complete action cards take priority over between-fight XP and repeated generic instructions.

## Verification and remaining judgment

Rules tests cover one, two, and four heroes; movement clear of a saved blast; staying in danger; protection and wards; dazing; defeated casters; and repeated resolution. Authored-content tests cover solo support heroes, cooperative objective completion without defeating enemies, and the timeout ending. The existing seeded ordinary-fight digest remains unchanged.

The live browser test uses two phones and a TV, checks 320px/390px and largest text without prompt scrolling, reloads a committed warning, interrupts through the phone's Fox Fire controls, and has both heroes finish the rope objective. The general combat browser review remains enabled.

Family observation is still required: do children anticipate the burst, deliberately make room, notice a saved friend, choose different contributions, and want another turn? Automated completion is evidence that the loop works, not that its difficulty and pacing are right.

## Captured surfaces

- [Phone](../reviews/combat-quay/phone.png)
- [Largest text](../reviews/combat-quay/largest-text.png)
- [Shared TV](../reviews/combat-quay/tv.png)

Type checking, content validation/proofs, the production build and payload gate pass. The payload remains within the existing budgets: 329KB first paint and 1483KB total. The full regression run passed 9,633 tests and exposed three findings: the redundant real-chapter hint, a downstream solo narration line, and the expected content-file digest changes. The hint was removed, the narration corrected, and only the two deliberately edited chapter-file hashes were re-pinned. Affected suites were rerun; gameplay/legacy-save digests were retained.
