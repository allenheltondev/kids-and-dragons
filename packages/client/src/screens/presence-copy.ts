/**
 * Words for drop in, drop out (#258): a friend who stepped away, as the shared
 * screen says it, and what a watching phone (#388) says the party is doing.
 *
 * Pure, so the screens and the tests say one thing. Kid-facing (CLAUDE.md,
 * Voice): short, warm, never counting the party, no em dashes.
 */

import type { RunState } from "@kad/shared";

/**
 * The shared screen's line for one friend who stepped away. Their hero is not
 * knocked down and not gone: it waits with the party. When the fight's clock
 * is on them, it says how the table goes on (CombatPanel's "Pass … turn").
 */
export function steppedAwayLine(name: string, holdsTurn: boolean): string {
  return holdsTurn ? `${name} stepped away. Any phone can pass their turn.` : `${name} stepped away.`;
}

/** Mid-chapter: where a kid arriving has missed something worth a line. */
export function midChapter(state: Pick<RunState, "phase">): boolean {
  return state.phase === "scene" || state.phase === "check" || state.phase === "encounter";
}

/** What the party is doing right now, as somebody watching (#388) needs to hear it. */
function situation(state: RunState): string {
  if (state.encounter) return "The party is in a fight!";
  if (state.phase === "encounter") return "A fight is about to start!";
  const prompt = state.prompt;
  if (prompt?.kind === "roll") return "The party is trying something tricky.";
  if (prompt?.kind === "item_swap") return "Somebody just found something.";
  if (state.sceneType === "rest") return "The party is taking a rest.";
  if (prompt?.kind === "choice") {
    return prompt.vote ? "The party is voting on what to do next." : "The party is deciding what to do next.";
  }
  return "The party is on the move.";
}

/**
 * What a spectator's phone says the party is doing (#388), or null before the
 * story starts, when there is nothing yet to watch.
 */
export function watchingLine(state: RunState): string | null {
  return midChapter(state) ? situation(state) : null;
}

/** Which scene of which chapter, counting a revisit as a new arrival. */
export function sceneKey(state: RunState): string {
  return [state.chapterId ?? "", state.sceneId ?? "", (state.visited ?? []).length].join("|");
}
