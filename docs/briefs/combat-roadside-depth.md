# Roadside combat: hold a lane, make a crossing

This extends the ferry benchmark into Gemfall chapter 2. The remaining combat catalog still needs individual design work and family observation.

## Sausage wagon

Two hungry cinder wolves approach a compact 7 × 6 lane. A shield marks the defensive post; the sausage wagon waits on the road above it. Finish two rounds with a standing hero there and no wolf on it, and the drover rolls clear. The rounds need not be consecutive: a friend can take over after a retreat or a recovery. Normal attacks, protection, healing and control remain available. Shooing both wolves still wins.

The choice is between committing a defender to the wagon and concentrating on the wolves. Leaving the lane costs progress opportunities. Five rounds without a resolution sends the wolves after a thrown string of sausages; the caravan continues with less supper. Defeat retains its existing recovery branch.

## Plank mimic

The 7 × 6 ditch has two crossings around blocked banks. The mimic marks fixed ground before its next slap. Players can bait the mark, move out of it, interrupt with daze, protect a friend, or shoo the mimic. Getting every standing friend to the far bank ends the fight through a separate escape branch. Downed friends are brought along by the existing escape rules.

Crossing leaves the buried whistle and coins behind; defeating the mimic still earns them. After six rounds the hay cart tips, leading to the existing goats-and-cider recovery. This is a route and reward decision, rather than a second helping-turn counter.

## Presentation and compatibility

Both encounters reuse painted chapter locations and characters. The wagon now has a bespoke transparent sausage-wagon prop, matching the existing painted inventory; its source and final generation prompt are recorded in `docs/art-sources/sausage-wagon.md`. Physical exits can now select a story prop; the mimic's far bank uses a plank edge instead of a magical gate. The same authored asset reaches the phone, TV and offline chapter warming. Existing exits retain their gate and glyph fallback.

Mission phones use the compact layout and two action cards whether or not an enemy has a windup. The shared panel keeps the merged two-level typography and single outer frame, including open-exit instructions.

Previously saved ordinary wolf fights keep their stored board and lack of environment. The ordinary combat arithmetic and board-rendering goldens continue to use the shipped roadside arena; their digests remain unchanged. Only chapter 2's intentional content-file digest is repinned. The graph proof is regenerated for the exit-art schema addition.

## Wagon experience benchmark

The wagon is now staged above the defended lane, with wheel tracks and state-driven travel rather than a counter attached to a small icon. Peach targeting arrows show which friend each wolf currently plans to attack; movement and intervening turns can change those forecasts. The shield remains separate from the wagon, making the defender's position clear.

Earned progress moves the wagon along the road and changes the phone's route view. Leaving the post stops new progress without erasing safe rounds. A browser run deliberately leaves the post after one safe round and hands it to the other hero, then captures the wagon rolling clear. Reconnecting snaps to saved progress; reduced motion uses stationary positions. The departure prop uses the measured story head and narration bounds to stay out of their text. Repeated chapter goals and objective captions are removed from this mission's combat column.

The handoff is positional: the defender draws the wolves toward the right flank while their friend approaches from the left. Retreating behind that friend can instead let a wolf occupy the shield. The phone gives the last consequence priority over an automatic fighter-detail paragraph; tapping a portrait still opens inspection. Action names and descriptions retain 16px/12px floors rather than letting the added scene reduce them to tiny type.

[Watch the actual encounter sequence](../reviews/combat-roadside/wagon-sequence.webm), [the exposed post](../reviews/combat-roadside/wagon-vulnerable.png), and [the departure](../reviews/combat-roadside/wagon-clear-normal.png). The recording is a trimmed browser capture, not a scripted animation mockup.

## Verification

Authored-rule tests cover one, two and four support heroes holding the wagon and crossing the ditch with enemies still standing, saved progress, ignored objectives reaching timeout, and the separate reward contract. Browser tests play both fights with two phones and a TV, use a real movement control, reload in progress, and check 320px phones and largest text without hiding the action cards or scrolling the prompt. Captures are under `docs/reviews/combat-roadside/`.

These establish playability and readable presentation. Whether children choose to rotate defenders, bait the slap or leave treasure behind still needs observation.

Final validation: 238 focused tests, five browser scenarios (both roadside fights, ferry, rescue and general combat), type checking, content validation/proofs, production build and payload budget pass. Payload is 329KB first paint and 1488KB total. The first-paint limit stays 330KB; the total budget explicitly increases from 1485KB to 1490KB for the approximately 5KB wagon feature, with no new dependency.

| Encounter | TV | Largest TV text | 320px phone | Largest phone text |
| --- | --- | --- | --- | --- |
| Wagon | [View](../reviews/combat-roadside/wolves-tv-normal.png) | [View](../reviews/combat-roadside/wolves-tv-largest.png) | [View](../reviews/combat-roadside/wolves-phone-320-normal.png) | [View](../reviews/combat-roadside/wolves-phone-390-largest.png) |
| Mimic | [View](../reviews/combat-roadside/mimic-tv-normal.png) | [View](../reviews/combat-roadside/mimic-tv-largest.png) | [View](../reviews/combat-roadside/mimic-phone-320-normal.png) | [View](../reviews/combat-roadside/mimic-phone-390-largest.png) |
