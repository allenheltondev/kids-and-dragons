import type { CSSProperties } from "react";
import type { CastStance } from "@kad/shared";
import { figureSize } from "../world/figure-scale";

/**
 * The Field Guide's pictures breathe, bob and drift the way the same figures
 * do on the stage (world/idle-motion.ts), by the stance canon gives them.
 */

/** `/assets/entities/mosshorn/portrait.webp` is the figure `entities/mosshorn`; anything else is nobody's. */
export function figureOfArt(art: string | undefined): string | null {
  const match = art ? /\/assets\/(entities|characters|cast)\/([^/]+)\//.exec(art) : null;
  return match ? `${match[1]!}/${match[2]!}` : null;
}

/** How an entry's picture occupies its frame: standing unless canon says it hovers, flies or swims. */
export function stanceOfArt(art: string | undefined): CastStance {
  const figure = figureOfArt(art);
  return figure ? figureSize(figure).stance : "standing";
}

/** A steady, small number from an id, so a grid of pictures never breathes in step. */
function phaseOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 1000 / 1000;
}

/** The attribute and the offset a picture's frame carries; the stylesheet does the moving. */
export function motionProps(art: string | undefined, id: string): { "data-stance": CastStance; style: CSSProperties } {
  return { "data-stance": stanceOfArt(art), style: { "--fg-phase": `${String(-phaseOf(id) * 6)}s` } as CSSProperties };
}
