/**
 * ChapterPreface (#357): the words around a chapter, over the stage.
 *
 * - There is no "Last time…" card at a chapter's start. The chapter's goal is the one thing the
 *   start puts up and says (ChapterGoal, NarrationPanel); the campaign's prologue and the
 *   chapter's plate carry the story so far, and the Story page in the adventure book keeps the
 *   recap for anyone who wants it. `useStartPreface` remains only to hold the first scene's
 *   read-aloud behind a plate.
 * - **"Where you left off"**, for a screen that comes back partway: a room resumed with Keep
 *   going, a screen loaded mid-chapter (a TV refreshed, a phone dropping in), or a kid's phone
 *   coming back to the table while this screen watched. The goal, the steps ticked so far, and
 *   a line from each of the last few scenes the run walked (`RunState.visited`). Shown, not
 *   read: the story the table is in is what the voice is for.
 *
 * It asks for no tap. It goes away by itself once it has had time to be read, and at once
 * when play moves on to another scene. It is a DOM overlay above the stage (a figure that
 * overflows its frame, #366, stays behind it), between the corner row and the story plate,
 * and it steps its type down until it fits the room it has (fit-plate.ts), so the plate's words
 * and choices are never under it. Not in a fight: there the board is the picture.
 *
 * The usual rules (layout/WorldView.tsx): nothing here reads the room mode, and nothing uses a
 * viewport unit.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { leftOffLines } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import { onStageInset, stageInsetBottom } from "../world/stage-inset";
import { useEnsureChapter } from "./content";
import { useChapterGoal } from "./ChapterGoal";
import { fitPlate } from "./fit-plate";
import { Icon } from "./icons";
import { midChapter, sceneKey } from "./presence-copy";
import { atChapterStart, resetPrefaceCampaigns, useRunCampaign } from "./run-campaign";
import { useStartPlates } from "./start-plates";
import "./ChapterGoal.css";
import "./ChapterPreface.css";

/** How long "Where you left off" stays up: long enough to read slowly. */
export function prefaceShowMs(words: number): number {
  return Math.min(32_000, Math.max(12000, 1500 + words * 420));
}

const wordCount = (texts: readonly string[]): number => texts.join(" ").split(/\s+/).filter((w) => w !== "").length;

/** Test seam: forget fetched campaigns. */
export { resetPrefaceCampaigns };

/** How long a chapter's first scene waits on the campaign and chapter files, whose plates it may have to sit behind. */
export const PREFACE_WAIT_MS = 2500;

/**
 * Whether a chapter's first scene must wait. It waits while a prologue or chapter plate is up
 * (StoryPlates), and, never longer than PREFACE_WAIT_MS, while the campaign and chapter files
 * are still on the way: until they land there is no telling whether a painting is coming, and
 * a story said first would be cut off by it and could not be said again. Past the wait the
 * story is read without them.
 */
export function useStartPreface(): { status: "none" | "pending" } {
  useEnsureChapter();
  const state = useRunState();
  const chapter = useChapter();
  const campaign = useRunCampaign(state?.campaignId ?? null);
  const plates = useStartPlates();
  const start = state !== null && atChapterStart(state);
  const key = start ? `${state.runId}:${state.chapterId ?? ""}` : "";
  const loaded = start && chapter?.id === state.chapterId && campaign !== undefined;
  const waiting = start && !loaded;
  const [gaveUp, setGaveUp] = useState<string | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setGaveUp(key), PREFACE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, key]);
  if (plates !== null) return { status: "pending" };
  return { status: waiting && gaveUp !== key ? "pending" : "none" };
}

/**
 * The type steps down until the card fits its band (fit-plate.ts). On a band too short for even
 * the last rung (a phone's pane over a long rest scene), the oldest lines go, one at a time, and
 * then "So far" altogether; never the goal, its steps, or the last "Last time…" line. Read
 * aloud, every line is still said.
 */
/**
 * Fit the card to the room it has: the type steps down (`fitPlate`), then, if it is still
 * clipped, the least important parts go, one at a time: the recap's lines but the last, then
 * whatever carries `data-trim`, lowest number first. On the "Where you left off" card that is
 * the "So far" trail (1) before the goal's steps (2), so what stays longest is the heading
 * and the goal in one line: the sentence the whole chapter is about, never cut off by the
 * card's own bottom edge on a short phone.
 */
function fitCard(card: HTMLElement): void {
  card.hidden = false;
  const lines = [...card.querySelectorAll<HTMLElement>(".preface__lines > li")];
  const extras = [...card.querySelectorAll<HTMLElement>("[data-trim]")].sort(
    (a, b) => Number(a.dataset["trim"] || 1) - Number(b.dataset["trim"] || 1),
  );
  for (const element of [...lines, ...extras]) element.hidden = false;
  fitPlate(card);
  for (const element of [...lines.slice(0, -1), ...extras]) {
    if (!card.hasAttribute("data-clipped")) return;
    element.hidden = true;
    fitPlate(card);
  }
  // Still clipped with nothing left to trim: a phone held sideways, where the
  // story plate leaves the world pane a strip too short for even the heading
  // and the goal. A sliver of a card cut off mid-word says nothing a kid can
  // read, so the card stays away and the catch-up line, which fits, speaks.
  if (card.hasAttribute("data-clipped")) card.hidden = true;
}

type Shown = { key: string; scene: string };

/**
 * When this screen should say "Where you left off": the first look at a run that is already
 * partway through a chapter, a chapter coming back from the lobby partway through (Keep going),
 * or a seat at the table coming back (or a late joiner sitting down) while this screen watched.
 */
function cameBack(previous: RunState | null, state: RunState, firstLook: boolean): boolean {
  if (!midChapter(state) || state.encounter != null || atChapterStart(state)) return false;
  if (firstLook || previous === null) return true;
  if (!midChapter(previous) || previous.chapterId !== state.chapterId) return true;
  const before = new Map(previous.party.map((member) => [member.playerId, member.connected]));
  return state.party.some((member) => member.connected && before.get(member.playerId) !== true);
}

export function ChapterPreface(): ReactElement | null {
  const state = useRunState();
  const chapter = useChapter();
  const current = useChapterGoal();
  const [shown, setShown] = useState<Shown | null>(null);
  const previous = useRef<RunState | null>(null);
  const looked = useRef(false);

  useEffect(() => {
    if (state === null) return;
    const scene = sceneKey(state);
    const firstLook = !looked.current;
    looked.current = true;
    const before = previous.current;
    previous.current = state;
    if (cameBack(before, state, firstLook)) {
      setShown({ key: `${state.runId}:${scene}`, scene });
      return;
    }
    // Play moving on puts it away: it is about then, not now. So does a fight starting.
    setShown((now) => (now && (now.scene !== scene || state.encounter != null || !midChapter(state)) ? null : now));
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = shown !== null && chapter !== null && state !== null && chapter.id === state.chapterId;
  const trail = back ? leftOffLines(chapter, state.visited ?? []) : [];
  const words = wordCount([current?.goal.text ?? "", ...(current?.goal.steps.map((s) => s.label) ?? []), ...trail]);

  // Away by itself once it has had its time.
  const shownKey = shown?.key ?? null;
  useEffect(() => {
    if (shownKey === null || shown === null) return;
    const timer = setTimeout(() => setShown((now) => (now?.key === shownKey ? null : now)), prefaceShowMs(words));
    return () => clearTimeout(timer);
    // `words` is read once, when it goes up.
  }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Between the corner row and the story plate, however tall the plate is today.
  const [plate, setPlate] = useState(stageInsetBottom);
  useEffect(() => {
    const stop = onStageInset(setPlate);
    // The plate may have reported before this listened (a screen loading mid-chapter).
    setPlate(stageInsetBottom());
    return stop;
  }, []);
  const card = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (card.current) fitCard(card.current);
  });

  if (shown === null || state === null) return null;
  if (!back || (current === null && trail.length === 0)) return null;

  return (
    <div className="preface" style={{ ["--preface-plate" as string]: `${String(plate)}px` }}>
      <section
        ref={card}
        className="preface__card preface__card--back"
        data-testid="chapter-preface"
        data-kind="back"
        aria-label="Where you left off"
      >
        <>
            <h2 className="preface__head">Where you left off</h2>
            {current === null ? null : (
              <>
                <p className="preface__goal">
                  <Icon name="star" />
                  <span>
                    <span className="preface__label">Your goal: </span>
                    {current.goal.text}
                  </span>
                </p>
                <ul className="preface__steps" data-trim="2">
                  {current.goal.steps.map((step, i) => (
                    <li
                      key={step.id}
                      className={`goal__step${current.done[i] ? " goal__step--done" : ""}`}
                      data-done={current.done[i] ? "true" : "false"}
                    >
                      <span className="goal__box" role="img" aria-label={current.done[i] ? "Done" : "Not yet"}>
                        {current.done[i] ? <Icon name="check" /> : null}
                      </span>
                      <span className="goal__label">{step.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {trail.length === 0 ? null : (
              <>
                <h3 className="preface__sub" data-trim="1">So far</h3>
                <ul className="preface__lines preface__lines--trail" data-trim="1">
                  {trail.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
        </>
      </section>
    </div>
  );
}
