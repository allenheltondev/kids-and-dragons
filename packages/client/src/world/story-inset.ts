/**
 * The story plate's height and the narration head's reach (stage-inset.ts tells why), on
 * their own: the shared screen's column of notices (ui/display-dock.ts) reads both in the
 * first paint, and the framing maths beside them in stage-inset.ts belongs to the lazy stage.
 * stage-inset.ts re-exports all of this; import it from there.
 */

let bottom = 0;
const listeners = new Set<(bottomPx: number) => void>();

/** Report the plate's height in CSS px. 0 when nothing covers the stage. */
export function setStageInsetBottom(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === bottom) return;
  bottom = next;
  for (const listener of listeners) listener(bottom);
}

export function stageInsetBottom(): number {
  return bottom;
}

export function onStageInset(listener: (bottomPx: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/*
 * The top of the pane, too (#356). The chapter's goal sits in the narration's head under the
 * chapter's name, on the sky, and reports how far down the pane the head reaches. The
 * figures stand in the lower part of the story rect (scene.ts: feet at 88%, a figure 56% tall),
 * so the top of the frame is sky and the head may sit over it for free. Only a head reaching
 * past that band moves the stage: the frame starts lower and is that much shorter, just enough
 * that the heads stand clear, and never less than STAGE_KEEP of what it would have been.
 */
let top = 0;
const topListeners = new Set<(topPx: number) => void>();

/** Report how far down the pane the head reaches, in CSS px. 0 when there is no head. */
export function setStageInsetTop(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === top) return;
  top = next;
  for (const listener of topListeners) listener(top);
}

export function stageInsetTop(): number {
  return top;
}

export function onStageInsetTop(listener: (topPx: number) => void): () => void {
  topListeners.add(listener);
  return () => {
    topListeners.delete(listener);
  };
}
