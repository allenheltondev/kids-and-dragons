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
  EDGE_MARGIN,
  GROUND_MARGIN,
  MIN_FIGURE_SCALE,
  campBleed,
  campFigureScale,
  campFit,
  campFocusBand,
  campFigureWidth,
  campFraming,
  campStandRange,
  campStandX,
  campVisibleSpan,
  campWindow,
  type CampBand,
  type CampFraming,
  type CampWindow,
} from "./camp-framing";
import { HERO_SHARE, campHeightPx, campMeasure } from "./camp-motion";
import { QUEUE_GAP, queuePlaces, queueSpots } from "./camp-wander";
import { FIGURE_SIZES } from "./figure-sizes";

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

      it("puts the walking band in the window whenever it fits, centered, and keeps its feet in when not", () => {
        const b = bandPx(at);
        const middle = (window.top + window.bottom) / 2;
        // Clamped only where covering the window demands it.
        if (at.y < window.top - EPS && at.y + height > window.bottom + EPS) {
          if (fits(at, window)) expect((b.top + b.bottom) / 2).toBeCloseTo(middle);
          else expect(b.bottom).toBeCloseTo(window.bottom);
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

  it("keeps the feet in on the 16:9 TVs, where the full-size band is taller than the window", () => {
    for (const [w, h, top, bottom] of [[1280, 720, 168, 352], [1920, 1080, 252, 528]] as const) {
      const { window, at } = frameOf(w, h, top, bottom);
      expect(fits(at, window)).toBe(false);
      const b = bandPx(at);
      // The near lane's feet and their margin end on the window's bottom; only heads reach past its top.
      expect(b.bottom).toBeCloseTo(window.bottom);
      expect(window.top - b.top).toBeGreaterThan(0);
      const laneY = (id: string) => at.y + layout.lanes.get(id)!.y * canvas.height * at.scale;
      for (const id of ["back", "middle", "near"]) {
        expect(laneY(id)).toBeGreaterThan(window.top);
        expect(laneY(id)).toBeLessThan(window.bottom);
      }
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

/*
 * The figures' factor (docs/camp.md §8.3): when the band does not fit the
 * window at the painting's cover scale, the figures and pieces shrink, not the
 * painting. The insets are the lobby's as measured on the playtest table
 * (tools/playtest, `section.lobby` and `.lobby__camp-window`): on a 1280 × 720
 * TV the header reaches 65 px, and the panels cover 352 px with three heroes
 * seated and 446 px with four (the party wraps to a second row); the
 * 1920 × 1080 TV is the same lobby at 1.5×; Travel Mode's 390 × 844 phone has
 * a 390 × 668 World pane with 35 px of header and 348 px of panels.
 */
describe("the figures' factor", () => {
  const cm = (species: string) => FIGURE_SIZES[`characters/${species}`]![0];
  const THREE = [cm("unicorn"), cm("griffin"), cm("dragonling")];
  const FOUR = [...THREE, cm("bigfoot")];
  const measure = campMeasure(canvas.height);
  const lanes = layout.backdrop.lanes;
  const near = Math.max(...lanes.map((lane) => lane.y));

  const CASES = [
    ["a 1280 × 720 TV, three heroes", 1280, 720, 65, 352, THREE],
    ["a 1280 × 720 TV, four heroes and the bigfoot", 1280, 720, 65, 446, FOUR],
    ["a 1920 × 1080 TV, three heroes", 1920, 1080, 98, 528, THREE],
    ["a 1920 × 1080 TV, four heroes and the bigfoot", 1920, 1080, 98, 669, FOUR],
    ["a 390 × 844 phone's World pane, four heroes", 390, 668, 35, 348, FOUR],
    ["a TV with a short lobby, four heroes", 1280, 720, 65, 240, FOUR],
    ["a very short window, four heroes", 1280, 720, 168, 540, FOUR],
    ["a window of no height", 1280, 720, 300, 420, FOUR],
  ] as const;

  /** Where every hero's feet and the top of their head land, in pane px, on every lane. */
  function figuresPx(w: number, h: number, top: number, bottom: number, heights: readonly number[]) {
    const window = campWindow(h, top, bottom);
    const fit = campFit(w, window, layout, heights);
    const at = fit.framing;
    const toPane = (y: number) => at.y + y * canvas.height * at.scale;
    const figures = lanes.flatMap((lane) =>
      heights.map((heightCm) => {
        const drawn = (campHeightPx(heightCm, measure) * lane.scale * fit.figureScale) / canvas.height;
        return { lane: lane.id, feet: toPane(lane.y), head: toPane(lane.y - drawn) };
      }),
    );
    return { window, fit, figures, nearFeet: toPane(near + GROUND_MARGIN * fit.figureScale) };
  }

  for (const [name, w, h, top, bottom, heights] of CASES) {
    describe(name, () => {
      const { window, fit, figures, nearFeet } = figuresPx(w, h, top, bottom, heights);

      it("never shrinks below the floor, nor grows past full size", () => {
        expect(fit.figureScale).toBeGreaterThanOrEqual(MIN_FIGURE_SCALE);
        expect(fit.figureScale).toBeLessThanOrEqual(1);
      });

      it("leaves the painting cover-fit, edge to edge", () => {
        expect(fit.framing.scale).toBeCloseTo(Math.max(w / canvas.width, (window.bottom - window.top) / canvas.height));
        expect(fit.framing.x).toBeLessThanOrEqual(EPS);
        expect(fit.framing.y).toBeLessThanOrEqual(window.top + EPS);
        expect(fit.framing.y + canvas.height * fit.framing.scale).toBeGreaterThanOrEqual(window.bottom - EPS);
      });

      it("keeps the near lane's feet, and their shadow, inside the window", () => {
        expect(nearFeet).toBeLessThanOrEqual(window.bottom + EPS);
        for (const figure of figures) expect(figure.feet).toBeLessThanOrEqual(window.bottom + EPS);
      });

      it("shows every hero whole, on any lane, whenever it is above the floor", () => {
        if (fit.figureScale <= MIN_FIGURE_SCALE + EPS) return;
        for (const figure of figures) {
          expect(figure.head).toBeGreaterThanOrEqual(window.top - EPS);
          expect(figure.feet).toBeLessThanOrEqual(window.bottom + EPS);
        }
      });
    });
  }

  it("is 1 whenever the band already fits, and draws nobody smaller then", () => {
    for (const [w, h, top, bottom] of [[390, 668, 35, 348], [1920, 1080, 0, 0], [1280, 720, 0, 240]] as const) {
      const window = campWindow(h, top, bottom);
      expect(campFigureScale(w, window, layout, FOUR)).toBe(1);
      expect(campFit(w, window, layout, FOUR).band).toEqual(campFocusBand(layout, FOUR));
    }
  });

  it("is the largest factor that fits: the band then fills the window exactly", () => {
    const window = campWindow(720, 65, 352);
    const k = campFigureScale(1280, window, layout, THREE);
    expect(k).toBeGreaterThan(MIN_FIGURE_SCALE);
    expect(k).toBeLessThan(1);
    const at = campFraming(1280, window, canvas, campFocusBand(layout, THREE, k));
    const b = campFocusBand(layout, THREE, k);
    expect((b.bottom - b.top) * canvas.height * at.scale).toBeCloseTo(window.bottom - window.top);
  });

  it("shrinks for a taller hero seated, and for a shorter window", () => {
    const window = campWindow(720, 65, 300);
    expect(campFigureScale(1280, window, layout, FOUR)).toBeLessThan(campFigureScale(1280, window, layout, THREE));
    expect(campFigureScale(1280, campWindow(720, 65, 360), layout, THREE)).toBeLessThan(
      campFigureScale(1280, campWindow(720, 65, 300), layout, THREE),
    );
  });

  it("at the floor keeps the feet on the window's bottom and lets only the tallest heads reach past its top", () => {
    const { window, fit, figures, nearFeet } = figuresPx(1280, 720, 65, 446, FOUR);
    expect(fit.figureScale).toBe(MIN_FIGURE_SCALE);
    expect(nearFeet).toBeCloseTo(window.bottom);
    // The back and middle lanes' feet stand in the window too.
    for (const figure of figures) expect(figure.feet).toBeGreaterThan(window.top);
  });

  it("changes smoothly: a px of panel, or a hero's few cm, moves it only a little", () => {
    for (const [w, h, top, heights] of [[1280, 720, 65, FOUR], [1920, 1080, 98, THREE], [390, 668, 35, FOUR]] as const) {
      let prev = campFigureScale(w, campWindow(h, top, 0), layout, heights);
      for (let bottom = 1; bottom <= h; bottom++) {
        const next = campFigureScale(w, campWindow(h, top, bottom), layout, heights);
        // At most a fiftieth per px even on the phone, where the painting is drawn smallest.
        expect(Math.abs(next - prev)).toBeLessThan(0.02);
        prev = next;
      }
    }
    let prev = campFigureScale(1280, campWindow(720, 65, 352), layout, [100]);
    for (let tallest = 101; tallest <= 260; tallest++) {
      const next = campFigureScale(1280, campWindow(720, 65, 352), layout, [tallest]);
      expect(Math.abs(next - prev)).toBeLessThan(0.01);
      prev = next;
    }
  });

  it("reports the real tables' factors", () => {
    const k = (w: number, h: number, top: number, bottom: number, heights: readonly number[]) =>
      campFigureScale(w, campWindow(h, top, bottom), layout, heights);
    // 720p with three heroes fits a hair under full size; four heroes and the bigfoot, in a
    // window the party's second row shrinks to 209 px, hit the floor.
    expect(k(1280, 720, 65, 352, THREE)).toBeCloseTo(0.983, 3);
    expect(k(1280, 720, 65, 446, FOUR)).toBe(MIN_FIGURE_SCALE);
    expect(k(390, 668, 35, 348, FOUR)).toBe(1);
  });
});

/**
 * Every place a figure can stand, seen whole (docs/camp.md §8.6): the
 * painting covers the pane, so a pane narrower than 16:9 (a 1024 × 600 TV)
 * or one whose window asks for a bigger scale (a phone's World pane) crops its
 * sides, and the trailhead at x 0.95 put a bigfoot at the front of the line
 * half off a 16:9 TV's edge. Stand points and the line's places are moved in
 * from a cropped edge by the figure's width (camp.ts `pointX`, camp-wander.ts
 * `queueSpots`), so at every size, for every lobby and every order the party
 * readies in, each one lies inside the visible span, figure width included.
 */
describe("the places a figure stands, on screen", () => {
  const cm = (species: string) => FIGURE_SIZES[`characters/${species}`]![0];
  const PARTY = [cm("unicorn"), cm("griffin"), cm("dragonling"), cm("bigfoot")];
  const MARGIN = 1e-9;
  const SIZES = [
    ["a 1024 × 600 TV", 1024, 600, 55, 372],
    ["a 1280 × 720 TV", 1280, 720, 65, 446],
    ["a 1920 × 1080 TV", 1920, 1080, 98, 669],
    ["a 390 × 844 phone's World pane", 390, 668, 35, 348],
  ] as const;

  /** All orders of a list. */
  const orders = <T>(items: readonly T[]): T[][] =>
    items.length <= 1 ? [items.slice()] : items.flatMap((item, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));

  for (const [name, w, h, top, measuredBottom] of SIZES) {
    it(`keeps every stand point and every place in the line inside ${name}'s visible span`, () => {
      // The lobby as measured, and every other height its panels could take.
      for (const bottom of [measuredBottom, ...Array.from({ length: Math.floor((h * 0.75) / 8) }, (_, i) => i * 8)]) {
        const fit = campFit(w, campWindow(h, top, bottom), layout, PARTY);
        const span = campVisibleSpan(w, fit.framing, canvas.width);
        const inside = (x: number, width: number, what: string) => {
          expect(x - width / 2, `${name}, panels ${bottom}px: ${what} cut off on the left`).toBeGreaterThanOrEqual(span.x0 - MARGIN);
          expect(x + width / 2, `${name}, panels ${bottom}px: ${what} cut off on the right`).toBeLessThanOrEqual(span.x1 + MARGIN);
        };

        for (const point of layout.frame.standPoints) {
          const lane = layout.lanes.get(point.lane)!;
          const widest = Math.max(...PARTY.map((heightCm) => campFigureWidth(heightCm, lane.scale, fit.figureScale, canvas)));
          const x = campStandX(point.x, campStandRange(lane, span, widest));
          inside(x, widest, point.id);
          // Never off the ground either, and only moved when the edge made it.
          expect(x).toBeGreaterThanOrEqual(lane.x0);
          expect(x).toBeLessThanOrEqual(lane.x1);
          if (point.x - widest / 2 - EDGE_MARGIN >= span.x0 && point.x + widest / 2 + EDGE_MARGIN <= span.x1) expect(x).toBe(point.x);
        }

        // The line: the trailhead's lane first, then the lanes behind it (camp.ts `lineLanes`).
        const trail = layout.frame.trailhead;
        const front = layout.lanes.get(trail.lane)!;
        const lanes = [front, ...[...layout.lanes.values()].filter((l) => l.y < front.y).sort((a, b) => b.y - a.y)];
        for (const order of orders(PARTY)) {
          const width = (heightCm: number, laneId: string) =>
            campFigureWidth(heightCm, layout.lanes.get(laneId)!.scale, fit.figureScale, canvas);
          const rows = lanes.map((lane) => ({ lane: lane.id, x0: lane.x0, x1: lane.x1, widths: order.map((heightCm) => width(heightCm, lane.id)) }));
          const places = queuePlaces(trail.x, 1, rows, QUEUE_GAP, span);
          expect(places).toHaveLength(order.length);
          places.forEach((place, i) => {
            inside(place.x, width(order[i]!, place.lane), `place ${i} in the line`);
            // Behind the one before it in its row, nobody inside anybody.
            const before = places.slice(0, i).filter((p) => p.lane === place.lane).at(-1);
            if (before) {
              const j = places.indexOf(before);
              const room = (width(order[j]!, place.lane) + width(order[i]!, place.lane)) / 2 + QUEUE_GAP;
              expect(before.x - place.x, `${name}, panels ${bottom}px: place ${i} inside place ${j}`).toBeGreaterThanOrEqual(room - 1e-9);
            }
          });
          // The front stands at the trailhead whenever the whole of the hero fits there.
          if (trail.x + rows[0]!.widths[0]! / 2 + EDGE_MARGIN <= span.x1) expect(places[0]).toEqual({ lane: trail.lane, x: trail.x });
          // The measured lobbies hold the whole party in one row.
          if (bottom === measuredBottom) expect(places.every((p) => p.lane === trail.lane), `${name}: one row`).toBe(true);
        }
      }
    });
  }

  it("runs the line on behind a trailhead the pane crops, and steps round whoever is in its way", () => {
    const span = { x0: 0.2, x1: 0.8 };
    const lane = { x0: 0.04, x1: 0.97 };
    const widths = [0.1, 0.08, 0.12];
    const spots = queueSpots(0.95, 1, widths, lane, QUEUE_GAP, span);
    expect(spots[0]).toBeCloseTo(0.8 - 0.05 - EDGE_MARGIN, 9);
    expect(spots[0]! - spots[1]!).toBeCloseTo(0.09 + QUEUE_GAP, 9);
    // A hero resting at a bedroll in the line's way: the line steps round them.
    const resting = { x: spots[1]!, width: 0.08 };
    const round = queueSpots(0.95, 1, widths, lane, QUEUE_GAP, span, [resting]);
    expect(round[0]).toBe(spots[0]);
    expect(Math.abs(round[1]! - resting.x)).toBeGreaterThanOrEqual((widths[1]! + resting.width) / 2 + QUEUE_GAP - 1e-9);
    expect(round[1]!).toBeLessThan(resting.x);
    // A line wider than the whole span bunches at its far end, never off the screen.
    const long = queueSpots(0.95, 1, [0.3, 0.3, 0.3], lane, QUEUE_GAP, span);
    for (const x of long) expect(x - 0.15).toBeGreaterThanOrEqual(span.x0 + EDGE_MARGIN - 1e-9);
  });
});
