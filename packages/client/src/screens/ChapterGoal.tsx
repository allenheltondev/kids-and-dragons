/**
 * ChapterGoal — what the party is trying to do this chapter (#356).
 *
 * On the shared screen under the chapter's name, and on every phone under the
 * hero's strip, for the whole chapter. On the TV nobody opens it: there is
 * nothing to tap, and it ticks by itself. On a phone it is one line, the goal
 * and its pips (how many steps are done), until the kid taps it open for the
 * steps; the phone remembers which way it was left. The playtest asked for
 * that: the card in full took a third of a small phone. A step ticks the moment the engine sets its
 * flag or hands over its item (chapter-goal.ts), which is the same run state
 * every surface already has, so the TV and the phones always agree.
 *
 * A step that ticks while somebody is watching gets a moment: the box fills
 * gold, a few sparks pop and the shared screen plays a chime. Only a tick seen
 * happening does, so a screen that loads mid-chapter shows what is done
 * without celebrating it all again. Reduced motion keeps the gold and a soft
 * glow, and drops the pop and the sparks.
 *
 * A phone held sideways has no height to spare for it, so there it is an icon over the world with
 * how many steps are done, and a tap opens the steps over the picture (the hero's own pane drops
 * its line). The words are still said when the chapter opens, and the entry scene says them.
 *
 * In a fight the board is the picture, so the card folds to the goal and a
 * row of pips, out of the way of the figures. On a short pane (a tablet at the
 * largest text) it keeps the pips and names only the next step, so the head
 * stays on the sky. In a phone's world pane it is a pill, "Goal" and the pips:
 * the phone's own pane, a tap away and where it opens, has the words.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { goalProgress, partyItemIds } from "@kad/shared";
import type { ChapterGoal as Goal } from "@kad/shared";
import { cue } from "../audio/cue";
import { useChapter, useRunState } from "../store";
import { useEnsureChapter } from "./content";
import { Icon } from "./icons";
import { FoldChevron, useFold } from "../ui/Collapsible";
import { useLandscapePhone } from "../layout/landscape";
import "./ChapterGoal.css";

/** How long a fresh tick keeps its moment. */
export const TICK_MOMENT_MS = 2400;

/** The goal in play, with what is ticked, or null when there is none to show. */
export function useChapterGoal(): { chapterId: string; entry: string; goal: Goal; done: boolean[] } | null {
  useEnsureChapter();
  const chapter = useChapter();
  const state = useRunState();
  const chapterId = state?.chapterId ?? null;
  if (chapterId === null || chapter?.id !== chapterId || !chapter.goal) return null;
  // What the party holds between them, for a step that watches an item (the ledger, the chord).
  const held = partyItemIds({ members: (state?.party ?? []).map((member) => member.character) });
  return { chapterId, entry: chapter.entry, goal: chapter.goal, done: goalProgress(chapter.goal, { flags: state?.flags ?? {}, held }) };
}

/**
 * The steps that have just ticked in front of this screen. Seeded silently
 * with whatever is already done the first time a chapter's goal is seen.
 */
function useFreshTicks(current: { chapterId: string; done: boolean[] } | null, onTick?: () => void): Set<number> {
  const seen = useRef<{ chapterId: string; done: boolean[] } | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const key = current === null ? "" : `${current.chapterId}:${current.done.map(Number).join("")}`;
  const tick = useRef(onTick);
  tick.current = onTick;
  useEffect(() => {
    if (current === null) return;
    const before = seen.current;
    seen.current = { chapterId: current.chapterId, done: current.done };
    if (before === null || before.chapterId !== current.chapterId) {
      setFresh(new Set());
      return;
    }
    const now = current.done.flatMap((done, i) => (done && !before.done[i] ? [i] : []));
    if (now.length === 0) return;
    tick.current?.();
    setFresh(new Set(now));
    const timer = setTimeout(() => setFresh(new Set()), TICK_MOMENT_MS);
    return () => clearTimeout(timer);
    // `key` is the whole of what matters about `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

export interface ChapterGoalCardProps {
  /** Where it stands: the shared screen's head, or a phone under the hero's strip. */
  place: "world" | "phone";
  /** A fight: the goal and its pips, without the steps. */
  folded?: boolean;
}

export function ChapterGoalCard({ place, folded = false }: ChapterGoalCardProps): ReactElement | null {
  const current = useChapterGoal();
  // On a phone the card is one line until the kid opens it, and stays the way this device left it.
  const [open, toggle] = useFold("goal", false);
  const stepsId = `goal-steps-${useId().replace(/:/g, "")}`;
  const sideways = useLandscapePhone();
  // The chime is the room's, so only the shared surface plays it.
  const fresh = useFreshTicks(current, place === "world" ? () => cue("gem-pickup") : undefined);
  if (current === null) return null;
  const { goal, done } = current;
  /*
   * The goal is done when its required steps are. An optional step (07l's ledger, chord and true
   * answer) is an extra a party may miss and still finish the chapter, as the validator's spine
   * rule says, so it never holds back the trophy and is counted on its own.
   */
  const required = goal.steps.map((step, i) => ({ optional: step.optional === true, done: done[i] === true }));
  const needed = required.filter((step) => !step.optional);
  const extras = required.filter((step) => step.optional);
  const all = needed.length > 0 ? needed.every((step) => step.done) : extras.every((step) => step.done);
  const summary =
    `${String(needed.filter((step) => step.done).length)} of ${String(needed.length)} done` +
    (extras.length > 0 ? `, ${String(extras.filter((step) => step.done).length)} of ${String(extras.length)} extras` : "");
  // What a short pane names: the next required step. A missed extra is never "next": the party may
  // be long past the place it could be done.
  const next = required.findIndex((step) => !step.optional && !step.done);

  // Only a phone folds, and not in a fight, where the card is already one line with nothing under it.
  const foldable = place === "phone" && !folded;

  const steps = (hidden: boolean): ReactElement => (
    <ul className="goal__steps" id={stepsId} hidden={hidden}>
      {goal.steps.map((step, i) => (
        <li
          key={step.id}
          className={`goal__step${done[i] ? " goal__step--done" : ""}${fresh.has(i) ? " goal__step--fresh" : ""}${step.optional ? " goal__step--optional" : ""}`}
          data-done={done[i] ? "true" : "false"}
          data-next={i === next ? "true" : undefined}
        >
          {/* The box says its state in words, never colour alone (spec §11). */}
          <span className="goal__box" role="img" aria-label={done[i] ? "Done" : "Not yet"}>
            {done[i] ? <Icon name="check" /> : null}
          </span>
          <span className="goal__label">
            {step.label}
            {step.optional ? <span className="goal__maybe"> (if you can)</span> : null}
          </span>
          {fresh.has(i) ? (
            <span className="goal__sparks" aria-hidden="true">
              <i /><i /><i /><i /><i /><i />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );

  // A phone held sideways: the hero's pane keeps its height, and the world carries an icon.
  if (sideways) {
    if (place === "phone") return null;
    const count = needed.length > 0 ? needed.filter((step) => step.done).length : extras.filter((step) => step.done).length;
    const total = needed.length > 0 ? needed.length : extras.length;
    return (
      <section
        className={`goal goal--badge${all ? " goal--all" : ""}${open ? " goal--open" : ""}`}
        aria-label="Your goal"
        data-testid="chapter-goal"
      >
        <button
          type="button"
          className={`goal__badge kad-focusable${fresh.size > 0 ? " goal__badge--fresh" : ""}`}
          aria-expanded={open}
          aria-controls={stepsId}
          aria-label={`Your goal, ${summary}`}
          onClick={toggle}
        >
          <Icon name={all ? "trophy" : "star"} />
          <span className="goal__count" aria-hidden="true">{`${String(count)}/${String(total)}`}</span>
        </button>
        {open ? (
          <div className="goal__popover">
            <p className="goal__sentence-full">{goal.text}</p>
            {steps(false)}
          </div>
        ) : null}
      </section>
    );
  }
  const head = (
    <>
      <Icon name={all ? "trophy" : "star"} />
      <span className="goal__sentence">{goal.text}</span>
      {/* All a phone's world pane shows beside the pips (ChapterGoal.css): that phone's own
          pane carries the words, and the story there has no room to give. */}
      <span className="goal__tag" aria-hidden="true">Goal</span>
      {/* The pips: the whole goal in a fight, on a short pane, and on a phone's folded line
          (ChapterGoal.css). */}
      <span className="goal__pips" role="img" aria-label={summary}>
        {done.map((d, i) => (
          <span key={goal.steps[i]!.id} className={`goal__pip${d ? " goal__pip--done" : ""}${goal.steps[i]!.optional ? " goal__pip--optional" : ""}${fresh.has(i) ? " goal__pip--fresh" : ""}`} />
        ))}
      </span>
      {foldable ? <FoldChevron /> : null}
    </>
  );

  return (
    <section
      className={`goal goal--${place}${folded ? " goal--folded" : ""}${all ? " goal--all" : ""}${foldable ? (open ? " goal--open" : " goal--closed") : ""}`}
      aria-label="Your goal"
      data-testid="chapter-goal"
    >
      {foldable ? (
        <button
          type="button"
          className="goal__text goal__toggle kad-focusable"
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={toggle}
        >
          {head}
        </button>
      ) : (
        <p className="goal__text">{head}</p>
      )}
      {folded ? null : steps(foldable && !open)}
    </section>
  );
}
