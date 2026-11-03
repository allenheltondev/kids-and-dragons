---
name: mini-game-design
description: "Design, critique, or implement mini-games with meaningful player skill, recoverable consequences, and finished visual presentation. Use when a mini-game feels flat, consists of routine button presses, lacks stakes, or falls below its surrounding story's visual quality. Covers cooperative and narrative mini-games; not general UI styling or incidental gamification."
---

# Mini-Game Design

Make the player do something worth learning, in a world worth looking at. Treat gameplay depth and visual quality as separate acceptance gates: neither compensates for the other's absence.

This skill grew from a cooperative relay that initially guaranteed every catch and pass. The user approved its redesign only after both the gameplay and the visuals improved. Read [the worked relay example](references/relay-benchmark.md) when designing a similar interaction or calibrating presentation. Inspect the linked screenshots when doing visual work.

## Establish the playable situation

Inspect the actual rules, input handling, assets, and rendered experience before deciding what is missing. Identify the player's age and abilities, device, time available, narrative situation, and whether play is solo or cooperative from the available context. Resolve routine choices without turning the work into a design questionnaire.

Describe the intended loop in concrete terms:

- **Read:** What can the player see or hear and anticipate?
- **Act:** What judgment, choice, or physical skill does the input express?
- **Consequence:** How does the quality of that action change what happens next?
- **Recover:** How can the player notice a mistake, adjust, or help someone else?

A gesture is not a mechanic merely because it differs from a button. A swipe that always succeeds, an arbitrary hold that only fills a bar, and a tap disguised as touching a painted object can all remain flat.

For an audit, explain the missing judgment or consequence. For implementation work, build and verify the loop in the existing product. Respect requests limited to critique, concepts, or visual polish; do not silently replace established rules during an art task.

## Make action quality matter

Connect the player's input to an observable result: direction to landing, force to flight or tension, timing to a catch, arrangement to a working mechanism. Show enough information for the player to make a better attempt deliberately. Use previews, readable motion, spatial targets, and useful near-miss feedback where they fit.

In cooperative play, let one player's action create a situation another can respond to. A difficult pass that a friend can save has more depth than independent confirmations by every player. Give waiting players something intelligible to watch, predict, or communicate.

Choose stakes suited to the fiction and audience: a wobbling delivery, lost momentum, diminishing light, a recoverable slip, or an authored story branch. Show their effects in the situation. Avoid punishment that merely adds waiting or repeats chores. Keep free play open-ended when its purpose is expression; visible accumulated choices can supply consequence without failure.

Do not copy relay's three-chance allowance, catch windows, or final rebound into every game. Balance, lifting, memory, sequencing, and timing need their own source of play. When redesigning a set, establish one satisfying benchmark, then adapt its principles rather than reskinning its rules.

## Finish the visual experience

Match the surrounding product's art direction and level of care. A technically functional game with a generic dark rectangle, tiny figures, stock hand icons, and dashed targets is still a prototype when the story uses rich paintings and characters.

- **Place:** Carry the authored location into play. Use perspective, ground contact, shadows, and restrained atmosphere to make objects belong in the scene.
- **Subject:** Make the manipulated object and recipient unmistakable at gameplay size. Prefer existing painted props and actual characters to unrelated generic icons. Scale the focal action for the available space.
- **Foreground:** Where hands, tools, or controls embody the action, give them appropriate art. Keep moving objects separate from hand or tool artwork so different props and animation states remain possible.
- **Feedback:** Make targets, anticipation, catches, strain, misses, saves, and arrival legible. Motion and light should explain state or reinforce action. Preserve target contrast over detailed art.
- **Hierarchy:** Spend screen space on the playable situation. Avoid repeated headings, instructions, status lines, and celebration banners crowding out the scene. Keep the important action visible above fixed navigation on short screens.

Inventory usable project artwork before commissioning replacements. Generate raster art with the available image-generation workflow when a bespoke illustration is needed; use code for precise targets, trails, and state effects. Preserve transparent source art, save project assets in the project, and record generation provenance when applicable. Do not bake labels or gameplay controls into illustrations.

## Preserve fairness and access

For shared play, derive rendering and scoring from the same rules and state. Distinguish animation from authoritative outcomes. Associate inputs with their attempt or flight so a late touch cannot affect the next action. Score timing in a way appropriate to the game's trust model and latency, and preserve recovery after reload or a participant disconnecting.

Provide appropriate alternatives to demanding gestures or motion: explicit aim/strength controls, wider windows, slower play, stationary presentation, or a helping hand. Preserve meaningful choices where possible. Reduced motion must actually stop decorative and gameplay motion that needs an alternative. Keep shared displays read-only when that is the product's model.

## Review both gates

Exercise a clean run, a near miss, a poor action, a recovery, and the end condition. Verify that actions produce different consequences and that stale or rejected inputs do not corrupt the game. Check relevant alternate inputs, reduced motion, and multiplayer state transitions.

Inspect the running game on its real surfaces, including the smallest supported viewport and any shared display. Capture and review actual screens; fix clipped targets, obscured actions, weak silhouettes, unreadable contrast, poor scale, and missing-art fallbacks. Include new assets in delivery and offline warming when the product supports it.

Report what changed, the practical verification, and any remaining limitation. Keep tests and browser evidence distinct from evidence that the game is fun. When observing players is possible, look for anticipation, deliberate corrections, cheering for saves, and wanting another turn; completion rate alone is insufficient.
