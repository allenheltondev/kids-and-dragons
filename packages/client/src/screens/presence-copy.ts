/**
 * Words for drop in, drop out (#258): a friend who stepped away, as the shared
 * screen says it, and the one line a kid who comes back (or joins partway)
 * reads on their own phone.
 *
 * Pure, so the screens and the tests say one thing. Kid-facing (CLAUDE.md,
 * Voice): short, warm, never counting the party, no em dashes.
 */

import { combatantById, type PartyMember, type RunState } from "@kad/shared";

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

/**
 * What the party is doing right now, as a kid arriving needs to hear it, and
 * what that means for their hero. A late joiner who sat down mid-fight is not
 * on the board (the engine seats them; the fight was set before they came),
 * so they hear that they join in after it.
 */
function situation(state: RunState, me: PartyMember | null): string {
  const encounter = state.encounter ?? null;
  if (encounter) {
    // Watching (#388): no hero of their own to place.
    if (!me) return "The party is in a fight!";
    const mine = combatantById(encounter, me.character.id);
    if (!mine) return "The party is in a fight. You join in after it.";
    if (mine.down) return "The party is in a fight, and a friend can help your hero up.";
    return "The party is in a fight, and your hero is right where you left them.";
  }
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
 * The catch-up (#258, spec §8.4): who you are, then what is going on. A kid
 * coming back hears "Welcome back"; one joining partway hears "Welcome".
 */
export function catchUpLine(state: RunState, me: PartyMember, returning: boolean): string {
  const hello = returning ? `Welcome back, ${me.character.name}!` : `Welcome, ${me.character.name}!`;
  return `${hello} ${situation(state, me)}`;
}

/**
 * What a spectator's phone says the party is doing (#388), or null before the
 * story starts, when there is nothing yet to watch.
 */
export function watchingLine(state: RunState): string | null {
  return midChapter(state) ? situation(state, null) : null;
}

/**
 * A fingerprint of where the story is, for telling whether anything happened
 * while this phone's connection was down: the scene, the fight's turn, and the
 * question open. Equal before and after means there is nothing to catch up on.
 */
export function situationKey(state: RunState): string {
  const encounter = state.encounter ?? null;
  return [
    state.chapterId ?? "",
    state.sceneId ?? "",
    (state.visited ?? []).length,
    encounter ? `${encounter.round}:${encounter.turnIndex}` : "",
    state.prompt?.kind ?? "",
  ].join("|");
}

/** Which scene of which chapter, counting a revisit as a new arrival. */
export function sceneKey(state: RunState): string {
  return [state.chapterId ?? "", state.sceneId ?? "", (state.visited ?? []).length].join("|");
}
