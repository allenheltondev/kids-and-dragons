import { describe, expect, it } from "vitest";
import { figureOfArt, motionProps, stanceOfArt } from "./guide-motion";

describe("the guide's pictures", () => {
  it("find their figure in the art's path", () => {
    expect(figureOfArt("/assets/entities/will_o_wisp/portrait.webp")).toBe("entities/will_o_wisp");
    expect(figureOfArt("/assets/characters/unicorn/fledgling/assembled.png")).toBe("characters/unicorn");
    expect(figureOfArt("/assets/world/map.webp")).toBeNull();
    expect(figureOfArt(undefined)).toBeNull();
  });

  it("move by the stance canon gives the figure, standing when it says nothing", () => {
    expect(stanceOfArt("/assets/entities/will_o_wisp/portrait.webp")).toBe("hovering");
    expect(stanceOfArt("/assets/entities/embermoth/portrait.webp")).toBe("flying");
    expect(stanceOfArt("/assets/entities/merfolk/portrait.webp")).toBe("swimming");
    expect(stanceOfArt("/assets/entities/frogfolk/portrait.webp")).toBe("standing");
    expect(stanceOfArt("/assets/entities/nobody_known/portrait.webp")).toBe("standing");
    expect(stanceOfArt(undefined)).toBe("standing");
  });

  it("start each picture at its own point in the motion, the same one every time", () => {
    const a = motionProps("/assets/entities/frogfolk/portrait.webp", "npc.frogfolk");
    const b = motionProps("/assets/entities/frogfolk/portrait.webp", "npc.frogfolk");
    const c = motionProps("/assets/entities/mosshorn/portrait.webp", "creature.mosshorn");
    expect(a).toEqual(b);
    expect(a.style).not.toEqual(c.style);
  });
});
