/**
 * Playtest mode — jump to any scene, force any roll (roadmap chapter 6).
 *
 * The problem it solves is not subtle. Authoring the third branch of a check
 * scene means reaching it, and reaching it means starting a run, building three
 * characters, playing to the check, and rolling badly on purpose. An author who
 * has to do that to see one line of narration will not iterate; they will guess.
 * "Idea to validated, playable chapter in under an hour" is chapter 6's done
 * condition, and most of that hour is currently spent replaying the first half
 * of the chapter.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS INSIDE THE ENGINE RATHER THAN BESIDE IT
 *
 * The tempting design is a separate dev-only path that writes `sceneId` and
 * moves on, keeping the cheat entirely out of the shipped engine. It is the
 * wrong one: entering a scene runs `onEnter`, opens the scene's prompt, heals
 * at a Rest, sets phase and narration and art, and carries a pending item swap
 * across the transition. A second implementation of that would drift, and it
 * would drift in the exact direction that makes playtesting worthless — the
 * author would be testing a scene the game never actually produces.
 *
 * So a jump is `enterSceneDraft`, the same function `CHOOSE` and `ADVANCE` end
 * up in, and the safety is a gate rather than a separate road.
 *
 * ---------------------------------------------------------------------------
 * THE GATE
 *
 * Three independent locks, none of which trusts the other two:
 *
 *   1. `EngineContext.playtest` must be `true`. The engine refuses both intents
 *      as FORBIDDEN otherwise, and refuses to *honour* a loaded die even if one
 *      somehow reached the state.
 *   2. The server decides that flag per entry point. `dev-server.ts` sets it;
 *      `lambda/runtime.ts` sets it to a literal `false`, so a deployed build has
 *      no code path that turns it on — there is no environment variable to set
 *      by accident, which is the same shape as `DevIdentity` never being
 *      constructible in prod.
 *   3. The client only draws the panel under `import.meta.env.DEV`, so the
 *      production bundle does not contain it at all.
 *
 * Lock 1 is the one that matters; 2 and 3 exist so that no single mistake is
 * enough. A stranger on your daughter's screen is the threat model this project
 * already writes about, and "warp the party to the ending" is exactly the kind
 * of thing that must not be one flipped boolean away.
 */

import type { Rng } from "./dice.js";

/** spec §4.1 — one die, always. */
export const DIE_MIN = 1;
export const DIE_MAX = 20;

/** A die value the engine will accept, or null to clear a loaded one. */
export function readDie(value: number | null): number | null {
  if (value === null) return null;
  const die = Math.floor(value);
  if (!Number.isFinite(die) || die < DIE_MIN || die > DIE_MAX) return null;
  return die;
}

export interface LoadedRng {
  rng: Rng;
  /** Whether the loaded value was actually used, so it can be spent exactly once. */
  spent: () => boolean;
}

/**
 * An `Rng` whose first draw produces `die` on a d20, and which is the run's own
 * generator from the second draw on.
 *
 * Loaded at the `Rng` seam rather than at `resolveCheck` because that is the
 * only place *every* roll passes through — a check, an attack, and initiative
 * all reach the dice by way of `rollD20(rng)`. Forcing the result anywhere
 * higher up would mean forcing it in three places and forgetting the fourth
 * when one gets added.
 *
 * `rollD20` is `floor(next() * 20) + 1`, so the value that lands on face `d` is
 * `(d - 1) / 20` — the bottom of that face's bucket, which floors back to `d`
 * exactly, without depending on how the multiply rounds.
 *
 * One draw, not one intent. An author who forces a 20 and then taps a choice
 * that rolls nothing keeps the 20 for the roll that follows; an author who
 * forces a 20 into a fight spends it on the first attack and the rest of the
 * round is honest. Both are what "force the next roll" means at a table.
 */
export function loadDie(rng: Rng, die: number): LoadedRng {
  let used = false;
  return {
    rng: {
      next(): number {
        if (used) return rng.next();
        used = true;
        return (die - 1) / DIE_MAX;
      },
    },
    spent: () => used,
  };
}
