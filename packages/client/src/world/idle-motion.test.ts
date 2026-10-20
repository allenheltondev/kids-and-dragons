import { expect, it } from "vitest";
import { idleBreath } from "./idle-motion";

it("keeps a breath subtle, repeats every six seconds, and offsets figures", () => {
  expect(idleBreath(0, 0)).toBe(0);
  expect(idleBreath(3, 0)).toBeCloseTo(0.008);
  expect(idleBreath(6, 0)).toBeCloseTo(0);
  expect(idleBreath(0, Math.PI)).toBeCloseTo(0.008);
});
it("returns to rest for reduced motion and downed figures", () => {
  expect(idleBreath(3, 0, true)).toBe(0);
});
