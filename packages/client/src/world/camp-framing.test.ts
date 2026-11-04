/**
 * The camp's framing (camp-framing.ts, docs/camp.md §3, §8.3, #614): one
 * painting covering the pane, slid so the camp stands in the lobby's window.
 * Run against the real layout in assets/manifest.json → camp, with the
 * lobby's real insets as measured on the playtest table (1280 × 720 TV, and a
 * 390 × 844 phone whose World pane is 390 × 668 under its top strip).
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { campLayout, parseCampManifest } from "./camp-layout";
import {
  GROUND_MARGIN,
  campBleed,
  campFocusBand,
  campFraming,
  campWindow,
  type CampBand,
  type CampFraming,
  type CampWindow,
} from "./camp-framing";
import { HERO_SHARE } from "./camp-motion";

const layout = campLayout(parseCampManifest((manifest as { camp: unknown }).camp), "open_plains", 1);
const canvas = layout.canvas;
const band = campFocusBand(layout);
const EPS = 1e-6;

/** Pane width and height, and the lobby's header reach and panel height, in px. */
const PANES = [
  ["a 1280 × 720 TV with the real lobby", 1280, 720, 168, 352],
  ["a 1920 × 1080 TV with the real lobby", 1920, 1080, 252, 528],
  ["a 390 × 844 phone's World pane with the real lobby", 390, 668, 43, 417],
  ["a TV with a short lobby", 1280, 720, 120, 240],
  ["a very short window", 1280, 720, 168, 540],
  ["panels reaching past the header", 800, 600, 300, 400],
  ["a pane with no lobby over it", 1920, 1080, 0, 0],
] as const;

function frameOf(w: number, h: number, top: number, bottom: number, focus: CampBand = band) {
  const window = campWindow(h, top, bottom);
  return { window, at: campFraming(w, window, canvas, focus) };
}

const bandPx = (at: CampFraming, b: CampBand = band) => ({
  top: at.y + b.top * canvas.height * at.scale,
  bottom: at.y + b.bottom * canvas.height * at.scale,
});
const fits = (at: CampFraming, window: CampWindow, b: CampBand = band) =>
  (b.bottom - b.top) * canvas.height * at.scale <= window.bottom - window.top + EPS;

describe("the camp's focus band", () => {
  const lanes = [...layout.backdrop.lanes].sort((a, b) => a.y - b.y);
  const back = lanes[0]!;
  const near = lanes[lanes.length - 1]!;

  it("runs from a standing hero's head on the back lane to just below the near lane", () => {
    expect(band.top).toBeCloseTo(back.y - HERO_SHARE * back.scale);
    expect(band.bottom).toBeCloseTo(near.y + GROUND_MARGIN);
  });

  it("grows for the tallest seated figure, and never shrinks for small ones", () => {
    expect(campFocusBand(layout, [95, 85])).toEqual(band);
    const bigfoot = campFocusBand(layout, [95, 215]);
    expect(bigfoot.top).toBeCloseTo(back.y - HERO_SHARE * (215 / 160) * back.scale);
    expect(bigfoot.bottom).toBe(band.bottom);
  });
});

describe("the camp's window", () => {
  it("is the open space between the header and the panels", () => {
    expect(campWindow(720, 168, 352)).toEqual({ top: 168, bottom: 368 });
  });

  it("is never inside out or off the pane", () => {
    expect(campWindow(600, 300, 400)).toEqual({ top: 300, bottom: 300 });
    expect(campWindow(600, -20, -5)).toEqual({ top: 0, bottom: 600 });
    expect(campWindow(600, 900, 0)).toEqual({ top: 600, bottom: 600 });
  });
});

describe("framing the camp (cover, then slide)", () => {
  for (const [name, w, h, top, bottom] of PANES) {
    describe(name, () => {
      const { window, at } = frameOf(w, h, top, bottom);
      const width = canvas.width * at.scale;
      const height = canvas.height * at.scale;

      it("covers the whole pane width and the whole window, with no gap", () => {
        expect(at.scale).toBeCloseTo(Math.max(w / canvas.width, (window.bottom - window.top) / canvas.height));
        expect(at.x).toBeLessThanOrEqual(EPS);
        expect(at.x + width).toBeGreaterThanOrEqual(w - EPS);
        expect(at.y).toBeLessThanOrEqual(window.top + EPS);
        expect(at.y + height).toBeGreaterThanOrEqual(window.bottom - EPS);
      });

      it("is centered across the camp", () => {
        expect(at.x + width / 2).toBeCloseTo(w / 2);
      });

      it("and its edges drawn on cover the rest of the pane, top to bottom", () => {
        const bleed = campBleed(h, at, canvas);
        expect(bleed.top).toBeGreaterThanOrEqual(0);
        expect(bleed.bottom).toBeGreaterThanOrEqual(0);
        expect(Math.max(0, at.y - bleed.top)).toBe(0);
        expect(at.y + height + bleed.bottom).toBeGreaterThanOrEqual(h - EPS);
      });

      it("puts the walking band in the window whenever it fits, centered", () => {
        const b = bandPx(at);
        const middle = (window.top + window.bottom) / 2;
        // Clamped only where covering the window demands it.
        if (at.y < window.top - EPS && at.y + height > window.bottom + EPS) {
          expect((b.top + b.bottom) / 2).toBeCloseTo(middle);
        }
        if (fits(at, window) && at.y < window.top - EPS && at.y + height > window.bottom + EPS) {
          expect(b.top).toBeGreaterThanOrEqual(window.top - EPS);
          expect(b.bottom).toBeLessThanOrEqual(window.bottom + EPS);
        }
      });
    });
  }

  it("fits the band inside the window on the phone and the short-lobby TV", () => {
    for (const [w, h, top, bottom] of [[390, 668, 43, 417], [1280, 720, 120, 240]] as const) {
      const { window, at } = frameOf(w, h, top, bottom);
      expect(fits(at, window)).toBe(true);
      const b = bandPx(at);
      expect(b.top).toBeGreaterThanOrEqual(window.top - EPS);
      expect(b.bottom).toBeLessThanOrEqual(window.bottom + EPS);
    }
  });

  it("overflows the window evenly on the 16:9 TVs, where the band is taller than the window", () => {
    for (const [w, h, top, bottom] of [[1280, 720, 168, 352], [1920, 1080, 252, 528]] as const) {
      const { window, at } = frameOf(w, h, top, bottom);
      expect(fits(at, window)).toBe(false);
      const b = bandPx(at);
      const over = window.top - b.top;
      expect(over).toBeGreaterThan(0);
      expect(over).toBeCloseTo(b.bottom - window.bottom);
      // The back and middle lanes stand in the window; the near lane is a few percent of the
      // pane below it, in the gap above the panels, never deep under them.
      const laneY = (id: string) => at.y + layout.lanes.get(id)!.y * canvas.height * at.scale;
      for (const id of ["back", "middle"]) {
        expect(laneY(id)).toBeGreaterThan(window.top);
        expect(laneY(id)).toBeLessThan(window.bottom);
      }
      expect(laneY("near") - window.bottom).toBeLessThan(0.04 * h);
    }
  });

  it("trims sky off the top of a 16:9 TV rather than leaving a gap above", () => {
    const { at } = frameOf(1280, 720, 168, 352);
    expect(at.y).toBeLessThan(0);
    expect(campBleed(720, at, canvas).top).toBe(0);
  });

  it("frames the same, scaled, at any size of the same proportions", () => {
    const small = frameOf(1280, 720, 168, 352).at;
    const big = frameOf(1920, 1080, 252, 528).at;
    expect(big.scale / small.scale).toBeCloseTo(1.5);
    expect(big.y / small.y).toBeCloseTo(1.5);
  });

  it("is stable as the inset changes: a px of panel moves the picture at most a px", () => {
    for (const [w, h, top] of [[1280, 720, 168], [390, 668, 43]] as const) {
      let prev = frameOf(w, h, top, 0).at;
      for (let bottom = 1; bottom <= h; bottom++) {
        const next = frameOf(w, h, top, bottom).at;
        expect(Math.abs(next.y - prev.y)).toBeLessThanOrEqual(1 + EPS);
        expect(Math.abs(next.x - prev.x)).toBeLessThanOrEqual(1 + EPS);
        expect(Math.abs(next.scale - prev.scale) * canvas.height).toBeLessThanOrEqual(1 + EPS);
        prev = next;
      }
      // And the same in, the same out.
      expect(frameOf(w, h, top, 300).at).toEqual(frameOf(w, h, top, 300).at);
    }
  });

  it("fills a 16:9 pane exactly when nothing covers it", () => {
    expect(frameOf(1920, 1080, 0, 0).at).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
