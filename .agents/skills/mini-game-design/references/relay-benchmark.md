# Worked example: cooperative relay

## What the user rejected

The original relay asked for a press to catch and an upward slide to throw. Catching always worked, and the throw advanced the route regardless of direction or strength. It had little to judge or master. More button feedback or animation could not give those guaranteed actions stakes.

An early visual pass kept story paintings behind the game and added gestures elsewhere, but the user clarified that the actual gameplay remained flat. Fix the missing decisions before assuming the problem is missing chrome.

## Gameplay that earned approval

| Player action | Readable information | Consequence |
| --- | --- | --- |
| Catch | Incoming trajectory, landing circle, catch window | A well-timed and positioned touch catches cleanly; an early grab or missed landing uses a shared chance. |
| Throw | Receiving target and trajectory preview | Swipe direction and distance determine aim and strength. They change the next player's landing and flight time. |
| Save | A drifting flight or fallen object | The next player can rescue a poor pass. A late pickup costs a chance but lets the route continue. |
| Deliver | Home is a visible final target | A wild final throw rebounds to the sender for recovery instead of granting automatic success. |

The implemented version uses three shared chances, records clean throws and saves, and routes exhausted attempts into an authored failure branch. Those values and structures are specific to this game, not a recipe for all mini-games.

Relaxed play slows flights, widens targets, and removes the late catch deadline. Reduced motion provides a stationary, untimed catch. Explicit direction and strength controls allow aiming without swiping. The existing helping hand can carry the story forward.

Rendering and scoring use shared flight rules. Actions identify the flight and attempt. Catch timing uses the displayed phone position rather than network arrival time, following this cooperative game's existing trust model. That is a deliberate family-game tradeoff, not a security recommendation for competitive play.

## Why the first visuals still failed

The user liked the new gameplay but called the visuals subpar. The phone still had a blank gradient field, generic hand icons, a small object on a dark blob, a dashed circle, and a trajectory line. The TV had small characters lined up over a largely empty dark board.

Do not treat passing interaction tests or having some art on screen as visual completion.

## Visual changes the user loved

Inspect these actual accepted screens when calibrating a comparable storybook game:

- [Phone: catching hands, held object, receiving character, and aiming target](relay-phone.png).
- [TV: party standing in the painted location, active hero, delivery object, and home](relay-tv.png).

The improvement combined existing project art with one purpose-made sprite:

- The chapter's painted landscape fills the playfield; authored scene art takes precedence over the biome fallback.
- Empty leather catching gloves with green cuffs form a foreground cradle. They have true transparency and no baked-in orb, allowing any authored object to move independently above them.
- The actual next hero appears inside the gold aiming target. The final destination uses a painted basket.
- The object loses the generic dark backing. Glow and a restrained trail establish the focal point and reinforce motion.
- Larger TV figures stand on the ground with contact shadows, an active light, and readable names. The home target belongs in the same scene.
- Gold rings, warm highlights, and small ambient motes fit the existing art direction. The precise target remains a separate code-driven element.
- Duplicate result banners and clipped instructions were removed from the TV route. Short phones reveal the whole flight surface when a receiving turn begins, without scrolling during a swipe.
- The generated sprite was delivered as a 512-pixel transparent WebP of about 52 KB, with its full source retained. The new sprite and reused destination prop are included in chapter warming.

The screenshots are references for composition and finish, not templates to reproduce in every game. Do not copy this project's characters or glove treatment into an unrelated art direction by default.

## What was actually verified

The relay was exercised through real phones and a TV against the shared rules: a drop consumed a chance, an intentionally poor throw drifted left on the next phone, a pickup saved the delivery, and an aimed final swipe reached home. Visual review covered a 390 × 844 phone, a 360 × 640 phone, and a 1280 × 720 TV. Relevant tests, typechecking, production build, and offline asset warming were checked.

The user's approval is evidence for this visual direction. It is not a substitute for observing whether a family understands and enjoys the completed game.

## Transfer the lesson, not the exact mechanic

| Mini-game | A source of depth to investigate |
| --- | --- |
| Balance | A moving load changes leverage; players read tilt, coordinate corrections, and recover a slip. |
| Cooperative lift | Players choose when to pull and ease off as tension changes. Too much and too little have distinct effects. |
| Timing or precision | A readable opening or obstacle gives the timing a purpose. A near miss changes the situation and may allow a recovery. |
| Sequence | Partial arrangements operate a visible mechanism, producing useful feedback before final commitment. |
| Memory or tracking | The pattern belongs to a subject or situation; mistakes produce a legible response rather than only an incorrect marker. |
| Free play | Choices accumulate into a visible scene the players help author, without forcing failure onto expressive play. |

These are design possibilities. They were not implemented or validated by the relay work.
