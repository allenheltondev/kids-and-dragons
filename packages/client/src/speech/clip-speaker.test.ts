/**
 * The recorded voice in front of the device voice (docs/voice-narration-plan.md §7).
 *
 * The rule under test is the plan's: recorded voice is an upgrade, never a requirement. A line
 * whose every clip is there plays them, in order, through the engine's voice channel; a line
 * missing any of them (not in the manifest, a 404, no signal, bytes that will not decode, too
 * slow) is read by the device voice whole, and nothing ever stalls the queue behind it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipPath, manifestPath, type NarrationPart, type SpeakOptions, type VoiceManifest } from "@kad/shared";
import type { VoiceBuffer, VoiceChannel } from "../audio/cue";
import { createClipSpeaker, manifestOf, RESOLVE_MS, type FetchedLike } from "./clip-speaker";
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
function fakeChannel(options: { ready?: boolean; failDecode?: string } = {}) {
  const plays: { buffers: string[]; onEnd: () => void; stopped: boolean }[] = [];
  const channel: VoiceChannel = {
    ready: () => options.ready ?? true,
    decode: (bytes) => {
      const name = new TextDecoder().decode(bytes);
      if (name === options.failDecode) return Promise.reject(new Error("EncodingError"));
      return Promise.resolve({ duration: 0.5, name } as VoiceBuffer);
    },
    play: (buffers, onEnd) => {
      const play = { buffers: buffers.map((b) => (b as unknown as { name: string }).name), onEnd, stopped: false };
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
  const fetch = (url: string): Promise<FetchedLike> => {
    asked.push(url);
    const route = routes[url];
    if (route === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    if (route === "hang") return new Promise(() => undefined);
    return Promise.resolve(route ?? { ok: false, status: 404, json: () => Promise.reject(new Error("404")), arrayBuffer: () => Promise.reject(new Error("404")) });
  };
  return { fetch, asked };
}

const json = (body: unknown): FetchedLike => ({ ok: true, json: () => Promise.resolve(body), arrayBuffer: () => Promise.reject(new Error("not bytes")) });
const bytes = (key: string): FetchedLike => ({ ok: true, json: () => Promise.reject(new Error("not json")), arrayBuffer: () => Promise.resolve(new TextEncoder().encode(key).buffer as ArrayBuffer) });

function allThere(): Record<string, Route> {
  return { [manifestPath("ch")]: json(MANIFEST), [clipPath(A)]: bytes(A), [clipPath(B)]: bytes(B), [clipPath(C)]: bytes(C) };
}

function setup(routes: Record<string, Route> = allThere(), channelOptions: Parameters<typeof fakeChannel>[0] = {}) {
  const device = fakeDevice();
  const { channel, plays } = fakeChannel(channelOptions);
  const net = fakeFetch(routes);
  const speaking: boolean[] = [];
  let current: VoiceChannel | null = channel;
  const speaker = createClipSpeaker({
    device: device.device,
    channel: () => current,
    fetch: net.fetch,
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
    expect(t.net.asked.filter((url) => url === clipPath(B))).toHaveLength(2);
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

  it("when the clips are too slow: never later than RESOLVE_MS, and the line behind it follows", async () => {
    const routes = allThere();
    routes[clipPath(C)] = "hang";
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
    expect(t.plays).toHaveLength(1);
    expect(t.device.texts()).toEqual(["Last time, you met a goat."]);
    t.plays[0]!.onEnd();
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
    // Three clips of half a second each, then the grace.
    await vi.advanceTimersByTimeAsync(1500 + 2000);
    expect(t.plays[0]!.stopped).toBe(true);
    expect(t.device.texts()).toEqual(["Hero's turn."]);
  });
});
