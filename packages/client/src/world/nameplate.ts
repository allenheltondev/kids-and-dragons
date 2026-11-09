/** Names identify party figures, including players with the same species.
 * Authored illustration colors are preserved; labels stay separate from poses.
 */

import { Assets, Container, Rectangle, Sprite, Text, Texture } from "pixi.js";
import type { HeroNameStyle } from "./hero-name";

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
 * Creation sanitises and caps names at 16 characters (screens/hero-names.ts), so
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
export function fitNameplate(text: Text, maxWidth: number, wrap = false): void {
  text.style.wordWrap = wrap;
  text.style.breakWords = wrap;
  text.style.wordWrapWidth = maxWidth;
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

// ---------------------------------------------------------------------------
// The name style: a frame behind the name, a title under it (#664)
// ---------------------------------------------------------------------------

/**
 * The title line's type, as a fraction of the name's (docs/hero-looks.md
 * §7.2): "Pip" over "the Brave", the title small enough to read as part of
 * her name and never compete with it.
 */
export const NAMEPLATE_TITLE_SCALE = 0.6;

/**
 * The smallest a title is drawn on the TV, in pixels at 720p (§7.2). A title
 * that would draw smaller, or would run into a neighbour's plate, is hidden
 * rather than shortened, and the name keeps its place. Callers turn it into
 * their own units (`titleMinFont`).
 */
export const TITLE_MIN_PX_720 = 14;

/** The frame's margin round what it frames, as a fraction of the name's type size. */
const FRAME_PAD_X = 0.55;
const FRAME_PAD_Y = 0.2;

/**
 * What a nameplate carries beyond the name: a title line under it and a
 * frame behind it. The name itself is the caller's `Text`, untouched: its
 * ink, stroke, font and fit are exactly as before looks (§7.2).
 */
export interface NameDress {
  title: Text | null;
  /** The frame, once its painting has loaded; null for the plain plate. */
  frame: NineSlice | null;
  /** What it was dressed for, so an unchanged look is not rebuilt. */
  key: string;
  destroyed: boolean;
}

function styleKey(style: HeroNameStyle): string {
  return `${style.title ?? ""}|${style.frame?.url ?? ""}`;
}

/**
 * Dress a name for a hero's style, or undress it: `parent` is the container
 * the name is in, and the title and frame go beside it there (the frame just
 * behind it). Returns null when there is nothing to draw, which is every hero
 * with no look, so she draws exactly as before. `was` is the dress it had; an
 * unchanged style keeps it.
 */
export function dressNameplate(parent: Container, name: Text, style: HeroNameStyle, was: NameDress | null = null): NameDress | null {
  const key = styleKey(style);
  if (was && !was.destroyed && was.key === key) return was;
  if (was) destroyNameDress(was);
  if (style.title === null && style.frame === null) return null;
  const dress: NameDress = { title: null, frame: null, key, destroyed: false };
  if (style.title !== null) {
    const size = Number(name.style.fontSize) * NAMEPLATE_TITLE_SCALE;
    const title = new Text({
      text: style.title,
      style: {
        fontFamily: name.style.fontFamily,
        fontWeight: "700",
        fontSize: size,
        fill: 0xf6f3ff,
        stroke: { color: 0x120f26, width: Math.max(2, size * 0.11) },
        align: "center",
      },
    });
    title.anchor.set(0.5, 0);
    title.label = "nameplate-title";
    title.visible = false;
    parent.addChild(title);
    dress.title = title;
  }
  const art = style.frame;
  if (art) {
    // Asked for only because the manifest says it is there (hero-name.ts).
    void Assets.load<Texture>(art.url).then(
      (texture) => {
        if (dress.destroyed || name.destroyed || parent.destroyed) return;
        const frame = new NineSlice(texture, art.slice);
        frame.label = "nameplate-frame";
        frame.visible = false;
        parent.addChildAt(frame, Math.max(0, parent.getChildIndex(name)));
        dress.frame = frame;
      },
      () => undefined,
    );
  }
  return dress;
}

/**
 * A painting cut into nine and stretched to any size with its corners kept:
 * nine plain sprites over sub-textures of one, rather than Pixi's own
 * nine-slice sprite, whose render pipes would ride every stage's bundle for a
 * frame most heroes never wear.
 */
export class NineSlice extends Container {
  private readonly parts: Sprite[] = [];
  private readonly insets: { left: number; top: number; right: number; bottom: number };
  private w: number;
  private h: number;

  constructor(texture: Texture, insets: { left: number; top: number; right: number; bottom: number }) {
    super();
    this.insets = insets;
    const fw = texture.frame.width;
    const fh = texture.frame.height;
    this.w = fw;
    this.h = fh;
    const xs = [0, insets.left, fw - insets.right, fw];
    const ys = [0, insets.top, fh - insets.bottom, fh];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const frame = new Rectangle(texture.frame.x + xs[col]!, texture.frame.y + ys[row]!, Math.max(1, xs[col + 1]! - xs[col]!), Math.max(1, ys[row + 1]! - ys[row]!));
        const part = new Sprite(new Texture({ source: texture.source, frame }));
        this.parts.push(part);
        this.addChild(part);
      }
    }
    this.layoutParts();
  }

  override get width(): number {
    return this.w;
  }
  override set width(value: number) {
    this.w = value;
    this.layoutParts();
  }
  override get height(): number {
    return this.h;
  }
  override set height(value: number) {
    this.h = value;
    this.layoutParts();
  }

  private layoutParts(): void {
    if (this.parts.length < 9) return;
    const { left, top, right, bottom } = this.insets;
    // Corners shrink together when the frame is smaller than its own corners.
    const k = Math.min(1, this.w / Math.max(1, left + right), this.h / Math.max(1, top + bottom));
    const xs = [0, left * k, this.w - right * k, this.w];
    const ys = [0, top * k, this.h - bottom * k, this.h];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const part = this.parts[row * 3 + col]!;
        part.x = xs[col]!;
        part.y = ys[row]!;
        part.width = Math.max(0, xs[col + 1]! - xs[col]!);
        part.height = Math.max(0, ys[row + 1]! - ys[row]!);
      }
    }
  }
}

/** How a dress is fitted round its name: all in the name's own units. */
export interface NameDressRoom {
  /** The widest the title may be: wider would run into a neighbour, so it is hidden. */
  maxWidth: number;
  /** The smallest drawn font a title may have (`titleMinFont`). */
  minFont: number;
  /** The lowest its foot may reach, if the stage has a floor it must not fall off. */
  maxBottom?: number;
}

/**
 * The smallest title font in a stage's own units: `TITLE_MIN_PX_720` over how
 * many pixels one unit is on a 720p screen.
 */
export function titleMinFont(pixelsPerUnitAt720: number): number {
  return pixelsPerUnitAt720 > 0 ? TITLE_MIN_PX_720 / pixelsPerUnitAt720 : Infinity;
}

/** The title's drawn font: its size at the name's own fit. */
export function titleFont(name: Text): number {
  return Number(name.style.fontSize) * NAMEPLATE_TITLE_SCALE * name.scale.y;
}

/**
 * Lay the title under the name and the frame behind both, after the name has
 * been fitted (`fitNameplate`). The title is at the name's own scale, so 0.6
 * of the name as drawn; it is hidden, never shortened, when it would be too
 * small, too wide for its room, or fall off the stage.
 */
export function fitNameDress(dress: NameDress | null, name: Text, room: NameDressRoom): void {
  if (!dress || dress.destroyed) return;
  const title = dress.title;
  let shown = false;
  if (title) {
    title.scale.set(name.scale.x, name.scale.y);
    title.x = name.x;
    title.y = name.y + name.height;
    const fits = titleFont(name) >= room.minFont - 1e-6 && title.width <= room.maxWidth + 1e-6;
    const onStage = room.maxBottom === undefined || title.y + title.height <= room.maxBottom + 1e-6;
    shown = name.visible && fits && onStage;
    title.visible = shown;
  }
  const frame = dress.frame;
  if (frame) {
    const type = Number(name.style.fontSize) * name.scale.y;
    const width = Math.max(name.width, shown && title ? title.width : 0) + type * FRAME_PAD_X * 2;
    const height = name.height + (shown && title ? title.height : 0) + type * FRAME_PAD_Y * 2;
    frame.width = width;
    frame.height = height;
    frame.x = name.x - width / 2;
    frame.y = name.y - type * FRAME_PAD_Y;
    frame.visible = name.visible;
  }
}

/** Show or hide a dress with its name. A title stays hidden until it is fitted again. */
export function setNameDressVisible(dress: NameDress | null, visible: boolean): void {
  if (!dress || dress.destroyed) return;
  if (!visible && dress.title) dress.title.visible = false;
  if (dress.frame) dress.frame.visible = visible;
}

/** Hide a title the caller found crowding a neighbour (`crowdedTitles`). */
export function hideNameTitle(dress: NameDress | null): void {
  if (dress?.title) dress.title.visible = false;
}

export function destroyNameDress(dress: NameDress | null): void {
  if (!dress || dress.destroyed) return;
  dress.destroyed = true;
  dress.title?.destroy();
  dress.frame?.destroy();
  dress.title = null;
  dress.frame = null;
}

/** The title as drawn, in its parent's space, or null when none shows. */
export function titleBoxOf(dress: NameDress | null): NameplateBox | null {
  const title = dress?.title;
  if (!title || !title.visible) return null;
  return nameplateBoxOf(title);
}

/** One plate as numbers: its name, and its title when one shows. */
export interface PlateBoxes {
  name: NameplateBox;
  title: NameplateBox | null;
}

/**
 * Which titles crowd a neighbour (§7.2): a title whose box comes too close to
 * another plate's name, or to a title already kept, by the names' own gutter
 * rule (`nameplatesCollide`). Those are hidden; names are never moved or
 * shrunk for a title. Earlier plates keep theirs first. Pure.
 */
export function crowdedTitles(plates: readonly PlateBoxes[]): boolean[] {
  const crowded = plates.map(() => false);
  const kept: NameplateBox[] = [];
  plates.forEach((plate, i) => {
    if (!plate.title) return;
    const title = plate.title;
    const others = plates.filter((_, j) => j !== i).map((p) => p.name);
    if ([...others, ...kept].some((box) => nameplatesCollide(title, box))) crowded[i] = true;
    else kept.push(title);
  });
  return crowded;
}
