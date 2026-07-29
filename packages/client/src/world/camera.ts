/**
 * The focus camera — spec §2.2, §7.1, roadmap chapter 4.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ARITHMETIC AND NOT A PIXI CONTAINER
 *
 * Three people in a car, one phone each, a 10 × 8 board (§7.1). At full extent
 * that board gives about 39 px per tile on a phone — below the size a finger
 * can hit and well below the size a character reads at. §2.2 names the fix:
 * "combat gets an auto-framing camera that follows the active actor, with
 * pinch-zoom and pan to override", and architecture §4.6 rule 3 makes it
 * unconditional — the TV runs the same camera and simply has more room to
 * breathe. One camera, two very different rectangles to fit it into.
 *
 * So the framing is a function of state — board, focus, viewport — and lives
 * here, apart from the renderer that applies it. That is not tidiness. It is
 * the only way to test the clamp at all eight edges and corners of the board on
 * both a portrait phone and a widescreen TV without standing up a WebGL
 * context, and it means the same numbers can drive a Pixi transform today and
 * whatever `scene.ts` becomes when the Rive rigs land.
 *
 * ---------------------------------------------------------------------------
 * COORDINATES
 *
 * Board space is measured in tiles and shares `Position` with `@kad/shared`'s
 * grid: tile (x, y) covers the unit square from (x, y) to (x + 1, y + 1), so
 * its centre is (x + 0.5, y + 0.5) and the whole board is the rect
 * (0, 0)–(width, height). Fractions are legal here and nowhere else — the
 * camera routinely sits between tiles, which is exactly why it does not reuse
 * `Position` for its own centre. Screen space is CSS pixels from the top-left
 * of the *pane*, never of the window: this canvas is a whole TV in Party Mode
 * and one surface of a phone in Travel Mode (architecture §4.6 rule 2), and it
 * is not allowed to know which.
 *
 * The transform is uniform and axis-aligned — `screen = board * scale + offset`
 * — because a rotating or skewing tactical camera makes "which tile is that"
 * a question, and §7 caps the depth well below that.
 *
 * ---------------------------------------------------------------------------
 * HOW MUCH BOARD TO SHOW
 *
 * `FOCUS_MARGIN_TILES` is 3, and it is a compromise made with eyes open.
 *
 * Framing one tile is useless: an actor filling the screen tells her nothing
 * about what she can reach or what is reaching her. Framing every threat is the
 * opposite failure — an enemy with 4 steps (§7.1) can close and attack anything
 * within 5 tiles, so "show me all the threats" is a 11 × 11 window, which on a
 * 10 × 8 board is the whole board, which is the unreadable thing this module
 * exists to avoid.
 *
 * 3 tiles of context around whatever is in focus gives a 7 × 7 window. Anything
 * that close is on top of her *this* round — an enemy 3 tiles away needs two
 * steps to be adjacent — so it covers "about to reach her" in the sense she can
 * act on. On a 390 px-wide phone pane that is ~55 px per tile, above the ~44 px
 * touch target the highlighted reachable tiles (§7.2) have to survive. On a
 * 1920 × 1080 TV the same rule lands on ~154 px per tile, wider than the board,
 * so the clamp opens it out to the full 10 columns: identical code, and the TV
 * gets the whole board without a mode check anywhere.
 *
 * The margin is context around what the *caller* declares must be visible, and
 * the focus is a list for that reason. One actor is the common case; her plus
 * her target, or every actor in the encounter, are the same call. Callers that
 * need her whole move range on screen pass the reachable tiles, and the frame
 * grows to hold them.
 *
 * The frame is measured before it is clamped, so the zoom level does not change
 * as she walks toward a wall. Recomputing the fit against a clipped box would
 * zoom in every time the framed region ran off the edge, which reads as the
 * board lurching whenever anyone approaches a corner.
 *
 * ---------------------------------------------------------------------------
 * NEVER PAST THE EDGE
 *
 * Two clamps, and they are not the same clamp.
 *
 * *Scale* is floored at the whole board fitting the pane. You cannot zoom out
 * to a postage stamp in a field of black; there is nothing out there to find.
 * It is capped so at least `MIN_VISIBLE_TILES` stay on screen, because a pinch
 * that ends on one tile has lost the board entirely and there is no gesture for
 * "where am I".
 *
 * *Centre* is clamped per axis, and the two axes genuinely differ. A phone in
 * portrait and a 16:9 TV cannot both hold a 5:4 board exactly: on any axis
 * where the visible span is smaller than the board, the centre is held so the
 * view stays inside the board and empty space is impossible. On any axis where
 * the visible span is *larger* — the tall axis of a portrait phone, the wide
 * axis of a TV — the board is centred instead of clamped, so the leftover space
 * sits symmetrically as a letterbox. Clamping that axis instead would jam the
 * board against one edge with all the slack piled on the other, which reads as
 * a camera that has slipped rather than a board that has been framed.
 *
 * ---------------------------------------------------------------------------
 * WHAT RELEASES A MANUAL OVERRIDE
 *
 * A pinch or a pan wins outright — while `manual` is set the auto-frame is not
 * consulted at all — and it is released by exactly two things: `recentre()`,
 * which is the button she taps, and `setAttention()` with a key different from
 * the one the override was made under.
 *
 * Everything else deliberately does *not* release it. Not a timeout: a board
 * that snaps back on a hidden clock while an eight-year-old is still looking at
 * the thing she panned to is the worst version of this feature, and the brief
 * for the whole surface is that nothing moves without a reason she can see. Not
 * a new round either. An encounter is about four rounds (§7.1) of up to seven
 * turns, so a round boundary is roughly a minute and a half and a turn boundary
 * is seconds — releasing on turn change would undo her pan almost the instant
 * she made it, and releasing on round change would still yank the view out from
 * under her mid-look. Not a change of focus target, which is turn change under
 * another name.
 *
 * The attention key exists so that the *game* can take the camera back when it
 * genuinely needs her eyes: §2.2, "your turn comes to you" — being asked
 * something pushes the controls in front of the player automatically, and a
 * board panned three tiles away is a question she cannot answer. Callers set
 * the key to something that changes exactly then and no other time; the
 * encounter id plus the id of whoever this device is being asked to act as is
 * the intended shape.
 *
 * It is a key rather than a `youAreUpNow()` call because releasing has to be
 * edge-triggered. State arrives as server patches and React re-renders the
 * world several times per turn; a function that released on every call would
 * throw away a pan she made *during* her own turn on the next unrelated render,
 * and that bug is invisible in a test that only calls it once. Comparing keys
 * makes re-notification idempotent by construction.
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE MAY RETURN NaN
 *
 * A zero-width pane is not hypothetical: `PixiStage` measures its host in a
 * ResizeObserver and the first callback of a mount can land on a container that
 * has not been laid out yet. One `NaN` in a transform blanks the canvas, and a
 * blank canvas looks exactly like a crash. So every entry point launders its
 * inputs — a degenerate viewport is treated as 1 × 1, an empty focus list frames
 * the whole board, non-finite numbers are dropped — and every exit is finite.
 * ---------------------------------------------------------------------------
 */

import { BOARD_HEIGHT, BOARD_WIDTH, type Position } from "@kad/shared";

/** Tiles of context kept around the focus. See the header for why 3. */
export const FOCUS_MARGIN_TILES = 3;

/** A pinch may not zoom past this many tiles across either axis of the pane. */
export const MIN_VISIBLE_TILES = 3;

/** The pane the camera renders into, in CSS pixels. Never the window. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Tiles across and down. Defaults to the 10 × 8 of spec §7.1. */
export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** A point in board space, in tiles. Fractional, unlike a `Position`. */
export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

/** A point in the pane, in CSS pixels from its top-left corner. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** A rectangle of board space, in tiles, anchored at its top-left corner. */
export interface BoardRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A framing: where to look and how close. Both auto and manual produce one. */
export interface CameraView {
  readonly centre: BoardPoint;
  /** Pixels per tile. Always > 0. */
  readonly scale: number;
}

/**
 * A resolved camera — everything the renderer needs and nothing it has to
 * derive. `scale` and `offset` are the transform; `visible` is the same fact in
 * board space, for culling and for the tests to read.
 */
export interface Camera extends CameraView {
  /** `screenPx = boardTile * scale + offset`. */
  readonly offset: ScreenPoint;
  /** The board-space rect on screen. May extend past the board when letterboxed. */
  readonly visible: BoardRect;
  /** True while a pinch or pan is overriding the auto-frame. */
  readonly manual: boolean;
}

/**
 * Everything the camera remembers between frames. Plain data, replaced not
 * mutated, so it can sit in the store beside the rest of the client state.
 */
export interface CameraState {
  readonly board: BoardSize;
  /** Tiles that must stay on screen. Empty frames the whole board. */
  readonly focus: readonly Position[];
  /** The live override, or null while the auto-frame is in charge. */
  readonly override: CameraView | null;
  /** The attention key the override was taken under. See the header. */
  readonly attention: string;
}

export interface CameraOptions {
  readonly board?: BoardSize;
  readonly focus?: readonly Position[];
  readonly attention?: string;
}

// ---------------------------------------------------------------------------
// Building and updating the state
// ---------------------------------------------------------------------------

export function createCameraState(options: CameraOptions = {}): CameraState {
  return {
    board: safeBoard(options.board),
    focus: safeFocus(options.focus),
    override: null,
    attention: options.attention ?? "",
  };
}

/**
 * Points the auto-frame at a new set of tiles. Never releases an override — the
 * focus changes on every turn, and a turn passing is not a reason to throw away
 * the view she chose (see the header).
 *
 * Returns the same object when the focus is unchanged. The caller pushes this
 * from a render that runs on every server patch, and a fresh object each time
 * would re-run the framing and any effect watching it several times a turn.
 */
export function setFocus(state: CameraState, focus: readonly Position[]): CameraState {
  const next = safeFocus(focus);
  if (sameFocus(state.focus, next)) return state;
  return { ...state, focus: next };
}

/**
 * Tells the camera whose attention the game is asking for. Releases a manual
 * override only when the key actually changes, so calling it on every render
 * with the same key is free — that idempotence is the whole point (header).
 */
export function setAttention(state: CameraState, attention: string): CameraState {
  if (attention === state.attention) return state;
  return { ...state, attention, override: null };
}

/** The recentre button. Hands the board back to the auto-frame. */
export function recentre(state: CameraState): CameraState {
  if (state.override === null) return state;
  return { ...state, override: null };
}

/**
 * Drags the board with a finger: `delta` is how far the finger moved, so the
 * board follows it and the camera centre moves the other way.
 *
 * The delta is applied to the *resolved* camera rather than to whatever is in
 * state, which is what stops a pan against the edge from banking up. Composing
 * on the raw stored centre would let a hard drag into the wall accumulate tiles
 * of overshoot that then have to be dragged back before anything moves — the
 * board would feel dead for a moment with nothing on screen explaining why.
 */
export function panBy(state: CameraState, viewport: Viewport, delta: ScreenPoint): CameraState {
  const camera = resolveCamera(state, viewport);
  const dx = finite(delta.x, 0);
  const dy = finite(delta.y, 0);
  return override(state, viewport, {
    centre: { x: camera.centre.x - dx / camera.scale, y: camera.centre.y - dy / camera.scale },
    scale: camera.scale,
  });
}

/**
 * Pinch. `factor` above 1 zooms in. `anchor` is the point on screen that must
 * stay over the same tile — the midpoint between two fingers — and defaults to
 * the centre of the pane for a zoom button or a wheel.
 *
 * Anchoring gives way at the board's edge, where the clamp wins: holding the
 * anchor exactly would mean showing space past the edge, and a fixed anchor is
 * worth less than a view that is always over the board.
 */
export function zoomBy(
  state: CameraState,
  viewport: Viewport,
  factor: number,
  anchor?: ScreenPoint,
): CameraState {
  const camera = resolveCamera(state, viewport);
  const pane = safeViewport(viewport);
  const step = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const bounds = scaleBounds(state.board, pane);
  const scale = clamp(camera.scale * step, bounds.min, bounds.max);

  const at = anchor ?? { x: pane.width / 2, y: pane.height / 2 };
  const held = screenToBoard(camera, {
    x: finite(at.x, pane.width / 2),
    y: finite(at.y, pane.height / 2),
  });
  const ratio = camera.scale / scale;
  return override(state, viewport, {
    centre: {
      x: held.x - (held.x - camera.centre.x) * ratio,
      y: held.y - (held.y - camera.centre.y) * ratio,
    },
    scale,
  });
}

/**
 * Stores a framing as the live override, laundered and clamped. Clamping on the
 * way in as well as on the way out keeps `state.override` equal to what is
 * actually drawn, so anything that reads it — a debug overlay, a persisted
 * view, the next gesture — is looking at the real framing and not at a wish.
 */
function override(state: CameraState, viewport: Viewport, wanted: CameraView): CameraState {
  return { ...state, override: settle(state.board, safeViewport(viewport), wanted) };
}

// ---------------------------------------------------------------------------
// Resolving a camera
// ---------------------------------------------------------------------------

/**
 * The framing to draw this frame. Pure: same state and viewport, same numbers,
 * on the phone and on the TV.
 */
export function resolveCamera(state: CameraState, viewport: Viewport): Camera {
  const pane = safeViewport(viewport);
  const board = state.board;
  const wanted = state.override ?? autoFrame(board, state.focus, pane);
  const view = settle(board, pane, wanted);

  const visibleWidth = pane.width / view.scale;
  const visibleHeight = pane.height / view.scale;
  return {
    centre: view.centre,
    scale: view.scale,
    offset: {
      x: pane.width / 2 - view.centre.x * view.scale,
      y: pane.height / 2 - view.centre.y * view.scale,
    },
    visible: {
      x: view.centre.x - visibleWidth / 2,
      y: view.centre.y - visibleHeight / 2,
      width: visibleWidth,
      height: visibleHeight,
    },
    manual: state.override !== null,
  };
}

/** Board tiles → pixels in the pane. */
export function boardToScreen(camera: Camera, point: BoardPoint): ScreenPoint {
  return { x: point.x * camera.scale + camera.offset.x, y: point.y * camera.scale + camera.offset.y };
}

/** Pixels in the pane → board tiles. The inverse of `boardToScreen`. */
export function screenToBoard(camera: Camera, point: ScreenPoint): BoardPoint {
  return { x: (point.x - camera.offset.x) / camera.scale, y: (point.y - camera.offset.y) / camera.scale };
}

/**
 * The rect the auto-frame tries to fit: the focus tiles, grown by the margin.
 * Exported because it is the honest way to test what "framing an actor" means,
 * and because a debug overlay wants to draw it.
 */
export function focusFrame(board: BoardSize, focus: readonly Position[]): BoardRect {
  const tiles = safeFocus(focus);
  // An empty focus is not an error — it is combat that has not started, or an
  // actor who just left the board. Framing everything is the answer that never
  // looks broken.
  if (tiles.length === 0) return { x: 0, y: 0, width: board.width, height: board.height };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    // A tile owns the unit square out to (x + 1, y + 1), so framing tile 4
    // means framing through 5 — off-by-one here crops half a sprite.
    maxX = Math.max(maxX, tile.x + 1);
    maxY = Math.max(maxY, tile.y + 1);
  }
  return {
    x: minX - FOCUS_MARGIN_TILES,
    y: minY - FOCUS_MARGIN_TILES,
    width: maxX - minX + FOCUS_MARGIN_TILES * 2,
    height: maxY - minY + FOCUS_MARGIN_TILES * 2,
  };
}

function autoFrame(board: BoardSize, focus: readonly Position[], pane: Viewport): CameraView {
  const frame = focusFrame(board, focus);
  return {
    centre: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    // Contain, not cover: everything the caller asked for stays on screen. The
    // frame is deliberately *not* clipped to the board first — see the header.
    scale: Math.min(pane.width / frame.width, pane.height / frame.height),
  };
}

/** Clamps a wanted framing into one that is legal on this board and pane. */
function settle(board: BoardSize, pane: Viewport, wanted: CameraView): CameraView {
  const bounds = scaleBounds(board, pane);
  const scale = clamp(finite(wanted.scale, bounds.min), bounds.min, bounds.max);
  return {
    scale,
    centre: {
      x: clampAxis(finite(wanted.centre.x, board.width / 2), pane.width / scale, board.width),
      y: clampAxis(finite(wanted.centre.y, board.height / 2), pane.height / scale, board.height),
    },
  };
}

/**
 * Where the camera may sit on one axis. When the board is narrower than the
 * view on this axis it is centred, letterboxing the slack symmetrically;
 * otherwise the view is held inside the board so no empty space can show. See
 * the header for why those are different answers.
 */
function clampAxis(centre: number, visible: number, extent: number): number {
  if (visible >= extent) return extent / 2;
  return clamp(centre, visible / 2, extent - visible / 2);
}

function scaleBounds(board: BoardSize, pane: Viewport): { min: number; max: number } {
  // Zoomed all the way out is the whole board on screen and not one pixel more.
  const min = Math.min(pane.width / board.width, pane.height / board.height);
  const max = Math.min(
    pane.width / Math.min(MIN_VISIBLE_TILES, board.width),
    pane.height / Math.min(MIN_VISIBLE_TILES, board.height),
  );
  // A board smaller than MIN_VISIBLE_TILES would otherwise invert the bounds
  // and let `clamp` return the wrong end of them.
  return { min, max: Math.max(min, max) };
}

// ---------------------------------------------------------------------------
// Laundering
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * A pane with no area is a real state, not a bug: `PixiStage` observes its host
 * and the first measurement of a mount can be zero. One tile of a one-pixel
 * pane keeps every division below finite until the real size arrives.
 */
function safeViewport(viewport: Viewport): Viewport {
  return {
    width: Math.max(1, finite(viewport?.width, 1)),
    height: Math.max(1, finite(viewport?.height, 1)),
  };
}

function safeBoard(board: BoardSize | undefined): BoardSize {
  return {
    width: Math.max(1, Math.floor(finite(board?.width ?? BOARD_WIDTH, BOARD_WIDTH))),
    height: Math.max(1, Math.floor(finite(board?.height ?? BOARD_HEIGHT, BOARD_HEIGHT))),
  };
}

/**
 * Drops targets that are not real points. A half-applied state patch can leave
 * an actor with an undefined tile for a frame, and framing that would take the
 * whole board with it.
 */
function safeFocus(focus: readonly Position[] | undefined): readonly Position[] {
  if (!focus) return [];
  return focus.filter((tile) => tile && Number.isFinite(tile.x) && Number.isFinite(tile.y));
}

function sameFocus(a: readonly Position[], b: readonly Position[]): boolean {
  return a.length === b.length && a.every((tile, i) => tile.x === b[i]?.x && tile.y === b[i]?.y);
}
