/**
 * The air over a camp whose backdrop has no painted accent (camp-accents.ts):
 * small things drifting through it, drawn rather than painted. Snow falls on
 * the frozen north, embers rise off the volcanic plain, and dandelion seeds
 * drift across the open plains on the breeze.
 *
 * Pure and Pixi-free: each mote's pose is a function of the time alone, so
 * camp.ts only draws it, and a still camp (reduced motion) shows none.
 */

export type CampAirKind = "snow" | "embers" | "seeds";

export interface CampAir {
  kind: CampAirKind;
  /** How many at once. */
  count: number;
  /** Its colour, and whether it adds light (an ember glows). */
  color: number;
  glow: boolean;
  /** Radius in backdrop-canvas pixels, smallest and largest. */
  size: [number, number];
  /** Where in the 1920 × 1080 painting they drift: the band of sky and ground they cross. */
  top: number;
  bottom: number;
  /** How long one takes to cross the band, in seconds, slowest and fastest. */
  period: [number, number];
  /** How far one sways side to side, in pixels. */
  sway: number;
  /** Which way across the band they go: snow down, embers up, seeds left to right. */
  drift: "down" | "up" | "across";
  /** Its opacity at its fullest. */
  alpha: number;
}

const AIR: Readonly<Record<string, CampAir>> = {
  frozen_north: { kind: "snow", count: 42, color: 0xffffff, glow: false, size: [2.2, 5], top: -20, bottom: 1080, period: [14, 24], sway: 26, drift: "down", alpha: 0.85 },
  red_sky_volcanic: { kind: "embers", count: 16, color: 0xffa040, glow: true, size: [1.8, 3.6], top: 240, bottom: 1000, period: [7, 12], sway: 18, drift: "up", alpha: 0.9 },
  open_plains: { kind: "seeds", count: 10, color: 0xfffbea, glow: false, size: [2, 3.2], top: 260, bottom: 760, period: [22, 34], sway: 40, drift: "across", alpha: 0.8 },
};

/** The air a backdrop family has, or none (a painted accent, or still air). */
export function campAir(family: string): CampAir | undefined {
  return AIR[family];
}

/** One mote: its own size, speed and phase, fixed for the camp's life. */
export interface Mote {
  size: number;
  period: number;
  /** Where in its crossing it starts (0..1), and where across the band it runs. */
  phase: number;
  lane: number;
  sway: number;
}

/** A small seeded generator, so a camp's motes are the same on every screen and in every test. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function campMotes(air: CampAir, seed = 1): Mote[] {
  const random = seeded(seed);
  return Array.from({ length: air.count }, () => ({
    size: air.size[0] + random() * (air.size[1] - air.size[0]),
    period: air.period[0] + random() * (air.period[1] - air.period[0]),
    phase: random(),
    lane: random(),
    sway: (0.5 + random() * 0.5) * air.sway * (random() < 0.5 ? -1 : 1),
  }));
}

/** Where a mote is at `elapsed` seconds, in the painting's pixels, and how bright. */
export function motePose(air: CampAir, mote: Mote, elapsed: number, width = 1920): { x: number; y: number; alpha: number } {
  const t = (mote.phase + elapsed / mote.period) % 1;
  const wobble = Math.sin((elapsed / mote.period) * Math.PI * 6 + mote.phase * 20) * mote.sway;
  // Fades in and out at the band's ends, so nothing pops.
  const ends = Math.min(1, t / 0.12, (1 - t) / 0.12);
  const span = air.bottom - air.top;
  switch (air.drift) {
    case "down":
      return { x: mote.lane * width + wobble, y: air.top + t * span, alpha: air.alpha * ends };
    case "up": {
      // An ember flickers as it rises, and is gone before the sky.
      const flicker = 0.7 + 0.3 * Math.sin(elapsed * 9 + mote.phase * 40);
      return { x: mote.lane * width + wobble, y: air.bottom - t * span * 0.7, alpha: air.alpha * ends * flicker };
    }
    case "across":
      return { x: -40 + t * (width + 80), y: air.top + mote.lane * span + wobble, alpha: air.alpha * ends };
  }
}
