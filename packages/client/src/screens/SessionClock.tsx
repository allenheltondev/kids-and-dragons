/**
 * The session clock (#511): the host's pause and resume for a meal, bedtime or
 * a dead wifi, an optional short note, and what the evening took.
 *
 * Collection is transparent and optional. The panel says what is kept (the
 * chapter, how many played, when scenes opened, pauses, one note) and what is
 * not (names, chat, audio), and the host can turn timing off for the room. It
 * draws nothing at all on a server that is not keeping time.
 */

import { useEffect, useState } from "react";
import { TIMING_NOTE_MAX, type RunState, type TimingReport } from "@kad/shared";
import { useGameStore } from "../store";
import { Button } from "../ui";
import { currentSitting, sittingSentence, splitSentence } from "./session-clock";

/** True while a chapter is being played, which is when the clock means anything. */
function playing(state: Pick<RunState, "phase" | "campaignId">): boolean {
  return state.campaignId !== null && (state.phase === "scene" || state.phase === "check" || state.phase === "encounter");
}

/** The report, read when the panel opens and again whenever the clock or the chapter changes. */
function useTiming(state: RunState): TimingReport | null {
  const loadTiming = useGameStore((store) => store.loadTiming);
  const [report, setReport] = useState<TimingReport | null>(null);
  const { timingPaused, timingOff, phase, runId } = state;
  useEffect(() => {
    let live = true;
    void loadTiming().then((next) => {
      if (live) setReport(next);
    });
    return () => {
      live = false;
    };
  }, [loadTiming, timingPaused, timingOff, phase, runId]);
  return report;
}

/** Pause, resume, note and off, inside the Room panel. */
export function SessionClock({ state, busy, run }: { state: RunState; busy: boolean; run: (task: () => Promise<boolean>) => Promise<void> }): React.JSX.Element | null {
  const timingControl = useGameStore((store) => store.timingControl);
  const report = useTiming(state);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  if (!report?.enabled) return null;
  const paused = state.timingPaused === true;
  const off = state.timingOff === true;
  const sitting = currentSitting(report, state.runId);
  const live = playing(state);

  return (
    <section className="kad-host__clock" aria-label="Session clock">
      <Button
        variant="secondary"
        size="md"
        block
        disabled={busy || !live || off}
        aria-pressed={paused}
        onClick={() => void run(() => timingControl({ action: paused ? "resume" : "pause" }))}
      >
        {paused ? "Resume the clock" : "Pause the clock"}
      </Button>
      <p className="kad-host__hint">
        {off
          ? "Timing is off for this room. Nothing about this sitting is being kept."
          : paused
            ? "Paused: this time is left out. Play is not blocked, so tap Resume when you are back."
            : "For a meal, bedtime or a wifi problem. Paused and quiet time is left out of how long a chapter takes."}
      </p>

      {off ? null : (
        <form
          className="kad-host__note"
          onSubmit={(event) => {
            event.preventDefault();
            const text = note.trim();
            if (!text || !live) return;
            void run(() => timingControl({ action: "note", text })).then(() => {
              setNote("");
              setSaved(true);
            });
          }}
        >
          <label>
            <span className="kad-host__hint">A note for whoever plans the chapters</span>
            <input
              value={note}
              maxLength={TIMING_NOTE_MAX}
              placeholder="needed help with the clue"
              disabled={busy || !live}
              onChange={(event) => {
                setSaved(false);
                setNote(event.target.value);
              }}
            />
          </label>
          <Button variant="ghost" size="md" block type="submit" disabled={busy || !live || note.trim() === ""}>
            {saved ? "Note saved" : "Save note"}
          </Button>
        </form>
      )}

      {sitting && !off ? <p className="kad-host__hint">{sittingSentence(sitting)}</p> : null}

      <Button
        variant="ghost"
        size="md"
        block
        disabled={busy || !live}
        aria-pressed={off}
        onClick={() => void run(() => timingControl({ action: off ? "on" : "off" }))}
      >
        {off ? "Keep time again" : "Don't keep time"}
      </Button>
      <p className="kad-host__hint">
        Kept: the chapter, how many are playing, when each scene opened, pauses and this note. Never names, chat or audio.
      </p>
    </section>
  );
}

/** "Tonight took about 31 minutes", on the screen that ends a chapter. */
export function SessionSummary({ state }: { state: RunState }): React.JSX.Element | null {
  const report = useTiming(state);
  if (state.phase !== "chapter_complete" || !report?.enabled) return null;
  const sitting = currentSitting(report, state.runId);
  if (!sitting || sitting.status !== "completed") return null;
  const split = splitSentence(sitting);
  return (
    <div className="kad-host__offer" role="status" aria-label="How long this took">
      <p>{sittingSentence(sitting)}</p>
      {split ? <p className="kad-host__hint">{split}</p> : null}
      <p className="kad-host__hint">Only used to plan chapters. It is not a score.</p>
    </div>
  );
}
