/** Approved procedural source bank. Exported samples keep this renderer out of the game bundle. */
import { CUE_SPECS, MUSIC_SPECS } from "./paths";
import type { CueId } from "./cue";

export interface Voice {
  at: number;
  duration: number;
  freq: number;
  endFreq?: number;
  gain: number;
  attack?: number;
  pan?: number;
  noise?: boolean;
  cutoff?: number;
  highpass?: number;
  swell?: boolean;
  decay?: number;
  /** Slow pitch motion, in Hz and cents, for breath and bowed voices. */
  vibrato?: [number, number];
  /** Ratios and relative amplitudes; non-integer ratios give bells their character. */
  partials?: [number, number][];
}
export interface ProceduralSound {
  id: string;
  label: string;
  group: "Game effects" | "Gemfall effects" | "Music";
  brief: string;
  seconds: number;
  loop: boolean;
  voices: Voice[];
  echo: number;
}

const bell = (freq: number, at: number, duration: number, gain = 0.3, pan = 0): Voice => ({
  freq, at, duration, gain, pan, attack: 0.006,
  partials: [[1, 1], [2.76, 0.2], [5.4, 0.05]],
});
const wood = (at: number, gain = 0.3, freq = 420): Voice[] => [
  { at, duration: 0.075, freq, endFreq: freq * 0.65, gain, attack: 0.003, partials: [[1, 1], [1.57, 0.3]] },
  { at, duration: 0.04, freq: 0, gain: gain * 0.45, noise: true, cutoff: 1800, attack: 0.002 },
];
const notes = (frequencies: number[], spacing: number, duration: number): Voice[] =>
  frequencies.map((freq, i) => bell(freq, i * spacing, duration, 0.22, (i % 2 ? 1 : -1) * 0.2));

const cueVoices: Partial<Record<CueId, Voice[]>> = {
  "party-ready": [...wood(0, 0.1, 180), ...wood(0.18, 0.08, 220), ...[196, 261.63, 329.63].map((freq, i) => ({ at: 0.25 + i * 0.12, duration: 0.6, freq, gain: 0.1, attack: 0.012, partials: [[1, 1], [2, 0.15]] as [number, number][] }))],
  // Irregular short contacts, rather than a descending pitched percussion scale.
  dice: [0.015, 0.047, 0.105, 0.14, 0.218, 0.256, 0.345, 0.403, 0.515, 0.64, 0.81, 1.04, 1.23].flatMap((at, i) => [
    { at, duration: 0.025 + (i % 3) * 0.006, freq: 0, noise: true, cutoff: 3200 + (i % 4) * 360, highpass: 650, gain: 0.24 - i * 0.008, attack: 0.0008, decay: 8, pan: (i % 3 - 1) * 0.25 },
    { at, duration: 0.025, freq: [210, 275, 235, 310][i % 4]!, gain: 0.025, attack: 0.0008, decay: 9 },
  ]),
  // A hollow wooden knock, then a wobbly boing on top (vibrato does the wobble).
  bonk: [
    { at: 0, duration: 0.16, freq: 540, endFreq: 170, gain: 0.32, attack: 0.002, decay: 7, partials: [[1, 1], [2.7, 0.25]] },
    { at: 0, duration: 0.05, freq: 0, noise: true, cutoff: 1800, highpass: 400, gain: 0.14, attack: 0.001, decay: 10 },
    { at: 0.13, duration: 0.5, freq: 340, endFreq: 250, gain: 0.12, attack: 0.01, decay: 3, vibrato: [11, 60] },
  ],
  attack: [
    { at: 0, duration: 0.3, freq: 130, endFreq: 52, gain: 0.5, attack: 0.004 },
    { at: 0, duration: 0.11, freq: 0, gain: 0.22, noise: true, cutoff: 850, attack: 0.004 },
  ],
  heal: [
    ...[261.63, 329.63, 392].map((freq, i) => ({ at: 0, duration: 0.58, freq, gain: 0.13, swell: true, pan: (i - 1) * 0.2, partials: [[1, 1], [2, 0.07]] as [number, number][] })),
    { at: 0, duration: 0.58, freq: 0, noise: true, cutoff: 1200, gain: 0.07, swell: true },
  ],
  down: [
    { at: 0, duration: 0.62, freq: 196, endFreq: 98, gain: 0.3, attack: 0.02 },
    { at: 0.08, duration: 0.5, freq: 0, gain: 0.16, noise: true, cutoff: 650, attack: 0.03 },
  ],
  revive: [
    { at: 0, duration: 0.38, freq: 262, endFreq: 523, gain: 0.24, attack: 0.045 },
    ...[0.02, 0.09, 0.16].map((at) => ({ at, duration: 0.1, freq: 0, gain: 0.12, noise: true, cutoff: 2200, attack: 0.03 })),
  ],
  "level-up": notes([523.26, 659.26, 784, 1046.5], 0.12, 0.4),
  transform: [
    { at: 0, duration: 1.55, freq: 0, noise: true, cutoff: 1800, gain: 0.13, swell: true },
    { at: 0, duration: 1.35, freq: 130.81, endFreq: 261.63, gain: 0.11, swell: true },
    ...[261.63, 329.63, 392].map((freq, i) => ({ at: 0.65, duration: 1.1, freq, gain: 0.12, swell: true, pan: (i - 1) * 0.3, partials: [[1, 1], [2, 0.14], [3, 0.04]] as [number, number][] })),
  ],
  "scene-enter": [...wood(0.015, 0.14, 340), { at: 0, duration: 0.24, freq: 0, gain: 0.09, noise: true, cutoff: 1100, attack: 0.03 }],
  choice: [bell(880, 0, 0.14, 0.16)],
  "encounter-begin": [0, 0.25].map((at, i) => ({ at, duration: 0.5, freq: 125 + i * 25, endFreq: 65 + i * 12, gain: 0.32, attack: 0.009, partials: [[1, 1], [1.5, 0.15]] })),
  victory: [
    // A gentle two-pulse drum lift and a breathy chord resolving home.
    ...[0, 0.22].map((at) => ({ at, duration: 0.18, freq: 115, endFreq: 68, gain: 0.16, attack: 0.005 })),
    ...[196, 246.94, 293.66].map((freq, i) => ({ at: 0.06, duration: 0.43, freq, gain: 0.08, swell: true, pan: (i - 1) * 0.2 })),
    ...[261.63, 329.63, 392].map((freq, i) => ({ at: 0.43, duration: 0.92, freq, gain: 0.16, swell: true, pan: (i - 1) * 0.25, partials: [[1, 1], [2, 0.16], [3, 0.04]] as [number, number][] })),
  ],
  tap: wood(0, 0.09, 750).map((v) => ({ ...v, duration: 0.06 })),
  error: [0, 0.14].map((at) => ({ at, duration: 0.13, freq: 196, endFreq: 174.61, gain: 0.16, attack: 0.012 })),
};

function music(id: string, label: string, brief: string, seconds: number, base: number, colour: "forest" | "marsh" | "citadel" | "mountain"): ProceduralSound {
  const voices: Voice[] = [];
  const pitch = (step: number) => base * 2 ** (step / 12);
  if (colour === "forest") {
    // Broad overlapping bowed swells, no beat and no foreground melody.
    for (let phrase = 0; phrase < 4; phrase++) for (const [i, step] of [[0, 7, 14, 16], [-3, 4, 9, 12], [-7, 0, 5, 9], [-5, 2, 7, 14]][phrase]!.entries()) voices.push({
      at: phrase * seconds / 4, duration: seconds / 4 * 1.65, freq: pitch(step), gain: 0.07,
      swell: true, vibrato: [0.24 + i * 0.06, 5], pan: (i - 1.5) * 0.3,
      partials: [[1, 1], [2, 0.13], [3, 0.035]],
    });
  } else if (colour === "marsh") {
    // A suspended drone, air, and answering reed phrases rather than bells.
    for (let phrase = 0; phrase < 4; phrase++) {
      const at = phrase * 8;
      for (const step of [0, 7]) voices.push({ at, duration: 12, freq: pitch(step) / 2, gain: 0.065, swell: true });
      voices.push({ at, duration: 10, freq: 0, noise: true, cutoff: 650, highpass: 180, gain: 0.06, swell: true, pan: phrase % 2 ? 0.6 : -0.6 });
      [9, 7, 2, 5].slice(0, phrase % 2 ? 3 : 2).forEach((step, i) => voices.push({
        at: at + 1.3 + i * 1.9, duration: 2.4, freq: pitch(step) * 2, gain: 0.055,
        swell: true, vibrato: [4.3, 7], pan: phrase % 2 ? -0.35 : 0.35,
        partials: [[1, 1], [2, 0.3], [3, 0.1]],
      }));
    }
  } else if (colour === "citadel") {
    // Light plucked strings, alternating bass, and a gentle travelling pulse.
    const chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
    for (let bar = 0; bar < 8; bar++) {
      const at = bar * 4, chord = chords[bar % 4]!;
      voices.push({ at, duration: 2.2, freq: pitch(chord[0]!) / 2, gain: 0.12, attack: 0.008, decay: 4, partials: [[1, 1], [2, 0.18]] });
      for (let beat = 0; beat < 4; beat++) voices.push({
        at: at + beat * 0.8 + (beat === 3 ? 0.2 : 0), duration: 1.1,
        freq: pitch(chord[[0, 2, 1, 2][beat]!]!) * 2, gain: 0.085,
        attack: 0.005, decay: 7, pan: beat % 2 ? 0.35 : -0.35,
        partials: [[1, 1], [2, 0.24], [3, 0.09], [4, 0.035]],
      });
      if (bar % 2 === 0) voices.push({ at: at + 2, duration: 0.15, freq: 92, endFreq: 55, gain: 0.055, attack: 0.004 });
    }
  } else {
    // Deep open fifths with slow mineral breaths, no travelling rhythm.
    for (let phrase = 0; phrase < 4; phrase++) {
      const at = phrase * 8, root = [0, -5, -3, 0][phrase]!;
      for (const [i, step] of [root - 12, root, root + 7].entries()) voices.push({
        at, duration: 14, freq: pitch(step), gain: i === 0 ? 0.11 : 0.055,
        swell: true, vibrato: [0.15, 3], pan: (i - 1) * 0.5,
        partials: [[1, 1], [2, 0.08], [3, 0.055]],
      });
      voices.push({ at: at + 1, duration: 9, freq: 0, noise: true, cutoff: 180, gain: 0.14, swell: true });
      if (phrase % 2 === 0) voices.push({ at: at + 3.5, duration: 5, freq: pitch(root + 19), gain: 0.045, swell: true, vibrato: [0.4, 4], pan: phrase === 0 ? -0.55 : 0.55 });
    }
  }
  return { id, label, group: "Music", brief, seconds, loop: true, voices, echo: colour === "citadel" ? 0.09 : colour === "mountain" ? 0.36 : 0.22 };
}

/** Entry arrangements: different meters and instrumentation from the quest beds. */
function entryMusic(): ProceduralSound[] {
  const home: Voice[] = [], lobby: Voice[] = [];
  const chords = [[0, 4, 7], [-5, 0, 4], [-3, 0, 5], [-7, -3, 2]];
  for (let bar = 0; bar < 12; bar++) {
    const chord = chords[Math.floor(bar / 3)]!;
    for (let beat = 0; beat < 6; beat++) {
      const at = bar * 3 + beat * 0.5;
      home.push({ at, duration: 0.85, freq: 196 * 2 ** (chord[beat % 3]! / 12), gain: beat % 3 === 0 ? 0.045 : 0.026, attack: 0.008, decay: 4, pan: beat % 2 ? 0.25 : -0.25, partials: [[1, 1], [2, 0.18], [3, 0.05]] });
      if (beat === 0 || beat === 3) home.push({ at, duration: 0.15, freq: 110, endFreq: 65, gain: 0.022, attack: 0.005 });
    }
    if (bar % 3 === 1) for (const [i, step] of [7, 9, 7, 4].entries()) home.push({ at: bar * 3 + i * 0.5, duration: 0.8, freq: 392 * 2 ** (step / 12), gain: 0.025, swell: true, vibrato: [4, 3] });
  }
  for (let phrase = 0; phrase < 4; phrase++) {
    for (const [i, step] of chords[phrase]!.entries()) lobby.push({ at: phrase * 10, duration: 16, freq: 146.83 * 2 ** (step / 12), gain: 0.034, swell: true, pan: (i - 1) * 0.35, vibrato: [0.2, 3], partials: [[1, 1], [2, 0.08]] });
    lobby.push({ at: phrase * 10 + 4, duration: 3.5, freq: 293.66 * 2 ** (chords[phrase]![1]! / 12), gain: 0.025, swell: true, vibrato: [3.8, 4] });
    lobby.push({ at: phrase * 10, duration: 15, freq: 0, noise: true, cutoff: 350, gain: 0.012, swell: true });
  }
  return [
    { id: "entry-home", label: "Welcome to the realm", group: "Music", ...MUSIC_SPECS["entry-home"]!, loop: true, voices: home, echo: 0.12 },
    { id: "entry-lobby", label: "Around the campfire", group: "Music", ...MUSIC_SPECS["entry-lobby"]!, loop: true, voices: lobby, echo: 0.2 },
  ];
}

export function proceduralSounds(): ProceduralSound[] {
  const game: ProceduralSound[] = (Object.entries(CUE_SPECS) as [CueId, (typeof CUE_SPECS)[CueId]][]).filter(([id]) => cueVoices[id]).map(([id, spec]) => ({
    id, label: id.replaceAll("-", " "), group: "Game effects", ...spec,
    loop: false, voices: cueVoices[id]!, echo: id === "dice" ? 0 : ["heal", "transform", "victory", "level-up"].includes(id) ? 0.15 : 0.03,
  }));
  const extras: ProceduralSound[] = [
    { id: "gem-pickup", label: "Gem pickup", brief: "Three small rising crystal notes with a shimmering tail.", seconds: 1.1, voices: notes([659.25, 783.99, 1046.5], 0.13, 0.65), echo: 0.22 },
    { id: "gate-hum", label: "Hollow Gate hum", brief: "A low warm pulsing hum shared by the Gate and gemstones. Mysterious, not threatening.", seconds: 8, voices: [110, 110.7, 165, 220.3].map((freq, i) => ({ at: 0, duration: 8, freq, gain: 0.07, attack: 1.2, pan: i % 2 ? 0.3 : -0.3 })), echo: 0.15 },
    { id: "citadel-bell", label: "Citadel bell", brief: "One warm bronze watch bell with slowly fading overtones.", seconds: 4, voices: [{ ...bell(293.66, 0, 3.9, 0.3), partials: [[1, 1], [2.02, 0.38], [2.76, 0.12], [4.1, 0.04]] }], echo: 0.24 },
    { id: "seal-awakening", label: "Seal awakening", brief: "A gentle deep mineral rumble beneath crystal chimes. Awe rather than alarm.", seconds: 6, voices: [{ at: 0, duration: 6, freq: 0, noise: true, cutoff: 160, gain: 0.2, attack: 1.3 }, { at: 0, duration: 6, freq: 65.41, endFreq: 73.42, gain: 0.18, attack: 1.5 }, ...[523.25, 659.25, 783.99].map((freq, i) => bell(freq, 1.2 + i * 0.8, 2.4, 0.08, i % 2 ? 0.4 : -0.4))], echo: 0.2 },
    { id: "cavern-air", label: "Cavern ambience", brief: "Soft filtered cavern air and occasional resonant mineral droplets.", seconds: 12, voices: [{ at: 0, duration: 12, freq: 0, noise: true, cutoff: 450, gain: 0.09, attack: 1.2 }, ...[0.6, 3.7, 7.3, 10.1].map((at, i) => bell([523.25, 392, 659.25, 440][i]!, at, 1.7, 0.075, i % 2 ? 0.5 : -0.5))], echo: 0.32 },
  ].map((spec) => ({ ...spec, group: "Gemfall effects", loop: false } as ProceduralSound));
  return [...game, ...extras, ...entryMusic(),
    music("forest", "Enchanted forest", MUSIC_SPECS.forest!.brief, MUSIC_SPECS.forest!.seconds, 130.81, "forest"),
    music("gemfall-marsh", "Marsh mysteries", "Breathy reed phrases over suspended drones and soft marsh air. Curious and unhurried.", 32, 110, "marsh"),
    music("gemfall-citadel", "Citadel discovery", "Light plucked strings, alternating bass, and a gentle travelling pulse. Warm and purposeful.", 32, 146.83, "citadel"),
    music("gemfall-mountain", "Under the mountain", "Deep open fifths, slow mineral breaths, and distant sustained tones. Spacious and still.", 32, 87.31, "mountain"),
  ];
}

/** Seeded noise makes every export reproducible. Output is stereo PCM, ready for AudioBuffer or WAV. */
export function renderProcedural(sound: ProceduralSound, sampleRate = 24000): [Float32Array, Float32Array] {
  const frames = Math.round(sound.seconds * sampleRate);
  const channels: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)];
  let seed = 0x12345678;
  for (const voice of sound.voices) {
    let phase = 0, filtered = 0, low = 0;
    const length = Math.round(voice.duration * sampleRate);
    const cutoff = 1 - Math.exp(-2 * Math.PI * (voice.cutoff ?? 2000) / sampleRate);
    const highpass = 1 - Math.exp(-2 * Math.PI * (voice.highpass ?? 0) / sampleRate);
    const pan = voice.pan ?? 0;
    const gains = [Math.cos((pan + 1) * Math.PI / 4), Math.sin((pan + 1) * Math.PI / 4)];
    for (let i = 0; i < length; i++) {
      let frame = Math.round(voice.at * sampleRate) + i;
      if (sound.loop) frame %= frames;
      else if (frame >= frames) break;
      const t = i / sampleRate, progress = i / length;
      const attack = Math.min(voice.attack ?? 0.008, voice.duration * 0.4);
      const envelope = voice.swell ? Math.sin(Math.PI * progress) ** 2
        : (1 - Math.exp(-t / Math.max(attack / 3, 0.0003))) * Math.exp(-progress * (voice.decay ?? (voice.noise ? 3 : 4.5))) * Math.min(1, (voice.duration - t) / Math.min(0.05, voice.duration * 0.2));
      let value: number;
      if (voice.noise) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const noise = (seed >>> 0) / 0xffffffff * 2 - 1;
        filtered += cutoff * (noise - filtered);
        low += highpass * (filtered - low);
        value = filtered - low;
      } else {
        const [rate, cents] = voice.vibrato ?? [0, 0];
        const detune = 2 ** (Math.sin(2 * Math.PI * rate * t) * cents / 1200);
        phase += 2 * Math.PI * (voice.freq + ((voice.endFreq ?? voice.freq) - voice.freq) * progress) * detune / sampleRate;
        value = (voice.partials ?? [[1, 1]]).reduce((sum, [ratio, weight]) => sum + Math.sin(phase * ratio) * weight, 0);
      }
      for (let ch = 0; ch < 2; ch++) channels[ch]![frame] = channels[ch]![frame]! + value * envelope * voice.gain * gains[ch]!;
    }
  }
  // A short stereo room, implemented without feedback so tails remain bounded.
  const dry = channels.map((c) => c.slice());
  for (const [delay, weight] of [[0.113, 1], [0.229, 0.6], [0.347, 0.3]]) {
    const offset = Math.round(delay! * sampleRate);
    for (let i = 0; i < frames; i++) {
      const source = i - offset;
      if (!sound.loop && source < 0) continue;
      const index = (source + frames) % frames;
      channels[0][i] = channels[0][i]! + dry[1]![index]! * sound.echo * weight!;
      channels[1][i] = channels[1][i]! + dry[0]![index]! * sound.echo * weight!;
    }
  }
  let peak = 0, squares = 0;
  for (const channel of channels) for (const value of channel) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
  const rms = Math.sqrt(squares / (frames * 2));
  const target = sound.id === "entry-lobby" ? 0.035 : sound.id === "party-ready" ? 0.075 : sound.group === "Music" ? 0.055 : sound.id === "tap" ? 0.04 : 0.12;
  const scale = Math.min(target / Math.max(rms, 0.00001), 0.6 / Math.max(peak, 0.00001));
  for (const channel of channels) for (let i = 0; i < frames; i++) {
    const edge = sound.loop ? 1 : Math.min(1, i / (sampleRate * 0.004), (frames - 1 - i) / (sampleRate * 0.012));
    channel[i] = channel[i]! * scale * edge;
  }
  return channels;
}
