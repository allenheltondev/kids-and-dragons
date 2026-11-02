import { DICE_PLAYBACK_RATE } from "../dice-timing";
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
 *   narration clips → voice gain ───→ destination
 *
 * Master carries volume × mute; the two stages under it exist so music can sit
 * well under the effects without every recipe knowing that. Muting sets master
 * to zero rather than tearing the pad down: the pad is three oscillators, and
 * keeping it running means unmute is instant instead of a rebuild.
 *
 * Recorded narration has a bus of its own beside master (`sink.voice`,
 * speech/clip-speaker.ts). It follows the volume and quiet mode but not mute:
 * mute is the sound switch, read-aloud has its own, and the device voice it
 * stands in for was never muted by it either. While a clip plays the music
 * ducks VOICE_DUCK_DB and comes back when the voice ends or is cut off.
 */

import type { AmbienceId, AudioSink, AudioState, CueId, VoiceChannel } from "./cue";
import { createSampleLibrary, type SampleLibrary, type SampleLoaderOptions } from "./samples";
import { CUE_QUIET } from "./cues";
import { QUIET_VOLUME_SCALE, isQuiet } from "../quiet";
import { CUE_TONES, padFor, renderTones } from "./synth";

export interface AudioPrefs {
  muted: boolean;
  /** 0..1 master volume. */
  volume: number;
}

const STORAGE_KEY = "kad-audio";
const DEFAULT_PREFS: AudioPrefs = { muted: false, volume: 0.8 };

/** How far under the effects the music sits. */
const MUSIC_LEVEL = 0.45;
const SFX_LEVEL = 1;
/** Seconds to walk one pad out and the next in. */
const MUSIC_FADE_S = 1.5;
/** How far the music drops under a recorded voice, and how fast it goes down and comes back. */
export const VOICE_DUCK_DB = -10;
const VOICE_DUCK = 10 ** (VOICE_DUCK_DB / 20);
const DUCK_S = 0.25;
const UNDUCK_S = 0.8;

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
  /**
   * Whether a gesture has actually opened the context yet.
   *
   * Surfaced because the *absence* of one is invisible and permanent: a
   * display client loads, nobody touches it, and every cue is dropped for the
   * rest of the evening with nothing on screen saying why. Something has to be
   * able to ask, so it can offer the gesture.
   */
  unlocked(): boolean;
  /**
   * What the browser is doing with sound right now, for the one prompt a TV
   * needs (#264). `unsupported` is a browser with no AudioContext at all, which
   * no tap can mend, so nothing should ask for one. `locked` has never had a
   * gesture; `suspended` had one and the browser still holds the context back
   * (a TV browser that does not count a remote's click, or a context a hidden
   * tab re-suspended). Only `running` makes a sound.
   */
  state(): AudioState;
  /** Called when `state()` may have changed. Returns the way to stop listening. */
  onStateChange(listener: () => void): () => void;
  muted(): boolean;
  setMuted(next: boolean): void;
  /** 0..1. */
  volume(): number;
  setVolume(next: number): void;
  /**
   * Quiet mode (#260): the master level is scaled down and the sudden cues are
   * dropped. Never stored: it is the room's, not the device's preference.
   */
  setQuiet(next: boolean): void;
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
  let quiet = isQuiet();

  let ctx: BaseAudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let voiceBus: GainNode | null = null;
  /** Clip playlists playing now, by their stop; the music is ducked while there is any. */
  const voicePlays = new Set<() => void>();

  /** The biome whose pad is (or would be) playing, and its teardown. */
  let musicBiome: string | null = null;
  let stopPad: (() => void) | null = null;
  let library: SampleLibrary | null = null;
  let ambienceId: AmbienceId | null = null;
  let stopAmbience: (() => void) | null = null;
  let ambienceRecorded = false;
  const sceneStops = new Set<() => void>();
  const locationCueIds = new Set<CueId>(["gem-pickup", "gate-hum", "citadel-bell", "seal-awakening", "cavern-air"]);
  function stopSceneCues(): void {
    for (const stop of sceneStops) stop();
    sceneStops.clear();
  }

  function masterLevel(): number {
    return prefs.muted ? 0 : voiceLevel();
  }

  function voiceLevel(): number {
    return prefs.volume * (quiet ? QUIET_VOLUME_SCALE : 1);
  }

  function duckMusic(down: boolean): void {
    if (!ctx || !musicBus) return;
    const at = ctx.currentTime;
    const gain = musicBus.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(gain.value, at);
    gain.linearRampToValueAtTime(down ? MUSIC_LEVEL * VOICE_DUCK : MUSIC_LEVEL, at + (down ? DUCK_S : UNDUCK_S));
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

  const stateListeners = new Set<() => void>();
  function stateChanged(): void {
    for (const listener of stateListeners) listener();
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
    voiceBus = ctx.createGain();
    voiceBus.gain.setValueAtTime(voiceLevel(), ctx.currentTime);
    voiceBus.connect(ctx.destination);

    // The context may still arrive suspended even inside a gesture handler.
    resume(ctx);
    ctx.addEventListener?.("statechange", stateChanged);
    stateChanged();

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

    // A biome asked for before the gesture starts its pad now — music is a
    // *state*, unlike a cue, so honouring it late is honouring it.
    if (musicBiome !== null) {
      startPad(musicBiome);
      requestMusic(musicBiome);
    }
    if (ambienceId !== null && !prefs.muted) {
      startAmbience(ambienceId);
      requestAmbience(ambienceId);
    }
  }

  function requestAmbience(id: AmbienceId): void {
    library?.wantCue?.(id, () => {
      if (!ctx || prefs.muted || ambienceId !== id || ambienceRecorded || !library?.cue(id)) return;
      stopAmbience?.();
      startAmbience(id);
    });
  }

  function startAmbience(id: AmbienceId): void {
    if (!ctx || !sfx) return;
    const context = ctx;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.25);
    gain.connect(sfx);
    const sample = library?.cue(id) ?? null;
    ambienceRecorded = sample !== null;
    const sources: AudioScheduledSourceNode[] = [];
    if (sample) {
      const source = context.createBufferSource();
      source.buffer = sample;
      source.loop = true;
      source.connect(gain);
      source.start(now);
      sources.push(source);
    } else if (id === "gate-hum") {
      for (const freq of [110, 110.7, 165]) {
        const osc = context.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);
        const voice = context.createGain();
        voice.gain.setValueAtTime(0.06, now);
        osc.connect(voice); voice.connect(gain); osc.start(now); sources.push(osc);
      }
    } else {
      // A quiet, filtered and tapered air buffer can loop indefinitely offline.
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let filtered = 0;
      for (let i = 0; i < data.length; i++) {
        filtered += 0.025 * (Math.random() * 2 - 1 - filtered);
        data[i] = filtered * 0.2 * Math.min(1, i / 1000, (data.length - 1 - i) / 1000);
      }
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true; source.connect(gain); source.start(now); sources.push(source);
    }
    stopAmbience = () => {
      const at = context.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + 0.15);
      for (const source of sources) { try { source.stop(at + 0.15); } catch { /* Already stopped. */ } }
    };
  }

  let musicRecorded = false;
  function requestMusic(biome: string): void {
    library?.wantMusic(biome, () => {
      if (!ctx || musicBiome !== biome || musicRecorded || !library?.music(biome)) return;
      stopPad?.();
      stopPad = null;
      startPad(biome);
    });
  }

  /**
   * Three detuned sine voices on the biome's chord, breathing on a slow LFO.
   * Quiet enough to talk over — it is a bed, not a soundtrack.
   */
  function startPad(biome: string): void {
    if (!ctx || !musicBus) return;
    const now = ctx.currentTime;
    // Let the lobby's sustained opening settle in gradually.
    const fadeIn = biome === "entry-lobby" ? 6 : MUSIC_FADE_S;

    /*
     * A real loop, when the biome has one. Both the loop and synth pad use
     * the slower lobby entrance, including when a download arrives late.
     */
    const recorded = library?.music(biome) ?? null;
    musicRecorded = recorded !== null;
    if (recorded) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeIn);
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
    padGain.gain.linearRampToValueAtTime(1, now + fadeIn);
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

  const voice: VoiceChannel = {
    ready: () => ctx !== null && voiceBus !== null && ctx.state === "running",
    decode(bytes) {
      return ctx ? ctx.decodeAudioData(bytes) : Promise.reject(new Error("no audio context"));
    },
    play(buffers, onEnd) {
      if (!ctx || !voiceBus || buffers.length === 0) {
        onEnd();
        return () => undefined;
      }
      const context = ctx;
      const bus = voiceBus;
      const sources: AudioBufferSourceNode[] = [];
      // Back to back on the context's clock, so no timer can open a gap between clips.
      let at = context.currentTime + 0.05;
      for (const buffer of buffers) {
        const source = context.createBufferSource();
        // Only `decode` above makes these, so each is the context's own AudioBuffer.
        source.buffer = buffer as AudioBuffer;
        source.connect(bus);
        source.start(at);
        at += buffer.duration;
        sources.push(source);
      }
      let over = false;
      const end = (natural: boolean): void => {
        if (over) return;
        over = true;
        voicePlays.delete(stop);
        for (const source of sources) {
          source.onended = null;
          try {
            source.stop();
            source.disconnect();
          } catch {
            // Already ended, or a context torn down under it.
          }
        }
        if (voicePlays.size === 0) duckMusic(false);
        if (natural) onEnd();
      };
      const stop = (): void => end(false);
      sources[sources.length - 1]!.onended = () => end(true);
      if (voicePlays.size === 0) duckMusic(true);
      voicePlays.add(stop);
      return stop;
    },
  };

  const sink: AudioSink = {
    voice,
    ambience(id) {
      if (id === ambienceId) return;
      ambienceId = id;
      stopAmbience?.(); stopAmbience = null;
      if (id !== null && !prefs.muted) { startAmbience(id); requestAmbience(id); }
    },
    stopSceneCues,
    cue(id: CueId): void {
      if (!ctx || !sfx || prefs.muted) return;
      if (quiet && CUE_QUIET[id] === "drop") return;
      const sample = library?.cue(id) ?? null;
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        if (id === "dice") source.playbackRate.setValueAtTime(DICE_PLAYBACK_RATE, ctx.currentTime);
        if (locationCueIds.has(id)) {
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(1, ctx.currentTime);
          source.connect(gain);
          gain.connect(sfx);
          const stop = () => {
            const now = ctx?.currentTime ?? 0;
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + 0.04);
            try { source.stop(now + 0.04); } catch { /* Already ended. */ }
          };
          sceneStops.add(stop);
          source.onended = () => { sceneStops.delete(stop); gain.disconnect(); source.disconnect(); };
        } else source.connect(sfx);
        source.start(ctx.currentTime);
        return;
      }
      // No file for this cue yet, or it did not decode: the recipe stands in
      // (samples.ts — real audio is an upgrade, never a requirement).
      const stop = renderTones(ctx, sfx, CUE_TONES[id], ctx.currentTime);
      if (locationCueIds.has(id)) sceneStops.add(stop);
    },
    music(biome: string | null): void {
      if (biome === musicBiome) return;
      musicBiome = biome;
      // Play a fallback immediately; a ready callback crossfades in the file.
      stopPad?.();
      stopPad = null;
      if (biome !== null) startPad(biome);
      if (biome !== null) requestMusic(biome);
    },
  };

  function applyMaster(): void {
    if (!ctx || !master) return;
    master.gain.setValueAtTime(masterLevel(), ctx.currentTime);
    voiceBus?.gain.setValueAtTime(voiceLevel(), ctx.currentTime);
  }

  return {
    sink,
    unlock,
    unlocked: () => ctx !== null,
    state(): AudioState {
      if (ctx) return ctx.state === "running" ? "running" : "suspended";
      return createContext ? "locked" : "unsupported";
    },
    onStateChange(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },
    muted: () => prefs.muted,
    setMuted(next: boolean): void {
      prefs.muted = next;
      if (next) stopSceneCues();
      if (next) { stopAmbience?.(); stopAmbience = null; }
      else if (ambienceId !== null && !stopAmbience) { startAmbience(ambienceId); requestAmbience(ambienceId); }
      applyMaster();
      writePrefs(storage, prefs);
    },
    volume: () => prefs.volume,
    setVolume(next: number): void {
      prefs.volume = Math.min(1, Math.max(0, next));
      applyMaster();
      writePrefs(storage, prefs);
    },
    setQuiet(next: boolean): void {
      quiet = next;
      applyMaster();
    },
    dispose(): void {
      for (const stop of [...voicePlays]) stop();
      stopAmbience?.(); stopAmbience = null; ambienceId = null;
      stopSceneCues();
      stopPad?.();
      stopPad = null;
      musicBiome = null;
      ctx?.removeEventListener?.("statechange", stateChanged);
      stateListeners.clear();
      const closable = ctx as { close?: () => Promise<void> } | null;
      closable?.close?.().catch(() => undefined);
      ctx = null;
      master = null;
      sfx = null;
      musicBus = null;
      voiceBus = null;
    },
  };
}
