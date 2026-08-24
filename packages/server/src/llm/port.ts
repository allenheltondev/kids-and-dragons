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
  /**
   * A fingerprint of the state the line was written against.
   *
   * §6.4 keys the cache on `(sceneId, choiceId)` alone, which is enough for a
   * party that only ever moves forward and wrong for one that loops. A chapter
   * may route back through a scene it has already been through, and the entry
   * from the first pass is still sitting in the map: the same edge, the same
   * key, a line written before an intervening fight, before three flags got
   * set, and before somebody got knocked down.
   *
   * Serving that is worse than serving nothing, because it is *specifically*
   * wrong — the layer's whole job is to know what has happened, so a stale line
   * fails at exactly the thing it was added to do.
   *
   * So the key carries what the prompt actually read. Anything the narration
   * depends on changing makes the key miss, and a miss is the authored text.
   * Deliberately conservative: an intervening fight invalidates warm entries
   * that would still have been fine, and that costs one live call.
   */
  stamp: string;
}

/**
 * The fingerprint — the state a line was written against, as a short string.
 *
 * Covers exactly what reaches the prompt: who is hurt or down (`partyBlock`)
 * and which flags are set (`sceneBlock`). Not `seq`, which moves on every
 * READY and every roll and would miss every single time; not the whole state,
 * which would do the same for a different reason.
 *
 * ---------------------------------------------------------------------------
 * WHY A FIGHT'S STAMP IGNORES THE PARTY'S HEALTH
 *
 * `leaving` is the scene these exits leave *from*, and when it is an encounter
 * the health half is dropped. In a fight hp moves on nearly every accepted
 * action, so a stamp that includes it is a key that changes every turn — and
 * since `warm()` runs after every action, each turn of a fight bought fresh
 * lines for the same two exits and threw away the last turn's. A typical fight
 * paid for its "won"/"lost" lines twenty times over and read one of them.
 *
 * Keeping the stamp still across the fight means the entry warmed when the
 * fight began is the one `arrivalKey` finds when it ends: mid-fight warms hit
 * `ready` and send nothing. The price is honest and small — the line was
 * written against the party as it stood when the fight started, and the one
 * fact that matters about how it ended is already in the label ("won the
 * fight" / "lost the fight"). Flags stay in the stamp either way: a flag set
 * mid-fight is rare and worth a re-warm.
 */
export function stampOf(state: RunState, leaving: Scene): string {
  const health =
    leaving.type === "encounter"
      ? ""
      : state.party
          .map((member) => `${member.character.id}:${String(member.hp)}${member.down ? "d" : ""}`)
          .join(",");
  const flags = Object.entries(state.flags)
    .filter(([, on]) => on)
    .map(([flag]) => flag)
    .sort()
    .join(",");
  return `${health}|${flags}`;
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
   * Warms the cache for what can happen next.
   *
   * **Returns a promise the caller must await**, which is the opposite of what
   * fire-and-forget wants and is forced by where this runs. On Lambda the
   * execution environment is frozen the moment the handler's promise resolves:
   * a request dispatched and not awaited does not continue during the gap it
   * was dispatched into. It resumes on the *next* invocation — which is the tap
   * it was supposed to be ready for, arriving after `take()` has already
   * missed. Speculative work that lands after the moment it was speculating
   * about is worse than none: it is paid for and never read.
   *
   * Awaiting costs the player nothing, because of *where* it is awaited. The
   * patch is published to every phone before this is called, so the television
   * and all three controllers have already moved on; the only thing still
   * waiting is the acting phone's HTTP response, which carries `{ ok, seq }`
   * and which nothing renders from.
   *
   * Never rejects — a failure to warm is a cache miss, and a cache miss is the
   * authored text.
   */
  warm(moments: { key: PrefetchKey; request: NarrationRequest }[]): Promise<void>;

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
  warm: () => Promise.resolve(),
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
