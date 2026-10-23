import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The steps back inside a page: a Field Guide entry open over the guide, a map
 * region's entry over the map, the pane you were looking at a moment ago.
 *
 * A screen with somewhere to step back to registers a step while it has one
 * (`useBackStep`), and the global back button (ui/BackButton.tsx) runs the
 * most specific one first and only leaves the page once nothing is left. A
 * step returns true when it did something, so one that finds nothing to undo
 * lets the next one try.
 *
 * Local navigation, like player-navigation.ts: never an intent, never sent.
 */
type Step = () => boolean;

/** An entry open over a page is undone before the page itself is. */
export const DETAIL_STEP = 10;

interface Registered {
  step: Step;
  priority: number;
}

const steps: Registered[] = [];
const listeners = new Set<() => void>();
let count = 0;

function changed(): void {
  count = steps.length;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Register a step; the returned function takes it away. */
export function pushBackStep(step: Step, priority = 0): () => void {
  const entry = { step, priority };
  steps.push(entry);
  changed();
  return () => {
    const at = steps.indexOf(entry);
    if (at !== -1) steps.splice(at, 1);
    changed();
  };
}

/** Take the most specific step that has something to undo. False when none did. */
export function runBackStep(): boolean {
  // Highest priority first; among equals the newest, which is the one drawn on top.
  const order = steps.map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.priority - a.entry.priority || b.index - a.index);
  return order.some(({ entry }) => entry.step());
}

/** Whether any screen has a step back to offer right now. */
export function useHasBackStep(): boolean {
  return useSyncExternalStore(subscribe, () => count > 0, () => false);
}

/**
 * Offer a step while `step` is non-null. The step may be a new closure every
 * render; the latest is the one that runs.
 */
export function useBackStep(step: Step | null, priority = 0): void {
  const active = step !== null;
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    if (!active) return;
    return pushBackStep(() => latest.current?.() ?? false, priority);
  }, [active, priority]);
}
