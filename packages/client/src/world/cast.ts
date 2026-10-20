/**
 * The story stage's cast: who is standing in a scene with the party.
 *
 * A chapter names them per scene (`CastMember` in @kad/shared's chapter.ts);
 * this module turns that into what the stage draws (a URL, a nameplate, a
 * height) and decides where everybody stands. Pure and Pixi-free, like
 * art-paths.ts, so the composition is testable without a WebGL context and
 * the rule "the party is never crowded off its own stage" is a number a test
 * can hold.
 *
 * Every path is a fact about `assets/`; tools/content/validate.mjs refuses a
 * figure that does not resolve, so nothing here probes for a file.
 */

import type { CastMember, CastStance, Chapter, RunState } from "@kad/shared";
import {
  castSize,
  drawnHeight,
  heightFit,
  paintedWidths,
  widthFit,
  type SizedFigure,
  type StageMeasure,
} from "./figure-scale";

/** A cast member as the stage draws them. */
export interface StageCastMember {
  /** Stable across scenes, so a character who stays is not re-entered. */
  key: string;
  url: string;
  name: string | null;
  /** How tall they really are, after the chapter's `size` (figure-scale.ts). */
  heightCm: number;
  /** How they occupy this scene, after the chapter's `stance`. */
  stance: CastStance;
  /**
   * Set when this figure is one of a group (`count` > 1): the group shares a
   * slot, so layout packs them close, and the odd ones stand a step back.
   */
  crowd?: { index: number; size: number };
}

/** The most a scene casts (schemas/chapter.schema.json `cast.maxItems`). */
export const MAX_CAST = 3;

/** The most figures one cast entry becomes (`castMember.count` maximum). */
export const MAX_GROUP = 6;

/**
 * A group's share of the band, as a multiple of one figure's: a pack of three
 * takes the room of about two, so they overlap into a huddle, not a row.
 */
export const GROUP_SPREAD = 0.62;

/**
 * Entity art that is a whole group in one canvas, and the members it is cut
 * into (tools/art/split-group.py, assets/manifest.json castFigures). Drawn
 * as one figure, the Skywardens' griffin, faun and centaur stood at a third
 * of their width and short of a hero: three tiny guards. A chapter still
 * casts `entities/skywardens`; the stage stands the members as a group, each
 * at its own height, with the chapter's one nameplate under the first.
 */
export const ENSEMBLES: Readonly<Record<string, readonly string[]>> = {
  skywardens: ["cast/skywarden_griffin", "cast/skywarden_faun", "cast/skywarden_centaur"],
};

/** `entities/selkie` → its art. Null for anything the schema would refuse. */
export function castFigureUrl(figure: string): string | null {
  const match = /^(entities|characters|cast)\/([a-z0-9]+(?:[_-][a-z0-9]+)*)$/.exec(figure);
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "characters") return `/assets/characters/${id}/fledgling/assembled.png`;
  return `/assets/${kind}/${id}/assembled.png`;
}

export function stageCast(members: readonly CastMember[]): StageCastMember[] {
  const out: StageCastMember[] = [];
  for (const member of members.slice(0, MAX_CAST)) {
    const url = castFigureUrl(member.figure);
    if (url === null) continue;
    const key = `${member.figure}|${member.name ?? ""}`;
    const ensemble = member.figure.startsWith("entities/") ? ENSEMBLES[member.figure.slice("entities/".length)] : undefined;
    if (ensemble) {
      // The group is the entry: `count` has nothing to multiply, and an
      // authored size or stance still applies, to each of them.
      ensemble.forEach((part, index) => {
        out.push({
          key: index === 0 ? key : `${key}#${index}`,
          url: castFigureUrl(part) ?? url,
          name: index === 0 ? (member.name ?? null) : null,
          ...castSize(part, member.size, member.stance),
          crowd: { index, size: ensemble.length },
        });
      });
      continue;
    }
    const size = Math.max(1, Math.min(Math.floor(member.count ?? 1), MAX_GROUP));
    const sized = castSize(member.figure, member.size, member.stance);
    for (let index = 0; index < size; index++) {
      out.push({
        // The first keeps the plain key, so a one-of-a-kind cast is unchanged
        // and a group growing from 1 to 3 does not re-enter its first member.
        key: index === 0 ? key : `${key}#${index}`,
        url,
        // One nameplate per group, under its first figure.
        name: index === 0 ? (member.name ?? null) : null,
        ...sized,
        ...(size > 1 ? { crowd: { index, size } } : {}),
      });
    }
  }
  return out;
}

/**
 * Who stands in the current scene. Empty in a fight, where the board is the
 * picture and the enemies are already on it, and for a chapter the client has
 * not caught up to yet.
 */
export function castFor(chapter: Chapter | null, state: RunState | null): StageCastMember[] {
  if (!chapter || !state || chapter.id !== state.chapterId || !state.sceneId || state.encounter) return [];
  const scene = chapter.scenes[state.sceneId];
  if (!scene || scene.type === "encounter") return [];
  return stageCast(scene.cast ?? []);
}

/**
 * Where everybody stands, in the story's 1600-wide design space.
 *
 * Alone, the party is centred as it always was. With company, the party takes
 * the left of the stage and the cast the right, facing each other across a gap
 * in the middle: the picture of a meeting. Each side spaces its own figures,
 * so a third hero joining does not shove the selkie about, and a centaur's
 * width is budgeted from its drawn width rather than squeezed into a pony's slot.
 */
export interface StageSlots {
  party: number[];
  cast: number[];
  /** Horizontal room each party figure has, for the nameplate fit. */
  partySlot: number;
  castSlots: number[];
}

export function stageSlots(
  partyCount: number,
  /**
   * How much room each cast figure needs, in `FIGURE_SLOT`s: its drawn width
   * over the width a hero's slot always had.
   */
  castWeights: readonly number[],
  width: number,
  /** Parallel to castWeights: true for a figure that is one of a group. */
  crowded: readonly boolean[] = [],
  compact = false,
): StageSlots {
  if (castWeights.length === 0) {
    // 416 is the 26% of the 1600 design width the lineup always used; held
    // in units so a wide pane centres the same group rather than scattering it.
    const spacing = Math.min(width / (partyCount + 1), 416);
    const start = width / 2 - (spacing * (partyCount - 1)) / 2;
    return {
      party: Array.from({ length: partyCount }, (_, i) => start + spacing * i),
      cast: [],
      partySlot: spacing,
      castSlots: [],
    };
  }

  // The party's half is the left 54%, the cast's the right 40%, with the
  // remainder as the gap between them that makes it read as two groups.
  // A narrow stage pages guests one at a time. Leave room for the full rig
  // canvas at the left edge rather than hanging the first hero offscreen.
  const partyBand = { from: width * (compact ? 0.13 : 0.03), to: width * (compact ? 0.65 : 0.55) };
  const castBand = { from: width * (compact ? 0.7 : 0.6), to: width * (compact ? 0.99 : 0.97) };

  // Spacing is capped in absolute design units, not as a share of the band:
  // on a wide pane the band grows and the heroes should stay a group.
  const partySpacing = Math.min((partyBand.to - partyBand.from) / Math.max(partyCount, 1), 340);
  // Right-aligned toward the middle: the heroes step up to meet whoever is there.
  const partyStart = partyBand.to - partySpacing * (partyCount - 0.5);
  const party = Array.from({ length: partyCount }, (_, i) => partyStart + partySpacing * i);

  // Each cast figure's share of its band is proportional to how wide it is drawn.
  const weights = castWeights.map((s, i) => Math.max(s, 0.5) * (crowded[i] ? GROUP_SPREAD : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const bandWidth = castBand.to - castBand.from;
  // A lone figure does not drift to the far edge: it stands near the gap.
  const used = Math.min(bandWidth, total * FIGURE_SLOT);
  let cursor = castBand.from;
  const cast: number[] = [];
  const castSlots: number[] = [];
  for (const weight of weights) {
    const slot = (used * weight) / total;
    cast.push(compact && weights.length === 1 ? width * 0.8 : cursor + slot / 2);
    // A lone figure's name may use the band's room, not just the figure's:
    // "Madame Coralie Fenn" under a lone merfolk has the right of the stage to
    // itself, and shrinking it to the figure's width made it the smallest text
    // on screen. Two or three share the band and keep to their own slots.
    castSlots.push(weights.length === 1 ? Math.max(slot, Math.min(bandWidth, 560)) : slot);
    cursor += slot;
  }
  return { party, cast, partySlot: partySpacing, castSlots };
}

/** The width, in design units, a cast figure of weight 1 is given (`stageSlots`). */
export const FIGURE_SLOT = 300;

/**
 * The story stage's measure (#362): 2.5 design units a centimeter, so a 160 cm
 * faun paints 400 units tall, about where a hero always stood in the 900-unit
 * design rect. The tallest figure may reach `headroom` above the ground line
 * (scene.ts stands it at 88% of the rect, and leaves a margin at the top), so
 * anything up to 3 m stands at natural scale and anything taller shrinks the
 * stage. Nothing is drawn shorter than `floor`, 64 units, which at natural
 * scale is a 26 cm figure: a teapot-sized sprite sits right on it, and
 * anything smaller stands at the floor rather than as a speck.
 */
export const STORY_MEASURE: StageMeasure = { pxPerCm: 2.5, headroom: 900 * 0.88 - 40, floor: 64 };

/**
 * How much of its slot a figure's painted box may span. A little over the
 * slot: the box is the paint's bounding rectangle, and a horse's nose and a
 * neighbour's tail rarely meet in its corners. Names keep to their slots
 * strictly (scene.ts), which is the gutter that has to hold.
 */
export const SLOT_FILL = 1.1;

export interface StageFigure extends SizedFigure {
  /** One of a group: it may overlap its neighbours (`GROUP_SPREAD`). */
  crowded?: boolean;
}

export interface StageLayout {
  slots: StageSlots;
  /** The drawn (painted) height of each party figure, then each cast figure. */
  party: number[];
  cast: number[];
  /** The one scale every figure is drawn at, relative to natural size: 1 unless something had to fit. */
  k: number;
}

/**
 * Where everybody stands and how tall each is drawn (#362): true proportion,
 * shrunk together until the tallest fits under the frame and every figure fits
 * its slot, never grown, and floored for the tiny.
 */
export function stageLayout(
  party: readonly StageFigure[],
  cast: readonly StageFigure[],
  width: number,
  compact = false,
  measure: StageMeasure = STORY_MEASURE,
): StageLayout {
  const all = [...party, ...cast];
  const tall = heightFit(all, measure);
  const widths = paintedWidths(all, tall, measure);
  const castWidths = widths.slice(party.length);
  const slots = stageSlots(
    party.length,
    castWidths.map((w) => w / FIGURE_SLOT),
    width,
    cast.map((member) => member.crowded ?? false),
    compact,
  );
  const rooms = [
    ...party.map(() => slots.partySlot * SLOT_FILL),
    ...cast.map((member, i) => (slots.castSlots[i] ?? 0) * SLOT_FILL / (member.crowded ? GROUP_SPREAD : 1)),
  ];
  const k = tall * widthFit(widths, rooms);
  return {
    slots,
    party: party.map((figure) => drawnHeight(figure, k, measure)),
    cast: cast.map((figure) => drawnHeight(figure, k, measure)),
    k,
  };
}
