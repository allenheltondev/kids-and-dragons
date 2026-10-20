// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LAST_FIT, fitPlate, unfitPlate } from "./fit-plate";

/** A plate whose content is as tall as `heights[rung]` at each rung of the ladder, in a box `room` tall. */
function plateOf(heights: number[], room: number): HTMLElement {
  const plate = document.createElement("div");
  Object.defineProperty(plate, "clientHeight", { value: room });
  Object.defineProperty(plate, "scrollHeight", {
    get: () => (plate.hasAttribute("data-clipped") ? room : heights[Number(plate.dataset.fit)] ?? heights[heights.length - 1]),
  });
  return plate;
}

describe("fitPlate (#331)", () => {
  it("keeps the sofa size when everything fits", () => {
    const plate = plateOf([300, 280, 260, 240, 220, 200, 180], 360);
    fitPlate(plate);
    expect(plate.dataset.fit).toBe("0");
    expect(plate.hasAttribute("data-clipped")).toBe(false);
  });

  it("steps down to the first rung that holds the choices", () => {
    const plate = plateOf([500, 430, 380, 350, 330, 300, 280], 360);
    fitPlate(plate);
    expect(plate.dataset.fit).toBe("3");
    expect(plate.hasAttribute("data-clipped")).toBe(false);
  });

  it("lets only the story scroll once the last rung is not enough", () => {
    const plate = plateOf([900, 800, 700, 600, 500, 450, 420], 360);
    fitPlate(plate);
    expect(plate.dataset.fit).toBe(String(LAST_FIT));
    expect(plate.hasAttribute("data-clipped")).toBe(true);
  });

  it("starts over for the next scene rather than staying small", () => {
    const plate = plateOf([300, 280], 360);
    plate.dataset.fit = "5";
    plate.setAttribute("data-clipped", "");
    fitPlate(plate);
    expect(plate.dataset.fit).toBe("0");
    expect(plate.hasAttribute("data-clipped")).toBe(false);
  });

  it("is put back to the natural size for a fight", () => {
    const plate = plateOf([900], 360);
    fitPlate(plate);
    unfitPlate(plate);
    expect(plate.hasAttribute("data-fit")).toBe(false);
    expect(plate.hasAttribute("data-clipped")).toBe(false);
  });
});
