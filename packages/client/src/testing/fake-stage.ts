/**
 * A Pixi stage with no renderer — enough of one to test `world/`.
 *
 * Named so vitest's `*.test.ts` glob does not collect it, the same as
 * `fixtures.ts` beside it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `world/board.ts` and `world/scene.ts` were the two least-covered files in the
 * client and the two with the most fix commits against them, which is not a
 * coincidence: the rule extracts (`board-math`, `camera`, `nameplate`,
 * `scene-actors`) are well tested, and every one of those fixes was in the
 * *wiring around* them — a label rewritten without being re-fitted, an actor
 * updated where it should have been rebuilt. A unit test of a pure function
 * cannot catch its caller failing to call it.
 *
 * The blocker was never WebGL. Pixi's scene graph — `Container`, `Graphics`,
 * `Text`, positions, `destroy()` — is plain JavaScript and constructs happily
 * under jsdom. Two things stood in the way, and both are small:
 *
 *  1. `Text` measures glyphs through a 2D canvas context, which jsdom does not
 *     implement. `fakeCanvas2D()` supplies one.
 *  2. `createScene()` takes an `Application`, which does need a renderer — but
 *     it only ever reads `stage`, `ticker` and `canvas` from it (five sites).
 *     `fakeApp()` supplies those.
 *
 * ---------------------------------------------------------------------------
 * ON FAKE FONT METRICS
 *
 * Text is measured as `CHAR_WIDTH` per character. That is not a limitation
 * being tolerated, it is the point: real metrics vary by platform and installed
 * font, so a width assertion against them would be flaky on somebody else's
 * laptop. Every rule these tests check is about *proportion* — does a long name
 * get scaled down, do two labels leave a gutter — and a linear measure states
 * those exactly. What it cannot check is kerning and glyph shape, which no
 * assertion in CI should be trying to check anyway.
 */

import { Container } from "pixi.js";

/** Board pixels per character, at the default font size. Deterministic. */
export const CHAR_WIDTH = 10;
const ASCENT = 16;
const DESCENT = 4;

/**
 * Pixi tests `instanceof CanvasRenderingContext2D` before trusting a context,
 * and jsdom does not define the class when it has no canvas implementation. So
 * the fake declares it, and is one.
 */
class FakeCanvasContext2D {
  font = "";
  textBaseline = "";
  textAlign = "";
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 0;
  lineJoin = "";
  miterLimit = 0;
  globalAlpha = 1;
  readonly canvas: unknown;

  constructor(canvas: unknown) {
    this.canvas = canvas;
  }

  measureText(text: string): Record<string, number> {
    const width = text.length * CHAR_WIDTH;
    return {
      width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: ASCENT,
      actualBoundingBoxDescent: DESCENT,
      fontBoundingBoxAscent: ASCENT,
      fontBoundingBoxDescent: DESCENT,
    };
  }

  save(): void {}
  restore(): void {}
  scale(): void {}
  rotate(): void {}
  translate(): void {}
  transform(): void {}
  setTransform(): void {}
  getTransform(): Record<string, number> {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  fillText(): void {}
  strokeText(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  rect(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  drawImage(): void {}
  putImageData(): void {}
  getImageData(): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(4) };
  }
  createImageData(): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(4) };
  }
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
  createPattern(): null {
    return null;
  }
}

/** Marks a patched prototype, so the check survives a fresh jsdom global. */
const INSTALLED = Symbol.for("kad.fakeCanvas2D");

/**
 * Teach jsdom's `<canvas>` to hand out the fake context. Idempotent, and safe
 * to call from every `beforeAll` that needs text measurement.
 *
 * The idempotence flag lives on the prototype rather than in this module on
 * purpose. Vitest gives each test file a fresh jsdom global but may reuse the
 * module registry, so a module-level `let installed` reports "already done"
 * about a realm it never touched — and the second file silently gets jsdom's
 * unimplemented canvas back.
 *
 * A note on what this does not silence: Pixi probes for a canvas context while
 * its own modules are loading, which under ESM is before any `beforeAll` can
 * run, so each Pixi-touching suite prints one "Not implemented:
 * HTMLCanvasElement's getContext()" line from jsdom on the way in. It is
 * cosmetic — the probe's result is not used for anything these tests assert —
 * and the fix is worse than the noise: hoisting the patch into a vitest
 * `setupFiles` was tried, and it loaded this module into all 59 suites for
 * about 17 extra seconds without removing a single line.
 */
export function installFakeCanvas2D(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals["CanvasRenderingContext2D"] ??= FakeCanvasContext2D;

  const proto = globalThis.HTMLCanvasElement.prototype as unknown as {
    getContext(id: string): unknown;
    [INSTALLED]?: boolean;
  };
  if (proto[INSTALLED]) return;
  proto[INSTALLED] = true;
  proto.getContext = function getContext(id: string): unknown {
    return id === "2d" ? new FakeCanvasContext2D(this) : null;
  };
}

/** A ticker whose frames the test advances by hand. */
export interface FakeTicker {
  deltaMS: number;
  add(fn: () => void): void;
  remove(fn: () => void): void;
  /** How many callbacks are still attached — a leak is a scene that never died. */
  readonly count: number;
  /** Run every attached callback once, at `ms` since the last frame. */
  frame(ms?: number): void;
}

export interface FakeApp {
  stage: Container;
  ticker: FakeTicker;
  canvas: HTMLCanvasElement;
}

/**
 * The three things `createScene()` reads off an `Application`.
 *
 * Driving the ticker by hand rather than by wall clock is worth as much as the
 * renderer-free stage: animation in here is `approach()`-based, so "has it
 * arrived yet" is a question about elapsed time, and a test that has to wait
 * for real frames is a test that is slow *and* racy.
 */
export function fakeApp(): FakeApp {
  const callbacks = new Set<() => void>();
  const ticker: FakeTicker = {
    deltaMS: 16,
    add: (fn) => void callbacks.add(fn),
    remove: (fn) => void callbacks.delete(fn),
    get count() {
      return callbacks.size;
    },
    frame(ms = 16) {
      ticker.deltaMS = ms;
      for (const fn of [...callbacks]) fn();
    },
  };
  return { stage: new Container(), ticker, canvas: globalThis.document.createElement("canvas") };
}
