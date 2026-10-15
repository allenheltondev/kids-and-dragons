import { describe, expect, it, vi } from "vitest";
import { readBreath } from "./rive-rig";

describe("readBreath", () => {
  it("frees the matrix the runtime hands back on every read", () => {
    const del = vi.fn();
    const body = { worldTransform: () => ({ yy: 1.018, delete: del }) };
    expect(readBreath(body)).toBeCloseTo(0.018);
    readBreath(body);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("frees it even when the reading is unusable", () => {
    const del = vi.fn();
    expect(readBreath({ worldTransform: () => ({ yy: Number.NaN, delete: del }) })).toBe(0);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("clamps a fall's rotated root rather than reporting it as breath", () => {
    expect(readBreath({ worldTransform: () => ({ yy: 0.2, delete: () => {} }) })).toBe(0);
    expect(readBreath({ worldTransform: () => ({ yy: 3, delete: () => {} }) })).toBe(0.05);
  });

  it("reports no breath when the runtime throws", () => {
    expect(
      readBreath({
        worldTransform: () => {
          throw new Error("freed");
        },
      }),
    ).toBe(0);
  });
});
