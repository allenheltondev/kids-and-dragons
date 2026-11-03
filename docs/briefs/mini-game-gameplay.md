# Mini-game gameplay benchmark

The storytelling provides a situation, anticipation and consequences. Mini-games need the same qualities in their rules: a gesture should express a decision or skill, and its quality should change what happens next. Painting a control or filling a shared progress bar does not supply that depth.

## Relay: first implementation

- Catch the incoming object in its landing circle during the catch window. An early grab or a missed landing uses one of three shared chances. A fallen object can be picked up and the route continues.
- Aim an upward swipe at the next pair of gold hands. Horizontal direction and swipe distance determine accuracy and strength. A trajectory preview makes the gesture learnable before release; tapping the throw surface does not advance the route.
- A clean throw reaches the middle of the receiving phone. An inaccurate throw drifts left or right and narrows the catch window. Strength changes flight duration. The next player can save a poor throw.
- Home is a target too. A wild final throw rebounds, uses a chance, and stays with the last player for recovery. Three drops end the attempt and expose the existing authored failure branch. Continuing, rather than a visual effect, applies that branch.
- Clean throws, saves and best catch streak persist with the prompt and appear in the result. The TV shows the same shared route and chances. Inputs carry a flight identifier so old touches cannot affect a later flight.
- Relaxed play slows flights, widens targets, and leaves late catches available. Reduced motion uses a stationary, untimed catch. Explicit direction and strength controls provide the same throw decisions without swiping. The existing helping hand remains available.
- Old active saves retain their original relay until retry. New attempts use flight gameplay.

Catch timing uses the position displayed by the phone, like existing precision games, rather than penalizing network delivery latency. Measurements are validated by the engine; this cooperative game does not attempt to prevent a modified client from forging timing.

## Next mechanics to develop against this benchmark

| Game | Current source of flatness | Gameplay to explore |
| --- | --- | --- |
| Balance | Find a static total; everyone can converge on one setting | A moving load changes each side's leverage. Read the tilt, coordinate corrections, and recover a slip. |
| Cooperative lift | Holding or adding props only fills elapsed time | Choose when to pull and ease off as tension changes. Too much and too little should have different visible effects. |
| Precision and timing | A repeating abstract window ends in a binary result | Read an obstacle or opening in the scene. Let near misses alter the situation and offer a recovery. |
| Sequence | Submit an ordered answer | Let partial arrangements operate a visible mechanism, revealing useful feedback before the final commitment. |
| Memory and tracking | Observe and return an answer | Tie the pattern to a changing subject and make a mistaken response do something legible in the scene. |
| Free play | Repeated choices can produce equivalent reactions | Make choices accumulate into a visible scene the children helped author. Keep genuinely playful scenes free of failure. |

These are design directions, not implemented mechanics. Review relay with a family before copying its difficulty or three-chance structure elsewhere. Watch for understanding, anticipation, deliberate corrections, cheering for saves, and wanting another turn; completion rate alone will not show whether it is fun.
