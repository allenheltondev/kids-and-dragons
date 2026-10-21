/**
 * Where the shared screen's column of notices stands (App.tsx `.kad-display-stack`): under
 * the chapter's goal and over the stage, never on the goal or the story plate (#389's audit
 * found three "Player joined" cards across the goal at 1024x600).
 *
 * The narration reports how far down the pane its head reaches and how tall its plate is, for
 * the stage to frame the figures between them (world/stage-inset.ts). The column reads the same
 * two numbers. Outside a story (the lobby, a fight, the chapter's end) both are 0 and the column
 * keeps its place under the corner row.
 */

import { useSyncExternalStore, type CSSProperties } from "react";
import { onStageInset, onStageInsetTop, stageInsetBottom, stageInsetTop } from "../world/stage-inset";

const subscribe = (listener: () => void): (() => void) => {
  const stopTop = onStageInsetTop(listener);
  const stopBottom = onStageInset(listener);
  return () => {
    stopTop();
    stopBottom();
  };
};

/** The column's limits as custom properties, in CSS px; none on a screen that is not the display. */
export function useDisplayDock(display: boolean): CSSProperties | undefined {
  const top = useSyncExternalStore(subscribe, stageInsetTop, stageInsetTop);
  const bottom = useSyncExternalStore(subscribe, stageInsetBottom, stageInsetBottom);
  if (!display) return undefined;
  return { "--kad-dock-top": `${String(top)}px`, "--kad-dock-bottom": `${String(bottom)}px` } as CSSProperties;
}
