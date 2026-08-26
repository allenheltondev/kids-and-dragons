/**
 * The Web Audio sink — the thing `setAudioSink()` installs on a world surface.
 *
 * ---------------------------------------------------------------------------
 * THE THREE PROMISES
 *
 * 1. **It can always be absent.** jsdom has no `AudioContext`; a TV browser
 *    might refuse one; the factory is injectable for tests. Every path in here
 *    works with no context at all — a cue with nowhere to go is dropped, which
 *    through the seam's eyes is indistinguishable from no sink installed.
 * 2. **It never plays before a gesture.** Browsers gate audio behind a user
 *    interaction; an AudioContext created cold starts suspended and logs a
 *    warning per attempt. So the context is not even created until `unlock()`,
 *    which the surface calls from its first pointer event. Cues before that
 *    are dropped, not queued — a sound for a moment that has passed is worse
 *    than silence.
 * 3. **Preferences survive the evening.** Mute and volume live in
 *    localStorage (guarded — private windows throw), because re-muting the TV
 *    every session is how a family stops using sound entirely.
 *
 * ---------------------------------------------------------------------------
 * TOPOLOGY
 *
 *   voices → sfx gain ─┐
 *                      ├→ master gain → destination
 *   music pad ─────────┘
 *
 * Master carries volume × mute; the two stages under it exist so music can sit
 * well under the effects without every recipe knowing that. Muting sets master
 * to zero rather than tearing the pad down: the pad is three oscillators, and
 * keeping it running means unmute is instant instead of a rebuild.
 */

import type { AudioSink, CueId } from "./cue";
import { createSampleLibrary, type SampleLibrary, type SampleLoaderOptions } from "./samples";
import { CUE_TONES, padFor, renderTones } from "./synth";

export interface AudioPrefs {
  muted: boolean;
  /** 0..1 master volume. */
  volume: number;
}

const STORAGE_KEY = "kad-audio";
const DEFAULT_PREFS: AudioPrefs = { muted: false, volume: 0.8 };

/** How far under the effects the music sits. */
const MUSIC_LEVEL = 0.12;
const SFX_LEVEL = 1;
/** Seconds to walk one pad out and the next in. */
const MUSIC_FADE_S = 1.5;

/** The slice of Storage this uses, so tests can hand in a plain object. */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioEngineOptions {
  /**
   * Builds the context, first gesture only. Defaults to the browser's
   * AudioContext; undefined (jsdom, tests, an ancient TV) makes the whole
   * engine inert — deliberately, see promise 1.
   */
  createContext?: (() => BaseAudioContext) | undefined;
  storage?: PrefStore | undefined;
  /**
   * Real audio, when there is any (samples.ts). Injected so tests can supply
   * a library — or none at all, which is the placeholder-only path the game
   * shipped with and still runs on.
   */
  samples?: ((ctx: BaseAudioContext) => SampleLibrary) | undefined;
  sampleOptions?: SampleLoaderOptions | undefined;
}

export interface AudioEngine {
  sink: AudioSink;
  /** Call from a user gesture. Idempotent. */
  unlock(): void;
  muted(): boolean;
  setMuted(next: boolean): void;
  /** 0..1. */
  volume(): number;
  setVolume(next: number): void;
  /** Stops the music and releases the context. For surface unmount. */
  dispose(): void;
}

function defaultContextFactory(): (() => BaseAudioContext) | undefined {
  if (typeof window === "undefined") return undefined;
  const Ctor =
    window.AudioContext ??
    // Older WebKit TVs. The cast is the whole point of the fallback.
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? () => new Ctor() : undefined;
}

function defaultStorage(): PrefStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Browsers set to block site data throw on the *accessor*.
    return undefined;
  }
}

function readPrefs(storage: PrefStore | undefined): AudioPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_PREFS.muted,
      volume:
        typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : DEFAULT_PREFS.volume,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(storage: PrefStore | undefined, prefs: AudioPrefs): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // A full or blocked store loses the preference, never the evening.
  }
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const createContext = "createContext" in options ? options.createContext : defaultContextFactory();
  const storage = "storage" in options ? options.storage : defaultStorage();

  const prefs = readPrefs(storage);

  let ctx: BaseAudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let musicBus: GainNode | null = null;

  /** The biome whose pad is (or would be) playing, and its teardown. */
  let musicBiome: string | null = null;
  let stopPad: (() => void) | null = null;
  let library: SampleLibrary | null = null;

  function masterLevel(): number {
    return prefs.muted ? 0 : prefs.volume;
  }

  /**
   * Best-effort resume, every time. A context is not resumed once and settled:
   * the first resume() can reject, and a backgrounded tab can re-suspend a
   * running context — after either, the only cure is another resume from
   * inside another gesture.
   */
  function resume(target: BaseAudioContext): void {
    const resumable = target as { resume?: () => Promise<void> };
    resumable.resume?.().catch(() => undefined);
  }

  function unlock(): void {
    if (ctx) {
      // Creation is once; resuming is every gesture — see resume().
      resume(ctx);
      return;
    }
    if (!createContext) return;
    try {
      ctx = createContext();
    } catch {
      // Promise 1: a context that cannot exist is an engine that stays quiet.
      return;
    }
    master = ctx.createGain();
    master.gain.setValueAtTime(masterLevel(), ctx.currentTime);
    master.connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.gain.setValueAtTime(SFX_LEVEL, ctx.currentTime);
    sfx.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(MUSIC_LEVEL, ctx.currentTime);
    musicBus.connect(master);

    // The context may still arrive suspended even inside a gesture handler.
    resume(ctx);

    /*
     * Real audio starts downloading here rather than at import: a display
     * client that never makes a sound should never spend a byte on it, and
     * the unlock gesture is the first moment we know sound is wanted.
     */
    const build =
      options.samples ??
      ((context: BaseAudioContext) => createSampleLibrary(context, options.sampleOptions ?? {}));
    library = build(ctx);
    library.preload();
    if (musicBiome !== null) library.wantMusic(musicBiome);

    // A biome asked for before the gesture starts its pad now — music is a
    // *state*, unlike a cue, so honouring it late is honouring it.
    if (musicBiome !== null) startPad(musicBiome);
  }

  /**
   * Three detuned sine voices on the biome's chord, breathing on a slow LFO.
   * Quiet enough to talk over — it is a bed, not a soundtrack.
   */
  function startPad(biome: string): void {
    if (!ctx || !musicBus) return;
    const now = ctx.currentTime;

    /*
     * A real loop, when the biome has one. Faded in over the same window the
     * synth pad uses, so swapping a chapter's music from placeholder to
     * composed changes what plays and nothing about how it arrives.
     */
    const recorded = library?.music(biome) ?? null;
    if (recorded) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
      gain.connect(musicBus);
      const source = ctx.createBufferSource();
      source.buffer = recorded;
      source.loop = true;
      source.connect(gain);
      source.start(now);
      stopPad = () => {
        const at = ctx ? ctx.currentTime : 0;
        try {
          gain.gain.cancelScheduledValues(at);
          gain.gain.setValueAtTime(gain.gain.value, at);
          gain.gain.linearRampToValueAtTime(0, at + MUSIC_FADE_S);
          source.stop(at + MUSIC_FADE_S);
        } catch {
          // A context torn down mid-fade has already achieved the silence.
        }
      };
      return;
    }

    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, now);
    padGain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_S);
    padGain.connect(musicBus);

    const breath = ctx.createGain();
    breath.gain.setValueAtTime(1, now);
    breath.connect(padGain);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.08, now);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.25, now);
    lfo.connect(lfoDepth);
    lfoDepth.connect(breath.gain);
    lfo.start(now);

    const voices: OscillatorNode[] = [lfo];
    for (const freq of padFor(biome)) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      // A few cents of detune keeps a pure chord from sounding like a test
      // tone. Deterministic per voice, so the bed is identical every night.
      osc.frequency.setValueAtTime(freq * 1.001, now);
      osc.connect(breath);
      osc.start(now);
      voices.push(osc);
    }

    stopPad = () => {
      const at = ctx ? ctx.currentTime : 0;
      try {
        padGain.gain.cancelScheduledValues(at);
        padGain.gain.setValueAtTime(padGain.gain.value, at);
        padGain.gain.linearRampToValueAtTime(0, at + MUSIC_FADE_S);
        for (const voice of voices) voice.stop(at + MUSIC_FADE_S);
      } catch {
        // A context torn down mid-fade has already achieved the silence.
      }
    };
  }

  const sink: AudioSink = {
    cue(id: CueId): void {
      if (!ctx || !sfx || prefs.muted) return;
      const sample = library?.cue(id) ?? null;
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        source.connect(sfx);
        source.start(ctx.currentTime);
        return;
      }
      // No file for this cue yet, or it did not decode: the recipe stands in
      // (samples.ts — real audio is an upgrade, never a requirement).
      renderTones(ctx, sfx, CUE_TONES[id], ctx.currentTime);
    },
    music(biome: string | null): void {
      if (biome === musicBiome) return;
      musicBiome = biome;
      // Ask for the file. It may arrive after the pad has started, in which
      // case this biome plays synthesized tonight and recorded next time —
      // swapping mid-scene would be a jump-cut in the one sound that is
      // supposed to be continuous.
      if (biome !== null) library?.wantMusic(biome);
      stopPad?.();
      stopPad = null;
      if (biome !== null) startPad(biome);
    },
  };

  function applyMaster(): void {
    if (!ctx || !master) return;
    master.gain.setValueAtTime(masterLevel(), ctx.currentTime);
  }

  return {
    sink,
    unlock,
    muted: () => prefs.muted,
    setMuted(next: boolean): void {
      prefs.muted = next;
      applyMaster();
      writePrefs(storage, prefs);
    },
    volume: () => prefs.volume,
    setVolume(next: number): void {
      prefs.volume = Math.min(1, Math.max(0, next));
      applyMaster();
      writePrefs(storage, prefs);
    },
    dispose(): void {
      stopPad?.();
      stopPad = null;
      musicBiome = null;
      const closable = ctx as { close?: () => Promise<void> } | null;
      closable?.close?.().catch(() => undefined);
      ctx = null;
      master = null;
      sfx = null;
      musicBus = null;
    },
  };
}
