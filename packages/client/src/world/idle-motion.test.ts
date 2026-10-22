import { expect, it } from "vitest";
import { BREATH_STRETCH, idleBreath } from "./idle-motion";

it("breathes enough to see, repeats every four seconds, and offsets figures", () => {
  expect(idleBreath(0, 0)).toBe(0);
  expect(idleBreath(2, 0)).toBeCloseTo(BREATH_STRETCH);
  expect(idleBreath(4, 0)).toBeCloseTo(0);
  expect(idleBreath(0, Math.PI)).toBeCloseTo(BREATH_STRETCH);
  expect(BREATH_STRETCH).toBeGreaterThanOrEqual(0.02);
});
it("returns to rest for reduced motion and downed figures", () => {
  expect(idleBreath(3, 0, true)).toBe(0);
});
