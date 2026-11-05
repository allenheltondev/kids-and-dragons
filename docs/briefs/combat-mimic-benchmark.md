# Mimic crossing: a physical threat and a shared route

This continues the wagon benchmark without adding another counter or changing combat arithmetic. It also adds a combat reference to the repository's mini-game-design skill, so future passes carry the lessons forward.

## The playable situation

- Read the mimic rearing up and the saved marked ground. The physical pose replaces the lantern's warm tint and orbiting sparks.
- Choose a crossing, bait the marks away from the route, move clear before the mimic's next turn, interrupt with daze, or protect a friend who stays exposed. The existing alternative remains: shoo the mimics to claim the whistle and coins, or get everyone across and leave the treasure behind.
- On release, the body compresses into a slap and ground rings mark the actual saved tiles. Empty strikes, hits and interruption have distinct words. Presentation never chooses targets or damage.
- The shared column counts friends across and names them; the active phone also reports partial crossing progress. Friends still on the lane remain able to contribute. Saved threats and progress survive refresh.
- The persisted escape receipt shows the mimic sliding away and the cleared planks in the story's available stage space. Defeat and the six-round timeout retain their authored recovery.

## Presentation contract

`windupAttack.presentation: "slam"` is optional and copied with the saved attack. Omission preserves the existing spark presentation. Rules tests compare physical and default styles and require identical targeting, roll and damage events. Old active encounters retain their old fields and defaults.

Phone and TV use the same physical preparation/impact wording. A physical exit with an authored prop is named as a crossing rather than a rift. Quiet transient captions stay inside the battlefield; repeated crossing captions and the chapter goal no longer compete with the immediate situation. The shared panel retains one turn heading and consistent body text.

Reduced motion keeps the raised pose and saved markings stationary, omitting the slap compression and expanding ground rings. Existing painted mimic and plank artwork is reused; the retreat prop is included in offline chapter warming. No new dependency or raster asset is added.

## Verification

The live two-phone/TV run checks 320px phones, largest text, refresh, physical attack metadata, a partial crossing with one friend still playing, and the escape payoff's clearance around story text. The ferry browser scenario checks that the original spark encounter still behaves and renders correctly. Focused tests cover physical feedback/copy, native rearing and impact, saved style metadata, unchanged damage rules, named exits, warming, and legacy compatibility. The complete unit suite passes: 9,657 tests passed, 15 skipped. The final affected-suite rerun passes 165 tests. Type checking, content validation/proofs, build and payload checks pass; the extended skill validates too.

Payload remains within the existing limits: 329KB first paint / 330KB, 1490KB total / 1490KB. The content-file digest and graph proof are refreshed for the intentional authoring/schema additions; combat/save goldens remain unchanged.

Player observation is still needed: do children recognize the raised planks before reading the explanation, deliberately draw a slap away from the crossing, and understand which friend still needs to reach safety?

[Recorded sequence](../reviews/combat-mimic/sequence.webm) · [Marked ground](../reviews/combat-mimic/tv-in-play.png) · [One friend across](../reviews/combat-mimic/crossing-progress.png) · [Payoff](../reviews/combat-mimic/crossing-clear.png) · [Largest TV text](../reviews/combat-mimic/tv-largest.png) · [Largest phone text](../reviews/combat-mimic/phone-390-largest.png)
