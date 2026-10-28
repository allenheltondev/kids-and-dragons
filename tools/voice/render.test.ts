import { describe, expect, it, vi } from "vitest";
import type { DesiredSegment } from "./desired";
import { candidates, renderOwed, type RenderDeps } from "./render";
import { MemoryClipStore, StoreSet } from "./store";

const segment = (n: number, chars = 100): DesiredSegment => ({ key: String(n).padStart(64, "0"), by: "narrator", text: "x".repeat(chars) });
const owed = (count: number, chars = 100): DesiredSegment[] => Array.from({ length: count }, (_, i) => segment(i + 1, chars));

function deps(over: Partial<RenderDeps> = {}) {
  const synth = vi.fn(() => Promise.resolve(Buffer.from("wav")));
  const store = new MemoryClipStore();
  const made: RenderDeps = {
    synth,
    encode: () => ({ bytes: Buffer.from("webm"), ms: 1234 }),
    store,
    price: (chars) => chars / 100, // a dollar per hundred characters
    sleep: () => Promise.resolve(),
    ...over,
  };
  return { made, synth, store };
}

const live = { render: true, maxDollars: 75, backoffMs: 0 };

describe("rendering what is owed", () => {
  it("renders each distinct clip once and keeps it with its length", async () => {
    const { made, synth, store } = deps();
    const report = await renderOwed([...owed(3), segment(1)], made, live);
    expect(synth).toHaveBeenCalledTimes(3);
    expect(report.rendered).toHaveLength(3);
    expect(report.lengths.get(segment(2).key)).toBe(1234);
    expect(store.clips.size).toBe(3);
  });

  it("never renders a clip the store already has: that is the generation cache", async () => {
    const { made, synth } = deps();
    await renderOwed(owed(3), made, live);
    synth.mockClear();
    const again = await renderOwed(owed(3), made, live);
    expect(synth).not.toHaveBeenCalled();
    expect(again.cached).toHaveLength(3);
    expect(again.dollars).toBe(0);
    expect(again.lengths.get(segment(1).key)).toBe(1234);
  });

  it("spends nothing and calls nothing in a dry run, but still prices it", async () => {
    const { made, synth, store } = deps();
    const report = await renderOwed(owed(3), made, { ...live, render: false });
    expect(synth).not.toHaveBeenCalled();
    expect(store.clips.size).toBe(0);
    expect(report.planned).toHaveLength(3);
    expect(report.dollars).toBeCloseTo(3);
  });
});

describe("the spend cap", () => {
  it("stops before the request that would cross it, and says what is left", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(5), made, { ...live, maxDollars: 3.5, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(3);
    expect(report.stoppedBy).toBe("dollars");
    expect(report.dollars).toBeLessThanOrEqual(3.5);
    expect(report.deferred).toHaveLength(2);
  });

  it("cannot be overshot by workers running together", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(20), made, { ...live, maxDollars: 4.5, concurrency: 8 });
    expect(synth.mock.calls.length).toBeLessThanOrEqual(4);
    expect(report.dollars).toBeLessThanOrEqual(4.5);
    expect(report.rendered.length + report.deferred.length).toBe(20);
  });

  it("honours a character cap too", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(5), made, { ...live, maxChars: 250, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(2);
    expect(report.stoppedBy).toBe("chars");
  });

  it("does not charge a cached clip against the cap", async () => {
    const { made } = deps();
    await renderOwed(owed(3), made, live);
    const report = await renderOwed(owed(3), made, { ...live, maxDollars: 0 });
    expect(report.cached).toHaveLength(3);
    expect(report.stoppedBy).toBeNull();
  });
});

describe("when the provider fails", () => {
  it("retries, then succeeds", async () => {
    let calls = 0;
    const { made, store } = deps({
      synth: () => (++calls < 3 ? Promise.reject(new Error("HTTP 503")) : Promise.resolve(Buffer.from("wav"))),
    });
    const report = await renderOwed(owed(1), made, live);
    expect(calls).toBe(3);
    expect(report.rendered).toHaveLength(1);
    expect(store.clips.size).toBe(1);
  });

  it("gives up after its attempts and keeps nothing, but still counts every try as spend", async () => {
    const { made, store } = deps({ synth: () => Promise.reject(new Error("HTTP 400: bad voice")) });
    const report = await renderOwed(owed(2), made, { ...live, attempts: 2 });
    expect(report.failed).toEqual([
      { key: segment(1).key, error: "HTTP 400: bad voice" },
      { key: segment(2).key, error: "HTTP 400: bad voice" },
    ]);
    expect(store.clips.size).toBe(0);
    expect(report.lengths.size).toBe(0);
    // Two clips, two tries each, a dollar a try: a failed call may have been billed.
    expect(report.dollars).toBeCloseTo(4);
  });

  it("counts every retry against the cap: one clip's budget buys one call, not four", async () => {
    const synth = vi.fn(() => Promise.reject(new Error("HTTP 503")));
    const { made } = deps({ synth });
    const report = await renderOwed(owed(1), made, { ...live, maxDollars: 1, attempts: 4 });
    expect(synth).toHaveBeenCalledTimes(1);
    expect(report.dollars).toBeLessThanOrEqual(1);
    expect(report.stoppedBy).toBe("dollars");
    expect(report.failed[0]?.error).toMatch(/retry stopped by the spend cap/);
  });

  it("counts a try whose audio could not be kept: encode or upload failing is still a billed call", async () => {
    const encode = vi.fn(() => {
      throw new Error("ffmpeg failed");
    });
    const { made, synth } = deps({ encode });
    const report = await renderOwed(owed(1), made, { ...live, attempts: 3 });
    expect(synth).toHaveBeenCalledTimes(3);
    expect(report.dollars).toBeCloseTo(3);
    expect(report.rendered).toHaveLength(0);
  });
});

describe("the destination decides what is owed", () => {
  it("puts every wanted clip to the store, whatever any manifest says", () => {
    const wantedSegments = candidates([{ lines: [{ address: "a", chapter: "c", campaign: "k", variant: "", segments: [segment(1), segment(2)] }] }]);
    expect(wantedSegments.map((s) => s.key)).toEqual([segment(1).key, segment(2).key]);
  });

  it("filters by speaker and counts a shared clip once", () => {
    const pib = { ...segment(2), by: "pib#a" };
    const lines = [{ address: "a", chapter: "c", campaign: "k", variant: "", segments: [segment(1), pib] }, { address: "b", chapter: "c", campaign: "k", variant: "", segments: [pib] }];
    expect(candidates([{ lines }], "pib").map((s) => s.key)).toEqual([pib.key]);
    expect(candidates([{ lines }])).toHaveLength(2);
  });

  it("backfills a destination that lacks a clip another has: a new bucket is repaired, not trusted", async () => {
    const staging = new MemoryClipStore();
    const prod = new MemoryClipStore();
    await staging.put(segment(1).key, Buffer.from("webm"), { ms: 1234 });
    const { made, synth } = deps({ store: new StoreSet([staging, prod]) });
    const report = await renderOwed([segment(1)], made, live);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(prod.clips.has(segment(1).key)).toBe(true);
    expect(report.rendered).toHaveLength(1);
    // And a clip both have costs nothing.
    synth.mockClear();
    const again = await renderOwed([segment(1)], made, live);
    expect(synth).not.toHaveBeenCalled();
    expect(again.cached).toHaveLength(1);
  });
});

describe("measuring what the provider bills", () => {
  it("adds up reported audio tokens against the seconds of audio they bought", async () => {
    const { pcmToWav } = await import("./bakeoff/providers");
    // Two seconds of 24 kHz audio, billed as 60 tokens: 30 a second.
    const wav = pcmToWav(Buffer.alloc(24000 * 2 * 2), 24000);
    const { made } = deps({ synth: () => Promise.resolve({ wav, audioTokens: 60 }) });
    const report = await renderOwed(owed(2), made, live);
    expect(report.measured).toEqual({ audioTokens: 120, seconds: 4, clips: 2, tokensPerSecond: 30 });
  });

  it("measures nothing when the provider reports no tokens", async () => {
    const { made } = deps();
    const report = await renderOwed(owed(1), made, live);
    expect(report.measured.tokensPerSecond).toBeNull();
  });

  it("reads Gemini's usage report, preferring its audio tokens", async () => {
    const { audioTokensOf } = await import("./bakeoff/providers");
    expect(audioTokensOf({ candidatesTokenCount: 90, candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 80 }] })).toBe(80);
    expect(audioTokensOf({ candidatesTokenCount: 90 })).toBe(90);
    expect(audioTokensOf(undefined)).toBeUndefined();
  });

  it("knows the length of a WAV, and that other bytes are not one", async () => {
    const { pcmToWav } = await import("./bakeoff/providers");
    const { wavSeconds } = await import("./render");
    expect(wavSeconds(pcmToWav(Buffer.alloc(48000), 24000))).toBe(1);
    expect(wavSeconds(Buffer.from("not audio"))).toBeNull();
  });
});
