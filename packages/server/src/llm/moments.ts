/**
 * What can happen next — the input to architecture §6.4's speculative prefetch.
 *
 * §6.4: "When the party enters a scene, immediately fire off generation for the
 * 3–4 likely reactions **during the transition animation.** By the time she
 * taps, the text is already in hand."
 *
 * So this answers one question: from where the party is standing, what are the
 * small number of scenes they could be looking at next, and by which button?
 * The chapter graph already knows — every branch is authored — which is why
 * this is a pure function over content and state rather than a guess.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS CAPPED
 *
 * §6.4 says three or four. A choice-point scene can author more, and prefetching
 * every branch of every scene multiplies the call count by the branching factor
 * for lines most of which are thrown away. The cap is not about the money (§6.2:
 * "cost is not a design constraint here") — it is that a burst of parallel
 * requests is the one thing that could make the *next* prefetch slow, and a slow
 * prefetch is a miss.
 */

import type { Chapter, RunState, Scene, SceneId } from "@kad/shared";
import type { NarrationRequest, PrefetchKey } from "./port.ts";
import { partyBrief, stampOf } from "./port.ts";

/** §6.4's "3–4 likely reactions". */
export const PREFETCH_WIDTH = 4;

export interface Moment {
  key: PrefetchKey;
  request: NarrationRequest;
}

/** The authored line for a scene, resolved the way the engine resolves it. */
export function authoredLine(scene: Scene): string {
  return scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
}

/**
 * Where a scene can lead, as `(label, destination)` pairs.
 *
 * A choice's label is the text on the button, which is both the cache key
 * (§6.4's `choiceId`) and the single most useful thing the prompt gets — it is
 * how the party got here, which is the one thing the authored line could not
 * have known.
 *
 * Species-gated choices are included even though this party may not be able to
 * take them. Filtering would need the party's species and would save at most one
 * call; including them means a gate that opens later is already warm.
 */
export function exitsOf(scene: Scene): { label: string | null; goto: SceneId }[] {
  switch (scene.type) {
    case "encounter":
      // A fight has exactly two ways out and the party does not choose either.
      // Both are worth having: the losing branch is where the layer earns the
      // most, because §7.3 says a loss is a story beat rather than a failure.
      return [
        { label: "won the fight", goto: scene.onVictory.goto },
        { label: "lost the fight", goto: scene.onDefeat.goto },
      ];
    case "check":
      return [
        { label: "passed the check", goto: scene.onSuccess.goto },
        { label: "failed the check", goto: scene.onFailure.goto },
      ];
    default:
      return dedupe(scene.choices.map((choice) => ({ label: choice.label, goto: choice.goto })));
  }
}

/**
 * One exit per destination — and **no label at all** when more than one choice
 * leads there.
 *
 * The collapsing is not an optimisation but a correctness rule, and the two
 * functions in this file disagreed without it. `arrivalKey` identifies an
 * arrival by finding the branch that leads where the party ended up, so a second
 * branch to the same scene would produce a key that can never be read back:
 * warming it spends a call on a line nothing will ever take.
 *
 * The reference chapter's entry scene is exactly this shape — three
 * species-gated choices, smash it, fly over it, walk through it, all arriving at
 * the same clearing. Before this they filled the prefetch window and pushed one
 * of the scene's only two *ungated* choices out of it, so the branch the party
 * was most likely to take was the one branch never warmed.
 *
 * **Dropping the label is the other half, and without it the fix was a bug.**
 * Keeping the first label meant a party who flew over the hedge got a line
 * generated from "smash it" — the prompt was told they got here by choosing
 * something they did not choose, and the line could then contradict the
 * authored transition sitting directly above it on the same screen. That is a
 * worse failure than no line at all, because it is confidently wrong about the
 * one thing this layer exists to know.
 *
 * The prefetch runs before anybody has tapped, so when several buttons lead to
 * the same room the honest answer is that we do not know which one they will
 * press. `via: null` says so, and `momentBlock` renders it as a plain arrival.
 */
function dedupe(exits: { label: string; goto: SceneId }[]): { label: string | null; goto: SceneId }[] {
  const count = new Map<SceneId, number>();
  for (const exit of exits) count.set(exit.goto, (count.get(exit.goto) ?? 0) + 1);

  const seen = new Set<SceneId>();
  const collapsed: { label: string | null; goto: SceneId }[] = [];
  for (const exit of exits) {
    if (seen.has(exit.goto)) continue;
    seen.add(exit.goto);
    collapsed.push({ label: (count.get(exit.goto) ?? 0) > 1 ? null : exit.label, goto: exit.goto });
  }
  return collapsed;
}

/**
 * The moments to warm from where the party is standing.
 *
 * Returns nothing rather than throwing for a run that is not in a chapter — the
 * lobby and character creation are most of a session's intents and none of them
 * have a scene to leave.
 */
export function nextMoments(state: RunState, chapter: Chapter): Moment[] {
  if (state.sceneId === null) return [];
  const here = chapter.scenes[state.sceneId];
  if (!here) return [];

  const party = partyBrief(state);
  // One fingerprint for the whole batch: every line in it is written against
  // the state the party is standing in right now, which is the state
  // `arrivalKey` will fingerprint when they leave.
  const stamp = stampOf(state);
  const moments: Moment[] = [];

  for (const exit of exitsOf(here).slice(0, PREFETCH_WIDTH)) {
    const destination = chapter.scenes[exit.goto];
    // A dangling goto is a `content:validate` failure, not something to crash a
    // live session over. Skipping it means the layer is quiet for that branch
    // and the game plays on.
    if (!destination) continue;
    const authored = authoredLine(destination);
    // Nothing to decorate, and nothing to fall back to either — the validator's
    // on-topic rule has no vocabulary to work with on a scene with no text.
    if (authored.trim().length === 0) continue;

    moments.push({
      key: { runId: state.runId, sceneId: exit.goto, choiceId: exit.label, stamp },
      request: {
        runId: state.runId,
        chapter,
        sceneId: exit.goto,
        scene: destination,
        authored,
        via: exit.label,
        party,
        flags: state.flags,
      },
    });
  }

  return moments;
}

/**
 * The key to look up when the party has *arrived* somewhere.
 *
 * The mirror of `nextMoments`: that one writes keys from the scene being left,
 * this one reads a key from the scene arrived at. They have to agree on the
 * label, which is why both go through `exitsOf` rather than each building the
 * string its own way.
 */
export function arrivalKey(
  before: RunState,
  after: RunState,
  chapter: Chapter,
): PrefetchKey | null {
  if (after.sceneId === null) return null;
  // Same scene: nobody arrived anywhere, so there is nothing to take.
  if (before.sceneId === after.sceneId) return null;

  const from = before.sceneId === null ? null : chapter.scenes[before.sceneId];
  if (!from) return null;

  const exit = exitsOf(from).find((each) => each.goto === after.sceneId);
  if (!exit) return null;

  // Fingerprinted from `before` — the state the party was standing in when the
  // batch was warmed — so a loop back through the same edge after anything has
  // happened misses rather than serving a line written for the first pass.
  return { runId: after.runId, sceneId: after.sceneId, choiceId: exit.label, stamp: stampOf(before) };
}
