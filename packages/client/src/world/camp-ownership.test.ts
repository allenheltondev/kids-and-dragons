import { expect, it } from "vitest";
import { campLayoutFixture } from "../testing/camp-fixture";
import { campOwnedScale, campPieceOwner } from "./camp-ownership";
import { campHeightPx, campMeasure } from "./camp-motion";

const measure = campMeasure(1080);
it.each([15, 85, 160, 215, 1000])("keeps owned kit proportional to its %s cm owner's displayed size", heightCm => {
  const base = campHeightPx(40, measure);
  const owned = base * campOwnedScale({ heightCm }, measure);
  expect(owned / campHeightPx(heightCm, measure)).toBeCloseTo(base / campHeightPx(160, measure));
  if (heightCm === 85) expect(owned).toBeLessThan(measure.floor!);
});
it("leaves unowned shared pieces at their authored size", () => {
  expect(campOwnedScale(undefined, measure)).toBe(1);
  expect(campPieceOwner(campLayoutFixture(), { id: "campfire", path: "", lane: "middle", x: .5 }, [{ seat: 0, heightCm: 85 }])).toBeUndefined();
});
it("assigns any owned piece by seat, independently of party order or a rest hotspot", () => {
  const layout = campLayoutFixture();
  const figures = [{ seat: 1, heightCm: 215 }, { seat: 0, heightCm: 85 }];
  expect(campPieceOwner(layout, { id: "travel_chest", path: "", lane: "near", x: .5, ownerSeat: 0 }, figures)).toBe(figures[1]);
  expect(campPieceOwner(layout, { id: "travel_chest", path: "", lane: "near", x: .5, ownerSeat: 1 }, figures)).toBe(figures[0]);
  expect(campPieceOwner(layout, { id: "travel_chest", path: "", lane: "near", x: .5, ownerSeat: 3 }, figures)).toBeUndefined();
  layout.frame.standPoints.find(p => p.seat === 0)!.hotspot = "old_bedroll";
  expect(campPieceOwner(layout, { id: "old_bedroll", path: "", lane: "back", x: .24 }, figures)).toBe(figures[1]);
});
