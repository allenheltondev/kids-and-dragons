/**
 * A place in the narration for the host's stop offer (screens/HostControls.tsx `StopOffer`).
 *
 * The offer used to stand in the shared screen's right-hand column (App.tsx
 * `.kad-display-stack`), which is over the stage: at an outdoor rest the crew's camp is framed
 * between the goal card and the plate (docs/camp.md §3.2), and for the offer's fifteen seconds it
 * covered the camp's right side, heroes, banner pole and the crew's name; at an indoor rest it
 * stood on the story's lineup the same way. So the narration keeps two slots off the stage and
 * offers the offer one of them (NarrationPanel.tsx `useStoryDockPick`):
 *
 *   - beside the chapter's goal card, in the head, where the head has room for it there: the
 *     card is as tall, so nothing moves, and the grown-up finds it near where it always was, top right;
 *   - else at the end of the choices' row, on the plate. The stage, the camp and the lineup are
 *     framed above the plate (stage-inset.ts), so a plate that grows a line for it moves them up
 *     rather than putting the offer on them.
 *
 * With no narration up (a fight, a screen with no story) there is no slot, and the offer stays
 * in the column. A module-level value, like stage-inset.ts, because the slots belong to the
 * narration and the offer to the host controls, two lazy chunks that may not import each other.
 */

import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The narration's pick; null when it has none (or is going). */
export function setStoryDock(next: HTMLElement | null): void {
  if (next === slot) return;
  slot = next;
  for (const listener of listeners) listener();
}

/** The slot the offer is drawn in, or null while there is none. */
export function useStoryDock(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => slot,
    () => null,
  );
}
