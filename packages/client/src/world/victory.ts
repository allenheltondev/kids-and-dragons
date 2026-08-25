/**
 * The victory beat — roadmap chapter 8's "victory sequences".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A CLIENT-SIDE READING RATHER THAN A NEW PRESENTATION
 *
 * The engine has no VICTORY presentation and should not grow one. A fight that
 * ends *is* an arrival: `settleEncounter` takes `onVictory`'s branch and the
 * party walks into the next scene, which is a SCENE_ENTER like any other
 * (engine.ts). Adding a presentation kind for it would put a spectacle
 * decision in the protocol — and then in the event log, and then in replay —
 * to say something the state already says.
 *
 * What the state says is this: the encounter that was running a moment ago is
 * gone, and it was *won*. `encounterOutcome` answers the second half from the
 * encounter the client already mirrors, so the whole beat is a transition
 * detector over two states.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY IS NOT
 *
 * Not a screen, not a pause, not a thing anybody taps past. §7.3 makes losing
 * a story branch rather than a failure, and the mirror of that is that winning
 * is not a trophy ceremony either — the party beat the wisps and walks on. So
 * the beat is a flourish over the scene that is already arriving: a bloom of
 * light and the victory cue, under a second, with the next scene's own
 * transition carrying on underneath it.
 */

import { encounterOutcome, type RunState } from "@kad/shared";

/**
 * Did a fight just end in a win, between these two states?
 *
 * Pure over the pair, so the rule is testable with no renderer — and so the
 * two callers that need it (the flourish and the cue) cannot disagree about
 * what a victory is.
 *
 * The `before` encounter is the one that decides it: by `after` the engine
 * has already cleared the field. A run that never had a fight, a fight still
 * ongoing, and a wipe all answer false — a wipe is `onDefeat`, and a screen
 * that sparkled at a party being knocked down would be telling an
 * eight-year-old the opposite of what happened.
 */
export function justWonAFight(before: RunState | null, after: RunState | null): boolean {
  const fought = before?.encounter ?? null;
  if (!fought) return false;
  if (after?.encounter) return false;
  return encounterOutcome(fought) === "victory";
}
