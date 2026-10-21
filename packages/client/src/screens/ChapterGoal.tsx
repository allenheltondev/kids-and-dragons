/**
 * ChapterGoal — what the party is trying to do this chapter (#356).
 *
 * On the shared screen under the chapter's name, and on every phone under the
 * hero's strip, for the whole chapter. Nobody opens it: there is nothing to
 * tap, and it ticks by itself. A step ticks the moment the engine sets its
 * flag or hands over its item (chapter-goal.ts), which is the same run state
 * every surface already has, so the TV and the phones always agree.
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
 * stays on the sky. In a phone's world pane it is a pill, "Goal" and the pips:
 * the phone's own pane, a tap away and where it opens, has the words.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { goalProgress, partyItemIds } from "@kad/shared";
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

  return (
    <section
      className={`goal goal--${place}${folded ? " goal--folded" : ""}${all ? " goal--all" : ""}`}
      aria-label="Your goal"
      data-testid="chapter-goal"
    >
      <p className="goal__text">
        <Icon name={all ? "trophy" : "star"} />
        <span className="goal__sentence">{goal.text}</span>
        {/* All a phone's world pane shows beside the pips (ChapterGoal.css): that phone's own
            pane carries the words, and the story there has no room to give. */}
        <span className="goal__tag" aria-hidden="true">Goal</span>
        {/* The pips: the whole goal in a fight, and on a short pane (ChapterGoal.css). */}
        <span className="goal__pips" role="img" aria-label={summary}>
          {done.map((d, i) => (
            <span key={goal.steps[i]!.id} className={`goal__pip${d ? " goal__pip--done" : ""}${goal.steps[i]!.optional ? " goal__pip--optional" : ""}${fresh.has(i) ? " goal__pip--fresh" : ""}`} />
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
      )}
    </section>
  );
}
