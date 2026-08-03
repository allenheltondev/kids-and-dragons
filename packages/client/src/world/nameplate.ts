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
/** Gap between the feet and the top of the name, as a fraction of the figure's
    drawn height. Tight, so the label reads as attached to the figure rather
    than floating on the floor. */
export const NAMEPLATE_GAP = 0.045;

/**
 * How far below the feet the name sits, for a figure `figureHeight` tall.
 *
 * Exported because the board positions its labels in board space rather than
 * inside the actor they belong to, so it needs this number too — and the one
 * thing worse than two coordinate spaces is two copies of the formula that
 * converts between them.
 */
export function nameplateGap(figureHeight: number): number {
  return figureHeight * NAMEPLATE_GAP;
}

export interface NameplateSpec {
  /**
   * What the type is sized against.
   *
   * Kept separate from `figureHeight` because the two stages disagree about
   * it. The lineup sizes type off the figure — right for one creature in a
   * 1600×900 rect. The board sizes it off a *tile*, because the same figure is
   * a much smaller share of a 10×8 grid and the lineup's fraction produced a
   * name half the on-screen size there, marginal on a TV.
   */
  typeHeight: number;
  /**
   * The figure's actual drawn height, which is what the drop below its feet is
   * measured from. One knob used to do both jobs, so retuning type size
   * silently moved the label down the screen; it did, by 4px, the first time
   * the board's was retuned.
   */
  figureHeight: number;
  /** How much room the name has beside it, in the caller's units. */
  maxWidth: number;
}

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
 * for a name with nothing in it. All three measures are in the caller's own
 * units — see `NameplateSpec` for why type and figure are measured separately.
 *
 * The caller adds this as a sibling of the art rather than a child of it: the
 * art rotates and fades — the fallen pose, the connection ghost — and a name
 * that tipped over with the character would be harder to read at exactly the
 * moment somebody is looking for it.
 */
export function createNameplate(name: string, spec: NameplateSpec): Text | null {
  const label = nameplateLabel(name);
  if (label === null) return null;

  const size = spec.typeHeight * NAMEPLATE_FONT;
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
  text.y = nameplateGap(spec.figureHeight);
  fitNameplate(text, spec.maxWidth);
  return text;
}

/** Re-measure and re-fit — for a name that changed under a figure that did not. */
export function fitNameplate(text: Text, maxWidth: number): void {
  text.scale.set(1);
  text.scale.set(nameplateScale(text.width, maxWidth));
}

/**
 * One drawn name, as numbers — what it says and the box it occupies, in
 * whichever space its stage draws in.
 *
 * This exists so the nameplates can be *asserted on*. They are drawn into a
 * canvas, so nothing in the DOM knows they are there: both real defects this
 * feature shipped with — a name cropped by the figure in front of it, and two
 * names on adjacent tiles running together into `SparklehoofSkyclaw` — were
 * found by a human looking at a screenshot, and nothing would have caught
 * either one twice. A box per label makes both mechanically checkable, which
 * is what `e2e/nameplates.spec.ts` does with them.
 */
export interface NameplateBox {
  text: string;
  /** Centre-x and top-y of the drawn label, after fitting. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The drawn names, and *which stage drew them*.
 *
 * The space is not a convenience. Without it a caller cannot tell a lineup
 * reading from a board reading, and the two are trivially confusable: an
 * e2e written against this seam polled for "three names are present", got
 * three from the story lineup, and asserted the board's geometry against them
 * for two full runs — passing happily while the reintroduced board bug sat
 * right there. Naming the space is what makes "I am looking at the board"
 * something a test can require rather than assume.
 */
export interface NameplateReading {
  space: "story" | "board";
  boxes: NameplateBox[];
}

export function nameplateBoxOf(text: Text): NameplateBox {
  return {
    text: text.text,
    x: text.x,
    y: text.y,
    width: text.width,
    height: text.height,
  };
}

/**
 * The smallest gap between two names that still reads as two names, as a
 * fraction of their type height.
 *
 * Not zero, and that distinction is the whole value of this rule. The defect
 * this was written against rendered `Sparklehoof` and `Skyclaw` on adjacent
 * tiles with their edges *touching* — which is unreadable, and which a plain
 * overlap test calls fine, because they did not technically overlap. Asserting
 * "do not intersect" would have passed the exact bug it exists to catch; it
 * was checked, and it did.
 */
export const NAMEPLATE_MIN_GUTTER = 0.3;

/**
 * Are two drawn names too close together to read as two names?
 *
 * The y-band is consulted only to rule out labels on different rows: on the
 * board every party figure's label sits at the same offset below its own feet,
 * so two names in the same row share a band by construction and the question
 * is decided on x. Pure, so the rule is testable without a canvas.
 */
export function nameplatesCollide(a: NameplateBox, b: NameplateBox): boolean {
  const sameBand = Math.abs(a.y - b.y) < Math.max(a.height, b.height);
  if (!sameBand) return false;
  const gap = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
  return gap < Math.max(a.height, b.height) * NAMEPLATE_MIN_GUTTER;
}
