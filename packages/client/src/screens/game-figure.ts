import type { CSSProperties } from "react";
import type { HeroArtSubject } from "../world/hero-art";
import { figureSize } from "../world/figure-scale";
import "./game-figure.css";

/** Full-body staging only: portrait badges deliberately keep their own uniform size.
 * Compare against a fixed reference, never the tallest hero currently connected. */
export function gameFigureStyle(hero: HeroArtSubject): CSSProperties {
  return { "--figure-scale": figureSize(`characters/${hero.species}`).heightCm / 215 } as CSSProperties;
}

/** Keep a shared camera for the roster while allowing small parties more room. */
export function gameFigureStageStyle(count: number): CSSProperties {
  return { "--figure-width": `${count >= 3 ? 32 : 55}cqw` } as CSSProperties;
}

/** Relay's display follows each figure's hands; phone catch scoring stays unchanged. */
export function gameFigureHandY(hero?: HeroArtSubject): string {
  if (!hero) return "64%";
  const scale = figureSize(`characters/${hero.species}`).heightCm / 215;
  return `calc(73% - min(110cqh, var(--figure-width, 32cqw)) * ${scale * .329})`;
}
