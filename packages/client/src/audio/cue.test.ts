/**
 * The sound seam — the same contract speak() proved: uninstalled means
 * silent, and a broken sink can never take down the scene it was
 * underscoring. These tests are the contract, because everything else in the
 * audio system leans on "cue() is always safe to call".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cue, getAudioSink, music, setAudioSink, type AudioSink } from "./cue";

afterEach(() => {
  setAudioSink(null);
});

function fakeSink(): AudioSink & { cues: string[]; biomes: (string | null)[] } {
  const cues: string[] = [];
  const biomes: (string | null)[] = [];
  return {
    cues,
    biomes,
    cue(id) {
      cues.push(id);
    },
    music(biome) {
      biomes.push(biome);
    },
  };
}

describe("the seam", () => {
  it("does nothing with no sink installed", () => {
    // The default state — every phone, every test, jsdom. Must not throw.
    expect(() => {
      cue("dice");
      music("forest");
    }).not.toThrow();
  });

  it("routes to the installed sink", () => {
    const sink = fakeSink();
    setAudioSink(sink);
    cue("dice");
    music("forest");
    music(null);
    expect(sink.cues).toEqual(["dice"]);
    expect(sink.biomes).toEqual(["forest", null]);
  });

  it("treats a null cue as a decision, not a call", () => {
    // cueForPresentation returns null for visual-only beats; the call site
    // passes it straight through rather than branching.
    const sink = fakeSink();
    setAudioSink(sink);
    cue(null);
    expect(sink.cues).toEqual([]);
  });

  it("swallows a sink that throws", () => {
    // Flavor, never load-bearing: an audio bug must not break a turn.
    setAudioSink({
      cue: () => {
        throw new Error("no speakers");
      },
      music: () => {
        throw new Error("no speakers");
      },
    });
    expect(() => {
      cue("tap");
      music("forest");
    }).not.toThrow();
  });

  it("uninstalls back to silence", () => {
    const sink = fakeSink();
    setAudioSink(sink);
    setAudioSink(null);
    cue("tap");
    expect(sink.cues).toEqual([]);
    expect(getAudioSink()).toBeNull();
  });

  it("exposes the current sink for the control that owns it", () => {
    const sink = fakeSink();
    setAudioSink(sink);
    expect(getAudioSink()).toBe(sink);
  });
});

describe("keeping vi honest", () => {
  it("has no timers or globals in play", () => {
    // The seam is a module-level variable and two guarded calls — pinning
    // that it stays synchronous, because a cue that waits is a cue that
    // plays after its moment.
    const sink = fakeSink();
    setAudioSink(sink);
    vi.useFakeTimers();
    try {
      cue("tap");
      expect(sink.cues).toEqual(["tap"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
