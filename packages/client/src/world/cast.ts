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

import type { CastMember, CastSize, Chapter, RunState } from "@kad/shared";

/** A cast member as the stage draws them. */
export interface StageCastMember {
  /** Stable across scenes, so a character who stays is not re-entered. */
  key: string;
  url: string;
  name: string | null;
  /** Drawn height as a multiple of a party figure's. */
  scale: number;
}

/**
 * assets/manifest.json → entities[].scale. Copied, not fetched, for the same
 * reason art-paths.ts copies the class rig list: the runtime stays a lookup and
 * a test (cast.test.ts) holds every declared entity to the manifest.
 */
export const ENTITY_SIZES: Readonly<Record<string, CastSize | "variable">> = {
  sheeple: "medium",
  centaur: "large",
  faun: "medium",
  burrowfolk: "small_to_medium",
  harvest_sprite: "tiny",
  frogfolk: "small_to_medium",
  boughkin: "very_large",
  boggart: "small",
  yeti: "large",
  merfolk: "medium",
  selkie: "medium",
  stone_troll: "very_large",
  witch_order: "variable",
  // Drawn, but not (yet) declared in manifest.entities; sized by eye.
  skywardens: "medium",
  pib: "tiny",
  loftmire: "variable",
  cloud_whale: "colossal",
  reefglider: "medium",
  glassback_crab: "medium_to_large",
  embermoth: "tiny_to_small",
  jackalope: "small",
  silver_otter: "small",
  mosshorn: "medium",
  mire_mimic: "medium_to_large",
  snowhorn_goat: "medium",
  donkey: "medium",
  mule: "medium_to_large",
  pony: "small_to_medium",
  cinder_wolf: "medium",
  legend_dragon: "colossal",
  frost_wyrm: "large",
  river_drake: "large",
  bone_crawler: "small_to_medium",
  echo_hunter: "large",
  will_o_wisp: "tiny",
  restless_remains: "variable",
};

/**
 * Size → height beside a party figure. The entity art is all drawn to fill
 * the same 1024 canvas (a harvest sprite is as tall on disk as a centaur), so
 * scale is the only thing that says one is a teapot and the other a horse.
 * Capped well under the frame: a colossal dragon stands as the biggest thing
 * on screen, not as a wall.
 */
export const SIZE_SCALE: Readonly<Record<CastSize, number>> = {
  tiny: 0.4,
  tiny_to_small: 0.5,
  small: 0.65,
  small_to_medium: 0.82,
  medium: 1,
  medium_to_large: 1.12,
  large: 1.25,
  very_large: 1.35,
  colossal: 1.45,
};

/** The most a scene casts (schemas/chapter.schema.json `cast.maxItems`). */
export const MAX_CAST = 3;

/** `entities/selkie` → its art. Null for anything the schema would refuse. */
export function castFigureUrl(figure: string): string | null {
  const match = /^(entities|characters|cast)\/([a-z0-9_]+)$/.exec(figure);
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "characters") return `/assets/characters/${id}/fledgling/assembled.png`;
  return `/assets/${kind}/${id}/assembled.png`;
}

function sizeOf(member: CastMember): CastSize {
  if (member.size) return member.size;
  const [kind, id] = member.figure.split("/");
  if (kind !== "entities" || id === undefined) return "medium";
  const size = ENTITY_SIZES[id];
  return size === undefined || size === "variable" ? "medium" : size;
}

export function stageCast(members: readonly CastMember[]): StageCastMember[] {
  const out: StageCastMember[] = [];
  for (const member of members.slice(0, MAX_CAST)) {
    const url = castFigureUrl(member.figure);
    if (url === null) continue;
    out.push({
      key: `${member.figure}|${member.name ?? ""}`,
      url,
      name: member.name ?? null,
      scale: SIZE_SCALE[sizeOf(member)],
    });
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
 * width is budgeted from its scale rather than squeezed into a pony's slot.
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
  castScales: readonly number[],
  width: number,
): StageSlots {
  if (castScales.length === 0) {
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
  const partyBand = { from: width * 0.03, to: width * 0.55 };
  const castBand = { from: width * 0.6, to: width * 0.97 };

  // Spacing is capped in absolute design units, not as a share of the band:
  // on a wide pane the band grows and the heroes should stay a group.
  const partySpacing = Math.min((partyBand.to - partyBand.from) / Math.max(partyCount, 1), 340);
  // Right-aligned toward the middle: the heroes step up to meet whoever is there.
  const partyStart = partyBand.to - partySpacing * (partyCount - 0.5);
  const party = Array.from({ length: partyCount }, (_, i) => partyStart + partySpacing * i);

  // Each cast figure's share of its band is proportional to how big it is.
  const weights = castScales.map((s) => Math.max(s, 0.5));
  const total = weights.reduce((a, b) => a + b, 0);
  const bandWidth = castBand.to - castBand.from;
  // A lone figure does not drift to the far edge: it stands near the gap.
  const used = Math.min(bandWidth, total * 300);
  let cursor = castBand.from;
  const cast: number[] = [];
  const castSlots: number[] = [];
  for (const weight of weights) {
    const slot = (used * weight) / total;
    cast.push(cursor + slot / 2);
    // A lone figure's name may use the band's room, not just the figure's:
    // "Madame Coralie Fenn" under a lone merfolk has the right of the stage to
    // itself, and shrinking it to the figure's width made it the smallest text
    // on screen. Two or three share the band and keep to their own slots.
    castSlots.push(weights.length === 1 ? Math.max(slot, Math.min(bandWidth, 560)) : slot);
    cursor += slot;
  }
  return { party, cast, partySlot: partySpacing, castSlots };
}
