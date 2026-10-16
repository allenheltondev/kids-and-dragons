/** Riftlight's composed source scores. Rendered exports keep this out of the live bundle. */
import { MUSIC_SPECS } from "./paths";
import type { ProceduralSound, Voice } from "./procedural";

/** D–F–A–G–E: five hummable notes, ending on the unresolved second. */
export const RIFT_MOTIF = [0, 3, 7, 5, 2] as const;
export const RIFT_MUSIC_IDS = ["riftlight-theme", "riftlight-paths", "riftlight-sky", "riftlight-coast"] as const;

function arrangement(id: (typeof RIFT_MUSIC_IDS)[number]): ProceduralSound {
  const voices: Voice[] = [];
  const base = 146.8324;
  const pitch = (step: number) => base * 2 ** (step / 12);
  const colour = id.slice("riftlight-".length);
  // Open D minor/add9 bed, changing inversion every ten seconds. Short voices
  // end inside the loop; the opening and tail remain quiet without a hard cut.
  for (let bar = 0; bar < 4; bar++) {
    const chord = [[0, 7, 14, 15], [-5, 0, 7, 14], [-9, 0, 7, 14], [-5, 0, 3, 14]][bar]!;
    for (const [i, step] of chord.entries()) voices.push({
      at: bar * 10, duration: 10, freq: pitch(step) / (colour === "paths" ? 2 : 1),
      gain: colour === "sky" ? 0.035 : 0.045, swell: true,
      pan: (i - 1.5) * 0.28, vibrato: [0.18 + i * 0.03, 4],
      partials: colour === "coast" ? [[1, 1], [3, 0.20], [5, 0.055]] : [[1, 1], [2, 0.12], [3, 0.035]],
    });
    const spacing = colour === "paths" ? 1.4 : 1.15;
    for (const [i, step] of RIFT_MOTIF.entries()) voices.push({
      at: 1 + bar * 10 + i * spacing + (colour === "coast" ? [0, 0.14, -0.08, 0.17, 0][i]! : 0),
      duration: colour === "sky" ? 2.6 : colour === "paths" ? 2.5 : 2.1,
      freq: pitch(step) * (colour === "sky" || colour === "theme" ? 2 : 1),
      gain: colour === "theme" ? 0.075 : colour === "coast" ? 0.052 : 0.060,
      swell: colour === "sky" || colour === "paths", attack: 0.09, decay: 2.5,
      pan: colour === "sky" ? (i - 2) * 0.15 : (bar % 2 ? -0.15 : 0.15),
      vibrato: [colour === "sky" ? 0.35 : 3.7, colour === "sky" ? 16 : 4],
      partials: colour === "coast" ? [[1, 1], [3, 0.25], [5, 0.06]] : [[1, 1], [2, 0.10], [3, 0.025]],
    });
    if (colour === "paths" || colour === "theme") {
      // Sparse ice/glass overtones, leaving the low path melody in front.
      voices.push({ at: bar * 10 + 3, duration: 4, freq: pitch(bar % 2 ? 7 : 14) * 2,
        gain: 0.018, attack: 0.03, decay: 5, partials: [[1, 1], [2.76, 0.13], [5.4, 0.025]], pan: bar % 2 ? 0.45 : -0.45 });
    }
    if (colour === "sky") {
      voices.push({ at: bar * 10, duration: 10, freq: 0, noise: true, cutoff: 850, highpass: 220,
        gain: 0.025, swell: true, pan: bar % 2 ? -0.5 : 0.5 });
      // A distant breathy low bend, suggestive of a whale without a creature call.
      voices.push({ at: bar * 10 + 2, duration: 7, freq: pitch(-12), endFreq: pitch(-10),
        gain: 0.018, swell: true, vibrato: [0.15, 18] });
    }
    if (colour === "coast") for (const [i, offset] of [0, 1.2, 2.5, 3.6, 5.0, 6.1, 7.5, 8.7].entries()) {
      voices.push({ at: bar * 10 + offset, duration: 0.24, freq: 0, noise: true,
        cutoff: 900, highpass: 170, gain: i % 2 ? 0.025 : 0.04, attack: 0.025, decay: 5, pan: i % 2 ? -0.25 : 0.25 });
      if (i % 2 === 0) voices.push({ at: bar * 10 + offset, duration: 0.65,
        freq: pitch(-12), endFreq: pitch(-12) * 0.98, gain: 0.025, attack: 0.03 });
    }
  }
  return { id, label: id.replaceAll("-", " "), group: "Music", ...MUSIC_SPECS[id]!, loop: true, voices, echo: colour === "sky" ? 0.22 : 0.14 };
}

export function riftlightMusic(): ProceduralSound[] {
  return RIFT_MUSIC_IDS.map(arrangement);
}
