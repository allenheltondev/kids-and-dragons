/**
 * A section of the phone that folds away under its own heading.
 *
 * The You page grew long enough that a kid scrolled past the stats to find
 * the bag (playtest, October 2026). Each section now has a heading that is
 * also its switch: tap it to fold the section to that one line, tap it again
 * to open it. What a device folded stays folded on that device, so a kid who
 * never looks at the token card stops paying its height every time.
 *
 * Two screens share it (the You page's sections and the chapter goal's phone
 * line), which is the bar for landing in ui/. It is phone furniture: the TV
 * never folds anything, because nobody there has anything to tap.
 *
 * The switch is a real button inside the heading, with `aria-expanded` and
 * `aria-controls`, so a screen reader hears "Your things, button, expanded".
 * The body is `hidden` rather than unmounted: a selection half-made in the
 * bag survives folding it, and what is inside keeps its own state.
 */

import { useCallback, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cue } from "../audio/cue";
import "./collapsible.css";

/** One key for every fold on the device: `{ [id]: open }`. */
export const FOLDS_KEY = "kad.folds";

function readFolds(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "null") as unknown;
    return raw !== null && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
  } catch {
    // Private mode, a blocked store, or something hand-edited: everything at its default.
    return {};
  }
}

function writeFold(id: string, open: boolean): void {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify({ ...readFolds(), [id]: open }));
  } catch {
    // Remembering is a convenience; the fold still works for this visit.
  }
}

/**
 * Whether the fold `id` is open on this device, and the switch. Starts at
 * whatever this device last chose, else `defaultOpen`.
 */
export function useFold(id: string, defaultOpen: boolean): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(() => {
    const stored = readFolds()[id];
    return typeof stored === "boolean" ? stored : defaultOpen;
  });
  const toggle = useCallback(() => {
    cue("tap");
    setOpen((was) => {
      writeFold(id, !was);
      return !was;
    });
  }, [id]);
  return [open, toggle];
}

/** The chevron at the end of a fold's heading: down when open, sideways when folded. */
export function FoldChevron(): ReactElement {
  return (
    <svg className="kad-fold__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface CollapsibleProps {
  /** Stable name for remembering this fold on the device ("stats", "bag"). */
  id: string;
  /** The heading's words, with their icon. Also the button's name. */
  title: ReactNode;
  /** Open until this device says otherwise. */
  defaultOpen?: boolean;
  /** Beside the title, folded or open: a small fact the section owns (the purse). */
  trail?: ReactNode;
  /** The heading's level in the page. */
  level?: 3 | 4;
  className?: string;
  children: ReactNode;
}

export function Collapsible({
  id,
  title,
  defaultOpen = true,
  trail,
  level = 3,
  className,
  children,
}: CollapsibleProps): ReactElement {
  const [open, toggle] = useFold(id, defaultOpen);
  const bodyId = `kad-fold-${useId().replace(/:/g, "")}`;
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <section
      className={`kad-fold kad-fold--h${String(level)}${open ? " kad-fold--open" : ""}${className ? ` ${className}` : ""}`}
      data-fold={id}
    >
      <Heading className="kad-fold__head">
        <button
          type="button"
          className="kad-fold__toggle kad-focusable"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span className="kad-fold__title">{title}</span>
          {trail === undefined ? null : <span className="kad-fold__trail">{trail}</span>}
          <FoldChevron />
        </button>
      </Heading>
      <div id={bodyId} className="kad-fold__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
