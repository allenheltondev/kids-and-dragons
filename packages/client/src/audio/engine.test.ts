/**
 * The Web Audio engine, against a fake context.
 *
 * The three promises in engine.ts are the spec here: absent context is a
 * silent engine and never an error; nothing plays before the unlock gesture;
 * preferences survive into the next evening. The fake is deliberately dumb —
 * it records what was built and connected, because "did the right nodes get
 * scheduled" is the whole testable surface of an audio graph.
 */

import { describe, expect, it } from "vitest";
import { createAudioEngine, type PrefStore } from "./engine";
import { QUIET_VOLUME_SCALE, setQuiet } from "../quiet";
import type { CueId } from "./cue";
import { CUE_QUIET } from "./cues";
import { DEFAULT_PAD, padFor } from "./synth";

class FakeParam {
  value = 0;
  history: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number): void {
    this.value = value;
    this.history.push({ kind: "set", value, at });
  }
  linearRampToValueAtTime(value: number, at: number): void {
    this.value = value;
    this.history.push({ kind: "ramp", value, at });
  }
  cancelScheduledValues(at: number): void {
    this.history.push({ kind: "cancel", value: 0, at });
  }
}

class FakeNode {
  connectedTo: unknown[] = [];
  connect(node: unknown): void {
    this.connectedTo.push(node);
  }
  disconnect(): void {
    this.connectedTo = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(at = 0): void {
    this.startedAt = at;
  }
  stop(at = 0): void {
    this.stoppedAt = at;
  }
}

class FakeBufferSource extends FakeNode {
  playbackRate = new FakeParam();
  loop = false;
  buffer: unknown = null;
  startedAt: number | null = null;
  onended: (() => void) | null = null;
  start(at = 0): void { this.startedAt = at; }
  stopped = false;
  stop(): void { this.stopped = true; }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  sources: FakeBufferSource[] = [];
  closed = false;
  resumes = 0;
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createBuffer(_channels: number, length: number): { getChannelData(i: number): Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
  resume(): Promise<void> {
    this.resumes += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function memoryStore(seed: Record<string, string> = {}): PrefStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function build(options: { storage?: PrefStore } = {}) {
  const contexts: FakeContext[] = [];
  const engine = createAudioEngine({
    createContext: () => {
      const ctx = new FakeContext();
      contexts.push(ctx);
      return ctx as unknown as BaseAudioContext;
    },
    storage: options.storage,
  });
  return { engine, contexts };
}

describe("promise 1: it can always be absent", () => {
  it("is fully inert with no context factory, and never throws", () => {
    // jsdom, a TV browser with audio disabled, CI. Everything is a no-op.
    const engine = createAudioEngine({ createContext: undefined, storage: undefined });
    expect(() => {
      engine.unlock();
      engine.sink.cue("dice");
      engine.sink.music("forest");
      engine.setMuted(true);
      engine.setVolume(0.5);
      engine.dispose();
    }).not.toThrow();
  });

  it("survives a factory that throws", () => {
    const engine = createAudioEngine({
      createContext: () => {
        throw new Error("browser said no");
      },
      storage: undefined,
    });
    expect(() => {
      engine.unlock();
      engine.sink.cue("tap");
    }).not.toThrow();
  });

  it("survives a storage that throws", () => {
    const hostile: PrefStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { engine } = build({ storage: hostile });
    expect(engine.muted()).toBe(false);
    expect(() => engine.setMuted(true)).not.toThrow();
  });
});

describe("promise 2: nothing before a gesture", () => {
  it("does not even create a context until unlock", () => {
    const { engine, contexts } = build();
    engine.sink.cue("dice");
    engine.sink.music("forest");
    expect(contexts).toHaveLength(0);
  });

  it("drops cues from before the unlock rather than queueing them", () => {
    // A sound for a moment that has passed is worse than silence.
    const { engine, contexts } = build();
    engine.sink.cue("dice");
    engine.unlock();
    const ctx = contexts[0]!;
    const before = ctx.oscillators.length + ctx.sources.length;
    // Only the graph plumbing exists; the dropped cue scheduled no voices.
    expect(before).toBe(0);
  });

  it("honours the music state late, because music is state and a cue is an event", () => {
    const { engine, contexts } = build();
    engine.sink.music("forest");
    engine.unlock();
    const ctx = contexts[0]!;
    // The pad: one voice per chord note, plus the breathing LFO.
    expect(ctx.oscillators).toHaveLength(padFor("forest").length + 1);
  });

  it("unlocks once, however many gestures arrive", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.unlock();
    engine.unlock();
    expect(contexts).toHaveLength(1);
  });

  it("retries resume on every gesture, because a context can be re-suspended", () => {
    /*
     * Creation is once; resuming is not once-and-settled. The first resume()
     * can reject, and a backgrounded tab can re-suspend a running context —
     * an unlock that bails early on "ctx exists" would leave the engine
     * silent for the rest of the evening with the gesture listeners still
     * firing uselessly.
     */
    const { engine, contexts } = build();
    engine.unlock();
    engine.unlock();
    engine.unlock();
    expect(contexts[0]!.resumes).toBe(3);
  });
});

describe("cues", () => {
  it("schedules voices through the sfx bus after unlock", () => {
    const { engine, contexts } = build();
    engine.unlock();
    const ctx = contexts[0]!;
    engine.sink.cue("tap");
    expect(ctx.oscillators.filter((osc) => osc.startedAt !== null).length).toBeGreaterThan(0);
  });

  it("plays nothing while muted", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.setMuted(true);
    const ctx = contexts[0]!;
    const before = ctx.oscillators.length;
    engine.sink.cue("dice");
    expect(ctx.oscillators.length).toBe(before);
  });
});

describe("real audio, when there is any", () => {
  const BUFFER = { duration: 1 } as AudioBuffer;

  it("loops location ambience past its clip duration without restarting inside the location", () => {
    const ctx = new FakeContext();
    const engine = createAudioEngine({ createContext: () => ctx as unknown as BaseAudioContext, storage: memoryStore(),
      samples: () => ({ preload() {}, cue: () => ({ duration: 12 } as AudioBuffer), music: () => null, wantMusic() {} }),
    });
    engine.sink.ambience?.("cavern-air");
    expect(ctx.sources).toHaveLength(0); // A requested location waits for the gesture.
    engine.unlock();
    const air = ctx.sources[0]!;
    expect(air.loop).toBe(true);
    ctx.currentTime = 30;
    engine.sink.stopSceneCues?.(); // WorldView changes mouth -> check_remains.
    engine.sink.ambience?.("cavern-air");
    expect(ctx.sources).toHaveLength(1);
    expect(air.stopped).toBe(false);
    engine.sink.ambience?.(null); // Combat or a different illustration.
    expect(air.stopped).toBe(true);
    engine.dispose();
  });

  it("upgrades late ambience only while its location is still current", () => {
    const ctx = new FakeContext();
    let available = false;
    let ready = () => {};
    const engine = createAudioEngine({ createContext: () => ctx as unknown as BaseAudioContext, storage: memoryStore(),
      samples: () => ({ preload() {}, cue: () => available ? BUFFER : null, music: () => null, wantMusic() {}, wantCue(_id, callback) { ready = callback; } }),
    });
    engine.unlock();
    engine.sink.ambience?.("gate-hum");
    const fallback = [...ctx.oscillators];
    available = true; ready();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.loop).toBe(true);
    expect(fallback.every((o) => o.stoppedAt !== null)).toBe(true);
    engine.sink.ambience?.(null);
    ready();
    expect(ctx.sources).toHaveLength(1);
    engine.dispose();
  });

  it("fades in late music and ignores downloads for a scene already left", () => {
    const ctx = new FakeContext();
    let available: string | null = null;
    const listeners = new Map<string, () => void>();
    const engine = createAudioEngine({ createContext: () => ctx as unknown as BaseAudioContext, storage: memoryStore(),
      samples: () => ({ preload() {}, cue: () => BUFFER, music: (id) => id === available ? BUFFER : null,
        wantMusic(id, ready) { if (ready) listeners.set(id, ready); } }),
    });
    engine.unlock();
    engine.sink.music("forest");
    const originalPad = [...ctx.oscillators];
    available = "forest";
    listeners.get("forest")!();
    expect(ctx.sources).toHaveLength(1);
    expect(originalPad.every((osc) => osc.stoppedAt !== null)).toBe(true);
    engine.sink.music("gemfall-marsh");
    listeners.get("forest")!();
    expect(ctx.sources).toHaveLength(1);
    engine.sink.cue("gate-hum");
    const hum = ctx.sources.at(-1)!;
    engine.sink.stopSceneCues?.();
    expect(hum.stopped).toBe(true);
    engine.dispose();
  });

  function withLibrary(cue: (id: string) => AudioBuffer | null) {
    const contexts: FakeContext[] = [];
    const engine = createAudioEngine({
      createContext: () => {
        const ctx = new FakeContext();
        contexts.push(ctx);
        return ctx as unknown as BaseAudioContext;
      },
      storage: memoryStore(),
      samples: () => ({
        preload: () => undefined,
        wantMusic: () => undefined,
        cue: (id) => cue(id),
        music: () => null,
      }),
    });
    return { engine, contexts };
  }

  it("plays the file instead of the recipe when one has loaded", () => {
    const { engine, contexts } = withLibrary(() => BUFFER);
    engine.unlock();
    const ctx = contexts[0]!;
    const oscillatorsBefore = ctx.oscillators.length;

    engine.sink.cue("dice");

    // A buffer source, and *not* the synth's oscillators — otherwise both
    // would play and the dice would rattle twice.
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0]!.playbackRate.value).toBeCloseTo(1400 / 2200);
    expect(ctx.oscillators.length).toBe(oscillatorsBefore);
  });

  it("falls back to the recipe for a cue with no file", () => {
    // The ordinary state until every cue is sourced: real audio is an upgrade,
    // never a requirement.
    const { engine, contexts } = withLibrary(() => null);
    engine.unlock();
    const ctx = contexts[0]!;
    engine.sink.cue("tap");
    expect(ctx.oscillators.filter((osc) => osc.startedAt !== null).length).toBeGreaterThan(0);
  });

  it("still plays nothing while muted, file or not", () => {
    const { engine, contexts } = withLibrary(() => BUFFER);
    engine.unlock();
    engine.setMuted(true);
    engine.sink.cue("dice");
    expect(contexts[0]!.sources.length).toBe(0);
  });
});

describe("music", () => {
  it.each([false, true])("eases lobby music in over six seconds (recorded: %s)", (recorded) => {
    const ctx = new FakeContext();
    ctx.currentTime = 10;
    const engine = createAudioEngine({
      createContext: () => ctx as unknown as BaseAudioContext,
      storage: memoryStore(),
      samples: () => ({ preload() {}, cue: () => null, music: () => recorded ? {} as AudioBuffer : null, wantMusic() {} }),
    });
    engine.unlock();
    engine.sink.music("entry-lobby");
    const entrance = ctx.gains.find((gain) => gain.gain.history.some((event) => event.kind === "ramp" && event.value === 1));
    expect(entrance?.gain.history).toEqual([
      { kind: "set", value: 0, at: 10 },
      { kind: "ramp", value: 1, at: 16 },
    ]);
    engine.dispose();
  });

  it("is idempotent for the biome already playing", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("forest");
    const ctx = contexts[0]!;
    const after = ctx.oscillators.length;
    engine.sink.music("forest");
    expect(ctx.oscillators.length).toBe(after);
  });

  it("fades the old pad out when the biome changes", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("forest");
    const ctx = contexts[0]!;
    const firstPad = [...ctx.oscillators];
    engine.sink.music("somewhere-new");
    // Old voices got a stop scheduled; a new pad is running.
    expect(firstPad.every((osc) => osc.stoppedAt !== null)).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThan(firstPad.length);
  });

  it("goes to silence for null — the lobby", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("forest");
    const ctx = contexts[0]!;
    engine.sink.music(null);
    expect(ctx.oscillators.every((osc) => osc.stoppedAt !== null)).toBe(true);
  });

  it("hums the default pad for a chapter's track before its file exists", () => {
    // A chapter may name a track that has no recording yet (#226). It gets the
    // same pad as a biome nobody composed for, never silence.
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("a-track-nobody-produced");
    const tones = contexts[0]!.oscillators.map((osc) => osc.frequency.value);
    expect(tones).toEqual(expect.arrayContaining(DEFAULT_PAD.map((freq) => freq * 1.001)));
  });

  it("hums the default pad for a biome nobody wrote a chord for", () => {
    // The seventeen Red Sky backdrops arrive with music before anybody
    // composes for them (synth.ts).
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("crystal-canyon");
    expect(contexts[0]!.oscillators.length).toBeGreaterThan(0);
  });
});

describe("promise 3: preferences survive the evening", () => {
  it("persists mute and volume, and reads them back", () => {
    const storage = memoryStore();
    const first = build({ storage });
    first.engine.setMuted(true);
    first.engine.setVolume(0.4);

    const second = build({ storage });
    expect(second.engine.muted()).toBe(true);
    expect(second.engine.volume()).toBe(0.4);
  });

  it("applies the persisted state to the graph at unlock", () => {
    const storage = memoryStore();
    const first = build({ storage });
    first.engine.setMuted(true);

    const second = build({ storage });
    second.engine.unlock();
    // Master is the first gain built; muted means it opened at zero.
    expect(second.contexts[0]!.gains[0]!.gain.value).toBe(0);
  });

  it("clamps volume to 0..1", () => {
    const { engine } = build();
    engine.setVolume(7);
    expect(engine.volume()).toBe(1);
    engine.setVolume(-2);
    expect(engine.volume()).toBe(0);
  });

  it("falls back to defaults on garbage in the store", () => {
    const storage = memoryStore({ "kad-audio": "{not json" });
    const { engine } = build({ storage });
    expect(engine.muted()).toBe(false);
    expect(engine.volume()).toBe(0.8);
  });
});

describe("dispose", () => {
  it("stops the pad and closes the context", () => {
    const { engine, contexts } = build();
    engine.unlock();
    engine.sink.music("forest");
    engine.dispose();
    const ctx = contexts[0]!;
    expect(ctx.closed).toBe(true);
    expect(ctx.oscillators.every((osc) => osc.stoppedAt !== null)).toBe(true);
  });
});

describe("quiet mode (#260)", () => {
  function unlocked() {
    const built = build();
    built.engine.unlock();
    return { ...built, ctx: built.contexts[0]!, master: built.contexts[0]!.gains[0]! };
  }

  it("scales the master level down, and the device can still go lower", () => {
    const { engine, master } = unlocked();
    engine.setVolume(1);
    expect(master.gain.value).toBe(1);
    engine.setQuiet(true);
    expect(master.gain.value).toBeCloseTo(QUIET_VOLUME_SCALE);
    engine.setVolume(0.5);
    expect(master.gain.value).toBeCloseTo(0.5 * QUIET_VOLUME_SCALE);
    engine.setQuiet(false);
    expect(master.gain.value).toBe(0.5);
  });

  it("starts quiet when the room already was, and never stores it", () => {
    setQuiet(true);
    try {
      const storage = memoryStore();
      const { engine, contexts } = build({ storage });
      engine.unlock();
      expect(contexts[0]!.gains[0]!.gain.value).toBeCloseTo(0.8 * QUIET_VOLUME_SCALE);
      expect(storage.getItem("kad-audio")).toBeNull();
    } finally {
      setQuiet(false);
    }
  });

  it("drops the sudden cues and still plays the soft ones", () => {
    const { engine, ctx } = unlocked();
    engine.setQuiet(true);
    const before = ctx.oscillators.length;
    for (const id of Object.keys(CUE_QUIET) as CueId[]) {
      if (CUE_QUIET[id] !== "drop") continue;
      engine.sink.cue(id);
    }
    expect(ctx.oscillators.length).toBe(before);

    engine.sink.cue("heal");
    expect(ctx.oscillators.length).toBeGreaterThan(before);
  });
});

describe("state: what a TV that blocks sound looks like (#264)", () => {
  class StatefulContext extends FakeContext {
    state: "suspended" | "running" = "suspended";
    listeners = new Set<() => void>();
    addEventListener(_: string, fn: () => void): void { this.listeners.add(fn); }
    removeEventListener(_: string, fn: () => void): void { this.listeners.delete(fn); }
    override resume(): Promise<void> {
      this.resumes += 1;
      return Promise.resolve();
    }
    allow(): void {
      this.state = "running";
      for (const fn of this.listeners) fn();
    }
  }

  it("is unsupported with no AudioContext, locked before a gesture, and suspended while the browser holds it back", () => {
    expect(createAudioEngine({ createContext: undefined, storage: undefined }).state()).toBe("unsupported");

    let ctx!: StatefulContext;
    const engine = createAudioEngine({ createContext: () => (ctx = new StatefulContext()) as unknown as BaseAudioContext, storage: undefined });
    expect(engine.state()).toBe("locked");
    const heard: string[] = [];
    engine.onStateChange(() => { heard.push(engine.state()); });
    engine.unlock();
    expect(engine.state()).toBe("suspended");
    ctx.allow();
    expect(engine.state()).toBe("running");
    expect(heard).toEqual(["suspended", "running"]);
  });

  it("stops telling listeners once disposed", () => {
    let ctx!: StatefulContext;
    const engine = createAudioEngine({ createContext: () => (ctx = new StatefulContext()) as unknown as BaseAudioContext, storage: undefined });
    engine.unlock();
    let calls = 0;
    engine.onStateChange(() => { calls += 1; });
    engine.dispose();
    ctx.allow();
    expect(calls).toBe(0);
  });
});

describe("recorded voice (docs/voice-narration-plan.md §7)", () => {
  class VoiceContext extends FakeContext {
    state: "suspended" | "running" = "running";
    decodeAudioData(bytes: ArrayBuffer): Promise<{ duration: number }> {
      return bytes.byteLength === 0 ? Promise.reject(new Error("EncodingError")) : Promise.resolve({ duration: bytes.byteLength });
    }
  }

  function voiced(storage?: PrefStore) {
    let ctx!: VoiceContext;
    const engine = createAudioEngine({ createContext: () => (ctx = new VoiceContext()) as unknown as BaseAudioContext, storage });
    engine.unlock();
    // master, sfx, music, voice: the order unlock() builds them in.
    return { engine, ctx, music: ctx.gains[2]!, voiceBus: ctx.gains[3]!, voice: engine.sink.voice! };
  }

  const MUSIC = 0.45;
  const DUCKED = MUSIC * 10 ** (-10 / 20);

  it("has no channel to play on until a gesture has started a running context", () => {
    const engine = createAudioEngine({ createContext: () => new VoiceContext() as unknown as BaseAudioContext, storage: undefined });
    expect(engine.sink.voice!.ready()).toBe(false);
    engine.unlock();
    expect(engine.sink.voice!.ready()).toBe(true);
    const held = voiced();
    held.ctx.state = "suspended";
    expect(held.voice.ready()).toBe(false);
  });

  it("decodes in the engine's context, and rejects bytes that will not decode", async () => {
    const { voice } = voiced();
    await expect(voice.decode(new ArrayBuffer(2))).resolves.toEqual({ duration: 2 });
    await expect(voice.decode(new ArrayBuffer(0))).rejects.toThrow();
  });

  it("plays clips back to back on its own bus, ducks the music about 10 dB, and restores it after", () => {
    const { ctx, music, voiceBus, voice } = voiced();
    let ended = 0;
    voice.play([{ duration: 1.5 }, { duration: 2 }], () => { ended += 1; });
    const [first, second] = ctx.sources.slice(-2);
    expect(first!.connectedTo).toContain(voiceBus);
    expect(second!.startedAt! - first!.startedAt!).toBeCloseTo(1.5);
    expect(music.gain.value).toBeCloseTo(DUCKED);
    expect(20 * Math.log10(music.gain.value / MUSIC)).toBeCloseTo(-10);
    second!.onended!();
    expect(ended).toBe(1);
    expect(music.gain.value).toBeCloseTo(MUSIC);
  });

  it("restores the music when the voice is cut off, and never says it ended", () => {
    const { ctx, music, voice } = voiced();
    let ended = 0;
    const stop = voice.play([{ duration: 1 }, { duration: 1 }], () => { ended += 1; });
    expect(music.gain.value).toBeCloseTo(DUCKED);
    stop();
    expect(ctx.sources.slice(-2).every((s) => s.stopped)).toBe(true);
    expect(music.gain.value).toBeCloseTo(MUSIC);
    expect(ended).toBe(0);
    stop();
    expect(ended).toBe(0);
  });

  it("follows the volume and quiet mode, but not mute: read-aloud has its own switch", () => {
    const { engine, voiceBus } = voiced(memoryStore());
    engine.setVolume(0.5);
    expect(voiceBus.gain.value).toBeCloseTo(0.5);
    engine.setMuted(true);
    expect(voiceBus.gain.value).toBeCloseTo(0.5);
    engine.setQuiet(true);
    expect(voiceBus.gain.value).toBeCloseTo(0.5 * QUIET_VOLUME_SCALE);
    engine.setQuiet(false);
  });

  it("stops a voice still playing when the engine goes", () => {
    const { ctx, engine, voice } = voiced();
    voice.play([{ duration: 3 }], () => undefined);
    engine.dispose();
    expect(ctx.sources.at(-1)!.stopped).toBe(true);
  });
});
