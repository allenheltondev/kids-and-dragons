import { describe, expect, it } from "vitest";
import { BOARD_HEIGHT, BOARD_WIDTH, type Position } from "@kad/shared";
import {
  FOCUS_MARGIN_TILES,
  MIN_VISIBLE_TILES,
  boardToScreen,
  createCameraState,
  focusFrame,
  panBy,
  recentre,
  resolveCamera,
  screenToBoard,
  setAttention,
  setFocus,
  zoomBy,
  type Camera,
  type CameraState,
  type Viewport,
} from "./camera";

/**
 * The two real shapes, and they are nothing alike: one surface of a phone in
 * Travel Mode (spec §2.2, taller than it is wide) and a 1080p TV in Party Mode
 * (much wider than it is tall). The 10 × 8 board (§7.1) is 5:4, so it cannot
 * fit either exactly — every letterbox test below turns on that.
 */
const PHONE: Viewport = { width: 390, height: 720 };
const TV: Viewport = { width: 1920, height: 1080 };

const CENTRE: Position = { x: 5, y: 4 };

function camera(focus: readonly Position[], viewport: Viewport): Camera {
  return resolveCamera(createCameraState({ focus }), viewport);
}

/** Every number a renderer would multiply a coordinate by. */
function transformValues(cam: Camera): number[] {
  return [
    cam.centre.x,
    cam.centre.y,
    cam.scale,
    cam.offset.x,
    cam.offset.y,
    cam.visible.x,
    cam.visible.y,
    cam.visible.width,
    cam.visible.height,
  ];
}

/**
 * The clamp contract, stated once so it can be asserted at every edge: on an
 * axis where the board is bigger than the view, the view is entirely inside the
 * board; where it is smaller, the board is centred in it. Never anything else —
 * a view half off the board is the disorienting case on a phone and the broken
 * looking one on a TV.
 */
function expectInsideOrCentred(cam: Camera, board = { width: BOARD_WIDTH, height: BOARD_HEIGHT }): void {
  if (cam.visible.width >= board.width) {
    expect(cam.centre.x).toBeCloseTo(board.width / 2, 6);
  } else {
    expect(cam.visible.x).toBeGreaterThanOrEqual(-1e-9);
    expect(cam.visible.x + cam.visible.width).toBeLessThanOrEqual(board.width + 1e-9);
  }
  if (cam.visible.height >= board.height) {
    expect(cam.centre.y).toBeCloseTo(board.height / 2, 6);
  } else {
    expect(cam.visible.y).toBeGreaterThanOrEqual(-1e-9);
    expect(cam.visible.y + cam.visible.height).toBeLessThanOrEqual(board.height + 1e-9);
  }
}

describe("focusFrame", () => {
  it("puts the margin on all four sides of a single actor", () => {
    // Catches a frame that grows in one direction only — the actor would sit
    // against an edge of the screen with all the context behind her.
    const frame = focusFrame({ width: BOARD_WIDTH, height: BOARD_HEIGHT }, [{ x: 5, y: 4 }]);
    expect(frame).toEqual({
      x: 5 - FOCUS_MARGIN_TILES,
      y: 4 - FOCUS_MARGIN_TILES,
      width: 1 + FOCUS_MARGIN_TILES * 2,
      height: 1 + FOCUS_MARGIN_TILES * 2,
    });
  });

  it("counts a tile as a whole square, not a point", () => {
    // Off-by-one guard: framing tiles 2..4 must frame through x = 5, or the
    // rightmost sprite in the group is cropped down the middle.
    const frame = focusFrame({ width: BOARD_WIDTH, height: BOARD_HEIGHT }, [
      { x: 2, y: 1 },
      { x: 4, y: 1 },
    ]);
    expect(frame.x).toBe(2 - FOCUS_MARGIN_TILES);
    expect(frame.x + frame.width).toBe(5 + FOCUS_MARGIN_TILES);
  });

  it("frames the whole board when nothing is in focus", () => {
    // Combat that has not begun, or an actor who left the board mid-patch.
    // The alternative is an infinite bounding box and a NaN scale.
    expect(focusFrame({ width: BOARD_WIDTH, height: BOARD_HEIGHT }, [])).toEqual({
      x: 0,
      y: 0,
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
    });
  });
});

describe("auto-frame", () => {
  it("gives a phone a legible tile instead of the whole board", () => {
    // The reason this module exists (§2.2). At full extent a 10-wide board on a
    // 390 px pane is 39 px per tile — under the touch target the reachable-tile
    // highlights (§7.2) have to be tappable at. The frame must beat that.
    const cam = camera([CENTRE], PHONE);
    expect(cam.scale).toBeGreaterThan(50);
    expect(cam.visible.width).toBeCloseTo(1 + FOCUS_MARGIN_TILES * 2, 6);
  });

  it("keeps the actor and her margin on screen on both surfaces", () => {
    // The framing promise: everything within FOCUS_MARGIN_TILES is visible, on
    // a shape as tall as a phone and one as wide as a TV.
    for (const viewport of [PHONE, TV]) {
      const cam = camera([CENTRE], viewport);
      expect(cam.visible.x).toBeLessThanOrEqual(CENTRE.x - FOCUS_MARGIN_TILES + 1e-9);
      expect(cam.visible.x + cam.visible.width).toBeGreaterThanOrEqual(
        CENTRE.x + 1 + FOCUS_MARGIN_TILES - 1e-9,
      );
      expect(cam.visible.y).toBeLessThanOrEqual(CENTRE.y - FOCUS_MARGIN_TILES + 1e-9);
      expect(cam.visible.y + cam.visible.height).toBeGreaterThanOrEqual(
        CENTRE.y + 1 + FOCUS_MARGIN_TILES - 1e-9,
      );
    }
  });

  it("letterboxes the axis with slack, and which axis differs per surface", () => {
    // The aspect-ratio case, both directions. The phone has spare height and so
    // shows more rows than asked for; the TV has spare width and shows the full
    // 10 columns. Same code, no mode check (architecture §4.6 rule 3).
    const phone = camera([CENTRE], PHONE);
    expect(phone.visible.height).toBeGreaterThan(phone.visible.width);
    expect(phone.visible.height).toBeGreaterThan(BOARD_HEIGHT);
    expect(phone.centre.y).toBeCloseTo(BOARD_HEIGHT / 2, 6);

    const tv = camera([CENTRE], TV);
    expect(tv.visible.width).toBeGreaterThan(tv.visible.height);
    expect(tv.visible.width).toBeGreaterThan(BOARD_WIDTH);
    expect(tv.centre.x).toBeCloseTo(BOARD_WIDTH / 2, 6);
  });

  it("holds the zoom steady as an actor walks toward a wall", () => {
    // Catches framing the *clipped* box: the frame around a cornered actor runs
    // off the board, and refitting to what is left would zoom in every time
    // anyone approached an edge — the board would lurch on their move.
    const middle = camera([CENTRE], PHONE);
    for (const at of [{ x: 0, y: 0 }, { x: 9, y: 7 }, { x: 0, y: 7 }, { x: 9, y: 0 }]) {
      expect(camera([at], PHONE).scale).toBeCloseTo(middle.scale, 6);
    }
  });

  it("widens for a group instead of losing half of it", () => {
    // A whole encounter (§7.1: 3 players vs 2–4 enemies) is a legal focus, and
    // the camera must pull back for it rather than frame the first actor.
    const encounter: Position[] = [
      { x: 1, y: 1 },
      { x: 8, y: 6 },
      { x: 4, y: 3 },
    ];
    const cam = camera(encounter, TV);
    for (const actor of encounter) {
      const screen = boardToScreen(cam, { x: actor.x + 0.5, y: actor.y + 0.5 });
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(TV.width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(TV.height);
    }
    expect(cam.scale).toBeLessThan(camera([CENTRE], TV).scale);
  });

  it("shows the whole board and no more when nothing is in focus", () => {
    // Zoomed all the way out is the board, not the board adrift in black.
    const cam = camera([], TV);
    expect(cam.scale).toBeCloseTo(Math.min(TV.width / BOARD_WIDTH, TV.height / BOARD_HEIGHT), 6);
    expect(cam.visible.width).toBeGreaterThanOrEqual(BOARD_WIDTH - 1e-9);
    expect(cam.visible.height).toBeGreaterThanOrEqual(BOARD_HEIGHT - 1e-9);
    expectInsideOrCentred(cam);
  });
});

describe("clamping to the board", () => {
  const edges: readonly Position[] = [
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    { x: 0, y: 7 },
    { x: 9, y: 7 },
    { x: 5, y: 0 },
    { x: 5, y: 7 },
    { x: 0, y: 4 },
    { x: 9, y: 4 },
  ];

  it("never shows space past the edge, at all four corners and all four edges", () => {
    // Both surfaces, because the two clamp differently: the phone clamps
    // horizontally and letterboxes vertically, the TV does the reverse.
    for (const viewport of [PHONE, TV]) {
      for (const at of edges) {
        expectInsideOrCentred(camera([at], viewport));
      }
    }
  });

  it("puts the board edge exactly on the pane edge in the corner", () => {
    // The exact numbers, not just an inequality: a clamp that stops one tile
    // short would pass the bounds check above while wasting a column she needs.
    const phone = camera([{ x: 0, y: 0 }], PHONE);
    expect(phone.visible.x).toBeCloseTo(0, 6);
    expect(boardToScreen(phone, { x: 0, y: 0 }).x).toBeCloseTo(0, 6);

    const farCorner = camera([{ x: 9, y: 7 }], PHONE);
    expect(farCorner.visible.x + farCorner.visible.width).toBeCloseTo(BOARD_WIDTH, 6);
    expect(boardToScreen(farCorner, { x: BOARD_WIDTH, y: 0 }).x).toBeCloseTo(PHONE.width, 6);

    // The TV clamps on the other axis, so the bottom row is the one to check.
    const tvBottom = camera([{ x: 5, y: 7 }], TV);
    expect(tvBottom.visible.y + tvBottom.visible.height).toBeCloseTo(BOARD_HEIGHT, 6);
    const tvTop = camera([{ x: 5, y: 0 }], TV);
    expect(tvTop.visible.y).toBeCloseTo(0, 6);
  });

  it("refuses to zoom out past the whole board", () => {
    // Pinching out forever would leave the board a stamp in a field of black,
    // with nothing out there to find and no gesture for "where am I".
    const state = createCameraState({ focus: [CENTRE] });
    const zoomedOut = zoomBy(state, PHONE, 0.001);
    const cam = resolveCamera(zoomedOut, PHONE);
    expect(cam.scale).toBeCloseTo(Math.min(PHONE.width / BOARD_WIDTH, PHONE.height / BOARD_HEIGHT), 6);
    expectInsideOrCentred(cam);
  });

  it("refuses to zoom in past a handful of tiles", () => {
    // A pinch that ends on one tile has lost the board.
    const cam = resolveCamera(zoomBy(createCameraState({ focus: [CENTRE] }), PHONE, 1000), PHONE);
    expect(Math.min(cam.visible.width, cam.visible.height)).toBeGreaterThanOrEqual(
      MIN_VISIBLE_TILES - 1e-9,
    );
  });
});

describe("the transform", () => {
  it("puts the camera centre in the middle of the pane", () => {
    const cam = camera([CENTRE], PHONE);
    const screen = boardToScreen(cam, cam.centre);
    expect(screen.x).toBeCloseTo(PHONE.width / 2, 6);
    expect(screen.y).toBeCloseTo(PHONE.height / 2, 6);
  });

  it("round-trips board space through screen space", () => {
    // A tap has to become a tile. If these two disagree she taps one tile and
    // moves to another.
    const cam = camera([CENTRE], TV);
    for (const point of [{ x: 0, y: 0 }, { x: 3.5, y: 6.25 }, { x: 10, y: 8 }]) {
      const back = screenToBoard(cam, boardToScreen(cam, point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });
});

describe("manual override", () => {
  const panned = (): CameraState =>
    panBy(createCameraState({ focus: [CENTRE], attention: "enc_1:c_iris" }), PHONE, {
      x: -30,
      y: 0,
    });

  it("beats the auto-frame while it is held", () => {
    const before = resolveCamera(createCameraState({ focus: [CENTRE] }), PHONE);
    const after = resolveCamera(panned(), PHONE);
    expect(after.manual).toBe(true);
    // Dragging the finger left moves the camera right, by the pixels dragged.
    expect(after.centre.x).toBeCloseTo(before.centre.x + 30 / before.scale, 6);
  });

  it("survives the active actor changing", () => {
    // Turn order is up to seven actors a round (§7.1). Releasing on focus
    // change would undo her pan seconds after she made it.
    const state = setFocus(panned(), [{ x: 1, y: 6 }]);
    const cam = resolveCamera(state, PHONE);
    expect(cam.manual).toBe(true);
    expect(cam.centre.x).toBeCloseTo(resolveCamera(panned(), PHONE).centre.x, 6);
  });

  it("survives being told about the same attention again", () => {
    // The bug this prevents: state arrives as server patches and the world
    // re-renders several times a turn. An override released on every
    // notification would be thrown away by an unrelated render moments after a
    // pan made during her own turn.
    let state = panned();
    for (let i = 0; i < 5; i++) state = setAttention(state, "enc_1:c_iris");
    expect(resolveCamera(state, PHONE).manual).toBe(true);
  });

  it("survives a resize", () => {
    // Rotating the phone, or the TV pane reflowing, is not a request to
    // recentre — and the override must still be legal at the new size.
    const state = panned();
    expect(resolveCamera(state, TV).manual).toBe(true);
    expectInsideOrCentred(resolveCamera(state, TV));
    expectInsideOrCentred(resolveCamera(state, { width: 720, height: 390 }));
  });

  it("is released when the game asks for her attention", () => {
    // §2.2 "your turn comes to you" — a board panned three tiles away is a
    // question she cannot answer, so a new prompt takes the camera back.
    const state = setAttention(panned(), "enc_1:c_pip");
    expect(resolveCamera(state, PHONE).manual).toBe(false);
    expect(resolveCamera(state, PHONE).centre.x).toBeCloseTo(
      resolveCamera(createCameraState({ focus: [CENTRE] }), PHONE).centre.x,
      6,
    );
  });

  it("is released by the recentre button", () => {
    expect(resolveCamera(recentre(panned()), PHONE).manual).toBe(false);
  });

  it("costs nothing when there is nothing to release", () => {
    // Identity is load-bearing: this state lives in the store and a new object
    // per render re-runs every effect watching the camera.
    const state = createCameraState({ focus: [CENTRE] });
    expect(recentre(state)).toBe(state);
    expect(setFocus(state, [{ x: 5, y: 4 }])).toBe(state);
    expect(setAttention(state, "")).toBe(state);
  });

  it("does not bank up overshoot when panned into the wall", () => {
    // Rubber-banding, twice over. The stored override must sit exactly at the
    // wall — a caller reading it would otherwise see a framing that is not the
    // one on screen — and the next pan back must move immediately rather than
    // spending itself unwinding tiles of accumulated overshoot, which feels
    // like a dead board with nothing to explain it.
    let state = createCameraState({ focus: [CENTRE] });
    for (let i = 0; i < 20; i++) state = panBy(state, PHONE, { x: 400, y: 0 });
    const atWall = resolveCamera(state, PHONE);
    expect(atWall.visible.x).toBeCloseTo(0, 6);
    expect(state.override?.centre.x).toBeCloseTo(atWall.centre.x, 6);

    const nudged = resolveCamera(panBy(state, PHONE, { x: -55, y: 0 }), PHONE);
    expect(nudged.visible.x).toBeGreaterThan(0.5);
  });

  it("holds the pinched point under the fingers", () => {
    // A pinch that drifts is a pinch she has to fight. Anchored away from the
    // edges, where the clamp is allowed to win instead.
    const state = createCameraState({ focus: [CENTRE] });
    const before = resolveCamera(state, TV);
    const anchor = { x: TV.width * 0.5 + 120, y: TV.height * 0.5 - 60 };
    const held = screenToBoard(before, anchor);
    const after = resolveCamera(zoomBy(state, TV, 1.4, anchor), TV);
    expect(after.scale).toBeCloseTo(before.scale * 1.4, 6);
    const moved = boardToScreen(after, held);
    expect(moved.x).toBeCloseTo(anchor.x, 4);
    expect(moved.y).toBeCloseTo(anchor.y, 4);
  });

  it("ignores a nonsense pinch factor rather than inverting the board", () => {
    // Two fingers landing on the same pixel is a real gesture-recogniser
    // output; a factor of 0 or a negative scale mirrors or blanks the world.
    const state = createCameraState({ focus: [CENTRE] });
    const before = resolveCamera(state, PHONE);
    for (const factor of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cam = resolveCamera(zoomBy(state, PHONE, factor), PHONE);
      expect(cam.scale).toBeGreaterThan(0);
      expect(cam.scale).toBeCloseTo(before.scale, 6);
    }
  });
});

describe("degenerate input", () => {
  it("survives a pane with no size", () => {
    // Not hypothetical: PixiStage measures its host in a ResizeObserver and the
    // first callback of a mount can land before layout. One NaN in the
    // transform blanks the canvas, which looks exactly like a crash.
    for (const viewport of [
      { width: 0, height: 0 },
      { width: 0, height: 720 },
      { width: 390, height: 0 },
      { width: Number.NaN, height: Number.NaN },
      { width: -100, height: -100 },
    ]) {
      const cam = camera([CENTRE], viewport);
      for (const value of transformValues(cam)) expect(Number.isFinite(value)).toBe(true);
      expect(cam.scale).toBeGreaterThan(0);
    }
  });

  it("survives an empty focus list", () => {
    const cam = camera([], PHONE);
    for (const value of transformValues(cam)) expect(Number.isFinite(value)).toBe(true);
    expectInsideOrCentred(cam);
  });

  it("drops focus targets that are not points", () => {
    // A half-applied state patch can leave an actor without a tile for a frame.
    // One undefined coordinate would take the whole bounding box to NaN.
    const junk = [
      { x: Number.NaN, y: 2 },
      undefined,
      null,
      { x: 5, y: 4 },
    ] as unknown as Position[];
    const cam = camera(junk, PHONE);
    for (const value of transformValues(cam)) expect(Number.isFinite(value)).toBe(true);
    // The one real target still framed it, rather than being lost with the junk.
    expect(cam.visible.width).toBeCloseTo(1 + FOCUS_MARGIN_TILES * 2, 6);
  });

  it("survives a nonsense pan", () => {
    const state = panBy(createCameraState({ focus: [CENTRE] }), PHONE, {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
    });
    const cam = resolveCamera(state, PHONE);
    for (const value of transformValues(cam)) expect(Number.isFinite(value)).toBe(true);
    expectInsideOrCentred(cam);
  });

  it("defaults to the board of spec §7.1 and refuses an impossible one", () => {
    // A board with no tiles divides by zero everywhere downstream.
    expect(createCameraState().board).toEqual({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
    const broken = createCameraState({
      board: { width: 0, height: Number.NaN },
      focus: [CENTRE],
    });
    expect(broken.board).toEqual({ width: 1, height: BOARD_HEIGHT });
    for (const value of transformValues(resolveCamera(broken, PHONE))) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("handles a board smaller than the minimum zoom would allow", () => {
    // A 1 × 1 board inverts the scale bounds if they are not ordered, and an
    // inverted clamp returns the wrong end of the range.
    const state = createCameraState({ board: { width: 1, height: 1 }, focus: [{ x: 0, y: 0 }] });
    const cam = resolveCamera(zoomBy(state, PHONE, 100), PHONE);
    expect(cam.scale).toBeGreaterThan(0);
    expectInsideOrCentred(cam, { width: 1, height: 1 });
  });
});
