/**
 * How much of the bottom of the world pane the story text is covering, so the
 * stage can stand its figures above it instead of behind it.
 *
 * The narration used to be a gradient over the whole pane with the lineup
 * painted underneath, which put the words across the heroes' faces on every
 * scene. Now the text sits on a plate along the bottom (NarrationPanel.css)
 * and reports the plate's height here; the scene frames the story into what
 * is left (scene.ts `setStageInset`).
 *
 * A module-level value, like `setActiveScene`, because the reporter is a DOM
 * panel and the reader a Pixi module, and neither may learn about the other.
 * It carries a measurement of this pane, never a mode (architecture §4.6).
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

/**
 * The part of a pane the story camera frames: everything above the text, but
 * never less than the stage needs. The story is a 16:9 design rect; on a
 * narrow pane it is width-limited and only needs `width × 9/16` of height, so
 * a phone's plate may take the rest. On a wide pane it keeps at least half.
 * Past that the plate scrolls; it does not shrink the party to stamps.
 *
 * NarrationPanel.css caps the plate at the same height (`max-block-size`), in
 * container units, so the two agree without either reading the other.
 */
export const MIN_STAGE_FRACTION = 0.5;
export const STAGE_ASPECT = 9 / 16;

export function storyStageHeight(paneWidth: number, paneHeight: number, insetBottom: number): number {
  const floor = Math.min(paneHeight * MIN_STAGE_FRACTION, paneWidth * STAGE_ASPECT);
  return Math.max(floor, paneHeight - Math.max(0, insetBottom));
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

/** The share of the frame above the figures' heads: sky the head may cover. */
export const SKY_FRACTION = 0.3;
/** However tall the head, the frame keeps this much of the height it had without one. */
export const STAGE_KEEP = 0.75;

/** Where the story camera frames, from the top of the pane: below a tall head, above the plate. */
export function storyStageFrame(
  paneWidth: number,
  paneHeight: number,
  insetBottom: number,
  insetTop: number,
): { top: number; height: number } {
  const full = storyStageHeight(paneWidth, paneHeight, insetBottom);
  const reach = Math.max(0, insetTop) - SKY_FRACTION * full;
  if (reach <= 0) return { top: 0, height: full };
  // The frame moves down by t and shrinks by t, so its sky band covers the head: t + 0.3 (full - t) = insetTop.
  const shift = Math.min(reach / (1 - SKY_FRACTION), full * (1 - STAGE_KEEP));
  return { top: shift, height: full - shift };
}
