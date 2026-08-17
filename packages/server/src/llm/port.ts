/**
 * The live-narration seam — architecture §6, roadmap chapter 7.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS FILE EXISTS TO MAKE STRUCTURAL
 *
 * "Turning the whole layer off changes nothing about whether the game works"
 * is chapter 7's done condition, and the cross-cutting table calls it the
 * **AI-optional invariant — tested in CI, not assumed**.
 *
 * The way to get that for free is to make *absence* the default rather than a
 * configuration. Every method here returns `null` for "I have nothing", every
 * caller already has to handle `null` because the model can always fail its own
 * validator, and `silentNarrator` returns `null` unconditionally. So the
 * stubbed path is not a special case the tests opt into — it is the same code
 * path a live call takes on a bad day, exercised by every test in the suite
 * that does not deliberately install a narrator.
 *
 * A `Narrator` may never throw and may never block for long. A screen at a
 * table with an eight-year-old at it does not wait for a language model.
 */

import type { Chapter, RunState, Scene, SceneId } from "@kad/shared";

/** One party member, flattened to what a prompt actually needs. */
export interface PartyBrief {
  name: string;
  species: string;
  class: string;
  level: number;
  /** Current and maximum, because "bruised" is worth narrating. */
  hp: number;
  maxHp: number;
  down: boolean;
}

/**
 * A moment worth a line of flavour.
 *
 * Carries the authored text rather than only the scene id, because the authored
 * line is three things at once: the fallback when anything goes wrong, the
 * anchor the model is asked to stay faithful to, and — per §6.3 — part of the
 * cached prefix.
 */
export interface NarrationRequest {
  runId: string;
  chapter: Chapter;
  sceneId: SceneId;
  scene: Scene;
  /** The authored narration this is decorating. Never empty. */
  authored: string;
  /**
   * How the party got here — the label on the choice they tapped, or null when
   * they arrived by any other road (a chapter's entry, a fight ending, a jump).
   *
   * This is the whole point of the layer. The authored text is written once for
   * every way into the scene; this is the one thing about *this* arrival that
   * the author could not have known.
   */
  via: string | null;
  party: PartyBrief[];
  /** Story flags set so far, for continuity ("you already freed the sprite"). */
  flags: Record<string, boolean>;
}

/** The end-of-session recap — architecture §6.5's second length cap. */
export interface RecapRequest {
  runId: string;
  chapter: Chapter;
  party: PartyBrief[];
  flags: Record<string, boolean>;
  /** Scenes visited, in order. The spine of the story to retell. */
  visited: SceneId[];
  /** How the chapter ended, when it has. */
  outcome: string | null;
}

/**
 * The cache key for a speculative generation — architecture §6.4's
 * `(sceneId, choiceId)`.
 *
 * `runId` is in it too, which §6.4 leaves implicit by saying "per-run cache". A
 * shared process serves many tables at once, so it has to be explicit here or
 * one household's prefetched line reaches another's television.
 */
export interface PrefetchKey {
  runId: string;
  sceneId: SceneId;
  /** The label of the choice that leads here, or null for a direct arrival. */
  choiceId: string | null;
}

export interface Narrator {
  /**
   * The line for a moment, or `null` to use the authored text.
   *
   * Never throws, never waits on the network: a hit on the speculative cache or
   * nothing. §6.4 wants "the player should never observe a wait", and the only
   * way to promise that is to refuse to be able to wait.
   */
  take(key: PrefetchKey, request: NarrationRequest): string | null;

  /**
   * Warms the cache for what can happen next. Returns immediately; the work
   * happens after the response has already gone out.
   *
   * Fire-and-forget on purpose — a rejected promise here must not fail the
   * action that triggered it, and there is nothing to await because nothing
   * downstream is allowed to block on the result.
   */
  warm(moments: { key: PrefetchKey; request: NarrationRequest }[]): void;

  /** The end-of-chapter recap, or `null`. This one may take its time. */
  recap(request: RecapRequest): Promise<string | null>;
}

/**
 * The narrator that never says anything — and therefore the definition of the
 * game working without the layer.
 *
 * This is the default in `HandlerDeps`, what CI runs, and what a deploy with
 * `LIVE_LLM_ENABLED=false` installs. Not a mock: the real code path.
 */
export const silentNarrator: Narrator = {
  take: () => null,
  warm: () => undefined,
  recap: () => Promise.resolve(null),
};

/** Flattens a run's party into the shape a prompt reads. */
export function partyBrief(state: RunState): PartyBrief[] {
  return state.party.map((member) => ({
    name: member.character.name,
    species: member.character.species,
    class: member.character.class,
    level: member.character.level,
    hp: member.hp,
    // On the character rather than the member: `maxHp` is *derived* (base +
    // species + trinkets) and lives on the resolved snapshot, while `hp` is the
    // mutable running total the fight writes.
    maxHp: member.character.maxHp,
    down: member.down,
  }));
}
