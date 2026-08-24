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
 * - **Silence is structural, not configured.** Phones in Party Mode never
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
  // The table's centrepiece (spec §2.2's ~1.5s roll).
  | "dice"
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
  | "error";

export interface AudioSink {
  /** Play one cue, now. Fire and forget. */
  cue(id: CueId): void;
  /**
   * The music for where the party is standing, by biome id — or null for
   * silence (the lobby, or no chapter loaded). Idempotent: the same biome
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
