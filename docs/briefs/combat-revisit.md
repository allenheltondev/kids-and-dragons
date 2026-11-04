# Combat revisit: encounter design benchmark

Status: implemented first benchmark and shared combat presentation pass. Automated checks and rendered phone/TV review verify rules, controls, and layout; family observation is still needed to judge whether fights are satisfying.

## Delivered benchmark

- Bun's rescue uses a compact 7 × 6 arena and two shared helping turns. Rescue progress survives saves; clearing enemies alone cannot finish this mission. Existing encounters retain their default victory rules.
- Enemy forecasts use the server's deterministic planner and describe the present board. Moving, protection, and intervening turns can change the eventual result.
- Waiting friends can suggest a board location without spending a move or action. Suggestions use the existing ephemeral preview channel, expire locally, and yield to the active player's aim.
- Visible fighter portraits replace the fighter dropdown. Bag, Stats, Friends, Class token, and Settings use direct page buttons.
- Phone terrain reuses existing biome tiles. On the shared screen, mission information occupies the measured fight-log column; repeated scene prose gives way to the battlefield while narration remains spoken and available on phones.
- Bundle measurements: 329KB first paint and 1481KB total before the final layout adjustment. Budgets explicitly allow 330KB and 1485KB. No runtime dependency or new raster asset was added.

This is a benchmark encounter plus improvements used by all fights, not a completed rewrite of every authored encounter. The expansion criteria below remain the family playtest checklist.

## What the audit found

- Gemfall has 34 encounter scenes, none with an authored environment. Riftlight has 23, of which 17 have environments and 15 have objective mechanics. This is a content-design opportunity as well as a UI problem.
- The base enemy policy is deliberately predictable: approach a reachable standing hero and attack. Environmental encounters can add guarding posts, captives, and readable creature behaviors. Preserve readability rather than making opponents secretly smarter.
- The ability system already supports protection, recovery, healing, movement, walls, and control. Adding more cards will not by itself make an encounter ask an interesting question.
- The phone review shows many equally gold legal destinations, small fighters, and the prompt "Walk on gold, or choose an action." It communicates permission more clearly than purpose or consequence.
- Basic attack and Get Ready can be the only legal choices in a solo support-class situation. Class identity needs a solo review alongside cooperative play.
- Enemy turns resolve authoritatively as a sequence. The planner is pure and deterministic, but its output is not currently a player-facing forecast. Forecasts must describe their scope honestly: a plan from the present board can change after another actor moves.

## Intended experience

A child can say: "The wisp is heading for Fern. I can stand between them while you get Bun out." After acting, the scene makes the result visible and gives the next player a reason to respond.

Read the situation → make a plan together → take an action → see what changed → recover or exploit the opening.

## First benchmark: a rescue encounter

Use a short rescue with a visible route to safety as the design benchmark, grounded in the existing Bun rescue scenario. The first screen should answer three questions: what are we trying to accomplish, what threatens it, and what can this hero contribute now?

1. Put the rescue and safe route on the board as the primary situation. Clearly distinguish completing the rescue, escaping, and simply clearing enemies; successful damage must not accidentally erase the encounter's purpose.
2. Make readable enemy intentions visible before commitment. Share planning with the authoritative rules, including roots, walls, guard posts, escaped heroes, and turn order. Distinguish a present-board forecast from a committed wind-up; avoid promising a future target that can silently change.
3. Give positioning an observable purpose: cover a friend, create space, reach the rescue, hold a route, or gather enemies for an area effect. Highlight the relevant few relationships instead of giving every legal tile equal visual weight.
4. Explain what an action will change in the situation. Keep legality, probabilities, and uncertain outcomes honest. Do not replace meaningful choices with a suggested best move.
5. Let a mistake create a recoverable problem: a threatened friend, lost position, or delayed rescue. A friend's protection, shove, heal, or helping hand should visibly answer it.
6. Present the payoff in the world: who protected whom, what opening was made, and what is now safe. Keep dice readable while returning attention to the action and its consequence promptly.

## Presentation benchmark

- Phone: readable actors and one current decision, with purpose and the relevant threat visible while selecting a move or action.
- TV: stage the whole encounter as a shared scene, with the mission, threats, reactions, and consequences legible from the sofa. Keep it read-only.
- Tablet: avoid requiring players to reconcile two equally dense boards to understand one decision.
- Preserve touch and keyboard access, reduced-motion equivalents, large text, reconnect recovery, stale-input protection, and older active encounter contracts.

## Acceptance before expansion

Exercise one, two, and four heroes; solo support classes; an ordinary success; a poor move; a protection or control save; a downed hero's recovery; escape; and reload during a turn. Inspect real phone and TV screens. Count empty movement turns, waiting, repetitive attacks, and adult explanations.

Family observation decides whether the benchmark is ready to spread: can children anticipate danger, explain a choice, coordinate different contributions, notice a save, and want to play again? Passing tests and finishing the fight do not establish those qualities.

## Verification evidence

The browser review covers 320px and 390px phones, tablet, largest text, enlarged map, missing-art fallbacks, and a real two-phone/TV rescue with suggestion delivery and refresh. Saved captures: [active phone](../reviews/combat-revisit/rescue-active-phone.png) and [shared TV](../reviews/combat-revisit/rescue-tv.png).

Type checking, production build, payload budget, content validation/proofs, focused combat regressions, and both final browser tests pass. The broad regression run passed 9,632 tests and skipped 15; its single outdated practice environment allowlist assertion was updated for the rescue victory field, and the complete affected 39-test content suite subsequently passed.
