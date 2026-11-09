import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DesiredSegment } from "./desired";
import { missingEncoders } from "./encode";
import { candidates, dirRawAudio, RAW_AUDIO_DIR, renderOwed, type RawAudio, type RenderDeps } from "./render";
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

  it("reserves what the provider bills (the words and their tags), not the words alone", async () => {
    const { made } = deps({ billedChars: (s) => s.text.length + 30 });
    const report = await renderOwed(owed(2, 100), made, { ...live, maxChars: 259 });
    expect(report.chars).toBe(130);
    expect(report.rendered).toHaveLength(1);
    expect(report.stoppedBy).toBe("chars");
    expect(report.deferred).toHaveLength(1);
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

  it("never asks again for audio it was given: an encode that fails keeps the audio and stops the run", async () => {
    const encode = vi.fn(() => {
      throw new Error("ffmpeg failed: spawnSync ffmpeg ENOENT");
    });
    const raw = memoryRaw();
    const { made, synth } = deps({ encode, raw });
    const report = await renderOwed(owed(5), made, { ...live, attempts: 3, concurrency: 1 });
    // One billed call for the first clip, none for the rest: the machine cannot encode, so nothing more is bought.
    expect(synth).toHaveBeenCalledTimes(1);
    expect(report.dollars).toBeCloseTo(1);
    expect(report.failed).toEqual([{ key: segment(1).key, error: "ffmpeg failed: spawnSync ffmpeg ENOENT" }]);
    expect(report.stoppedBy).toBe("local");
    expect(report.deferred).toHaveLength(4);
    expect(raw.get(segment(1).key)).toEqual({ audio: Buffer.from("wav"), ext: "wav" });
  });

  it("stops on a failed upload the same way", async () => {
    const raw = memoryRaw();
    const { made, synth, store } = deps({ raw });
    vi.spyOn(store, "put").mockRejectedValue(new Error("AccessDenied"));
    const report = await renderOwed(owed(3), made, { ...live, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(1);
    expect(report.stoppedBy).toBe("local");
    expect(raw.get(segment(1).key)).not.toBeNull();
  });

  it("encodes audio a failed run already paid for without asking the provider again, then lets it go", async () => {
    const raw = memoryRaw();
    raw.put(segment(1).key, Buffer.from("paid"), "mp3");
    const encode = vi.fn(() => ({ bytes: Buffer.from("webm"), ms: 900 }));
    const { made, synth } = deps({ raw, encode });
    const report = await renderOwed(owed(2), made, live);
    expect(synth).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(Buffer.from("paid"), "mp3");
    expect(report.chars).toBe(100);
    expect(report.rendered).toHaveLength(2);
    expect(raw.get(segment(1).key)).toBeNull();
  });
});

describe("keeping audio that was paid for", () => {
  it("saves it before encoding, so a process killed mid-encode loses nothing, and lets it go once stored", async () => {
    const raw = memoryRaw();
    const savedWhenEncoding: boolean[] = [];
    const encode = vi.fn(() => {
      savedWhenEncoding.push(raw.get(segment(1).key) !== null);
      return { bytes: Buffer.from("webm"), ms: 900 };
    });
    const { made } = deps({ raw, encode });
    const report = await renderOwed(owed(1), made, live);
    expect(savedWhenEncoding).toEqual([true]);
    expect(report.rendered).toHaveLength(1);
    expect(raw.get(segment(1).key)).toBeNull();
  });

  it("never asks the provider again when saving the audio fails: that is this machine, and the run stops", async () => {
    const raw = { ...memoryRaw(), put: () => { throw new Error("ENOSPC"); } };
    const { made, synth } = deps({ raw });
    const report = await renderOwed(owed(3), made, { ...live, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(1);
    expect(report.failed).toEqual([{ key: segment(1).key, error: "ENOSPC" }]);
    expect(report.stoppedBy).toBe("local");
  });

  it("keeps it outside test-results/, which Playwright empties on every run, in a folder git ignores", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    expect(path.relative(path.join(root, "test-results"), RAW_AUDIO_DIR).startsWith("..")).toBe(true);
    for (const config of ["playwright.config.ts", "playwright.prod.config.ts"]) {
      const file = path.join(root, config);
      if (!fs.existsSync(file)) continue;
      // An outputDir would move Playwright's emptied folder; if one is ever set, it must not hold the raw audio either.
      const outputDir = /outputDir:\s*["'`]([^"'`]+)["'`]/.exec(fs.readFileSync(file, "utf8"))?.[1];
      if (outputDir !== undefined) expect(path.relative(path.resolve(root, outputDir), RAW_AUDIO_DIR).startsWith("..")).toBe(true);
    }
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/)).toContain(`${path.relative(root, RAW_AUDIO_DIR)}/`);
  });

  it("survives a reread from its folder: what one run kept, the next finds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-voice-raw-"));
    dirRawAudio(dir).put("abc", Buffer.from("paid"), "mp3");
    expect(dirRawAudio(dir).get("abc")).toEqual({ audio: Buffer.from("paid"), ext: "mp3" });
    dirRawAudio(dir).drop("abc");
    expect(dirRawAudio(dir).get("abc")).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function memoryRaw(): RawAudio {
  const kept = new Map<string, { audio: Buffer; ext: "wav" | "mp3" }>();
  return { get: (key) => kept.get(key) ?? null, put: (key, audio, ext) => void kept.set(key, { audio, ext }), drop: (key) => void kept.delete(key) };
}

describe("before a paid render", () => {
  it("names the encoders this machine cannot run", () => {
    expect(missingEncoders(() => {})).toEqual([]);
    expect(missingEncoders((program) => {
      if (program === "ffmpeg") throw new Error("ENOENT");
    })).toEqual(["ffmpeg"]);
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
    const { made } = deps({ synth: () => Promise.resolve({ audio: wav, ext: "wav" as const, audioTokens: 60 }) });
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
