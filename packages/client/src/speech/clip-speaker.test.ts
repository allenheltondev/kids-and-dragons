/**
 * The recorded voice in front of the device voice (docs/voice-narration-plan.md §7).
 *
 * The rule under test is the plan's: recorded voice is an upgrade, never a requirement. A line
 * whose every clip is there plays them, in order, through the engine's voice channel; a line
 * missing any of them (not in the manifest, a 404, no signal, bytes that will not decode, too
 * slow) is read by the device voice whole, and nothing ever stalls the queue behind it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipPath, manifestPath, type NarrationPart, type SpeakOptions, type Speaker, type VoiceManifest } from "@kad/shared";
import type { VoiceBuffer, VoiceChannel } from "../audio/cue";
import { VOICE_GAP_MS } from "../audio/cue";
import { createClipSpeaker, firstClipsAhead, HELD_DECODES, manifestOf, PREFETCH_CONCURRENCY, RESOLVE_MS, whileSeen, type ClipPrefetchOptions, type FetchedLike } from "./clip-speaker";
import { createSynthSpeaker, type DeviceVoice } from "./synth-speaker";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const MANIFEST: VoiceManifest = {
  "ch/s1/narration": { "": [{ clip: A, ms: 1000 }, { clip: B, ms: 500 }] },
  "ch/s1/variants/0": { "party=3": [{ clip: C, ms: 800 }] },
  "ch/s2/narration": { "": [{ clip: B, ms: 500 }] },
};

const S1: NarrationPart[] = [
  { address: "ch/s1/narration", line: "The gate creaks." },
  { address: "ch/s1/variants/0", line: "{party} step through.", token: { party: "3" } },
];

/** A device voice that records what it was told, and finishes a line only when the test says. */
function fakeDevice() {
  const said: { text: string; opts: SpeakOptions | undefined }[] = [];
  const pending: (() => void)[] = [];
  let cancels = 0;
  const device = ((text: string, opts?: SpeakOptions) => void said.push({ text, opts })) as DeviceVoice;
  device.sayThen = (text, opts, done) => {
    said.push({ text, opts });
    pending.push(done);
  };
  device.cancel = () => {
    cancels += 1;
  };
  return {
    device,
    said,
    texts: () => said.map((s) => s.text),
    /** Ends the oldest line still being said. */
    finish: () => pending.shift()?.(),
    cancels: () => cancels,
  };
}

/** The engine's voice channel: decodes a clip's bytes into a buffer named after them, and plays on request. */
function fakeChannel(options: { ready?: boolean; failDecode?: string; detach?: boolean } = {}) {
  const plays: { buffers: string[]; onEnd: () => void; stopped: boolean }[] = [];
  const channel: VoiceChannel = {
    ready: () => options.ready ?? true,
    decode: (bytes) => {
      // A real decodeAudioData takes the buffer it is given: a second decode of it finds it empty.
      if (options.detach && bytes.byteLength === 0) return Promise.reject(new Error("detached"));
      const name = new TextDecoder().decode(bytes);
      if (options.detach) structuredClone(bytes, { transfer: [bytes] });
      if (name === options.failDecode) return Promise.reject(new Error("EncodingError"));
      return Promise.resolve({ duration: 0.5, name } as VoiceBuffer);
    },
    play: (clips, onEnd) => {
      // Clips may still be on their way: each is named here as it arrives, in play order.
      const play = { buffers: [] as string[], onEnd, stopped: false };
      void (async () => {
        for (const clip of clips) {
          try {
            play.buffers.push(((await clip) as unknown as { name: string }).name);
          } catch {
            return;
          }
        }
      })();
      plays.push(play);
      return () => {
        play.stopped = true;
      };
    },
  };
  return { channel, plays };
}

type Route = FetchedLike | "offline" | "hang";

/** A fetch over a table of URLs: a clip's body is its key, so the decode above can name it. */
function fakeFetch(routes: Record<string, Route>) {
  const asked: string[] = [];
  const inits: Record<string, unknown> = {};
  const fetch = (url: string, init?: { priority?: "low" }): Promise<FetchedLike> => {
    asked.push(url);
    inits[url] = init;
    const route = routes[url];
    if (route === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    if (route === "hang") return new Promise(() => undefined);
    return Promise.resolve(route ?? { ok: false, status: 404, json: () => Promise.reject(new Error("404")), arrayBuffer: () => Promise.reject(new Error("404")) });
  };
  return { fetch, asked, inits };
}

const json = (body: unknown): FetchedLike => ({ ok: true, json: () => Promise.resolve(body), arrayBuffer: () => Promise.reject(new Error("not bytes")) });
const bytes = (key: string): FetchedLike => ({ ok: true, json: () => Promise.reject(new Error("not json")), arrayBuffer: () => Promise.resolve(new TextEncoder().encode(key).buffer as ArrayBuffer) });

function allThere(): Record<string, Route> {
  return { [manifestPath("ch")]: json(MANIFEST), [clipPath(A)]: bytes(A), [clipPath(B)]: bytes(B), [clipPath(C)]: bytes(C) };
}

function setup(
  routes: Record<string, Route> = allThere(),
  channelOptions: Parameters<typeof fakeChannel>[0] = {},
  saveData = false,
) {
  const device = fakeDevice();
  const { channel, plays } = fakeChannel(channelOptions);
  const net = fakeFetch(routes);
  const speaking: boolean[] = [];
  let current: VoiceChannel | null = channel;
  const speaker = createClipSpeaker({
    device: device.device,
    channel: () => current,
    fetch: net.fetch,
    saveData: () => saveData,
    onSpeaking: (on) => speaking.push(on),
  });
  return { speaker, device, plays, net, speaking, unplug: () => void (current = null) };
}

/** Lets every resolved promise in the chain run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("manifestOf", () => {
  it("files a chapter's line under the chapter", () => {
    expect(manifestOf("bramblewood-01/scene_pib/narration")).toBe("bramblewood-01");
    expect(manifestOf("bramblewood-01/@goal")).toBe("bramblewood-01");
    expect(manifestOf(undefined)).toBeNull();
    expect(manifestOf("@help/x")).toBeNull();
  });

  it("files a campaign's prologue, epilogue and \"Last time\" under the campaign, and the help sheet under help", () => {
    expect(manifestOf("gemfall/@prologue/0")).toBe("_gemfall");
    expect(manifestOf("gemfall/@epilogue/cure/2")).toBe("_gemfall");
    expect(manifestOf("gemfall/@lastTime/opener")).toBe("_gemfall");
    expect(manifestOf("help/surfaces/story")).toBe("_help");
    expect(manifestOf("help/howToPlay/3")).toBe("_help");
    // A chapter's own plate and goal stay in the chapter's manifest.
    expect(manifestOf("gemfall-01/@plate")).toBe("gemfall-01");
  });
});

describe("lines outside a chapter", () => {
  it("fetches the campaign's manifest for a prologue plate and plays its clips", async () => {
    const t = setup({
      [manifestPath("_ch")]: json({ "ch/@prologue/0": { "": [{ clip: A, ms: 900 }] } }),
      [clipPath(A)]: bytes(A),
    });
    t.speaker("The road begins.", { source: "narration", parts: [{ address: "ch/@prologue/0", line: "The road begins." }] });
    await settle();
    expect(t.net.asked).toEqual([manifestPath("_ch"), clipPath(A)]);
    expect(t.plays.map((p) => p.buffers)).toEqual([[A]]);
    expect(t.device.said).toEqual([]);
  });

  it("fetches the help manifest for a help line", async () => {
    const t = setup({
      [manifestPath("_help")]: json({ "help/surfaces/story": { "": [{ clip: B, ms: 700 }] } }),
      [clipPath(B)]: bytes(B),
    });
    t.speaker("This is the story.", { source: "ui", parts: [{ address: "help/surfaces/story", line: "This is the story." }] });
    await settle();
    expect(t.net.asked).toEqual([manifestPath("_help"), clipPath(B)]);
    expect(t.plays.map((p) => p.buffers)).toEqual([[B]]);
  });
});

/** A chapter of three scenes: the second has a variant and a branch, and a choice label no recording plays. */
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const AHEAD: VoiceManifest = {
  "ch/@goal": { "": [{ clip: F, ms: 600 }] },
  "ch/s1/narration": { "": [{ clip: A, ms: 1000 }] },
  "ch/s2/narration": { "": [{ clip: B, ms: 500 }] },
  "ch/s2/variants/0": { "party=3": [{ clip: C, ms: 800 }] },
  "ch/s2/onSuccess/narration": { "": [{ clip: D, ms: 700 }] },
  "ch/s2/go/label": { "": [{ clip: E, ms: 300 }] },
  "ch/s3/narration": { "": [{ clip: E, ms: 400 }] },
};
function aheadRoutes(): Record<string, Route> {
  return {
    [manifestPath("ch")]: json(AHEAD),
    ...Object.fromEntries([A, B, C, D, E, F].map((key) => [clipPath(key), bytes(key)])),
  };
}

describe("prefetch: the clips for lines not yet spoken", () => {
  it("fetches the narration, variants and branches under a scene, low priority, and not a choice label", async () => {
    const t = setup(aheadRoutes());
    t.speaker.prefetch?.(["ch/s2/"]);
    await settle();
    expect(t.net.asked).toEqual([manifestPath("ch"), clipPath(B), clipPath(C), clipPath(D)]);
    for (const key of [B, C, D]) expect(t.net.inits[clipPath(key)]).toEqual({ priority: "low" });
    expect(t.plays).toEqual([]);
    expect(t.device.said).toEqual([]);
  });

  it("plays a line from what was prefetched without fetching its clips again", async () => {
    const t = setup(aheadRoutes());
    t.speaker.prefetch?.(["ch/s1/"]);
    await settle();
    const before = t.net.asked.length;
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    expect(t.net.asked).toHaveLength(before);
    expect(t.plays.map((p) => p.buffers)).toEqual([[A]]);
  });

  it("decodes a clip afresh every time it plays, since decoding takes the bytes it is given", async () => {
    const t = setup(aheadRoutes(), { detach: true });
    t.speaker.prefetch?.(["ch/s1/"]);
    await settle();
    const line = { source: "narration" as const, parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] };
    t.speaker("The gate creaks.", line);
    await settle();
    t.plays[0]!.onEnd();
    t.speaker("The gate creaks.", line);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS);
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[A], [A]]);
    expect(t.device.said).toEqual([]);
  });

  it("fetches the nearer scenes ahead of the rest of the chapter, once it asked for both", async () => {
    const t = setup(aheadRoutes());
    t.speaker.prefetch?.(["ch/"], { background: true });
    t.speaker.prefetch?.(["ch/s3/"]);
    await settle();
    const clips = t.net.asked.filter((url) => url !== manifestPath("ch"));
    // The background request may have filled its slots before the near one was known; after
    // that the near scene's clip goes before any other background clip still waiting.
    expect(clips.indexOf(clipPath(E))).toBeLessThanOrEqual(PREFETCH_CONCURRENCY);
    expect(clips.indexOf(clipPath(E))).toBeLessThan(clips.indexOf(clipPath(D)));
    expect(clips).toHaveLength(6);
    expect(new Set(clips).size).toBe(6);
  });

  it("holds back while a line the table is waiting on is still getting its own clips", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const routes = aheadRoutes();
    routes[clipPath(A)] = {
      ok: true,
      json: () => Promise.reject(new Error("not json")),
      arrayBuffer: () => held.then(() => new TextEncoder().encode(A).buffer as ArrayBuffer),
    };
    const t = setup(routes);
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    t.speaker.prefetch?.(["ch/s2/"]);
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    // Only the manifest and the spoken line's clip: the prefetch waits its turn.
    expect(t.net.asked).toEqual([manifestPath("ch"), clipPath(A)]);
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(t.net.asked.slice(2)).toEqual([clipPath(B), clipPath(C), clipPath(D)]);
  });

  it("fetches nothing for a device that asked to save data, and still plays lines", async () => {
    const t = setup(aheadRoutes(), {}, true);
    t.speaker.prefetch?.(["ch/s1/"]);
    await settle();
    expect(t.net.asked).toEqual([]);
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[A]]);
  });

  it("asks again for a clip whose prefetch failed, when its line is spoken", async () => {
    const routes = aheadRoutes();
    routes[clipPath(A)] = "offline";
    const t = setup(routes);
    t.speaker.prefetch?.(["ch/s1/"]);
    await settle();
    routes[clipPath(A)] = bytes(A);
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    expect(t.net.asked.filter((url) => url === clipPath(A))).toHaveLength(2);
    expect(t.plays.map((p) => p.buffers)).toEqual([[A]]);
  });

  it("retires what is queued when told to, without touching the line being spoken or the clip on its way", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const routes = aheadRoutes();
    for (const key of [F, B, C, D]) {
      routes[clipPath(key)] = {
        ok: true,
        json: () => Promise.reject(new Error("not json")),
        arrayBuffer: () => held.then(() => new TextEncoder().encode(key).buffer as ArrayBuffer),
      };
    }
    const t = setup(routes);
    // A line is playing from its own clips, and the whole chapter is queued behind it.
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[A]]);
    t.speaker.prefetch?.(["ch/"], { background: true });
    await settle();
    // The first few clips of the chapter are on their way (and held there); the rest are queued behind them.
    const started = t.net.asked.filter((url) => url !== manifestPath("ch"));
    expect(started).toEqual([clipPath(A), clipPath(F), clipPath(B), clipPath(C), clipPath(D)]);
    t.speaker.stopPrefetch?.();
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    // Nothing more was fetched (not s3's E), and the playing line neither stopped nor fell back to the device voice.
    expect(t.net.asked.filter((url) => url !== manifestPath("ch"))).toEqual(started);
    expect(t.plays[0]!.stopped).toBe(false);
    expect(t.device.said).toEqual([]);
    expect(t.device.cancels()).toBe(0);
  });

  it("drops a request that was still working out what to fetch when it was retired", async () => {
    const t = setup(aheadRoutes());
    t.speaker.prefetch?.(["ch/s1/"]);
    t.speaker.stopPrefetch?.();
    await settle();
    expect(t.net.asked.filter((url) => url !== manifestPath("ch"))).toEqual([]);
    // And the speaker still prefetches for whoever asks next.
    t.speaker.prefetch?.(["ch/s1/"]);
    await settle();
    expect(t.net.asked.filter((url) => url !== manifestPath("ch"))).toEqual([clipPath(A)]);
  });

  it("does nothing for a chapter with no manifest", async () => {
    const t = setup({});
    expect(() => t.speaker.prefetch?.(["ch/s1/"])).not.toThrow();
    await settle();
    expect(t.net.asked).toEqual([manifestPath("ch")]);
  });
});

describe("a recorded line", () => {
  it("resolves every part through the chapter's manifest and plays the clips in order", async () => {
    const t = setup();
    t.speaker("The gate creaks. All three of you step through.", { source: "narration", parts: S1 });
    await settle();
    expect(t.net.asked).toEqual([manifestPath("ch"), clipPath(A), clipPath(B), clipPath(C)]);
    expect(t.plays.map((p) => p.buffers)).toEqual([[A, B, C]]);
    expect(t.device.said).toEqual([]);
  });

  it("fetches a chapter's manifest once, and a clip a line repeats once", async () => {
    const t = setup();
    t.speaker("One.", { parts: [{ address: "ch/s2/narration", line: "One." }, { address: "ch/s2/narration", line: "One." }] });
    await settle();
    expect(t.plays[0]!.buffers).toEqual([B, B]);
    t.plays[0]!.onEnd();
    t.speaker("Again.", { parts: S1 });
    await settle();
    expect(t.net.asked.filter((url) => url === manifestPath("ch"))).toHaveLength(1);
    // Kept in memory: the second line's use of B is not a second download.
    expect(t.net.asked.filter((url) => url === clipPath(B))).toHaveLength(1);
  });

  it("marks the panel as speaking while it plays, and not after", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    await settle();
    expect(t.speaking).toEqual([true]);
    t.plays[0]!.onEnd();
    expect(t.speaking).toEqual([true, false]);
  });

  it("leaves a line without parts to the device voice, at once", () => {
    const t = setup();
    t.speaker("Hero's turn.", { source: "prompt" });
    expect(t.device.texts()).toEqual(["Hero's turn."]);
    expect(t.net.asked).toEqual([]);
    // What the device voice is told: the speaker's options, never the parts or the interrupt it already handled.
    t.speaker("Next.", { source: "narration", interrupt: true, parts: [] });
    expect(t.device.said[1]!.opts).toEqual({ source: "narration" });
  });
});

describe("all or nothing: the device voice reads the whole line", () => {
  const text = "The gate creaks. All three of you step through.";

  it("when one part is not in the manifest", async () => {
    const t = setup();
    t.speaker(text, { parts: [S1[0]!, { address: "ch/s1/variants/0", line: "x", token: { party: "4" } }] });
    await settle();
    expect(t.plays).toEqual([]);
    expect(t.device.texts()).toEqual([text]);
    expect(t.net.asked).toEqual([manifestPath("ch")]);
  });

  it("when a part was composed at run time (no address)", async () => {
    const t = setup();
    t.speaker(text, { parts: [S1[0]!, { line: "You find 3 coins." }] });
    await settle();
    expect(t.device.texts()).toEqual([text]);
    expect(t.net.asked).toEqual([]);
  });

  it("when the chapter has no manifest (404)", async () => {
    const routes = allThere();
    delete routes[manifestPath("ch")];
    const t = setup(routes);
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.device.texts()).toEqual([text]);
  });

  it("when one clip is a 404", async () => {
    const routes = allThere();
    delete routes[clipPath(C)];
    const t = setup(routes);
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.plays).toEqual([]);
    expect(t.device.texts()).toEqual([text]);
  });

  it("when the manifest answers 503, and asks for it again next time; a 404 is asked once", async () => {
    const busy: FetchedLike = { ok: false, status: 503, json: () => Promise.reject(new Error("503")), arrayBuffer: () => Promise.reject(new Error("503")) };
    const routes = allThere();
    routes[manifestPath("ch")] = busy;
    const t = setup(routes);
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.device.texts()).toEqual([text]);
    t.device.finish();
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.net.asked.filter((url) => url === manifestPath("ch"))).toHaveLength(2);

    const gone = allThere();
    delete gone[manifestPath("ch")];
    const u = setup(gone);
    u.speaker(text, { parts: S1 });
    await settle();
    u.device.finish();
    u.speaker(text, { parts: S1 });
    await settle();
    expect(u.net.asked.filter((url) => url === manifestPath("ch"))).toHaveLength(1);
  });

  it("when there is no signal, and asks for the manifest again next time", async () => {
    const routes = allThere();
    routes[manifestPath("ch")] = "offline";
    const t = setup(routes);
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.device.texts()).toEqual([text]);
    t.device.finish();
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.net.asked.filter((url) => url === manifestPath("ch"))).toHaveLength(2);
  });

  it("when a clip will not decode", async () => {
    const t = setup(allThere(), { failDecode: B });
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.plays).toEqual([]);
    expect(t.device.texts()).toEqual([text]);
  });

  it("when no engine is running (no gesture yet, or a phone with no sound)", async () => {
    const t = setup(allThere(), { ready: false });
    t.speaker(text, { parts: S1 });
    await settle();
    expect(t.device.texts()).toEqual([text]);
    const u = setup();
    u.unplug();
    u.speaker(text, { parts: S1 });
    await settle();
    expect(u.device.texts()).toEqual([text]);
  });

  it("when the first clip is too slow: never later than RESOLVE_MS, and the line behind it follows", async () => {
    const routes = allThere();
    routes[clipPath(A)] = "hang";
    const t = setup(routes);
    t.speaker(text, { parts: S1 });
    t.speaker("Hero's turn.");
    await settle();
    expect(t.device.texts()).toEqual([]);
    await vi.advanceTimersByTimeAsync(RESOLVE_MS);
    expect(t.plays).toEqual([]);
    // Both, in order: the device voice took the slow line, and the next was handed straight on.
    expect(t.device.texts()).toEqual([text, "Hero's turn."]);
  });
});

describe("speak()'s queue and interrupt rules", () => {
  it("a recorded line waits for the device line ahead of it, and the device line behind waits for it", async () => {
    const t = setup();
    t.speaker("Last time, you met a goat.", { source: "narration", interrupt: true });
    t.speaker("The gate creaks.", { source: "narration", parts: S1 });
    t.speaker("Tap the glowing card.", { source: "ui" });
    await settle();
    expect(t.device.texts()).toEqual(["Last time, you met a goat."]);
    expect(t.plays).toEqual([]);
    t.device.finish();
    await settle();
    // A breath between the device's line and the recording.
    expect(t.plays).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS);
    expect(t.plays).toHaveLength(1);
    expect(t.device.texts()).toEqual(["Last time, you met a goat."]);
    t.plays[0]!.onEnd();
    expect(t.device.texts()).toEqual(["Last time, you met a goat."]);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS);
    expect(t.device.texts()).toEqual(["Last time, you met a goat.", "Tap the glowing card."]);
  });

  it("device lines in a row go straight to the browser's own queue, as they always did", () => {
    const t = setup();
    t.speaker("One.");
    t.speaker("Two.");
    t.speaker("Three.");
    expect(t.device.texts()).toEqual(["One.", "Two.", "Three."]);
  });

  it("an interrupt mid-playlist stops the clips, restores the room, and says the new line", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    t.speaker("Queued behind it.");
    await settle();
    const first = t.plays[0]!;
    t.speaker("A new scene.", { interrupt: true, parts: [{ address: "ch/s2/narration", line: "A new scene." }] });
    expect(first.stopped).toBe(true);
    expect(t.device.cancels()).toBe(1);
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[A, B, C], [B]]);
    // The old playlist ending late changes nothing; the queued line went with the interrupt.
    first.onEnd();
    expect(t.device.said).toEqual([]);
    expect(t.plays).toHaveLength(2);
  });

  it("an interrupt while a recorded line is still loading drops it for good", async () => {
    const routes = allThere();
    routes[clipPath(C)] = "hang";
    const t = setup(routes);
    t.speaker("Slow.", { parts: S1 });
    t.speaker("Now.", { interrupt: true });
    await vi.advanceTimersByTimeAsync(RESOLVE_MS * 2);
    expect(t.device.texts()).toEqual(["Now."]);
    expect(t.plays).toEqual([]);
  });

  it("cancel stops everything and the speaking mark goes out", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    await settle();
    t.speaker.cancel!();
    expect(t.plays[0]!.stopped).toBe(true);
    expect(t.speaking).toEqual([true, false]);
  });

  it("a line with nothing recorded follows a device line at once, though that line never says it ended", async () => {
    // The browser's own queue keeps the order; waiting for an "ended" some browsers never send
    // would hold the story back for the watchdog's length (the preface e2e on #593).
    const { speaker, device } = setup({});
    speaker("Here we go! The hedge is listening.");
    speaker("Your goal: find the door.", { parts: [{ address: "ch/s1/narration", line: "Your goal: find the door." }] });
    speaker("A wall of thorns.");
    await settle();
    expect(device.texts()).toEqual(["Here we go! The hedge is listening.", "Your goal: find the door.", "A wall of thorns."]);
  });

  it("a device line whose first piece fails holds the recorded line until its last piece is said", async () => {
    // The real device voice over a browser queue that lets the test end or fail each piece.
    const queue: { text: string; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }[] = [];
    const device = createSynthSpeaker({
      synth: {
        speak: (u: SpeechSynthesisUtterance) => void queue.push(u as unknown as (typeof queue)[number]),
        cancel: () => void (queue.length = 0),
        getVoices: () => [],
      } as unknown as SpeechSynthesis,
      createUtterance: (t) => ({ text: t, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
    });
    const { channel, plays } = fakeChannel();
    const net = fakeFetch(allThere());
    const speaker = createClipSpeaker({ device, channel: () => channel, fetch: net.fetch });
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${String(i)} is here and goes on a while.`).join(" ");
    speaker(long);
    speaker("The gate creaks. All three of you step through.", { parts: S1 });
    await settle();
    const pieces = [...queue];
    expect(pieces.length).toBeGreaterThan(2);
    pieces[0]!.onerror?.({ error: "synthesis-failed" });
    await settle();
    expect(plays).toEqual([]);
    for (const piece of pieces.slice(1)) piece.onend?.();
    await settle();
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS);
    await settle();
    expect(plays.map((p) => p.buffers)).toEqual([[A, B, C]]);
  });

  it("a device line that never says it ended holds a recorded one only so long", async () => {
    const t = setup();
    t.speaker("Hi.");
    t.speaker("The gate creaks.", { parts: S1 });
    await settle();
    expect(t.plays).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(t.plays).toHaveLength(1);
  });

  it("a playlist that never says it ended does not hold the table", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    t.speaker("Hero's turn.");
    await settle();
    // The manifest's 2.3 s of clips and the two breaths between them, then the grace and the
    // allowance for a clip late mid-line.
    await vi.advanceTimersByTimeAsync(2300 + 2 * VOICE_GAP_MS + 2000 + RESOLVE_MS - 10);
    expect(t.plays[0]!.stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.plays[0]!.stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS);
    expect(t.device.texts()).toEqual(["Hero's turn."]);
  });
});

describe("narration only while the page is seen (whileSeen)", () => {
  function page(): { doc: Document; win: Window; show: (state: "hidden" | "visible") => void } {
    let state: "hidden" | "visible" = "visible";
    const doc = new EventTarget() as unknown as Document;
    Object.defineProperty(doc, "visibilityState", { get: () => state });
    const win = new EventTarget() as unknown as Window;
    return {
      doc,
      win,
      show(next) {
        state = next;
        doc.dispatchEvent(new Event("visibilitychange"));
      },
    };
  }
  function inner(): { speaker: Speaker; said: string[]; cancels: () => number } {
    const said: string[] = [];
    let cancelled = 0;
    const speaker = ((text: string) => {
      said.push(text);
    }) as Speaker;
    speaker.cancel = () => {
      cancelled += 1;
    };
    return { speaker, said, cancels: () => cancelled };
  }

  it("cancels on hide, and drops a line that arrives after the hide", () => {
    const { doc, win, show } = page();
    const { speaker, said, cancels } = inner();
    const speak = whileSeen(speaker, doc, win);
    speak("You reach the bridge.");
    show("hidden");
    expect(cancels()).toBe(1);
    // A new scene lands while the app is in the background: nothing is said or queued.
    speak("A troll steps out.");
    expect(said).toEqual(["You reach the bridge."]);
    show("visible");
    speak("Welcome back.");
    expect(said).toEqual(["You reach the bridge.", "Welcome back."]);
  });

  it("is silent from pagehide until pageshow, even while visibility still says visible", () => {
    const { doc, win } = page();
    const { speaker, said, cancels } = inner();
    const speak = whileSeen(speaker, doc, win);
    win.dispatchEvent(new Event("pagehide"));
    expect(cancels()).toBe(1);
    speak("Still there?");
    expect(said).toEqual([]);
    win.dispatchEvent(new Event("pageshow"));
    speak("Here again.");
    expect(said).toEqual(["Here again."]);
  });

  it("asks for clips only while the page is seen", () => {
    const { doc, win, show } = page();
    const asked: string[][] = [];
    const speaker = (() => undefined) as unknown as Speaker;
    speaker.prefetch = (prefixes) => void asked.push([...prefixes]);
    const seen = whileSeen(speaker, doc, win);
    seen.prefetch?.(["ch/s1/"]);
    show("hidden");
    seen.prefetch?.(["ch/s2/"]);
    show("visible");
    seen.prefetch?.(["ch/s3/"]);
    expect(asked).toEqual([["ch/s1/"], ["ch/s3/"]]);
  });

  it("retires the guessing ahead when the page is hidden or left, and says nothing of it while it is seen", () => {
    const { doc, win, show } = page();
    const speaker = (() => undefined) as unknown as Speaker;
    let stops = 0;
    speaker.stopPrefetch = () => void (stops += 1);
    whileSeen(speaker, doc, win);
    show("visible");
    expect(stops).toBe(0);
    show("hidden");
    expect(stops).toBe(1);
    show("visible");
    win.dispatchEvent(new Event("pagehide"));
    expect(stops).toBe(2);
  });

  it("passes cancel through", () => {
    const { doc, win } = page();
    const { speaker, cancels } = inner();
    whileSeen(speaker, doc, win).cancel?.();
    expect(cancels()).toBe(1);
  });
});

describe("a breath between clips, and no waiting for the whole line (playtest)", () => {
  /** A clip whose bytes arrive only when the test says. */
  function heldClip(key: string): { route: FetchedLike; release: () => void } {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    return {
      route: { ok: true, json: () => Promise.reject(new Error("not json")), arrayBuffer: () => held.then(() => new TextEncoder().encode(key).buffer as ArrayBuffer) },
      release: () => release(),
    };
  }

  it("starts a line on its first clip while a later one is still on its way", async () => {
    const routes = allThere();
    const late = heldClip(C);
    routes[clipPath(C)] = late.route;
    const t = setup(routes);
    t.speaker("The gate creaks. All three of you step through.", { parts: S1 });
    await settle();
    expect(t.plays).toHaveLength(1);
    expect(t.plays[0]!.buffers).toEqual([A, B]);
    late.release();
    await settle();
    expect(t.plays[0]!.buffers).toEqual([A, B, C]);
    expect(t.device.said).toEqual([]);
  });

  it("fetches a long line's clips in play order, a few ahead of the one playing", async () => {
    const keys = ["1", "2", "3", "4", "5"].map((d) => d.repeat(64));
    const held = keys.map(heldClip);
    const routes: Record<string, Route> = {
      [manifestPath("ch")]: json({ "ch/s9/narration": { "": keys.map((clip) => ({ clip, ms: 500 })) } }),
      ...Object.fromEntries(keys.map((key, i) => [clipPath(key), held[i]!.route])),
    };
    const t = setup(routes);
    t.speaker("Long.", { parts: [{ address: "ch/s9/narration", line: "Long." }] });
    await settle();
    expect(t.net.asked.slice(1)).toEqual(keys.slice(0, 3).map(clipPath));
    held[0]!.release();
    await settle();
    expect(t.net.asked.slice(1)).toEqual(keys.slice(0, 4).map(clipPath));
    expect(t.plays).toHaveLength(1);
  });

  it("pauses between one recorded line and the next, and not after the last", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    t.speaker("One.", { parts: [{ address: "ch/s2/narration", line: "One." }] });
    await settle();
    expect(t.plays).toHaveLength(1);
    t.plays[0]!.onEnd();
    await settle();
    expect(t.plays).toHaveLength(1);
    // Still saying the scene: the pause between two lines is part of it.
    expect(t.speaking).toEqual([true]);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS - 1);
    expect(t.plays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(t.plays).toHaveLength(2);
    t.plays[1]!.onEnd();
    // Nothing behind it: the speaking mark goes out at once.
    expect(t.speaking).toEqual([true, false]);
  });

  it("an interrupt during the pause drops it: the new scene's line starts at once", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    t.speaker("Queued.");
    await settle();
    t.plays[0]!.onEnd();
    t.speaker("A new scene.", { interrupt: true, parts: [{ address: "ch/s2/narration", line: "A new scene." }] });
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[A, B, C], [B]]);
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS * 2);
    expect(t.device.said).toEqual([]);
  });

  it("a stop during the pause leaves nothing to start after it", async () => {
    const t = setup();
    t.speaker("The gate creaks.", { parts: S1 });
    t.speaker("Behind it.");
    await settle();
    t.plays[0]!.onEnd();
    t.speaker.cancel!();
    await vi.advanceTimersByTimeAsync(VOICE_GAP_MS * 2);
    expect(t.device.said).toEqual([]);
    expect(t.speaking.at(-1)).toBe(false);
  });
});

describe("prefetch: aggressive, and bounded", () => {
  it("fetches a few clips at once, no more", async () => {
    const t = setup({ ...aheadRoutes(), ...Object.fromEntries([A, B, C, D, E, F].map((key) => [clipPath(key), "hang" as const])) });
    t.speaker.prefetch?.(["ch/"], { background: true });
    await settle();
    expect(t.net.asked.filter((url) => url !== manifestPath("ch"))).toHaveLength(PREFETCH_CONCURRENCY);
  });

  it("fetches one at a time while a playing line still waits on its own later clips", async () => {
    const routes = { ...aheadRoutes(), [clipPath(C)]: "hang" as const, [clipPath(D)]: "hang" as const, [clipPath(E)]: "hang" as const, [clipPath(F)]: "hang" as const };
    const t = setup(routes);
    t.speaker("The gate creaks. All three of you step through.", { parts: [{ address: "ch/s1/narration", line: "x" }, { address: "ch/s2/variants/0", line: "y", token: { party: "3" } }] });
    await settle();
    expect(t.plays).toHaveLength(1);
    const before = t.net.asked.length;
    t.speaker.prefetch?.(["ch/"], { background: true });
    await settle();
    expect(t.net.asked.length - before).toBe(1);
  });

  it("fetches the scenes in the order asked, the party's own scene first", async () => {
    const t = setup(aheadRoutes());
    t.speaker.prefetch?.(["ch/s3/", "ch/s1/"]);
    await settle();
    expect(t.net.asked.slice(1)).toEqual([clipPath(E), clipPath(A)]);
  });

  it("a new scene's request goes ahead of the guesses made from the last one", async () => {
    const routes = { ...aheadRoutes(), ...Object.fromEntries([A, B, C, D, E, F].map((key) => [clipPath(key), "hang" as const])) };
    const t = setup(routes);
    // A line is waiting on its first clip, so nothing is prefetched yet.
    t.speaker("Slow.", { parts: [{ address: "ch/@goal", line: "Slow." }] });
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"]);
    t.speaker.prefetch?.(["ch/s3/"]);
    await settle();
    await vi.advanceTimersByTimeAsync(RESOLVE_MS);
    await settle();
    // The goal's own clip, then the newest request's, then what was asked before it.
    expect(t.net.asked.slice(1)).toEqual([clipPath(F), clipPath(E), clipPath(A), clipPath(B), clipPath(C)]);
  });
});

describe("decoding ahead: the first clip of each line one step ahead", () => {
  /** The scene the party is in (s1) leads to s2; s2 is a check whose branch line is D. */
  const NEXT = { decodeAhead: { here: "ch/s1/", next: ["ch/s2/"] } } as ClipPrefetchOptions;
  const S2_LINE = { source: "narration" as const, parts: [{ address: "ch/s2/narration", line: "The bridge sways." }] };

  /** The setup above with a channel that counts decodes by name, and a switch for whether it runs. */
  function counted(saveData = false) {
    let running = true;
    const { channel, plays } = fakeChannel();
    const decodes: string[] = [];
    const counting: VoiceChannel = {
      ready: () => running,
      decode: (bytes) => {
        decodes.push(new TextDecoder().decode(bytes));
        return channel.decode(bytes);
      },
      play: channel.play,
    };
    const device = fakeDevice();
    const net = fakeFetch(aheadRoutes());
    const speaker = createClipSpeaker({ device: device.device, channel: () => counting, fetch: net.fetch, saveData: () => saveData });
    return { speaker, plays, decodes, device, net, stopRunning: () => void (running = false), startRunning: () => void (running = true) };
  }

  it("picks the branch lines of the scene the party is in and the narration of the scenes ahead, not their variants", () => {
    expect(firstClipsAhead({ here: "ch/s2/", next: ["ch/s3/"] }, [AHEAD])).toEqual([D, E]);
    expect(firstClipsAhead({ next: ["ch/s1/", "ch/s2/"] }, [AHEAD])).toEqual([A, B]);
  });

  it("starts a line whose first clip was decoded ahead without decoding it again", async () => {
    const t = counted();
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    expect(t.decodes).toEqual([B]);
    t.speaker("The bridge sways.", S2_LINE);
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[B]]);
    expect(t.decodes).toEqual([B]);
  });

  it("decodes only first clips: a line's later clips still decode while it plays", async () => {
    const t = counted();
    t.speaker.prefetch?.(["ch/s2/"], { decodeAhead: { next: ["ch/s2/"] } } as ClipPrefetchOptions);
    await settle();
    // s2's narration, never its variant (C), which only follows the narration in a line.
    expect(t.decodes).toEqual([B]);
  });

  it("lets go of what it held when the scene changes, keeping what is still one step ahead", async () => {
    const t = counted();
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    // The party is now in s2: s3 is the step ahead, and s2's own narration is no longer held.
    t.speaker.prefetch?.(["ch/s2/", "ch/s3/"], { decodeAhead: { here: "ch/s2/", next: ["ch/s3/"] } } as ClipPrefetchOptions);
    await settle();
    expect(t.decodes).toEqual([B, D, E]);
    // Kept a moment for the line the new scene says as it arrives, then gone.
    await vi.advanceTimersByTimeAsync(RESOLVE_MS);
    t.speaker("The bridge sways.", S2_LINE);
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[B]]);
    expect(t.decodes).toEqual([B, D, E, B]);
  });

  it("the new scene's own line can still take the clip it held a moment ago", async () => {
    const t = counted();
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    t.speaker.prefetch?.(["ch/s2/", "ch/s3/"], { decodeAhead: { here: "ch/s2/", next: ["ch/s3/"] } } as ClipPrefetchOptions);
    t.speaker("The bridge sways.", S2_LINE);
    await settle();
    expect(t.plays.map((p) => p.buffers)).toEqual([[B]]);
    expect(t.decodes.filter((name) => name === B)).toHaveLength(1);
  });

  it("lets go of everything when the guessing ahead is retired", async () => {
    const t = counted();
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    t.speaker.stopPrefetch?.();
    t.speaker("The bridge sways.", S2_LINE);
    await settle();
    expect(t.decodes).toEqual([B, B]);
  });

  it("decodes nothing until the engine is running, and nothing is made or resumed for it", async () => {
    const t = counted();
    t.stopRunning();
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    expect(t.net.asked).toContain(clipPath(B));
    expect(t.decodes).toEqual([]);
  });

  it("decodes nothing under Data Saver", async () => {
    const t = counted(true);
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    expect(t.decodes).toEqual([]);
  });

  it("decodes nothing while the page is hidden, and lets go of what it held when hidden", async () => {
    let state: "hidden" | "visible" = "visible";
    const doc = new EventTarget() as unknown as Document;
    Object.defineProperty(doc, "visibilityState", { get: () => state });
    const win = new EventTarget() as unknown as Window;
    const t = counted();
    const seen = whileSeen(t.speaker, doc, win);
    seen.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    expect(t.decodes).toEqual([B]);
    state = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    seen.prefetch?.(["ch/s2/", "ch/s3/"], { decodeAhead: { here: "ch/s2/", next: ["ch/s3/"] } } as ClipPrefetchOptions);
    await settle();
    expect(t.decodes).toEqual([B]);
    // Seen again: the line decodes its own first clip, since nothing was held for a hidden page.
    state = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    seen("The bridge sways.", S2_LINE);
    await settle();
    expect(t.decodes).toEqual([B, B]);
  });

  it("never decodes ahead while a line is being said, and catches up once it ends", async () => {
    const t = counted();
    t.speaker("The gate creaks.", { source: "narration", parts: [{ address: "ch/s1/narration", line: "The gate creaks." }] });
    await settle();
    expect(t.plays).toHaveLength(1);
    t.speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    // B's bytes are here, but the line playing has the decoder to itself.
    expect(t.net.asked).toContain(clipPath(B));
    expect(t.decodes).toEqual([A]);
    t.plays[0]!.onEnd();
    await settle();
    expect(t.decodes).toEqual([A, B]);
  });

  it("a line asked for while its first clip is still decoding ahead starts no later, from that decode", async () => {
    let finish: (buffer: VoiceBuffer) => void = () => undefined;
    const decodes: string[] = [];
    const { channel, plays } = fakeChannel();
    const slow: VoiceChannel = {
      ready: () => true,
      decode: (bytes) => {
        decodes.push(new TextDecoder().decode(bytes));
        return new Promise((resolve) => (finish = resolve));
      },
      play: channel.play,
    };
    const device = fakeDevice();
    const speaker = createClipSpeaker({ device: device.device, channel: () => slow, fetch: fakeFetch(aheadRoutes()).fetch });
    speaker.prefetch?.(["ch/s1/", "ch/s2/"], NEXT);
    await settle();
    expect(decodes).toEqual([B]);
    speaker("The bridge sways.", S2_LINE);
    await settle();
    // No second decode was queued behind the first: the line waits only on the one under way.
    expect(decodes).toEqual([B]);
    finish({ duration: 0.5, name: B } as unknown as VoiceBuffer);
    await settle();
    expect(plays.map((p) => p.buffers)).toEqual([[B]]);
    expect(device.said).toEqual([]);
  });

  it("holds at most HELD_DECODES first clips, nearest first", () => {
    const many: VoiceManifest = Object.fromEntries(
      Array.from({ length: HELD_DECODES + 5 }, (_, i) => [`ch/n${i}/narration`, { "": [{ clip: String(i).padStart(64, "0"), ms: 100 }] }]),
    );
    const next = Array.from({ length: HELD_DECODES + 5 }, (_, i) => `ch/n${i}/`);
    const keys = firstClipsAhead({ next }, [many]);
    expect(keys).toHaveLength(HELD_DECODES);
    expect(keys[0]).toBe("0".padStart(64, "0"));
  });
});
