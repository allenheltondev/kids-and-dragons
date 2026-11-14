/**
 * ChapterGoal — what the party is trying to do this chapter (#356), how far along it is, and
 * the chances it can take or leave on the way.
 *
 * On the shared screen under the chapter's name, and on every phone under the hero's strip, for
 * the whole chapter. On the TV nobody opens it: there is nothing to tap, and it ticks by itself.
 *
 * Three things, read from the run every surface already mirrors (chapter-trail.ts):
 *
 * - **The goal**: one sentence, the why. A kid who drifted off looks up and knows.
 * - **The trail**: a pip for each of the goal's milestones and a thin line for how far along the
 *   chapter is. Every road ticks every milestone (the validator holds them to the spine), so
 *   listing them ahead was a checklist nobody could miss and a small spoiler. A milestone is named
 *   only once it ticks, in the words for how this party did it (`doneLabel`). An optional step,
 *   one a party may miss, is named ahead with "(if you can)", like a chance.
 * - **The chances**: the chapter's bonus objectives. One the story has mentioned (`reveal`) shows
 *   its `hint` until it is met or no road left can meet it, when it quietly goes. One met with no
 *   reveal is a surprise. Met ones stay, gold, for the rest of the chapter.
 *
 * A milestone or chance that ticks while somebody is watching gets a moment: its words in gold
 * with a few sparks, and the shared screen plays a chime. Only a tick seen happening does, so a
 * screen that loads mid-chapter shows what is done without celebrating it all again. Reduced
 * motion keeps the gold and drops the pop and the sparks.
 *
 * On a phone it is one line, the goal and its pips, until the kid taps it open for the rest; the
 * phone remembers which way it was left. A phone held sideways has no height to spare for it, so
 * there it is an icon over the world with how many milestones are done, and a tap opens the rest
 * over the picture (the hero's own pane drops its line).
 *
 * In a fight the board is the picture, so the card folds to the goal and its pips, out of the
 * way of the figures. On a short pane (a tablet at the largest text) it keeps the pips and the
 * open chances. In a phone's world pane it is a pill, "Goal" and the pips.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode,
 * and nothing uses a viewport unit.
 */

import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { chanceStates, goalMilestones, partyItemIds, scenesToEnding, trailFraction } from "@kad/shared";
import type { Chance, ChapterGoal as Goal, GoalStep } from "@kad/shared";
import { cue } from "../audio/cue";
import { useChapter, useRunState } from "../store";
import { useEnsureChapter } from "./content";
import { Icon } from "./icons";
import { FoldChevron, useFold } from "../ui/Collapsible";
import { PlayerShell, useLandscapePhone } from "../layout/landscape";
import "./ChapterGoal.css";

/** How long a fresh tick keeps its moment. */
export const TICK_MOMENT_MS = 2400;

/** A goal step as the screens show it: ticked or not, and what a ticked one says. */
export interface Milestone {
  step: GoalStep;
  done: boolean;
  said: string;
}

export interface GoalInPlay {
  chapterId: string;
  entry: string;
  goal: Goal;
  /** Ticked or not, for each step in order. */
  done: boolean[];
  milestones: Milestone[];
  /** The chances on screen: open, or met. Hidden and missed ones are left out. */
  chances: Chance[];
  /** How far along the chapter the party stands, 0 to 1. */
  trail: number;
}

/** The goal in play, with what is ticked, or null when there is none to show. */
export function useChapterGoal(): GoalInPlay | null {
  useEnsureChapter();
  const chapter = useChapter();
  const state = useRunState();
  const chapterId = state?.chapterId ?? null;
  // The road lengths only change with the chapter.
  const distances = useMemo(() => (chapter ? scenesToEnding(chapter) : null), [chapter]);
  if (chapterId === null || chapter?.id !== chapterId || !chapter.goal || distances === null) return null;
  // What the party holds between them, for a step that watches an item (the ledger, the chord).
  const held = partyItemIds({ members: (state?.party ?? []).map((member) => member.character) });
  const flags = state?.flags ?? {};
  const milestones = goalMilestones(chapter.goal.steps, { flags, held });
  const sceneId = state?.sceneId ?? null;
  const ended = state?.phase === "chapter_complete";
  // Who is at the table: a chance behind a species or class gate nobody here meets is missed.
  const members = (state?.party ?? []).map((member) => member.character);
  const party = { species: members.map((m) => m.species), classes: members.map((m) => m.class) };
  const chances = chanceStates(chapter, { flags, visited: state?.visited ?? [], sceneId, party }).filter(
    (chance) => chance.state === "met" || (chance.state === "open" && !ended),
  );
  return {
    chapterId,
    entry: chapter.entry,
    goal: chapter.goal,
    done: milestones.map((m) => m.done),
    milestones,
    chances,
    trail: ended ? 1 : trailFraction(chapter, sceneId, distances),
  };
}

/** What can tick, in one list: the milestones, then the chances, each by a stable key. */
function tickKeys(current: GoalInPlay): { key: string; done: boolean }[] {
  return [
    ...current.milestones.map((m) => ({ key: `step:${m.step.id}`, done: m.done })),
    ...current.chances.map((c) => ({ key: `chance:${c.objective.id}`, done: c.state === "met" })),
  ];
}

/**
 * The milestones and chances that have just ticked in front of this screen, by key. Seeded
 * silently with whatever is already done the first time a chapter's goal is seen.
 */
function useFreshTicks(current: GoalInPlay | null, onTick?: () => void): Set<string> {
  const seen = useRef<{ chapterId: string; done: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const keys = current === null ? [] : tickKeys(current);
  const doneNow = keys.filter((k) => k.done).map((k) => k.key);
  const key = current === null ? "" : `${current.chapterId}:${doneNow.join(",")}`;
  const tick = useRef(onTick);
  tick.current = onTick;
  useEffect(() => {
    if (current === null) return;
    const before = seen.current;
    seen.current = { chapterId: current.chapterId, done: new Set(doneNow) };
    if (before === null || before.chapterId !== current.chapterId) {
      setFresh(new Set());
      return;
    }
    const now = doneNow.filter((k) => !before.done.has(k));
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

/** The furthest along the trail this screen has shown this chapter: a detour never walks it back. */
function useFurthest(chapterId: string | null, trail: number): number {
  const furthest = useRef<{ chapterId: string | null; at: number }>({ chapterId: null, at: 0 });
  if (furthest.current.chapterId !== chapterId) furthest.current = { chapterId, at: trail };
  else furthest.current.at = Math.max(furthest.current.at, trail);
  return furthest.current.at;
}

/** "About halfway", in tenths, for the trail's words. */
export function trailWords(trail: number): string {
  if (trail >= 1) return "At the end";
  if (trail <= 0) return "Just starting";
  return `About ${String(Math.max(10, Math.min(90, Math.round(trail * 10) * 10)))}% of the way`;
}

/** A chance's own words: its hint while open, its label once met. */
function chanceWords(chance: Chance): string {
  return chance.state === "met" ? chance.objective.label : (chance.objective.hint ?? chance.objective.label);
}

function Sparks(): ReactElement {
  return (
    <span className="goal__sparks" aria-hidden="true">
      <i /><i /><i /><i /><i /><i />
    </span>
  );
}

const COUNT_WORDS = ["None", "One", "Two", "Three", "Four"];

/** "Two more to go": the milestones not yet ticked, counted and never named. */
export function stillAhead(count: number): string {
  return `${COUNT_WORDS[count] ?? String(count)} more to go`;
}

/**
 * What a list of milestones shows, in order: each done one in its words, each extra not yet done
 * by what it asks, then one row for the required ones still ahead.
 */
export function milestoneRows(milestones: readonly Milestone[]): { key: string; done: boolean; words: string; optional: boolean }[] {
  const rows = milestones
    .filter((m) => m.done || m.step.optional === true)
    .map((m) => ({ key: m.step.id, done: m.done, words: m.done ? m.said : m.step.label, optional: m.step.optional === true }));
  const ahead = milestones.filter((m) => !m.done && m.step.optional !== true).length;
  if (ahead > 0) rows.push({ key: "@ahead", done: false, words: stillAhead(ahead), optional: false });
  return rows;
}

export function MilestoneList({ milestones, className = "goal__steps", trim }: { milestones: readonly Milestone[]; className?: string; trim?: string }): ReactElement {
  return (
    <ul className={className} data-trim={trim}>
      {milestoneRows(milestones).map((row) => (
        <li
          key={row.key}
          className={`goal__step${row.done ? " goal__step--done" : ""}${row.optional ? " goal__step--optional" : ""}`}
          data-done={row.done ? "true" : "false"}
        >
          {/* The box says its state in words, never colour alone (spec §11). */}
          <span className="goal__box" role="img" aria-label={row.done ? "Done" : "Not yet"}>
            {row.done ? <Icon name="check" /> : null}
          </span>
          <span className="goal__label">
            {row.words}
            {row.optional && !row.done ? <span className="goal__maybe"> (if you can)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ChapterGoalCardProps {
  /** Where it stands: the shared screen's head, or a phone under the hero's strip. */
  place: "world" | "phone";
  /** A fight: the goal and its pips, without the rest. */
  folded?: boolean;
  /** The chapter's summary: the milestones by name, in the words for how this party did them. */
  recap?: boolean;
}

export function ChapterGoalCard({ place, folded = false, recap = false }: ChapterGoalCardProps): ReactElement | null {
  const current = useChapterGoal();
  // On a phone the card is one line until the kid opens it, and stays the way this device left it.
  const [open, toggle] = useFold("goal", false);
  const restId = `goal-rest-${useId().replace(/:/g, "")}`;
  // Only a player's own shell: the shared screen is read-only at any size (layout/WorldView.tsx).
  // Both hooks run every render, whichever is true: a phone turning must not change their order.
  const landscapePhone = useLandscapePhone();
  const inPlayerShell = useContext(PlayerShell);
  const sideways = landscapePhone && inPlayerShell;
  // The chime is the room's, so only the shared surface plays it.
  const fresh = useFreshTicks(current, place === "world" ? () => cue("gem-pickup") : undefined);
  const trail = useFurthest(current?.chapterId ?? null, current?.trail ?? 0);
  if (current === null) return null;
  const { goal, milestones, chances } = current;
  /*
   * The goal is done when its required steps are. An optional step (07l's ledger, chord and true
   * answer) is an extra a party may miss and still finish the chapter, as the validator's spine
   * rule says, so it never holds back the trophy and is counted on its own.
   */
  const needed = milestones.filter((m) => m.step.optional !== true);
  const extras = milestones.filter((m) => m.step.optional === true);
  const all = needed.length > 0 ? needed.every((m) => m.done) : extras.every((m) => m.done);
  const summary =
    `${String(needed.filter((m) => m.done).length)} of ${String(needed.length)} done` +
    (extras.length > 0 ? `, ${String(extras.filter((m) => m.done).length)} of ${String(extras.length)} extras` : "");

  // Only a phone folds, and not in a fight, where the card is already one line with nothing under it.
  const foldable = place === "phone" && !folded;

  // What just ticked, in its words: a milestone as this party did it, a chance as it was met.
  const moments: { key: string; words: string; xp?: number }[] = [
    ...milestones.filter((m) => fresh.has(`step:${m.step.id}`)).map((m) => ({ key: `step:${m.step.id}`, words: m.said })),
    ...chances
      .filter((c) => fresh.has(`chance:${c.objective.id}`))
      .map((c) => ({ key: `chance:${c.objective.id}`, words: c.revealed ? c.objective.label : `Bonus! ${c.objective.label}`, xp: c.objective.xp })),
  ];

  const pips = (
    <span className="goal__pips" role="img" aria-label={summary}>
      {milestones.map((m) => (
        <span
          key={m.step.id}
          className={`goal__pip${m.done ? " goal__pip--done" : ""}${m.step.optional ? " goal__pip--optional" : ""}${fresh.has(`step:${m.step.id}`) ? " goal__pip--fresh" : ""}`}
        />
      ))}
    </span>
  );

  const trailLine = (
    <span className="goal__trail" role="img" aria-label={trailWords(trail)} data-trail={trail.toFixed(2)}>
      <span className="goal__trail-fill" style={{ inlineSize: `${String(Math.round(trail * 100))}%` }} />
    </span>
  );

  const momentLine =
    moments.length === 0 ? null : (
      <p className="goal__moment" role="status">
        {moments.map((m) => (
          <span key={m.key} className="goal__moment-item">
            <Icon name="check" />
            <span className="goal__moment-words">{m.words}</span>
            {m.xp ? <span className="goal__moment-xp">{`+${String(m.xp)} XP`}</span> : null}
            <Sparks />
          </span>
        ))}
      </p>
    );

  const chanceList =
    chances.length === 0 ? null : (
      <ul className="goal__chances" aria-label="Chances">
        {chances.map((c) => (
          <li
            key={c.objective.id}
            className={`goal__chance goal__chance--${c.state}${fresh.has(`chance:${c.objective.id}`) ? " goal__chance--fresh" : ""}`}
            data-state={c.state}
          >
            <Icon name={c.state === "met" ? "check" : "star"} />
            <span>{chanceWords(c)}</span>
          </li>
        ))}
      </ul>
    );

  /*
   * The milestones by name, for a phone opened, the sideways icon's card and the summary: what is
   * done in this party's words, an extra by what it asks, and the rest as one line of how many.
   */
  const milestoneList = <MilestoneList milestones={milestones} />;

  // A phone held sideways: the hero's pane keeps its height, and the world carries an icon.
  if (sideways) {
    if (place === "phone") return null;
    const counted = needed.length > 0 ? needed : extras;
    const count = counted.filter((m) => m.done).length;
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
          aria-controls={open ? restId : undefined}
          aria-label={`Your goal, ${summary}`}
          onClick={toggle}
        >
          <Icon name={all ? "trophy" : "star"} />
          <span className="goal__count" aria-hidden="true">{`${String(count)}/${String(counted.length)}`}</span>
        </button>
        {open ? (
          <div className="goal__popover" id={restId}>
            <p className="goal__sentence-full">{goal.text}</p>
            {trailLine}
            {milestoneList}
            {chanceList}
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
      {pips}
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
          aria-controls={restId}
          onClick={toggle}
        >
          {head}
        </button>
      ) : (
        <p className="goal__text">{head}</p>
      )}
      {folded ? null : foldable ? (
        <div className="goal__rest" id={restId} hidden={!open}>
          {trailLine}
          {momentLine}
          {milestoneList}
          {chanceList}
        </div>
      ) : (
        <>
          {recap ? null : trailLine}
          {momentLine}
          {recap ? milestoneList : null}
          {chanceList}
        </>
      )}
    </section>
  );
}
