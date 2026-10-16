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
  return `/assets/audio/music/${MUSIC_BY_BIOME[biome] ?? biome}.${AUDIO_EXTENSION}`;
}

/** Reuse approved arrangements across related places without duplicating files. */
export const MUSIC_BY_BIOME: Record<string, string> = {
  enchanted_woods: "forest", mosshome: "forest", bramblewood: "forest",
  glacier_of_origins: "riftlight-paths", frostfang_peaks: "riftlight-paths",
  sky_islands: "riftlight-sky",
  sallow_wastelands: "riftlight-coast", bone_yard: "riftlight-coast",
  whispering_marsh: "gemfall-marsh", mermaid_cove: "gemfall-marsh",
  exchange: "gemfall-citadel", sunward_fields: "gemfall-citadel", plains: "gemfall-citadel",
  eastern_plains: "gemfall-citadel", stone_crossing: "gemfall-citadel",
  red_sky_foothills: "gemfall-mountain", mount_red_sky: "gemfall-mountain",
};

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
  "rift-open": { brief: "A soft inward rush of air and a glassy rising shimmer, like a breath held. Wonder, not threat.", seconds: 2.0 },
  "rift-collapse": { brief: "The same shimmer folding closed and settling into silence. Gentle, never a bang.", seconds: 1.6 },
  "chime-sour": { brief: "One small Riftseeker chime struck, its note bending flat and wobbling: not yet. One continuous wavering note, no returning strike.", seconds: 1.4 },
  "chime-echo": { brief: "The same chime struck, and its note coming cleanly back a moment later: you can come back. Two clearly separated clean strikes, easy to distinguish from chime-sour across a room.", seconds: 1.8 },
  "attune-hum": { brief: "A low warm hum that answers someone, swelling in once. A short consonant answer, distinct from the Gate's sustained beating drone.", seconds: 3.0 },
  riftspark: { brief: "A quick bright sparkle and a small rising tone: you got a boost.", seconds: 0.9 },
  anchor: { brief: "A deep steady settling tone, like a stone set into place: the land holding still. A gentle grounded answer to an old wandering melody.", seconds: 2.0 },
  "party-ready": { brief: "Two soft hand drum taps and a warm rising wooden-string response. Ready to travel, no chimes.", seconds: 1.2 },
  "gem-pickup": { brief: "Three small rising crystal notes with a shimmering tail.", seconds: 1.1 },
  "gate-hum": { brief: "A low warm pulsing hum shared by the Gate and gemstones. Mysterious, not threatening.", seconds: 8 },
  "citadel-bell": { brief: "One warm bronze watch bell with slowly fading overtones.", seconds: 4 },
  "seal-awakening": { brief: "A gentle deep mineral rumble beneath crystal chimes. Awe rather than alarm.", seconds: 6 },
  "cavern-air": { brief: "Soft filtered cavern air and occasional resonant mineral droplets.", seconds: 12 },
  dice: {
    brief:
      "Irregular dry wooden dice contacts, tumbling and settling to a final tick. No pitched descent.",
    seconds: 1.4,
  },
  attack: {
    brief:
      "A soft padded impact — a storybook thump, like a cushion hitting a drum. Physical but never violent, no metal, no blood.",
    seconds: 0.4,
  },
  heal: {
    brief: "A warm breath-like chord swelling gently into relief; distinct from crystal pickups.",
    seconds: 0.6,
  },
  down: {
    brief:
      "A soft descending slump — somebody sitting down heavily in leaves. Sad but safe: nobody is hurt, they are having a rest.",
    seconds: 0.7,
  },
  revive: {
    brief: "A short rising airy flutter, like a bird taking off. Relief, with no final bell note.",
    seconds: 0.5,
  },
  "level-up": {
    brief: "A high-register four-note major arpeggio on a bright toy xylophone. Proud, quick, unmistakably good news.",
    seconds: 0.8,
  },
  transform: {
    brief:
      "A broad rising rush of air blooming into a soft luminous chord, without chimes. Wondrous, never spooky.",
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
      "Two soft drum pulses and a warm breathy chord resolving home. No bell fanfare.",
    seconds: 1.4,
  },
  tap: {
    brief: "A very short soft click. Felt more than heard.",
    seconds: 0.08,
  },
  "page-turn": {
    brief: "A quick soft paper flick, like turning a page in an old explorer's journal. Just the swish, no chime.",
    seconds: 0.3,
  },
  error: {
    brief: "Two low gentle pulses. Audibly 'not that', never harsh or buzzing.",
    seconds: 0.3,
  },
  bonk: {
    brief: "A cartoon bonk on the head for a natural 1: a hollow wooden knock, then a small wobbly boing. Silly, never painful.",
    seconds: 0.7,
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
  "riftlight-theme": { brief: "The five-note D–F–A–G–E rift motif stated plainly over warm strings and a soft glassy shimmer. Curious, a little wondering, gentle enough to talk over.", seconds: 40 },
  "riftlight-paths": { brief: "Slow, cold and still: sustained low tones, ice-like bell overtones, the D–F–A–G–E rift motif carried by a low voice. Memory and patience.", seconds: 40 },
  "riftlight-sky": { brief: "Airy and drifting: high breathy winds, slow swells like distant whale song, the D–F–A–G–E rift motif floating in and out.", seconds: 40 },
  "riftlight-coast": { brief: "Brackish and restless: low reeds, a slightly uneven pulse, wet percussion, the D–F–A–G–E rift motif slipping in rhythm.", seconds: 40 },
  "entry-home": { brief: "Welcoming acoustic plucks, soft hand percussion and a sparse flute phrase in a lilting six-beat rhythm.", seconds: 36 },
  "entry-lobby": { brief: "Quiet fireside strings and occasional mellow reed answers, with soft outdoor air. Unhurried, no percussion or creature calls.", seconds: 40 },
  "gemfall-marsh": { brief: "Breathy reed phrases over suspended drones and soft marsh air. Curious and unhurried.", seconds: 32 },
  "gemfall-citadel": { brief: "Light plucked strings, alternating bass, and a gentle travelling pulse. Warm and purposeful.", seconds: 32 },
  "gemfall-mountain": { brief: "Deep open fifths, slow mineral breaths, and distant sustained tones. Spacious and still.", seconds: 32 },
  forest: {
    brief:
      "A slow, quiet loop for a friendly enchanted wood at dusk: soft strings or warm pad, a little mysterious, gentle enough to talk over. No drums, no melody that pulls focus — this plays under a family reading aloud.",
    seconds: 45,
  },
};
