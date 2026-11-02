import { describe, expect, it } from "vitest";
import { createSynthSpeaker, sentencePieces } from "./synth-speaker";

/** A SpeechSynthesis that records what it is told and lets a test finish or refuse lines. */
class FakeSynth {
  queue: FakeUtterance[] = [];
  spoken: string[] = [];
  cancels = 0;
  voices: SpeechSynthesisVoice[] = [];
  speak(u: SpeechSynthesisUtterance): void {
    this.queue.push(u as unknown as FakeUtterance);
    this.spoken.push(u.text);
  }
  cancel(): void {
    this.cancels += 1;
    this.queue = [];
  }
  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }
}
class FakeUtterance {
  rate = 1;
  lang = "";
  voice: unknown = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor(public text: string) {}
}

function setup() {
  const synth = new FakeSynth();
  const listeners = new Map<string, () => void>();
  const gestureTarget = {
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => void listeners.set(type, fn as () => void),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
  const speaker = createSynthSpeaker({
    synth,
    createUtterance: (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
    gestureTarget,
  });
  return { synth, speaker, listeners };
}

describe("sentencePieces", () => {
  it("keeps a short line whole and splits a long one at sentence ends", () => {
    expect(sentencePieces("The gate creaks.  It opens!")).toEqual(["The gate creaks. It opens!"]);
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${String(i)} is here and goes on a while.`).join(" ");
    const pieces = sentencePieces(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length <= 180)).toBe(true);
    expect(pieces.join(" ")).toBe(long);
  });
});

describe("sentencePieces on long text", () => {
  it("splits a long sentence with no punctuation at word boundaries", () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${String(i)}`).join(" ");
    const pieces = sentencePieces(text);
    expect(text.length).toBeGreaterThan(400);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => p.length > 0 && p.length <= 180)).toBe(true);
    expect(pieces.join(" ")).toBe(text);
  });

  it("hard-splits a single token longer than a piece, and keeps every piece within the limit", () => {
    const text = `Hear ${"a".repeat(400)} now. ${"b".repeat(50)}`;
    const pieces = sentencePieces(text);
    expect(pieces.every((p) => p.length <= 180)).toBe(true);
    expect(pieces.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
  });
});

describe("createSynthSpeaker", () => {
  it("speaks at a gentle rate in US English", () => {
    const { synth, speaker } = setup();
    speaker("Hello there.");
    expect(synth.spoken).toEqual(["Hello there."]);
    const u = synth.queue[0]!;
    expect(u.lang).toBe("en-US");
    expect(u.rate).toBeLessThan(1);
  });

  it("queues behind the current line by default and cancels first when interrupting", () => {
    const { synth, speaker } = setup();
    speaker("One.");
    speaker("Two.");
    expect(synth.cancels).toBe(0);
    expect(synth.queue).toHaveLength(2);
    speaker("Three.", { interrupt: true });
    expect(synth.cancels).toBe(1);
    expect(synth.queue.map((u) => u.text)).toEqual(["Three."]);
  });

  it("cancel() silences everything", () => {
    const { synth, speaker } = setup();
    speaker("One.");
    speaker.cancel?.();
    expect(synth.queue).toEqual([]);
  });

  it("uses the requested voice and rate when it exists", () => {
    const { synth, speaker } = setup();
    const voice = { name: "Kindly", voiceURI: "kindly" } as SpeechSynthesisVoice;
    synth.voices = [voice];
    speaker("Hi.", { voice: "kindly", rate: 1.1 });
    expect(synth.queue[0]!.voice).toBe(voice);
    expect(synth.queue[0]!.rate).toBe(1.1);
  });

  it("holds a line the browser refused and says it on the first tap", () => {
    const { synth, speaker, listeners } = setup();
    speaker("Before any tap.");
    synth.queue[0]!.onerror?.({ error: "not-allowed" });
    expect([...listeners.keys()].sort()).toEqual(["keydown", "pointerdown"]);
    synth.spoken.length = 0;
    listeners.get("pointerdown")?.();
    expect(synth.spoken).toEqual(["Before any tap."]);
    expect(listeners.size).toBe(0);
  });

  it("drops a refused line that was cancelled before the tap", () => {
    const { synth, speaker, listeners } = setup();
    speaker("Refused.");
    synth.queue[0]!.onerror?.({ error: "not-allowed" });
    speaker.cancel?.();
    synth.spoken.length = 0;
    listeners.get("keydown")?.();
    expect(synth.spoken).toEqual([]);
  });
});

describe("sayThen: hearing that a line is over (for clip-speaker.ts)", () => {
  const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${String(i)} is here and goes on a while.`).join(" ");

  it("calls done once, when the last piece ends", () => {
    const { synth, speaker } = setup();
    let done = 0;
    speaker.sayThen(long, undefined, () => { done += 1; });
    expect(synth.queue.length).toBeGreaterThan(1);
    synth.queue[0]!.onend?.();
    expect(done).toBe(0);
    synth.queue.at(-1)!.onend?.();
    synth.queue.at(-1)!.onend?.();
    expect(done).toBe(1);
  });

  it("a piece that fails early does not end the line while later pieces are still queued", () => {
    const { synth, speaker } = setup();
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${String(i)} is here and goes on a while.`).join(" ");
    let done = 0;
    speaker.sayThen(long, undefined, () => { done += 1; });
    const pieces = [...synth.queue];
    expect(pieces.length).toBeGreaterThan(2);
    pieces[0]!.onerror?.({ error: "synthesis-failed" });
    expect(done).toBe(0);
    for (const piece of pieces.slice(1, -1)) piece.onend?.();
    expect(done).toBe(0);
    pieces.at(-1)!.onend?.();
    expect(done).toBe(1);
  });

  it("a line whose every piece fails (a cancel errors them all) still ends, once", () => {
    const { synth, speaker } = setup();
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${String(i)} is here and goes on a while.`).join(" ");
    let done = 0;
    speaker.sayThen(long, undefined, () => { done += 1; });
    const pieces = [...synth.queue];
    for (const piece of pieces) piece.onerror?.({ error: "interrupted" });
    expect(done).toBe(1);
  });

  it("calls done when the line is refused or cut off, so nothing waits on it for ever", () => {
    const { synth, speaker } = setup();
    let done = 0;
    speaker.sayThen("Hello.", undefined, () => { done += 1; });
    synth.queue[0]!.onerror?.({ error: "interrupted" });
    expect(done).toBe(1);
    speaker.sayThen("   ", undefined, () => { done += 1; });
    expect(done).toBe(2);
  });
});
