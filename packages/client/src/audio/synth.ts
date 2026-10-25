/**
 * The placeholder sounds, as data.
 *
 * Roadmap open item 2 — licensed pack, AI-generated, or commissioned — is
 * Allen's call and hasn't been made, so nothing here is meant to survive it.
 * What *is* meant to survive is the shape: a cue is a recipe the engine
 * renders, and swapping a recipe for a sample file later changes this table
 * and nothing else. Synthesis was chosen for the placeholders over bundled
 * audio files because it weighs nothing, has no licence, and sounds
 * *deliberately* provisional — nobody will mistake a sine chirp for the
 * final dice.
 *
 * The recipes aim for "gentle toy", not "game juice": short, quiet, and in a
 * major key wherever a pitch is implied. An eight-year-old's living room at
 * bedtime is the acoustic target (spec §1).
 */

import { DICE_CONTACT_MS } from "../dice-timing";
import type { CueId } from "./cue";

/** One scheduled voice inside a cue. */
export interface Tone {
  /** An oscillator shape, or "noise" for a white-noise burst. */
  type: OscillatorType | "noise";
  /** Start and end frequency in Hz, linearly swept. Ignored for noise. */
  freq: [number, number];
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds from `at` to silence. */
  duration: number;
  /** Peak gain, 0..1, before the engine's own sfx/master stages. */
  gain: number;
}

/* Pitches, so the recipes read as music rather than magic numbers. */
const C4 = 262, E4 = 330, G4 = 392, C5 = 523, E5 = 659, G5 = 784, A5 = 880;

export const CUE_TONES: Record<CueId, Tone[]> = {
  "rift-open": [
    { type: "noise", freq: [0, 0], at: 0, duration: 1.5, gain: 0.025 },
    { type: "sine", freq: [294, 587], at: 0.12, duration: 1.88, gain: 0.075 },
    { type: "sine", freq: [880, 1175], at: 0.6, duration: 1.4, gain: 0.025 },
  ],
  "rift-collapse": [
    { type: "sine", freq: [587, 294], at: 0, duration: 1.6, gain: 0.075 },
    { type: "sine", freq: [1175, 440], at: 0, duration: 1.3, gain: 0.025 },
    { type: "noise", freq: [0, 0], at: 0.1, duration: 1.2, gain: 0.015 },
  ],
  // Close frequencies beat audibly as the single chime bends flat.
  "chime-sour": [
    { type: "sine", freq: [784, 698], at: 0, duration: 1.4, gain: 0.10 },
    { type: "sine", freq: [789, 704], at: 0, duration: 1.4, gain: 0.055 },
  ],
  // Silence between strikes carries the answer even on a mono speaker.
  "chime-echo": [
    { type: "sine", freq: [784, 784], at: 0, duration: 0.55, gain: 0.12 },
    { type: "sine", freq: [784, 784], at: 0.85, duration: 0.95, gain: 0.095 },
  ],
  "attune-hum": [
    { type: "sine", freq: [146.83, 146.83], at: 0, duration: 3, gain: 0.04 },
    { type: "sine", freq: [220, 220], at: 0.25, duration: 2.75, gain: 0.045 },
    { type: "sine", freq: [293.66, 293.66], at: 0.55, duration: 2.45, gain: 0.035 },
  ],
  riftspark: [
    { type: "sine", freq: [659, 988], at: 0, duration: 0.65, gain: 0.075 },
    { type: "triangle", freq: [1318, 1568], at: 0.18, duration: 0.72, gain: 0.025 },
  ],
  anchor: [
    { type: "sine", freq: [82.41, 73.42], at: 0, duration: 2, gain: 0.085 },
    { type: "triangle", freq: [146.83, 146.83], at: 0.12, duration: 1.88, gain: 0.04 },
    { type: "sine", freq: [220, 220], at: 0.3, duration: 1.7, gain: 0.025 },
  ],
  "party-ready": [196, 262, 330].map((freq, i) => ({ type: "triangle", freq: [freq, freq], at: i * 0.15, duration: 0.3, gain: 0.08 })),
  "gem-pickup": [659, 784, 1047].map((freq, i) => ({ type: "sine", freq: [freq, freq], at: i * 0.13, duration: 0.6, gain: 0.1 })),
  "gate-hum": [110, 110.7, 165].map((freq) => ({ type: "sine", freq: [freq, freq], at: 0, duration: 8, gain: 0.05 })),
  "citadel-bell": [{ type: "sine", freq: [294, 294], at: 0, duration: 4, gain: 0.12 }],
  "seal-awakening": [{ type: "noise", freq: [0, 0], at: 0, duration: 6, gain: 0.03 }, { type: "sine", freq: [65, 73], at: 0, duration: 6, gain: 0.08 }],
  "cavern-air": [{ type: "noise", freq: [0, 0], at: 0, duration: 12, gain: 0.02 }],
  /*
   * The roll is the one sound allowed to be busy: it underscores a ~1.5s
   * animation that the whole table watches (spec §2.2). A rattle of noise
   * that settles, then a landing tick.
   */
  dice: [
    { type: "noise", freq: [0, 0], at: 0, duration: 0.14, gain: 0.035 },
    ...DICE_CONTACT_MS.flatMap<Tone>((ms, i) => [
      { type: "noise", freq: [0, 0], at: ms / 1000, duration: 0.035, gain: 0.17 - i * 0.03 },
      { type: "triangle", freq: [320, 200], at: ms / 1000, duration: 0.06, gain: 0.09 - i * 0.012 },
    ]),
  ],
  // A natural 1: a hollow knock, then a little boing. Comic, not a fail buzzer.
  bonk: [
    { type: "triangle", freq: [520, 160], at: 0, duration: 0.14, gain: 0.2 },
    { type: "noise", freq: [0, 0], at: 0, duration: 0.04, gain: 0.08 },
    { type: "sine", freq: [330, 250], at: 0.12, duration: 0.45, gain: 0.09 },
  ],
  attack: [
    { type: "sine", freq: [130, 55], at: 0, duration: 0.16, gain: 0.22 },
    { type: "noise", freq: [0, 0], at: 0, duration: 0.08, gain: 0.1 },
  ],
  heal: [
    { type: "sine", freq: [C4, C4], at: 0, duration: 0.12, gain: 0.12 },
    { type: "sine", freq: [E4, E4], at: 0.1, duration: 0.12, gain: 0.12 },
    { type: "sine", freq: [G4, G4], at: 0.2, duration: 0.2, gain: 0.12 },
  ],
  // "Knocked down, never dead" (spec §7.3): a slump, not a death knell.
  down: [{ type: "triangle", freq: [220, 110], at: 0, duration: 0.45, gain: 0.16 }],
  revive: [{ type: "triangle", freq: [C4, C5], at: 0, duration: 0.35, gain: 0.14 }],
  "level-up": [
    { type: "square", freq: [C4, C4], at: 0, duration: 0.09, gain: 0.08 },
    { type: "square", freq: [E4, E4], at: 0.09, duration: 0.09, gain: 0.08 },
    { type: "square", freq: [G4, G4], at: 0.18, duration: 0.09, gain: 0.08 },
    { type: "square", freq: [C5, C5], at: 0.27, duration: 0.25, gain: 0.1 },
  ],
  // Spec §8.1's "the whole party stops to watch" — the longest cue after the
  // dice, sized to the cutscene's opening rather than its whole 2s hold.
  transform: [
    { type: "sine", freq: [200, 1100], at: 0, duration: 1.1, gain: 0.1 },
    { type: "noise", freq: [0, 0], at: 0.5, duration: 0.6, gain: 0.06 },
    { type: "sine", freq: [C5, C5], at: 1.1, duration: 0.4, gain: 0.12 },
  ],
  "scene-enter": [{ type: "sine", freq: [G4, G4], at: 0, duration: 0.22, gain: 0.07 }],
  choice: [{ type: "sine", freq: [E5, E5], at: 0, duration: 0.07, gain: 0.08 }],
  "encounter-begin": [
    { type: "triangle", freq: [110, 110], at: 0, duration: 0.6, gain: 0.14 },
    { type: "triangle", freq: [165, 165], at: 0.05, duration: 0.55, gain: 0.1 },
  ],
  victory: [
    { type: "sine", freq: [C4, C4], at: 0, duration: 1.1, gain: 0.1 },
    { type: "sine", freq: [E4, E4], at: 0, duration: 1.1, gain: 0.1 },
    { type: "sine", freq: [G4, G4], at: 0, duration: 1.1, gain: 0.1 },
    { type: "triangle", freq: [C5, G5], at: 0.15, duration: 0.5, gain: 0.08 },
  ],
  tap: [{ type: "square", freq: [A5, A5], at: 0, duration: 0.03, gain: 0.04 }],
  "page-turn": [{ type: "noise", freq: [0, 0], at: 0, duration: 0.15, gain: 0.04 }],
  // Two low pulses — audibly "no", never harsh.
  error: [
    { type: "square", freq: [196, 196], at: 0, duration: 0.08, gain: 0.06 },
    { type: "square", freq: [196, 196], at: 0.14, duration: 0.08, gain: 0.06 },
  ],
};

/**
 * The music beds: a chord per biome, hummed very quietly by the engine.
 *
 * A biome absent from this table gets `DEFAULT_PAD` rather than silence, so
 * the seventeen Realm of Red Sky backdrops (roadmap chapter 8, Allen's side)
 * arrive with music before anybody writes them a chord. Real tracks replace
 * this table the same way samples replace `CUE_TONES`.
 */
export const MUSIC_PADS: Record<string, number[]> = {
  // Riftlight's D minor/add9 harmony remains available when samples cannot load.
  "riftlight-finale": [73.42, 110, 146.83, 164.81],
  "riftlight-theme": [146.83, 220, 293.66, 329.63],
  "riftlight-paths": [73.42, 110, 146.83, 164.81],
  "riftlight-sky": [146.83, 220, 329.63],
  "riftlight-coast": [73.42, 110, 174.61, 220],
  glacier_of_origins: [73.42, 110, 146.83, 164.81],
  frostfang_peaks: [73.42, 110, 146.83, 164.81],
  sky_islands: [146.83, 220, 329.63],
  sallow_wastelands: [73.42, 110, 174.61, 220],
  bone_yard: [73.42, 110, 174.61, 220],
  // A low add9 — warm, a little mysterious, unmistakably "under the trees".
  forest: [98, 147, 196, 220],
};

export const DEFAULT_PAD: number[] = [110, 165, 220];

export function padFor(biome: string): number[] {
  return MUSIC_PADS[biome] ?? DEFAULT_PAD;
}

/**
 * Renders a recipe into a running context.
 *
 * Every voice gets its own envelope — a 10ms attack so nothing clicks, a
 * linear fall to silence — and connects through `out`, which is where the
 * engine hangs its sfx volume. Sources stop themselves; nothing here needs
 * cleanup.
 */
export function renderTones(
  ctx: BaseAudioContext,
  out: AudioNode,
  tones: Tone[],
  when: number,
): () => void {
  const stops: (() => void)[] = [];
  for (const tone of tones) {
    const start = when + tone.at;
    const end = start + tone.duration;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(tone.gain, start + 0.01);
    envelope.gain.linearRampToValueAtTime(0, end);
    envelope.connect(out);

    if (tone.type === "noise") {
      // A fresh short buffer per burst. At under a second of mono audio this
      // is cheaper than caching would be worth.
      const length = Math.max(1, Math.ceil(ctx.sampleRate * tone.duration));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(envelope);
      source.start(start);
      source.stop(end);
      stops.push(() => { try { source.stop(ctx.currentTime); } catch { /* Already ended. */ } });
    } else {
      const osc = ctx.createOscillator();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq[0], start);
      osc.frequency.linearRampToValueAtTime(tone.freq[1], end);
      osc.connect(envelope);
      osc.start(start);
      osc.stop(end);
      stops.push(() => { try { osc.stop(ctx.currentTime); } catch { /* Already ended. */ } });
    }
  }
  return () => { for (const stop of stops) stop(); };
}
