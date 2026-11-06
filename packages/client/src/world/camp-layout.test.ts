import { describe, expect, it } from "vitest";
import { campLayoutFixture, campManifestFixture } from "../testing/camp-fixture";
import {
  CampLayoutError,
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
  it("accepts explicit ownership and rejects an invalid hero seat", () => {
    const read = parsed(m => { m.frames[0].pieces[0].ownerSeat = 0; })();
    expect(read.frames[0]!.pieces[0]!.ownerSeat).toBe(0);
    for (const seat of [-1, 4, 1.5, "0", true]) {
      expect(parsed(m => { m.frames[0].pieces[0].ownerSeat = seat; })).toThrow(/ownerSeat/);
    }
  });
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

  it("reads a frame's shared hotspots, which a stand point may name in place of a piece", () => {
    const read = parsed((m) => {
      m.frames[0].hotspots = [{ id: "banner_pole", kind: "banner_pole", lane: "near", x: 0.84, default: "kept_crew_banner" }];
      m.frames[0].standPoints[0].hotspot = "banner_pole";
    })();
    expect(read.frames[0]!.hotspots).toEqual([{ id: "banner_pole", kind: "banner_pole", lane: "near", x: 0.84, default: "kept_crew_banner" }]);
    expect(read.frames[0]!.standPoints[0]!.hotspot).toBe("banner_pole");
    expect(parseCampManifest(campManifestFixture()).frames[0]!.hotspots).toBeUndefined();
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
    ["a hotspot naming no piece", (m) => (m.frames[0].standPoints[0].hotspot = "cookfire"), /names no piece or hotspot "cookfire"/],
    ["a hotspot off its lane", (m) => (m.frames[0].hotspots = [{ id: "awning", kind: "awning", lane: "back", x: 0.02 }]), /hotspots\[0\]\.x: is off the walkable span/],
    ["a hotspot sharing a piece's id", (m) => (m.frames[0].hotspots = [{ id: "campfire", kind: "cookfire", lane: "middle", x: 0.5 }]), /piece or hotspot "campfire" appears twice/],
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


describe("a crew past the frame art painted (docs/camp.md §12.3; #627)", () => {
  it("pitches the biggest frame painted, and an unknown terrain on open_plains", () => {
    // Only stages 1 and 2 painted, as before Phase 3's art: a stage-3 or stage-4 crew gets stage 2.
    const m = campManifestFixture() as Raw;
    const two = { ...JSON.parse(JSON.stringify(m.frames[0])), stage: 2 };
    m.frames = [m.frames[0], two];
    m.backdrops = [{ ...JSON.parse(JSON.stringify(m.backdrops[0])), family: "frozen_north" }, ...m.backdrops];
    const manifest = parseCampManifest(m);
    for (const stage of [3, 4, 9]) expect(campLayout(manifest, "open_plains", stage).frame.stage).toBe(2);
    expect(campLayout(manifest, "open_plains", 1).frame.stage).toBe(1);
    // A terrain with no backdrop yet stands on open_plains, wherever it is listed.
    expect(campLayout(manifest, "sky_islands", 3).backdrop.family).toBe("open_plains");
    expect(campLayout(manifest, "frozen_north", 3).backdrop.family).toBe("frozen_north");
  });
});
