import { afterEach, describe, expect, it, vi } from "vitest";

import { getSpeaker, prefetchNarration, resetPrefetchRequests, setSpeaker, speak, stopSpeaking, type Speaker } from "./speak.js";

afterEach(() => {
  setSpeaker(null);
  resetPrefetchRequests();
});

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

describe("cancelling", () => {
  it("stopSpeaking asks the installed speaker to stop, and is silent without one", () => {
    expect(() => stopSpeaking()).not.toThrow();
    const cancel = vi.fn();
    setSpeaker(Object.assign(vi.fn(), { cancel }));
    stopSpeaking();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cuts the old speaker off when it is replaced or removed", () => {
    const cancel = vi.fn();
    setSpeaker(Object.assign(vi.fn(), { cancel }));
    setSpeaker(null);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("never lets a broken cancel throw", () => {
    setSpeaker(Object.assign(vi.fn(), { cancel: () => { throw new Error("boom"); } }));
    expect(() => stopSpeaking()).not.toThrow();
  });
});

describe("prefetchNarration", () => {
  const withPrefetch = (): { speaker: Speaker; asked: [readonly string[], unknown][] } => {
    const asked: [readonly string[], unknown][] = [];
    const speaker = (() => undefined) as unknown as Speaker;
    speaker.prefetch = (prefixes, opts) => void asked.push([prefixes, opts]);
    return { speaker, asked };
  };

  it("is a no-op with no speaker, and for a speaker that records nothing to fetch", () => {
    expect(() => prefetchNarration(["ch/s1/"])).not.toThrow();
    setSpeaker(() => undefined);
    expect(() => prefetchNarration(["ch/s1/"])).not.toThrow();
  });

  it("hands the speaker the prefixes and options", () => {
    const { speaker, asked } = withPrefetch();
    setSpeaker(speaker);
    prefetchNarration(["ch/s1/", "ch/s2/"], { background: true });
    prefetchNarration([]);
    expect(asked).toEqual([[["ch/s1/", "ch/s2/"], { background: true }]]);
  });

  it("makes a request that came before the speaker, once the speaker is installed", () => {
    prefetchNarration(["ch/s1/"]);
    prefetchNarration(["ch/"], { background: true });
    const { speaker, asked } = withPrefetch();
    setSpeaker(speaker);
    expect(asked).toEqual([[["ch/s1/"], undefined], [["ch/"], { background: true }]]);
  });

  it("never lets a failing speaker reach the scene", () => {
    const speaker = (() => undefined) as unknown as Speaker;
    speaker.prefetch = () => {
      throw new Error("no");
    };
    setSpeaker(speaker);
    expect(() => prefetchNarration(["ch/s1/"])).not.toThrow();
  });
});
