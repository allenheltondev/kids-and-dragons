/**
 * StoryPlates: paintings with the story told over them, before anything is asked of the table.
 *
 * A campaign's **prologue** (three to six plates) comes before its opening chapter's first
 * scene, and a **chapter plate** (one) before the first scene of a chapter that begins somewhere
 * new (shared `startPlates`). Each plate is a full-pane painting with its words beneath, read
 * aloud as it comes up. Shown once per device (`store/story-plates-seen.ts`) and skippable.
 *
 * - **Going back stops the turning.** A phone's Back (or a remote's left arrow) returns to the
 *   page before, and from then on the pages wait to be turned by hand.
 * - **Nothing to tap on the shared screen** (docs/tv-read-only-audit.md): it turns the pages by
 *   itself, a plate staying up as long as its words take to say, and has no button there. A
 *   remote's OK (Enter) turns a page and Escape skips the rest, on any screen. A phone's pane
 *   (Travel Mode) gets Next and Skip.
 * - **The story waits behind it.** While a reel is up `useStartPreface` is pending, so "Last time…"
 *   and the first scene's read-aloud start the moment it is done, never over it.
 * - **A painting that has not landed is left out.** Every painting is fetched up front; the ones
 *   that arrive (within PLATE_LOAD_MS) play, in order, and a reel with none is passed over for
 *   this page load without being marked seen, so it plays the day the art ships.
 * - Play moving on (a phone chose something) takes it away, unmarked: it was about then.
 *
 * The usual rules (layout/WorldView.tsx): `em` and container units only, nothing reads the room
 * mode (the shared screen is told from a phone by having no player).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { plateWordCount, speak, storyPlateUrl } from "@kad/shared";
import type { Campaign, StartPlates, StoryPlate } from "@kad/shared";
import { useSession } from "../store";
import { markStoryPlatesSeen, markStoryPlatesUnavailable } from "../store/story-plates-seen";
import { useStartPlates } from "./start-plates";
import "./StoryPlates.css";

/** How long a painting gets to arrive before it is left out. */
export const PLATE_LOAD_MS = 6000;

/**
 * How long a plate stays up: long enough to say, with a breath. About what the preface allows a
 * line (`prefaceShowMs`), a little shorter because a painting is being looked at, not read.
 */
export function plateHoldMs(words: number): number {
  return Math.min(22_000, Math.max(6500, 2000 + words * 420));
}

interface Frame extends StoryPlate {
  url: string;
}

/** Fetch every painting; the ones that arrive in time, in story order. Never rejects. */
function preload(plates: readonly StoryPlate[]): Promise<Frame[]> {
  return Promise.all(
    plates.map(
      (plate) =>
        new Promise<Frame | null>((resolve) => {
          const url = storyPlateUrl(plate.art);
          const image = new Image();
          const done = (frame: Frame | null): void => {
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(frame);
          };
          const timer = setTimeout(() => done(null), PLATE_LOAD_MS);
          image.onload = () => done({ ...plate, url });
          image.onerror = () => done(null);
          image.src = url;
        }),
    ),
  ).then((frames) => frames.filter((frame): frame is Frame => frame !== null));
}

/** What a plate says: its title first, on the first plate, so the table hears where it is. */
function spoken(picked: StartPlates, frame: Frame, index: number): string {
  return index === 0 ? `${picked.ribbon}. ${frame.narration}` : frame.narration;
}

function Reel({ picked, onDone }: { picked: StartPlates; onDone?: () => void }): ReactElement | null {
  const display = (useSession()?.playerId ?? "") === "";
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [index, setIndex] = useState(0);
  const done = useRef(false);
  const root = useRef<HTMLElement | null>(null);
  /** Set once somebody goes back to re-read: the pages stop turning by themselves after that. */
  const [held, setHeld] = useState(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    // A replay was asked for, so it is neither remembered nor held against the story.
    if (onDone) onDone();
    else markStoryPlatesSeen(picked.key);
  }, [picked.key, onDone]);

  useEffect(() => {
    let live = true;
    void preload(picked.plates).then((loaded) => {
      if (!live) return;
      if (loaded.length === 0) {
        if (onDone) onDone();
        else markStoryPlatesUnavailable(picked.key);
      }
      else setFrames(loaded);
    });
    return () => {
      live = false;
    };
    // The plates are the same for a key, so the key is what the fetch is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.key]);

  const advance = useCallback(() => {
    if (frames === null) return;
    if (index + 1 >= frames.length) finish();
    else setIndex(index + 1);
  }, [frames, index, finish]);

  // A replay is a dialog: focus moves into it once the paintings are up.
  const loaded = frames !== null;
  useEffect(() => {
    if (onDone && loaded) root.current?.focus();
    // Once, when the paintings land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const back = useCallback(() => {
    if (index === 0) return;
    setHeld(true);
    setIndex(index - 1);
  }, [index]);

  // Say the plate as it comes up, and turn the page once it has been said (unless somebody went back).
  const frame = frames?.[index];
  useEffect(() => {
    if (frames === null || frame === undefined) return;
    const text = spoken(picked, frame, index);
    speak(text, { source: "narration", interrupt: true });
    if (held) return;
    const timer = setTimeout(advance, plateHoldMs(plateWordCount(text)));
    return () => clearTimeout(timer);
    // `advance` is for this very index and frames; the page turns once per plate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, index, held]);

  // A remote's OK turns the page and Escape skips the rest, on any screen. A focused control
  // keeps its own Enter and Space.
  const ready = frames !== null;
  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        finish();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.key === "ArrowRight" || ((event.key === "Enter" || event.key === " ") && !target?.closest("button, a[href], summary, [role='button']"))) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, finish, advance, back]);

  if (frames === null || frame === undefined) return null;
  const last = index === frames.length - 1;
  const hold = plateHoldMs(plateWordCount(spoken(picked, frame, index)));

  return (
    <section
      ref={root}
      className="plates"
      data-testid="story-plates"
      data-kind={picked.kind}
      data-index={index}
      data-last={last}
      data-display={display}
      data-replay={onDone ? "true" : undefined}
      {...(onDone ? { role: "dialog", "aria-modal": true, tabIndex: -1 } : {})}
      aria-label={picked.ribbon}
      style={{ ["--plate-ms" as string]: `${String(hold)}ms` }}
    >
      {frames.map((each, i) => (
        <img
          key={each.art}
          className="plates__image"
          data-active={i === index}
          data-drift={i % 2 === 0 ? "in" : "out"}
          src={each.url}
          alt=""
          decoding="async"
        />
      ))}
      <div className="plates__caption">
        {index === 0 ? <h2 className="plates__ribbon">{picked.ribbon}</h2> : null}
        <p key={frame.art} className="plates__text" aria-live="polite">
          {frame.narration}
        </p>
        <div className="plates__foot">
          {frames.length > 1 ? (
            <ol className="plates__dots" aria-hidden="true">
              {frames.map((each, i) => (
                <li key={each.art} className="plates__dot" data-on={i <= index} />
              ))}
            </ol>
          ) : null}
          {display ? null : (
            <div className="plates__buttons">
              {index === 0 ? null : (
                <button type="button" className="plates__button" onClick={back}>
                  Back
                </button>
              )}
              {last ? null : (
                <button type="button" className="plates__button" onClick={advance}>
                  Next
                </button>
              )}
              <button type="button" className="plates__button plates__button--skip" onClick={finish}>
                {last ? "Continue" : "Skip"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function StoryPlates(): ReactElement | null {
  const picked = useStartPlates();
  if (picked === null) return null;
  // Keyed, so a chapter that follows another's plate starts its own reel from the first page.
  return <Reel key={picked.key} picked={picked} />;
}

/**
 * A campaign's prologue, asked for again from the phone mid-campaign: just the intro story, over
 * the whole screen whatever pane is showing. It touches nothing in the run, is not remembered,
 * and `onClose` is called when it ends or is skipped.
 */
export function PrologueReplay({ campaign, onClose }: { campaign: Campaign; onClose: () => void }): ReactElement | null {
  const picked = useMemo<StartPlates | null>(
    () =>
      campaign.prologue && campaign.prologue.plates.length > 0
        ? { kind: "prologue", key: `replay:${campaign.id}`, ribbon: campaign.title, plates: campaign.prologue.plates }
        : null,
    [campaign],
  );
  const [host] = useState(() => document.createElement("div"));

  // Modal: everything else on the page goes inert (no Tab or tap reaches a decision behind it),
  // and focus goes back to what opened the replay when it ends.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(host);
    const held: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === host || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      held.push(child);
    }
    return () => {
      for (const child of held) child.removeAttribute("inert");
      host.remove();
      if (opener?.isConnected) opener.focus();
    };
  }, [host]);

  if (picked === null) return null;
  return createPortal(<Reel key={picked.key} picked={picked} onDone={onClose} />, host);
}
