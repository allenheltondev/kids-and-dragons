// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedDie } from "./AnimatedDie";
const { draw, material } = vi.hoisted(() => ({
  draw: vi.fn(),
  material: vi.fn(),
}));
vi.mock("./dice-renderer", () => ({
  createDieRenderer: () => ({ draw, material }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  draw.mockClear();
  material.mockReset();
  vi.stubGlobal("CanvasRenderingContext2D", class {});
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  document.documentElement.removeAttribute("data-motion");
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-motion");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("the dice animation lifecycle", () => {
  it("contains an asynchronous material-painting failure and keeps rendering", async () => {
    let finishLoading: () => void = () => {
      throw new Error("Image not requested");
    };
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_url: string) {
          finishLoading = () => this.onload?.();
        }
      },
    );
    material.mockImplementationOnce(() => {
      throw new Error("Canvas allocation failed");
    });
    const { container } = render(
      <AnimatedDie value={20} duration={1400} seed={1} landed={false} />,
    );
    await act(async () => {
      finishLoading();
      await Promise.resolve();
    });
    expect(material).toHaveBeenCalledOnce();
    expect(container.querySelector(".polyhedral-die--ready")).not.toBeNull();
    const before = draw.mock.calls.length;
    act(() => vi.advanceTimersByTime(80));
    expect(draw.mock.calls.length).toBeGreaterThan(before);
  });

  it("stops spending frames after landing, and can replay an identical roll", () => {
    const { rerender } = render(
      <AnimatedDie value={20} duration={1400} seed={1} landed={false} />,
    );
    act(() => vi.advanceTimersByTime(1500));
    const stopped = draw.mock.calls.length;
    expect(stopped).toBeGreaterThan(10);
    act(() => vi.advanceTimersByTime(3000));
    expect(draw).toHaveBeenCalledTimes(stopped);
    rerender(
      <AnimatedDie value={20} duration={1400} seed={2} landed={false} />,
    );
    act(() => vi.advanceTimersByTime(80));
    expect(draw.mock.calls.length).toBeGreaterThan(stopped);
  });
  it("draws a static final pose for reduced motion and schedules no animation", () => {
    document.documentElement.dataset.motion = "reduced";
    render(<AnimatedDie value={9} duration={1400} seed={1} landed />);
    const count = draw.mock.calls.length;
    act(() => vi.advanceTimersByTime(2000));
    expect(draw).toHaveBeenCalledTimes(count);
    expect(draw.mock.calls.at(-1)?.[0].rotate).toEqual([0, 0, 0]);
  });
  it("honours a reduced-motion setting changed during a throw", async () => {
    render(<AnimatedDie value={8} duration={1400} seed={1} landed={false} />);
    act(() => vi.advanceTimersByTime(100));
    await act(async () => {
      document.documentElement.dataset.motion = "reduced";
      await Promise.resolve();
    });
    const count = draw.mock.calls.length;
    act(() => vi.advanceTimersByTime(2000));
    expect(draw).toHaveBeenCalledTimes(count);
    expect(draw.mock.calls.at(-1)?.[0].rotate).toEqual([0, 0, 0]);
  });
  it("cancels frames when the roll is replaced or unmounted", () => {
    const { unmount } = render(
      <AnimatedDie value={4} duration={1400} seed={1} landed={false} />,
    );
    act(() => vi.advanceTimersByTime(100));
    unmount();
    const count = draw.mock.calls.length;
    act(() => vi.advanceTimersByTime(2000));
    expect(draw).toHaveBeenCalledTimes(count);
  });
});
