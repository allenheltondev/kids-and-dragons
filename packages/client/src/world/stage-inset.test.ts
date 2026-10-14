import { afterEach, describe, expect, it, vi } from "vitest";
import {
  onStageInset,
  setStageInsetBottom,
  stageInsetBottom,
  storyStageHeight,
} from "./stage-inset";

afterEach(() => setStageInsetBottom(0));

describe("stage inset", () => {
  it("tells listeners when the plate's height changes, and only then", () => {
    const heard = vi.fn();
    const stop = onStageInset(heard);
    setStageInsetBottom(300.4);
    setStageInsetBottom(300);
    setStageInsetBottom(-5);
    stop();
    setStageInsetBottom(120);
    expect(heard.mock.calls).toEqual([[300], [0]]);
    expect(stageInsetBottom()).toBe(120);
  });

  it("launders a measurement that is not a height", () => {
    setStageInsetBottom(Number.NaN);
    expect(stageInsetBottom()).toBe(0);
  });
});

describe("storyStageHeight", () => {
  it("frames the story above the plate", () => {
    expect(storyStageHeight(1920, 1080, 400)).toBe(680);
    expect(storyStageHeight(1920, 1080, 0)).toBe(1080);
  });

  it("keeps half a wide pane, however long the paragraph", () => {
    expect(storyStageHeight(1920, 1080, 900)).toBe(540);
  });

  it("lets a phone's plate take what a width-limited stage does not need", () => {
    // A 390-wide pane draws the 16:9 story 219px tall; the rest can be words.
    expect(storyStageHeight(390, 780, 600)).toBeCloseTo(390 * (9 / 16));
  });
});
