/** The air over a camp (camp-air.ts): snow falls, embers rise, seeds drift across, and every painted backdrop moves somehow. */

import { describe, expect, it } from "vitest";
import { camp as campManifest } from "../../../../assets/manifest.json";
import { campAccent } from "./camp-accents";
import { campAir, campMotes, motePose } from "./camp-air";

const families = campManifest.backdrops.map((b: { family: string }) => b.family);

describe("the air over a camp", () => {
  it("gives every painted backdrop exactly one thing that moves: a painted accent, or drawn air", () => {
    for (const family of families) expect([campAccent(family), campAir(family)].filter(Boolean), family).toHaveLength(1);
  });

  it("draws the same motes for the same camp on every screen", () => {
    const air = campAir("frozen_north")!;
    expect(campMotes(air, 7)).toEqual(campMotes(air, 7));
    expect(campMotes(air, 7)).not.toEqual(campMotes(air, 8));
    for (const mote of campMotes(air, 7)) {
      expect(mote.size).toBeGreaterThanOrEqual(air.size[0]);
      expect(mote.size).toBeLessThanOrEqual(air.size[1]);
    }
  });

  it.each([
    ["frozen_north", "down"],
    ["red_sky_volcanic", "up"],
    ["open_plains", "across"],
  ] as const)("moves %s's motes %s, inside its band, fading in and out at its ends", (family, way) => {
    const air = campAir(family)!;
    const [mote] = campMotes(air, 3);
    const at = (t: number) => motePose(air, { ...mote!, phase: 0 }, t * mote!.period);
    const early = at(0.3);
    const later = at(0.6);
    if (way === "down") expect(later.y).toBeGreaterThan(early.y);
    if (way === "up") expect(later.y).toBeLessThan(early.y);
    if (way === "across") expect(later.x).toBeGreaterThan(early.x);
    for (let t = 0; t < 1; t += 0.05) {
      const pose = at(t);
      expect(pose.alpha).toBeGreaterThanOrEqual(0);
      expect(pose.alpha).toBeLessThanOrEqual(air.alpha);
      expect(pose.y).toBeGreaterThanOrEqual(air.top - air.sway);
      expect(pose.y).toBeLessThanOrEqual(air.bottom + air.sway);
    }
    // Nothing pops: faint at the very start and end of its crossing.
    expect(at(0).alpha).toBeCloseTo(0);
    expect(at(0.999).alpha).toBeLessThan(0.05);
  });
});
