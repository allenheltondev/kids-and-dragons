/**
 * The name under a figure's feet — how the table tells two players apart.
 *
 * The job used to belong to colour: each player picked a palette at creation
 * and the rigs exposed `mane`/`accent` tint slots the client wrote at runtime,
 * so two unicorns in one party were one green and one orange. It never looked
 * like the art it was painted over — a hue pushed onto authored shading flattens
 * exactly the detail the tier art exists for — and no amount of tuning was going
 * to make a runtime tint read as commissioned. So the figures now render as
 * drawn, and the name says who is who: explicit, sharp, and the same answer for
 * a player who cannot tell the two hues apart in the first place (spec §11 —
 * shape and text, never colour alone).
 *
 * Lives here, beside `actor-art.ts`, for that module's reason: both stages draw
 * it — the story lineup (`scene.ts`) and the combat board (`board.ts`) — and a
 * name that sat differently in a fight than in a scene would read as a different
 * label rather than the same one. One module, one look.
 *
 * Geometry is expressed as fractions of the figure's drawn height, because that
 * is the one measure the two stages share: the lineup works in 1600×900 design
 * units and the board in 128px tiles, and "a name about an eighth as tall as the
 * character" is the same picture in both. Width is the exception and is passed
 * in — how much room a figure has beside it is precisely what the two stages do
 * *not* agree on (a lineup slot is wide, a board tile is one tile).
 */

import { Text } from "pixi.js";

/**
 * Cap height as a fraction of the figure's drawn height.
 *
 * Read that height carefully before retuning it: it is the manifest's whole
 * 1024 canvas, and a creature stands in rather less of it (a fledgling unicorn
 * fills about half). So this number looks small and is not — a third of the
 * *visible* animal, which on a 720p TV framed on the lineup is a name about
 * 28px tall. It was set by photographing three same-species figures side by
 * side, which is the case the label exists for and the only one that shows
 * both failure modes: too small to read from the couch, or big enough that the
 * lineup reads as text with animals behind it.
 */
export const NAMEPLATE_FONT = 0.085;
/** Gap between the feet and the top of the name, same fraction. Tight, so the
    label reads as attached to the figure rather than floating on the floor. */
export const NAMEPLATE_GAP = 0.045;

/**
 * What a figure's nameplate says, or null when there is nothing to say.
 *
 * Creation sanitises and caps names at 16 characters (creationContent.ts), so
 * this is not a validator — it is the guard for the one case that still reaches
 * the stage: a save from before that cap, or a name that is all whitespace.
 * Drawing an empty `Text` would put a stroke-coloured smudge under the figure.
 */
export function nameplateLabel(name: string): string | null {
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * How far to shrink a nameplate so it fits the room its stage gives it.
 *
 * Shrink rather than truncate: "Sparklehoof…" tells you less than a smaller
 * "Sparklehoof", and the whole point of the label is that it is unambiguous.
 * Never grows a short name — a three-letter name blown up to fill a tile would
 * shout, and the size relationship to the figure is what makes the two stages
 * match.
 */
export function nameplateScale(width: number, maxWidth: number): number {
  if (!(width > 0) || !(maxWidth > 0)) return 1;
  return Math.min(1, maxWidth / width);
}

/**
 * A nameplate positioned under a figure whose feet are at the origin, or null
 * for a name with nothing in it. `height` is the figure's drawn height and
 * `maxWidth` the room it has beside it, both in the caller's own units.
 *
 * The caller adds this as a sibling of the art rather than a child of it: the
 * art rotates and fades — the fallen pose, the connection ghost — and a name
 * that tipped over with the character would be harder to read at exactly the
 * moment somebody is looking for it.
 */
export function createNameplate(name: string, height: number, maxWidth: number): Text | null {
  const label = nameplateLabel(name);
  if (label === null) return null;

  const size = height * NAMEPLATE_FONT;
  const text = new Text({
    text: label,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontWeight: "700",
      fontSize: size,
      fill: 0xf6f3ff,
      // The same ink the damage numbers are outlined in. A name has to hold up
      // over a biome backdrop nobody has painted yet as well as over the flat
      // fallback tiles, and an outline is what makes that independent of both.
      stroke: { color: 0x120f26, width: Math.max(2, size * 0.11) },
      align: "center",
    },
  });
  text.anchor.set(0.5, 0);
  text.y = height * NAMEPLATE_GAP;
  fitNameplate(text, maxWidth);
  return text;
}

/** Re-measure and re-fit — for a name that changed under a figure that did not. */
export function fitNameplate(text: Text, maxWidth: number): void {
  text.scale.set(1);
  text.scale.set(nameplateScale(text.width, maxWidth));
}
