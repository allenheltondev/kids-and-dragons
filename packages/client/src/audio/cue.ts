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
 *   uninstalled path for free, the same way `silentNarrator` runs the
 *   LLM-off path.
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
  | "error";

export type AmbienceId = "gate-hum" | "cavern-air";

export interface AudioSink {
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
