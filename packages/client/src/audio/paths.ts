/**
 * Where real audio lives, and what the game expects to find there.
 *
 * The same shape `world/art-paths.ts` holds for pictures: every path is a fact
 * about `assets/`, stated once, and nothing derives a filename anywhere else.
 * Nothing here imports the engine or Pixi — the verify gate (tools/audio) and
 * the browser both read this table, and a tool that had to boot a renderer to
 * learn a filename would be a tool nobody runs.
 *
 * ---------------------------------------------------------------------------
 * REAL FILES ARE AN UPGRADE, NEVER A REQUIREMENT
 *
 * Chapter 8 shipped synthesized placeholders (audio/synth.ts) precisely so the
 * sound source could be decided later. That stays true after real files exist:
 * the engine asks for a file, and a cue with no file — or a file that will not
 * decode, or a device with no network — plays its recipe instead. Silence is
 * never the failure mode, and neither is a missing-asset error at a table.
 */

import type { CueId } from "./cue";

/** Opus in a WebM container: small, and every browser this game runs on
    decodes it. One format, so nothing has to negotiate. */
export const AUDIO_EXTENSION = "webm";

export function cueUrl(id: CueId): string {
  return `/assets/audio/cues/${id}.${AUDIO_EXTENSION}`;
}

export function musicUrl(biome: string): string {
  return `/assets/audio/music/${biome}.${AUDIO_EXTENSION}`;
}

/**
 * What each cue is *for*, in the words somebody sourcing audio needs.
 *
 * This is the brief — the table a generator prompts from and a person shopping
 * a pack reads. Durations are targets rather than gates: the game plays what
 * it is given, and the number says what will sound right against the beat it
 * lands on (the roll animation is ~1.5s, a combat beat is ≤400ms apart).
 */
export interface CueSpec {
  /** What the sound is, for a prompt or a shopping list. */
  brief: string;
  /** Target length in seconds. */
  seconds: number;
}

export const CUE_SPECS: Record<CueId, CueSpec> = {
  dice: {
    brief:
      "Wooden dice tumbling in a cupped hand and settling on a table, ending with one clear landing tick. Warm, toy-like, not casino.",
    seconds: 1.4,
  },
  attack: {
    brief:
      "A soft padded impact — a storybook thump, like a cushion hitting a drum. Physical but never violent, no metal, no blood.",
    seconds: 0.4,
  },
  heal: {
    brief: "Three rising bell tones, gentle and clean, like a small glass chime.",
    seconds: 0.6,
  },
  down: {
    brief:
      "A soft descending slump — somebody sitting down heavily in leaves. Sad but safe: nobody is hurt, they are having a rest.",
    seconds: 0.7,
  },
  revive: {
    brief: "A short rising flutter, like a bird taking off. Relief, not fanfare.",
    seconds: 0.5,
  },
  "level-up": {
    brief: "A four-note major arpeggio on a bright toy xylophone. Proud, quick, unmistakably good news.",
    seconds: 0.8,
  },
  transform: {
    brief:
      "A rising magical shimmer that blooms into a warm chord — the biggest moment in the game, a child becoming something new. Wondrous, never spooky.",
    seconds: 1.8,
  },
  "scene-enter": {
    brief: "One soft woody knock with a little air around it. A page turning, not a door slamming.",
    seconds: 0.3,
  },
  choice: {
    brief: "A tiny bright blip, like a pebble dropped in water. Barely there.",
    seconds: 0.15,
  },
  "encounter-begin": {
    brief:
      "Two low woody drum hits, close together. Something is about to happen and it is exciting, not frightening.",
    seconds: 0.8,
  },
  victory: {
    brief:
      "A short warm major chord with a rising sparkle over it. A cheer, not a fanfare — the party won and walks on.",
    seconds: 1.4,
  },
  tap: {
    brief: "A very short soft click. Felt more than heard.",
    seconds: 0.08,
  },
  error: {
    brief: "Two low gentle pulses. Audibly 'not that', never harsh or buzzing.",
    seconds: 0.3,
  },
};

/**
 * The music brief per biome.
 *
 * Keyed by biome id, like the backdrops. A biome with no entry still gets
 * music — `synth.ts`'s default pad — so the seventeen Red Sky destinations
 * arrive playable before anybody composes for them.
 */
export const MUSIC_SPECS: Record<string, CueSpec> = {
  forest: {
    brief:
      "A slow, quiet loop for a friendly enchanted wood at dusk: soft strings or warm pad, a little mysterious, gentle enough to talk over. No drums, no melody that pulls focus — this plays under a family reading aloud.",
    seconds: 45,
  },
};
