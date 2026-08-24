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
  /*
   * The roll is the one sound allowed to be busy: it underscores a ~1.5s
   * animation that the whole table watches (spec §2.2). A rattle of noise
   * that settles, then a landing tick.
   */
  dice: [
    { type: "noise", freq: [0, 0], at: 0, duration: 0.9, gain: 0.18 },
    { type: "square", freq: [700, 180], at: 0, duration: 0.7, gain: 0.05 },
    { type: "triangle", freq: [C5, C5], at: 1.0, duration: 0.12, gain: 0.12 },
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
): void {
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
    } else {
      const osc = ctx.createOscillator();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq[0], start);
      osc.frequency.linearRampToValueAtTime(tone.freq[1], end);
      osc.connect(envelope);
      osc.start(start);
      osc.stop(end);
    }
  }
}
