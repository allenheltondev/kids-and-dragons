import { describe, expect, it } from "vitest";
import {
  DICE_CONTACT_MS,
  dieMesh,
  dot,
  orient,
  throwPose,
} from "./dice-geometry";
import { ROLL_TUMBLE_MS } from "../world/presentation";

describe("real dice meshes", () => {
  it.each([4, 6, 8, 10, 20])(
    "builds a closed convex d%s with each value exactly once",
    (sides) => {
      const faces = dieMesh(sides);
      expect(faces).toHaveLength(sides);
      expect(faces.map((f) => f.value).sort((a, b) => a - b)).toEqual(
        Array.from({ length: sides }, (_, i) => i + 1),
      );
      const edges = new Map<string, number>();
      const key = (p: readonly number[]) =>
        p.map((v) => v.toFixed(5)).join(",");
      for (const f of faces) {
        expect(dot(f.center, f.normal)).toBeGreaterThan(0);
        for (let i = 0; i < f.vertices.length; i++) {
          const edge = [
            key(f.vertices[i]!),
            key(f.vertices[(i + 1) % f.vertices.length]!),
          ]
            .sort()
            .join("|");
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every((count) => count === 2)).toBe(true);
      if (sides === 10)
        expect(faces.every((f) => f.vertices.length === 4)).toBe(true);
      if (sides === 20)
        expect(faces.every((f) => f.vertices.length === 3)).toBe(true);
    },
  );
  it("uses opposite d20 faces that sum to 21", () => {
    for (const f of dieMesh()) {
      const opposite = dieMesh().find((o) => dot(f.normal, o.normal) < -0.999)!;
      expect(f.value + opposite.value).toBe(21);
    }
  });
  it.each([4, 6, 8, 10, 20])(
    "lands every d%s result facing the viewer with upright lettering",
    (sides) => {
      for (const f of dieMesh(sides)) {
        expect(orient(f.normal, f, throwPose(1))).toEqual([
          expect.closeTo(0, 8),
          expect.closeTo(0, 8),
          expect.closeTo(1, 8),
        ]);
        expect(orient(f.up, f, throwPose(1))[1]).toBeCloseTo(1, 8);
      }
    },
  );
});

describe("the controlled throw", () => {
  it("puts each bounce on the existing wooden soundtrack contact", () => {
    for (const time of DICE_CONTACT_MS)
      expect(throwPose(time / ROLL_TUMBLE_MS).lift).toBeCloseTo(0, 10);
    expect(throwPose(1).rotate).toEqual([0, 0, 0]);
    expect(throwPose(1).x).toBeCloseTo(0);
    expect(throwPose(1).lift).toBe(0);
  });
  it("keeps motion bounded, deterministic and continuous", () => {
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000,
        p = throwPose(t, 17),
        next = throwPose(t + 0.00001, 17);
      expect(p).toEqual(throwPose(t, 17));
      expect(p.lift).toBeGreaterThanOrEqual(0);
      expect(Math.abs(p.lift - next.lift)).toBeLessThan(0.001);
      expect(p.rotate.every(Number.isFinite)).toBe(true);
    }
  });
});
