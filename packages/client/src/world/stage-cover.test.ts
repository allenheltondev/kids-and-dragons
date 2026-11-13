import { describe, expect, it, vi } from "vitest";
import { coverStage, onStageCover, stageCovered } from "./stage-cover";

describe("stage cover", () => {
  it("stays covered until every cover is lifted, and a release counts once", () => {
    const heard = vi.fn();
    const stop = onStageCover(heard);
    const first = coverStage();
    const second = coverStage();
    expect(stageCovered()).toBe(true);
    first();
    first();
    expect(stageCovered()).toBe(true);
    second();
    expect(stageCovered()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
    coverStage()();
    expect(heard).toHaveBeenCalledTimes(4);
  });
});
