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

// The plate's height and the head's reach are kept in story-inset.ts, which the first paint
// loads without the maths below (ui/display-dock.ts).
export { onStageInset, onStageInsetTop, setStageInsetBottom, setStageInsetTop, stageInsetBottom, stageInsetTop } from "./story-inset";

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
 * The top of the pane, too (#356): the head's reach is in story-inset.ts, beside the plate's
 * height. Only a head reaching past the sky band moves the stage (`storyStageFrame`).
 */

/*
 * What the head draws, not its box (#625). The head reports its whole box above, padding and
 * all, which the story's frame and the display dock measure from. An outdoor rest's camp stands
 * its tents and its heroes right up to what is drawn over the top of the pane, and a short TV
 * cannot spare the head's padding: so the head also reports the bottom of the lowest thing it
 * shows (the chapter's name, the goal card and its steps, a hand-off), and the rest's camp
 * window starts there (lobby-camp-stage.ts `setStageInset`).
 */
let cover = 0;
const coverListeners = new Set<(topPx: number) => void>();

/** Report how far down the pane what the head draws reaches, in CSS px. 0 when there is no head. */
export function setStageCoverTop(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === cover) return;
  cover = next;
  for (const listener of coverListeners) listener(cover);
}

export function stageCoverTop(): number {
  return cover;
}

export function onStageCoverTop(listener: (topPx: number) => void): () => void {
  coverListeners.add(listener);
  return () => {
    coverListeners.delete(listener);
  };
}

/**
 * How far below `paneTop` the lowest of `parts` reaches: the drawn bottom of a head whose box
 * ends at `headBottom` and hides what overflows it. A part with no size is not drawn. Rounded
 * up, so a camp framed from it never stands a fraction of a pixel under the card.
 */
export function coverBottom(paneTop: number, headBottom: number, parts: readonly { height: number; bottom: number }[]): number {
  let lowest = Number.NEGATIVE_INFINITY;
  for (const part of parts) if (part.height > 0) lowest = Math.max(lowest, part.bottom);
  if (lowest === Number.NEGATIVE_INFINITY) return 0;
  return Math.max(0, Math.ceil(Math.min(lowest, headBottom) - paneTop));
}

/** The share of the story rect above the figures' heads: sky the head may cover. */
export const SKY_FRACTION = 0.3;
/** However tall the head, the frame keeps this much of the height it had without one. */
export const STAGE_KEEP = 0.75;

/**
 * Where the figures' heads stand in a frame `height` tall starting `top` down the pane. The
 * camera fits the 16:9 story rect into the frame and centres it, so on a narrow pane the rect
 * is shorter than the frame and sits in its middle, with sky above it as well as inside it.
 */
function headsAt(paneWidth: number, top: number, height: number): number {
  const rect = Math.min(height, paneWidth * STAGE_ASPECT);
  return top + (height - rect) / 2 + SKY_FRACTION * rect;
}

/**
 * Where the story camera frames, from the top of the pane: below a tall head, above the plate.
 * The frame moves down (and is that much shorter) only as far as it takes for the figures'
 * heads to stand below the head's reach, and never past STAGE_KEEP of its height.
 */
export function storyStageFrame(
  paneWidth: number,
  paneHeight: number,
  insetBottom: number,
  insetTop: number,
): { top: number; height: number } {
  const full = storyStageHeight(paneWidth, paneHeight, insetBottom);
  const reach = Math.max(0, insetTop);
  if (headsAt(paneWidth, 0, full) >= reach) return { top: 0, height: full };
  const most = full * (1 - STAGE_KEEP);
  if (headsAt(paneWidth, most, full - most) <= reach) return { top: most, height: full - most };
  // The heads come down steadily as the frame does, so halve the way to the least that clears.
  let low = 0;
  let high = most;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (headsAt(paneWidth, mid, full - mid) >= reach) high = mid;
    else low = mid;
  }
  return { top: high, height: full - high };
}

/*
 * ---------------------------------------------------------------------------
 * The fight log's side
 *
 * The shared screen's fight log (screens/FightLog.tsx) stands down the right
 * of a wide pane, and a board drawn under it hid its last columns, which is
 * where half the monsters start. So the log reports how much of the pane's
 * end it covers, the way the narration plate reports its height, and the
 * fight camera frames the board into the rest (scene.ts `setBoardInset`). A
 * narrow pane's log is a small corner over the board's margin and reports 0.
 */

let end = 0;
const endListeners = new Set<(endPx: number) => void>();

/** Report the CSS px the fight log covers along the pane's end. 0 when it covers none. */
export function setBoardInsetEnd(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === end) return;
  end = next;
  for (const listener of endListeners) listener(end);
}

export function boardInsetEnd(): number {
  return end;
}

export function onBoardInsetEnd(listener: (endPx: number) => void): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}

/**
 * The width the fight camera frames the board into: the pane less the log,
 * never less than `MIN_STAGE_FRACTION` of it, so a log that somehow grew
 * across the pane cannot shrink the board to a stamp.
 */
export function boardStageWidth(paneWidth: number, insetEnd: number): number {
  return Math.max(paneWidth * MIN_STAGE_FRACTION, paneWidth - Math.max(0, insetEnd));
}

/*
 * ---------------------------------------------------------------------------
 * The lobby's side (#614)
 *
 * In the lobby the shared screen shows the crew's camp (world/camp.ts), and
 * the lobby's panels (screens/LobbyContent.tsx: the room code, the party and
 * its ready ticks, the adventure vote) stand along the bottom of the pane,
 * under its header. The lobby reports how much of the bottom the panels cover
 * and how far down the header reaches, the way the narration plate reports
 * its own height, and the camp's painting is slid so its camp stands in the
 * window between them (camp-framing.ts `campFraming`), so no hero stands under
 * the words. Its own values, not the plate's: on Begin the lobby goes and the
 * plate comes in the same commit, and neither may clear the other's report.
 */

let lobby = 0;
const lobbyListeners = new Set<(bottomPx: number) => void>();

/** Report the CSS px the lobby's panels cover along the pane's bottom. 0 when there is no lobby. */
export function setLobbyInsetBottom(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === lobby) return;
  lobby = next;
  for (const listener of lobbyListeners) listener(lobby);
}

export function lobbyInsetBottom(): number {
  return lobby;
}

export function onLobbyInset(listener: (bottomPx: number) => void): () => void {
  lobbyListeners.add(listener);
  return () => {
    lobbyListeners.delete(listener);
  };
}

let lobbyTop = 0;
const lobbyTopListeners = new Set<(topPx: number) => void>();

/** Report how far down the pane the lobby's header reaches: the top of the camp's window, in CSS px. */
export function setLobbyInsetTop(px: number): void {
  const next = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  if (next === lobbyTop) return;
  lobbyTop = next;
  for (const listener of lobbyTopListeners) listener(lobbyTop);
}

export function lobbyInsetTop(): number {
  return lobbyTop;
}

export function onLobbyInsetTop(listener: (topPx: number) => void): () => void {
  lobbyTopListeners.add(listener);
  return () => {
    lobbyTopListeners.delete(listener);
  };
}
