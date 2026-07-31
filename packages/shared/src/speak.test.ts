import { afterEach, describe, expect, it, vi } from "vitest";

import { getSpeaker, setSpeaker, speak } from "./speak.js";

afterEach(() => setSpeaker(null));

describe("speak (spec §11)", () => {
  it("is a no-op with no speaker installed — v1 behavior", () => {
    expect(getSpeaker()).toBeNull();
    expect(() => speak("The path ends at a wall of thorns.")).not.toThrow();
  });

  it("forwards text and options once a speaker is plugged in", () => {
    const spoken = vi.fn();
    setSpeaker(spoken);
    speak("Force through", { source: "choice" });
    expect(spoken).toHaveBeenCalledWith("Force through", { source: "choice" });
  });

  it("goes back to silence when the speaker is removed", () => {
    const spoken = vi.fn();
    setSpeaker(spoken);
    setSpeaker(null);
    speak("nothing to hear");
    expect(spoken).not.toHaveBeenCalled();
  });

  it("skips empty text", () => {
    const spoken = vi.fn();
    setSpeaker(spoken);
    speak("");
    expect(spoken).not.toHaveBeenCalled();
  });

  it("swallows a broken speaker — narration is flavor, never load-bearing", () => {
    setSpeaker(() => {
      throw new Error("TTS engine exploded");
    });
    expect(() => speak("the shrine glints in the moss")).not.toThrow();
  });
});
