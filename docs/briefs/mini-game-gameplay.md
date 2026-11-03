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

## Remaining mechanics: implemented pass

The same design gates now apply to the other interaction kinds. See [the design and compatibility notes](../reviews/mini-game-depth.md) for the complete read / act / consequence / recovery audit.

| Game | Gameplay now implemented |
| --- | --- |
| Balance | Carry a changing load across safe steps. Adjust shared lift before committing; slips scale with error, and steady carrying restores footing. |
| Cooperative effort | Choose a force with a physical grip or explicit strength control. A friend's committed effort changes what the remaining hands need to supply. Gentle compensation can save a weak pull; a jerk strains the support. |
| Precision and timing | Read a painted prop's landing or opening. Near misses offer easier recovery than rough actions. A clean action completes the authored task immediately. |
| Sequence | Operate a visible path with partial tests before committing to the crossing. Verified steps light up on every screen; changed steps lose their confirmation. Drag and keyboard rearrangement remain available. |
| Memory | Rebuild the pattern with a correctly remembered opening retained after one mistake. A second broken tune exposes the authored failure branch. |
| Tracking | An empty cover stays raised and unavailable. The remaining covers still allow a recovery. |
| Free play | Choices accumulate into a shared visible arrangement without adding a failure state. |

Current phones request the new rules when starting. Already active saves and older clients retain their original controls. The existing helping hand and authored result branches remain available.

Browser evidence verifies rendering, gestures, state changes, and access. Review these games with a family before treating them as tuned: look for anticipation, deliberate corrections, helping a friend recover, and wanting another turn. Completion rate alone will not show whether they are fun.
