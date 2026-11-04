import { describe, expect, it } from "vitest";
import { campLayoutFixture, campManifestFixture } from "../testing/camp-fixture";
import {
  CampLayoutError,
  GROUND_MARGIN,
  campFrame,
  campGround,
  campLayout,
  campRoute,
  laneAt,
  laneScaleAt,
  parseCampManifest,
  DEFAULT_PIECE_CM,
  pieceHeightCm,
  routeLength,
  routeSweeps,
} from "./camp-layout";

type Raw = ReturnType<typeof campManifestFixture> & Record<string, any>;

/** The fixture, edited by `change`, parsed. */
function parsed(change: (m: any) => void) {
  const m = campManifestFixture() as Raw;
  change(m);
  return () => parseCampManifest(m);
}

describe("parseCampManifest", () => {
  it("reads the contract's shape", () => {
    const manifest = parseCampManifest(campManifestFixture());
    expect(manifest.backdropCanvas).toEqual({ width: 1920, height: 1080 });
    expect(manifest.backdrops[0]!.lanes.map((l) => l.id)).toEqual(["back", "middle", "near"]);
    expect(manifest.frames[0]!.standPoints.filter((p) => p.seat !== undefined)).toHaveLength(4);
    expect(manifest.frames[0]!.movingParts[0]).toEqual({
      piece: "campfire",
      path: "camp/frames/stage1/campfire-flame.png",
      motion: "flicker",
    });
  });

  it("reads the contract's own example once it has its four bedrolls", () => {
    const example = {
      backdropCanvas: { width: 1920, height: 1080 },
      backdrops: [campManifestFixture()["backdrops"]].flat(),
      frames: [
        {
          stage: 1,
          pieces: [{ id: "campfire", path: "camp/frames/stage1/campfire.png", lane: "middle", x: 0.5 }],
          movingParts: [{ piece: "campfire", path: "camp/frames/stage1/campfire-flame.png", motion: "flicker" }],
          standPoints: [
            { id: "campfire-w", lane: "middle", x: 0.42, face: "right", action: "warmUp", hotspot: "campfire" },
            { id: "bedroll-1", lane: "back", x: 0.3, face: "right", action: "rest", seat: 0 },
          ],
          trailhead: { lane: "near", x: 0.96 },
        },
      ],
    };
    // As written it has one seat, and stage 1 needs one per hero.
    expect(() => parseCampManifest(example)).toThrow(/exactly 4 seats/);
    const frame = example.frames[0]!;
    for (const seat of [1, 2, 3]) {
      frame.standPoints.push({ id: `bedroll-${seat + 1}`, lane: "back", x: 0.3 + seat * 0.12, face: "right", action: "rest", seat });
    }
    expect(parseCampManifest(example).frames[0]!.standPoints).toHaveLength(5);
  });

  it("reads a piece's true height when it gives one, and guesses by kind when not", () => {
    const manifest = parsed((m) => (m.frames[0].pieces[0].heightCm = 75))();
    const [fire, pack] = manifest.frames[0]!.pieces;
    expect(fire!.heightCm).toBe(75);
    expect(pieceHeightCm(fire!)).toBe(75);
    expect(pack!.heightCm).toBeUndefined();
    expect(pieceHeightCm(pack!)).toBe(50);
    expect(pieceHeightCm({ id: "campfire-big" })).toBe(60);
    expect(pieceHeightCm({ id: "tent_2" })).toBe(170);
    expect(pieceHeightCm({ id: "wishing-well" })).toBe(DEFAULT_PIECE_CM);
    expect(parsed((m) => (m.frames[0].pieces[0].heightCm = 0))).toThrow(/heightCm: must be a positive number/);
    expect(parsed((m) => (m.frames[0].pieces[0].heightCm = "tall"))).toThrow(/heightCm/);
  });

  it("ignores keys it does not know, so the section can grow", () => {
    expect(() => parsed((m) => (m.tentStyles = ["canvas"]))()).not.toThrow();
  });

  const refusals: [string, (m: any) => void, RegExp][] = [
    ["a stand point on a lane nobody declared", (m) => (m.frames[0].standPoints[0].lane = "river"), /names no lane "river"/],
    ["a crossing naming a lane that is not there", (m) => m.backdrops[0].crossings[0].lanes.push("loft"), /names no lane "loft"/],
    ["a crossing joining one lane", (m) => (m.backdrops[0].crossings[0].lanes = ["back"]), /at least two lanes/],
    ["a crossing off a lane's span", (m) => (m.backdrops[0].crossings[0].x = 0.06), /off the walkable span of lane "back"/],
    ["two stand points with one id", (m) => (m.frames[0].standPoints[1].id = "campfire-w"), /stand point "campfire-w" appears twice/],
    ["three seats at stage 1", (m) => delete m.frames[0].standPoints[2].seat, /exactly 4 seats/],
    ["two bedrolls for one seat", (m) => (m.frames[0].standPoints[3].seat = 0), /seat "0" appears twice/],
    ["a fifth seat number", (m) => (m.frames[0].standPoints[2].seat = 4), /from 0 to 3/],
    ["a hotspot naming no piece", (m) => (m.frames[0].standPoints[0].hotspot = "cookfire"), /names no piece "cookfire"/],
    ["a moving part for no piece", (m) => (m.frames[0].movingParts[0].piece = "banner"), /names no piece "banner"/],
    ["a motion nobody draws", (m) => (m.frames[0].movingParts[0].motion = "spin"), /must be one of/],
    ["a facing that is not left or right", (m) => (m.frames[0].standPoints[0].face = "up"), /must be one of left, right/],
    ["an action nobody poses", (m) => (m.frames[0].standPoints[0].action = "dance"), /must be one of/],
    ["a stand point off the walkable lane", (m) => (m.frames[0].standPoints[0].x = 0.02), /off the walkable span/],
    ["a coordinate outside the canvas", (m) => (m.backdrops[0].lanes[0].y = 1.2), /fraction from 0 to 1/],
    ["a lane no crossing reaches", (m) => (m.backdrops[0].crossings = [{ x: 0.18, lanes: ["back", "middle"] }]), /no crossing reaches lane "near"/],
    ["a lane running backwards", (m) => (m.backdrops[0].lanes[0].x0 = 0.95), /x0 must be left of x1/],
    ["a trailhead on no lane", (m) => (m.frames[0].trailhead.lane = "road"), /names no lane "road"/],
    ["a frame whose lane one backdrop lacks", (m) => m.backdrops.push({ ...m.backdrops[0], family: "forest", lanes: m.backdrops[0].lanes.filter((l: any) => l.id !== "middle"), crossings: [{ x: 0.18, lanes: ["back", "near"] }] }), /on backdrop "forest"/],
  ];
  for (const [what, change, message] of refusals) {
    it(`refuses ${what}`, () => {
      const run = parsed(change);
      expect(run).toThrow(CampLayoutError);
      expect(run).toThrow(message);
    });
  }
});

describe("campLayout", () => {
  it("picks the family's backdrop and the stage's frame, falling back rather than failing", () => {
    const manifest = parseCampManifest(campManifestFixture());
    expect(campLayout(manifest, "open_plains", 1).frame.stage).toBe(1);
    expect(campLayout(manifest, "snowfield", 3).backdrop.family).toBe("open_plains");
    expect(campLayout(manifest, "open_plains", 4).frame.stage).toBe(1);
  });

  it("draws a figure bigger as it nears, eased between lanes", () => {
    const layout = campLayoutFixture();
    expect(laneScaleAt(layout, 0.7)).toBeCloseTo(0.86);
    expect(laneScaleAt(layout, 0.87)).toBeCloseTo(1);
    const between = laneScaleAt(layout, 0.74);
    expect(between).toBeGreaterThan(0.86);
    expect(between).toBeLessThan(0.93);
    expect(laneAt(layout, 0.78)).toBe("middle");
    expect(laneAt(layout, 0.8)).toBeNull();
  });
});

describe("campRoute", () => {
  const layout = campLayoutFixture();

  it("walks straight along one lane", () => {
    const route = campRoute(layout, { lane: "middle", x: 0.42 }, { lane: "middle", x: 0.58 })!;
    expect(route).toEqual([
      { x: 0.42, y: 0.78, lane: "middle" },
      { x: 0.58, y: 0.78, lane: "middle" },
    ]);
    expect(routeLength(route, layout.canvas)).toBeCloseTo(0.16 * 1920);
  });

  it("changes lanes only at a crossing, the one that makes the shorter walk", () => {
    const left = campRoute(layout, { lane: "back", x: 0.24 }, { lane: "near", x: 0.12 })!;
    expect(left.map((p) => p.x)).toEqual([0.24, 0.18, 0.18, 0.12]);
    const right = campRoute(layout, { lane: "back", x: 0.76 }, { lane: "near", x: 0.88 })!;
    expect(right.map((p) => p.x)).toEqual([0.76, 0.82, 0.82, 0.88]);
    const between = campRoute(layout, { lane: "back", x: 0.38 }, { lane: "middle", x: 0.42 })!;
    expect(between.map((p) => p.x)).toEqual([0.38, 0.31, 0.31, 0.42]);
  });

  it("is only ever along a lane or straight across at a crossing", () => {
    const crossings = layout.backdrop.crossings.map((c) => c.x);
    const points = layout.frame.standPoints;
    for (const a of points) {
      for (const b of points) {
        const route = campRoute(layout, a, b)!;
        expect(route).not.toBeNull();
        for (let i = 1; i < route.length; i++) {
          const p = route[i - 1]!;
          const q = route[i]!;
          if (p.y === q.y) expect(laneAt(layout, p.y)).not.toBeNull();
          else {
            expect(p.x).toBe(q.x);
            expect(crossings).toContain(p.x);
          }
        }
      }
    }
  });

  it("says which stretch of each lane a route sweeps, the middle lane included on a long crossing", () => {
    const route = campRoute(layout, { lane: "back", x: 0.24 }, { lane: "near", x: 0.12 })!;
    expect(routeSweeps(layout, route)).toEqual([
      { lane: "back", lo: 0.18, hi: 0.24 },
      { lane: "back", lo: 0.18, hi: 0.18 },
      { lane: "middle", lo: 0.18, hi: 0.18 },
      { lane: "near", lo: 0.18, hi: 0.18 },
      { lane: "near", lo: 0.12, hi: 0.18 },
    ]);
  });

  it("follows the trail past the end of its lane, off the edge", () => {
    const route = campRoute(layout, { lane: "near", x: 0.9 }, { lane: "near", x: 1.1 })!;
    expect(route[route.length - 1]).toEqual({ x: 1.1, y: 0.87, lane: "near" });
  });
});

describe("framing the camp clear of the panels (#614)", () => {
  const layout = campLayoutFixture();
  const canvas = layout.canvas;
  const ground = campGround(layout);

  it("reaches down to the nearest lane and the feet's margin", () => {
    expect(ground).toBeCloseTo(0.87 + GROUND_MARGIN);
  });

  for (const [name, w, h, inset] of [
    ["a TV with nothing over it", 1920, 1080, 0],
    ["a TV with the lobby's band", 1280, 720, 200],
    ["a phone's World pane", 390, 520, 260],
    ["a pane the panels nearly fill", 800, 600, 560],
  ] as const) {
    it(`keeps the ground above the panels and the whole width on ${name}`, () => {
      const free = h - inset;
      const at = campFrame(w, h, inset, canvas, ground);
      expect(at.y + ground * canvas.height * at.scale).toBeLessThanOrEqual(free + 1e-6);
      expect(at.x).toBeGreaterThanOrEqual(-1e-6);
      expect(at.x * 2 + canvas.width * at.scale).toBeCloseTo(w);
      // No sky gap above a canvas taller than the room it has, and none between a shorter one and the panels.
      if (canvas.height * at.scale >= free) expect(at.y).toBe(0);
      else expect(at.y + canvas.height * at.scale).toBeCloseTo(free);
    });
  }

  it("fills a 16:9 pane exactly when nothing covers it", () => {
    expect(campFrame(1920, 1080, 0, canvas, ground)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
