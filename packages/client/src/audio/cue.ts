/**
 * The sound seam — roadmap chapter 8, in the shape spec §11 already proved.
 *
 * `speak()` established the pattern: every call site exists and is a no-op
 * until something is installed, because retrofitting call sites later is the
 * expensive half. This is the same seam for non-speech audio — a cue name goes
 * in, and whatever sink is installed decides what that sounds like.
 *
 * Two consequences of the shape are the point:
 *
 * - **Silence is structural, not configured.** Joined controllers in Party Mode never
 *   install a sink, so the living room has one speaker — the television —
 *   without a single call site asking "am I the TV?". CI and jsdom run the
 *   uninstalled path for free.
 * - **Cues are vocabulary, not files.** A call site says `cue("down")`, never
 *   "play thud.mp3". Today the sink synthesizes placeholder tones (engine.ts);
 *   when Allen picks a sound source (roadmap open item 2) the recipes change
 *   and no call site does.
 *
 * The **render layer** calls this — never the engine, for the reason speak.ts
 * gives: engine.ts runs in Lambda, and a dice sound in a Lambda helps nobody.
 */

/**
 * Every sound the game knows how to ask for.
 *
 * A closed union rather than a string, so a typo'd cue is a compile error
 * instead of a silence nobody can diagnose — with no sink there is no runtime
 * anything to complain.
 */
export type CueId =
  | "rift-open"
  | "rift-collapse"
  | "chime-sour"
  | "chime-echo"
  | "attune-hum"
  | "riftspark"
  | "anchor"
  | "party-ready"
  | "gem-pickup"
  | "gate-hum"
  | "citadel-bell"
  | "seal-awakening"
  | "cavern-air"
  // The table's centrepiece (spec §2.2's ~1.5s roll).
  | "dice"
  // A natural 1: a cartoon knock on the head, so the worst roll gets a laugh.
  | "bonk"
  // Combat beats, one per presentation kind that lands a hit or a rescue.
  | "attack"
  | "heal"
  | "down"
  | "revive"
  // Progression's two sizes of fanfare (spec §8.1).
  | "level-up"
  | "transform"
  // Story beats.
  | "scene-enter"
  | "choice"
  | "encounter-begin"
  | "victory"
  // UI feedback. Deliberately tiny — a tap should sound like a tap.
  | "tap"
  // A map card opening: a soft paper flick.
  | "page-turn"
  // Story interaction (#493) game sounds: one note per coloured pad, a pattern's voice; a soft
  // catch, a whoosh for a pass or a shuffle, and the tick that says NOW is coming.
  | "pad-1"
  | "pad-2"
  | "pad-3"
  | "pad-4"
  | "catch"
  | "whoosh"
  | "tick"
  | "error";

export type AmbienceId = "gate-hum" | "cavern-air";

/** A decoded clip: an `AudioBuffer` in the game, named by what the speaker reads off it (this file is shared with tools that have no DOM). */
export interface VoiceBuffer {
  readonly duration: number;
}

/**
 * The breath between one recorded clip and the next (playtest: back-to-back clips made the
 * narrator and the characters run on into each other). Every clip boundary gets it, inside a
 * line (the engine's `play`) and between one line and the next (speech/clip-speaker.ts); never
 * after the last clip. One number, so the whole table's pacing is tuned here.
 */
export const VOICE_GAP_MS = 350;

/** A clip to play: decoded already, or still on its way (fetching or decoding). */
export type VoiceClip = VoiceBuffer | PromiseLike<VoiceBuffer>;

/**
 * Recorded narration's way out (docs/voice-narration-plan.md §7): clips are decoded in the
 * engine's context and played on their own bus, with the music ducked under them, rather than
 * through an `<audio>` tag that knows nothing of the music. Only a started engine has one.
 */
export interface VoiceChannel {
  /** True when a clip played now would be heard: a context a gesture has started and the browser runs. */
  ready(): boolean;
  /** Decodes a clip's bytes. Rejects when they will not decode, or there is no context to decode in. */
  decode(bytes: ArrayBuffer): Promise<VoiceBuffer>;
  /**
   * Plays the clips in order with VOICE_GAP_MS between each and the next (none after the last),
   * the music ducked, and calls `onEnd` once the last one has finished. A clip still on its way
   * is started as soon as it arrives (never before its gap is over), so the first clip of a line
   * need not wait for the rest; one that fails ends the line after what was already playing, and
   * `onEnd` is still called. Returns the way to stop early, which restores the music and never
   * calls `onEnd`. `onClip`, when given, is told each clip's place in the line as it begins to
   * be heard (the stage's cast pulse follows who is speaking); never after a stop.
   */
  play(clips: readonly VoiceClip[], onEnd: () => void, onClip?: (index: number) => void): () => void;
}

export interface AudioSink {
  /** Recorded voice, when this sink can play it (speech/clip-speaker.ts). */
  voice?: VoiceChannel;
  /** Sustained location sound; changing scenes inside the location does not restart it. */
  ambience?(id: AmbienceId | null): void;
  /** Stop location effects when the story leaves their scene. */
  stopSceneCues?(): void;
  /** Play one cue, now. Fire and forget. */
  cue(id: CueId): void;
  /**
   * The music for where the party is standing, by biome id — or null for
   * silence. The shell also supplies home and lobby track ids. Idempotent: the same biome
   * twice must not restart the track.
   */
  music(biome: string | null): void;
}

let current: AudioSink | null = null;

/** Installs a sink. Pass `null` to go back to silence — the mute control could
 * uninstall, but doesn't: muting is the engine's job so the *preference* can
 * persist while the seam stays stateless. */
export function setAudioSink(sink: AudioSink | null): void {
  current = sink;
}

export function getAudioSink(): AudioSink | null {
  return current;
}

/**
 * Plays a cue, or does nothing. Never throws: audio is flavor, and a broken
 * speaker must not be able to take down the scene it was only underscoring —
 * the same promise speak() makes, for the same reason.
 */
export function cue(id: CueId | null): void {
  const sink = current;
  if (!sink || id === null) return;
  try {
    sink.cue(id);
  } catch {
    // Flavor, never load-bearing (spec §10.3, same principle).
  }
}

/** Sets the music bed, or does nothing. Same contract as `cue`. */
export function music(biome: string | null): void {
  const sink = current;
  if (!sink) return;
  try {
    sink.music(biome);
  } catch {
    // Flavor, never load-bearing.
  }
}

export function stopSceneCues(): void {
  try { current?.stopSceneCues?.(); } catch { /* Decoration must never interrupt play. */ }
}

export function ambience(id: AmbienceId | null): void {
  try { current?.ambience?.(id); } catch { /* Decoration must never interrupt play. */ }
}

/*
 * A window onto the running engine for the shared screen's "Tap for sound" and
 * capability report (#264), which live in a lazy chunk and cannot reach the
 * component's engine any other way. Here, in a module already in the first
 * paint, because a module of its own is a chunk of its own.
 */
export type AudioState = "unsupported" | "locked" | "suspended" | "running";

export interface AudioProbe {
  state(): AudioState;
  onStateChange(listener: () => void): () => void;
  muted(): boolean;
  unlock(): void;
}

let probe: AudioProbe | null = null;
const probeListeners = new Set<() => void>();

export function setAudioProbe(next: AudioProbe | null): void {
  probe = next;
  for (const listener of probeListeners) listener();
}

export function getAudioProbe(): AudioProbe | null {
  return probe;
}

export function onAudioProbe(listener: () => void): () => void {
  probeListeners.add(listener);
  return () => { probeListeners.delete(listener); };
}
