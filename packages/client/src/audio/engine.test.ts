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
import { padFor } from "./synth";

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
  buffer: unknown = null;
  start(): void {}
  stop(): void {}
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
