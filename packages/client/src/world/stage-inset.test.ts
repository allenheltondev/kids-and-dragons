import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SKY_FRACTION,
  STAGE_KEEP,
  onStageInset,
  onStageInsetTop,
  setStageInsetBottom,
  setStageInsetTop,
  stageInsetBottom,
  stageInsetTop,
  storyStageFrame,
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

describe("storyStageFrame (#356)", () => {
  it("leaves the frame alone while the head sits on the sky", () => {
    // A 720 pane with a 250 plate: 470 of stage, and its top 30% (141) is sky.
    expect(storyStageFrame(1280, 720, 250, 0)).toEqual({ top: 0, height: 470 });
    expect(storyStageFrame(1280, 720, 250, 140)).toEqual({ top: 0, height: 470 });
  });

  it("moves the frame down just enough that the head stays on its sky", () => {
    const frame = storyStageFrame(1280, 720, 250, 200);
    expect(frame.top + frame.height).toBe(470);
    // The new frame's sky reaches the head's bottom.
    expect(frame.top + SKY_FRACTION * frame.height).toBeCloseTo(200, 1);
  });

  it("leaves a narrow pane's frame alone: its story is width-limited and sits below sky of its own", () => {
    // A 390-wide phone pane: the 16:9 story is 219 tall, centred in a much taller frame.
    expect(storyStageFrame(390, 760, 200, 220)).toEqual({ top: 0, height: 560 });
  });

  it("never gives up more than a quarter of the stage, however tall the head", () => {
    const frame = storyStageFrame(1280, 720, 250, 600);
    expect(frame.height).toBeCloseTo(470 * STAGE_KEEP);
    expect(frame.top + frame.height).toBe(470);
  });

  it("tells listeners when the head's reach changes, and only then", () => {
    const heard = vi.fn();
    const stop = onStageInsetTop(heard);
    setStageInsetTop(120.2);
    setStageInsetTop(120);
    stop();
    setStageInsetTop(0);
    expect(heard.mock.calls).toEqual([[120]]);
    expect(stageInsetTop()).toBe(0);
  });
});
