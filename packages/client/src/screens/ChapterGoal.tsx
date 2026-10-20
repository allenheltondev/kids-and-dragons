/**
 * ChapterGoal — what the party is trying to do this chapter (#356).
 *
 * On the shared screen under the chapter's name, and on every phone under the
 * hero's strip, for the whole chapter. Nobody opens it: there is nothing to
 * tap, and it ticks by itself. A step ticks the moment the engine sets its
 * flag (chapter-goal.ts), which is the same run state every surface already
 * has, so the TV and the phones always agree.
 *
 * A step that ticks while somebody is watching gets a moment: the box fills
 * gold, a few sparks pop and the shared screen plays a chime. Only a tick seen
 * happening does, so a screen that loads mid-chapter shows what is done
 * without celebrating it all again. Reduced motion keeps the gold and a soft
 * glow, and drops the pop and the sparks.
 *
 * In a fight the board is the picture, so the card folds to the goal and a
 * row of pips, out of the way of the figures. On a short pane (a tablet at the
 * largest text) it keeps the pips and names only the next step, so the head
 * stays on the sky.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { goalProgress } from "@kad/shared";
import type { ChapterGoal as Goal } from "@kad/shared";
import { cue } from "../audio/cue";
import { useChapter, useRunState } from "../store";
import { useEnsureChapter } from "./content";
import { Icon } from "./icons";
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
  return { chapterId, entry: chapter.entry, goal: chapter.goal, done: goalProgress(chapter.goal, state?.flags ?? {}) };
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
  // The chime is the room's, so only the shared surface plays it.
  const fresh = useFreshTicks(current, place === "world" ? () => cue("gem-pickup") : undefined);
  if (current === null) return null;
  const { goal, done } = current;
  const count = done.filter(Boolean).length;
  const all = count === goal.steps.length;
  const summary = `${String(count)} of ${String(goal.steps.length)} done`;
  // The first step not done yet: all a short pane has room to name.
  const next = done.findIndex((d) => !d);

  return (
    <section
      className={`goal goal--${place}${folded ? " goal--folded" : ""}${all ? " goal--all" : ""}`}
      aria-label="Your goal"
      data-testid="chapter-goal"
    >
      <p className="goal__text">
        <Icon name={all ? "trophy" : "star"} />
        <span>{goal.text}</span>
        {/* The pips: the whole goal in a fight, and on a short pane (ChapterGoal.css). */}
        <span className="goal__pips" role="img" aria-label={summary}>
          {done.map((d, i) => (
            <span key={goal.steps[i]!.id} className={`goal__pip${d ? " goal__pip--done" : ""}${fresh.has(i) ? " goal__pip--fresh" : ""}`} />
          ))}
        </span>
      </p>
      {folded ? null : (
        <ul className="goal__steps">
          {goal.steps.map((step, i) => (
            <li
              key={step.id}
              className={`goal__step${done[i] ? " goal__step--done" : ""}${fresh.has(i) ? " goal__step--fresh" : ""}${step.optional ? " goal__step--optional" : ""}`}
              data-done={done[i] ? "true" : "false"}
              data-next={i === next ? "true" : undefined}
            >
              <span className="goal__box" aria-hidden="true">
                {done[i] ? <Icon name="check" /> : null}
              </span>
              <span className="goal__label">
                {step.label}
                {step.optional ? <span className="goal__maybe"> (if you can)</span> : null}
              </span>
              {/* Words for the step's state, never colour alone (spec §11). */}
              <span className="kad-sr-only">{done[i] ? ", done" : ", not yet"}</span>
              {fresh.has(i) ? (
                <span className="goal__sparks" aria-hidden="true">
                  <i /><i /><i /><i /><i /><i />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
