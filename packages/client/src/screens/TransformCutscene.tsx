/**
 * TransformCutscene — the whole party stops to watch (spec §8.1).
 *
 * "Hitting a tier plays a transformation cutscene — the whole party stops to
 * watch. **This is the single most important moment in the game** and gets the
 * most animation budget." The roadmap says the same thing in stage directions:
 * party stops, camera pushes in, tier swap, full-screen moment.
 *
 * Driven by the **progression** channel, not the presentation one, and that is
 * not a style choice. `Presentation` carries one event per patch, and the patch
 * that crosses a tier is a chapter completion — which is already spending its
 * one presentation on CHAPTER_COMPLETE. The `LEVEL_UP` and `TRANSFORM`
 * presentation kinds exist in the protocol and **nothing has ever constructed
 * one**: the server puts tier changes in `progression.awards`, which is the
 * channel documented for exactly this ("ordered, replay-safe level/tier
 * progression updates") and which dedupes on server seq the same way.
 *
 * One beat per character, in party order, rather than everybody at once. XP is
 * uniform (spec §8.1 — "uniform party XP is what keeps everybody transforming
 * on the same evening"), so a whole party crossing a tier together is the
 * *normal* case, not the edge one. Six seconds of three separate moments beats
 * two seconds of a crowd: the eight-year-old this game is for gets her own.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { speak, TIER_IDS } from "@kad/shared";
import type { TierId } from "@kad/shared";
import { useParty, useProgression } from "../store";
import { CharacterPortrait } from "./CharacterPortrait";
import { Icon } from "./icons";
import "./shared.css";
import "./TransformCutscene.css";

/**
 * Three beats, and the middle one is the whole point.
 *
 * `BEFORE_MS` is long enough to recognise who it is at the tier they walked in
 * with; the swap lands on that boundary. `AFTER_MS` is deliberately the longest
 * hold in the client — longer than the dice (spec §4.1's ~1.5s) — because this
 * is the one screen the design says to over-polish.
 */
const BEFORE_MS = 900;
const AFTER_MS = 2400;

/**
 * How long one character's moment lasts, end to end.
 *
 * Exported because a second clock has to stay in step with it: in Travel Mode
 * the shell hands the world pane the whole screen for the cutscene, exactly as
 * it does for the roll, and it sizes that hold from this. DiceOverlay's header
 * notes the same arrangement for its three clocks — the difference here is that
 * this one is imported rather than re-typed, because a cutscene queue's length
 * is not a constant anybody could keep in their head.
 */
export const TRANSFORM_BEAT_MS = BEFORE_MS + AFTER_MS;

/** What a tier is called out loud. Capitalised for the sentence, not the id. */
const TIER_WORD: Record<TierId, string> = {
  fledgling: "Fledgling",
  sworn: "Sworn",
  radiant: "Radiant",
  mythic: "Mythic",
};

/**
 * The tier a character is coming *from*.
 *
 * Derived from the ladder rather than carried on the award, because the award
 * says where progression arrived and the ladder is the one place that knows the
 * order. Tiers only ever climb on an award — a campaign failure reverts a
 * character without producing one — so the step below is the honest answer.
 *
 * Exported so the derivation is testable without a DOM, the same way
 * `nextFace` is in DiceOverlay.
 */
export function previousTier(tier: TierId): TierId | null {
  const index = TIER_IDS.indexOf(tier);
  return index > 0 ? TIER_IDS[index - 1] ?? null : null;
}

/** One character's moment, queued. */
interface Beat {
  /** Monotonic, so the same character crossing twice still plays twice. */
  id: number;
  characterId: string;
  tier: TierId;
}

/**
 * `prefers-reduced-motion` turns off the push-in and shortens the hold, but
 * never the *swap*: the picture changing is the information, and the motion is
 * decoration on top of it. Asked in JS as well as CSS because a timer is not
 * something a media query can shorten.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function TransformCutscene(): ReactElement | null {
  const party = useParty();
  const [queue, setQueue] = useState<Beat[]>([]);
  /*
   * *Which beat* has swapped, not whether one has.
   *
   * A boolean here is a flash waiting to happen: when a beat ends and the queue
   * advances, the flag is still true for the next character's first committed
   * render, so the second hero in a queue shows her *result* — new picture, tier
   * word — for a frame before snapping back to "is changing…". Resetting it in
   * the same batch as the dequeue fixes the ordering; keying it to a beat id
   * removes the possibility, because a flag that names beat 1 simply does not
   * apply to beat 2. React flushes passive effects after the commit, so the
   * ordering version depends on a paint not happening in between — which is not
   * something to rely on for the one screen the design says to over-polish.
   */
  const [swappedFor, setSwappedFor] = useState<number | null>(null);
  const nextId = useRef(0);

  useProgression(
    useCallback((event) => {
      const crossings = (event.progression.awards ?? []).filter(
        (award): award is typeof award & { newTier: TierId } => award.newTier !== undefined,
      );
      if (crossings.length === 0) return;
      setQueue((pending) => [
        ...pending,
        ...crossings.map((award) => {
          nextId.current += 1;
          return { id: nextId.current, characterId: award.characterId, tier: award.newTier };
        }),
      ]);
    }, []),
  );

  const current = queue[0] ?? null;
  const currentId = current?.id ?? null;

  /*
   * The party as of now, read from inside a timer rather than closed over. The
   * beat outlives several renders and the lineup can be re-resolved underneath
   * it; a stale closure would announce a name from before the patch landed.
   */
  const partyRef = useRef(party);
  partyRef.current = party;
  const beatRef = useRef(current);
  beatRef.current = current;

  /*
   * One timer chain per beat, keyed on its id. The swap lands mid-beat and the
   * beat pops itself off the front when it is done, which is what makes a queue
   * of three play as three moments rather than one overlapping mess.
   *
   * The line is spoken *in* the swap callback rather than from a render effect
   * watching `swapped`. An effect needs a render to happen between the two
   * timers to see the flipped flag, and there is no rule that says one will:
   * a backgrounded tab coalesces pending timers on resume, and then the first
   * character of a queue transforms silently while the second gets both. A
   * side effect of the swap belongs on the swap.
   */
  useEffect(() => {
    if (currentId === null) return;
    const reduced = prefersReducedMotion();
    const before = reduced ? 0 : BEFORE_MS;
    const after = reduced ? Math.round(AFTER_MS / 2) : AFTER_MS;

    const announce = (): void => {
      const beat = beatRef.current;
      if (!beat) return;
      const name =
        partyRef.current.find((m) => m.character.id === beat.characterId)?.character.name ??
        "Someone";
      /*
       * Interrupts, unlike every other aside on this surface. The party has
       * stopped to watch; whatever was still being read out belongs to the
       * scene they have just finished.
       */
      speak(`${name} is ${TIER_WORD[beat.tier]}!`, { source: "narration", interrupt: true });
    };

    /*
     * Reduced motion has no "before" half to wait through, so it announces
     * immediately and schedules no swap at all. A zero-delay timer *and* an
     * immediate call would say the line twice.
     */
    if (before === 0) {
      setSwappedFor(currentId);
      announce();
    }
    const swap =
      before === 0
        ? null
        : window.setTimeout(() => {
            setSwappedFor(currentId);
            announce();
          }, before);
    // No reset needed on the way out: the flag names the beat it belongs to, so
    // the next one starts un-swapped by construction rather than by ordering.
    const done = window.setTimeout(() => {
      setQueue((pending) => pending.slice(1));
    }, before + after);

    return () => {
      if (swap !== null) window.clearTimeout(swap);
      window.clearTimeout(done);
    };
  }, [currentId]);

  const swapped = current !== null && swappedFor === current.id;
  const member =
    current === null ? null : party.find((m) => m.character.id === current.characterId) ?? null;

  /*
   * A run that reconnects onto a completed chapter replays nothing — the
   * progression watermark and a fresh store see to that — and a client with no
   * party for the id still gets the beat, because a missing name is not a
   * reason to swallow the most important moment in the game.
   */
  if (current === null) return null;

  const from = previousTier(current.tier);
  const shownTier = swapped ? current.tier : from ?? current.tier;
  const name = member?.character.name ?? "Someone";

  return (
    <div
      className={`transform${swapped ? " transform--after" : ""}`}
      role="status"
      aria-live="assertive"
    >
      <div className="transform__stage">
        {/*
         * The camera push. It is the *stage* that scales rather than the
         * figure, so the light pooled under the feet grows with it instead of
         * sliding out from underneath — the same reason the dice tumble inside
         * a stage that does not rotate.
         */}
        <span className="transform__figure" aria-hidden="true">
          {member === null ? (
            <Icon name="levelup" size="60%" />
          ) : (
            <CharacterPortrait
              species={member.character.species}
              characterClass={member.character.class}
              tier={shownTier}
              accent={member.character.appearance.accent}
              size="100%"
              lit
              float={swapped}
              stand="floor"
            />
          )}
        </span>
        <span className="transform__burst" aria-hidden="true" />
      </div>

      <p className="transform__name">{name}</p>
      {/* Word and icon, never colour alone (spec §11) — and the tier is the
          word she has been waiting a whole campaign for, so it gets the size. */}
      <p className="transform__tier">
        {swapped ? (
          <>
            <Icon name="star" />
            <span>{TIER_WORD[current.tier]}!</span>
          </>
        ) : (
          <>
            <Icon name="levelup" />
            <span>is changing…</span>
          </>
        )}
      </p>
    </div>
  );
}
