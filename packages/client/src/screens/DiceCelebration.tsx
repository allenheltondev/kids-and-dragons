/**
 * DiceCelebration — what the die does when it lands.
 *
 * A success throws confetti out of the die; a natural 20 throws more of it, in
 * gold, with stars. A miss lets a little dust fall off the die instead; a
 * natural 1 adds a wobble. Feeling, not information: the headline word and its
 * shape under the die (DiceOverlay) carry the outcome on their own (spec §11),
 * so this draws nothing at all under `prefers-reduced-motion`.
 *
 * Pure CSS, no canvas. The pieces are a few dozen spans with their flight
 * written into custom properties, and the layout comes from `burst()` — seeded,
 * so the same roll always throws the same confetti and a test can pin it.
 */

import type { ReactElement } from "react";
import "./DiceCelebration.css";

export type Celebration = "crit" | "success" | "miss" | "fumble";

export interface Piece {
  /** Where it flies to, in em from the die's centre. */
  x: number;
  y: number;
  /** How far it then falls, in em. */
  fall: number;
  /** Total spin, in degrees. */
  spin: number;
  /** Start delay and flight time, in ms. */
  delay: number;
  duration: number;
  /** Index into the palette for this celebration. */
  color: number;
  shape: "strip" | "dot" | "star";
}

/** mulberry32: small, stable, and the same one the dice use (shared/dice.ts). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT: Record<Celebration, number> = { crit: 56, success: 32, miss: 10, fumble: 14 };
const PALETTE_SIZE: Record<Celebration, number> = { crit: 3, success: 6, miss: 2, fumble: 2 };

/**
 * The pieces for one celebration. Confetti goes up and out in a fan and then
 * falls; dust only drifts down off the die's lower edge.
 */
export function burst(kind: Celebration, seed: number): Piece[] {
  const random = seeded(seed);
  const confetti = kind === "crit" || kind === "success";
  const reach = kind === "crit" ? 11 : 8;
  return Array.from({ length: COUNT[kind] }, () => {
    if (!confetti) {
      return {
        x: (random() - 0.5) * 6,
        y: 2 + random() * 1.5,
        fall: 2 + random() * 3,
        spin: (random() - 0.5) * 90,
        delay: Math.round(random() * 400),
        duration: Math.round(1400 + random() * 700),
        color: Math.floor(random() * PALETTE_SIZE[kind]),
        shape: "dot",
      };
    }
    // A fan pointed upward: -160° to -20°, so nothing shoots straight down
    // through the numbers under the die.
    const angle = ((-160 + random() * 140) * Math.PI) / 180;
    const distance = reach * (0.45 + random() * 0.55);
    const roll = random();
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      fall: 6 + random() * 6,
      spin: (random() < 0.5 ? -1 : 1) * (360 + random() * 540),
      delay: Math.round(random() * 140),
      duration: Math.round(1500 + random() * 800),
      color: Math.floor(random() * PALETTE_SIZE[kind]),
      shape: kind === "crit" && roll < 0.3 ? "star" : roll < 0.65 ? "strip" : "dot",
    };
  });
}

export function DiceCelebration({ kind, seed }: { kind: Celebration; seed: number }): ReactElement {
  return (
    <span className={`celebration celebration--${kind}`} aria-hidden="true">
      {burst(kind, seed).map((piece, i) => (
        <span
          key={i}
          className={`celebration__piece celebration__piece--${piece.shape} celebration__piece--c${String(piece.color)}`}
          style={
            {
              "--x": `${piece.x.toFixed(2)}em`,
              "--y": `${piece.y.toFixed(2)}em`,
              "--fall": `${piece.fall.toFixed(2)}em`,
              "--spin": `${piece.spin.toFixed(0)}deg`,
              "--delay": `${String(piece.delay)}ms`,
              "--duration": `${String(piece.duration)}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
