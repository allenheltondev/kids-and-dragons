// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDieRenderer } from "./dice-renderer";
import { dieMesh, throwPose } from "./dice-geometry";

function context(drawImage = vi.fn()): CanvasRenderingContext2D {
  const properties: Record<string, unknown> = {
    drawImage,
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
  };
  return new Proxy(properties, {
    get(target, key: string) {
      return (target[key] ??= vi.fn());
    },
  }) as unknown as CanvasRenderingContext2D;
}
// Narrow the overloaded browser API to the context this renderer requests.
const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
  getContext(id: "2d"): CanvasRenderingContext2D | null;
};
afterEach(() => vi.restoreAllMocks());
describe("face texture allocation failure", () => {
  it("returns the static fallback when an initial face has no 2D context", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvasPrototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return this === canvas ? context() : null;
    });
    expect(createDieRenderer(canvas, dieMesh(), 20)).toBeNull();
  });
  it("retains every original face when a later material upgrade runs out of contexts", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 440;
    const drawImage = vi.fn();
    const main = context(drawImage),
      face = context();
    let remaining = Infinity;
    vi.spyOn(canvasPrototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      if (this === canvas) return main;
      return remaining-- > 0 ? face : null;
    });
    const renderer = createDieRenderer(canvas, dieMesh(), 20)!;
    renderer.draw(throwPose(1));
    const original = drawImage.mock.calls.map(([texture]) => texture);
    expect(original.length).toBeGreaterThan(0);
    remaining = 2;
    expect(() => renderer.material(new Image())).not.toThrow();
    drawImage.mockClear();
    renderer.draw(throwPose(1));
    expect(drawImage.mock.calls.map(([texture]) => texture)).toEqual(original);
  });
});
