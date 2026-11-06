/**
 * The light each camp backdrop is lit by, so what stands on it is lit by the
 * same sun (docs/camp.md §3.1). Every camp's sun stands high at the upper
 * right (owner, 2026-11-06): a shadow comes off a thing's left-hand corner
 * and its bottom, falling to the lower left. Each painting gives its own
 * colour, depth, softness and length: blue on snow, rust under the volcanic
 * sky, short and soft under the forest canopy.
 *
 * Pure and Pixi-free. camp.ts reads it to draw one shadow layer under the
 * camp (every piece and figure casting from the same sun, the casts merged so
 * two never darken twice, and softened) and to tint what stands on the ground.
 */

export interface CampLight {
  /**
   * Where a cast falls, as a shear of the figure's own outline laid on the
   * ground: `lean` is how far right (negative: left) its top lands per unit
   * of the figure's height, and `reach` how far toward the viewer (negative:
   * back toward the horizon), both as fractions of that height.
   */
  lean: number;
  reach: number;
  /** The cast's colour, the ground's own shade rather than black. */
  shade: number;
  /** How dark the shadows are (0..1): the whole layer's opacity, so one shadow or two overlapping are as dark. */
  depth: number;
  /** How soft their edges are: the blur's strength at the painting's own size. */
  blur: number;
  /** The light's colour, multiplied over every piece and figure. */
  tint: number;
  /**
   * The air's colour far off: what stands on the back lanes leans toward it
   * and lets a little of the painting through (`campDepthShade`), so the back
   * of the camp sits in the painting's distance rather than on top of it.
   */
  haze: number;
}

/** Plains light: a warm sun high at the upper right. */
const PLAINS: CampLight = { lean: -0.5, reach: 0.2, shade: 0x1f3312, depth: 0.40, blur: 1, tint: 0xfff4e4, haze: 0xdfe9f5 };

const LIGHTS: Readonly<Record<string, CampLight>> = {
  open_plains: PLAINS,
  // A red sky: long casts, rust shade, a warm cast.
  red_sky_volcanic: { lean: -0.3, reach: 0.27, shade: 0x2e0c06, depth: 0.40, blur: 1.2, tint: 0xffdcc6, haze: 0xf5b8a0 },
  // Bright sun over snow: blue shade, cool white light.
  frozen_north: { lean: -0.5, reach: 0.24, shade: 0x34508a, depth: 0.35, blur: 0.8, tint: 0xeef4ff, haze: 0xdde8fb },
  // Light through the canopy: short, soft, green-dark casts.
  enchanted_forest: { lean: -0.3, reach: 0.14, shade: 0x12280f, depth: 0.43, blur: 1.6, tint: 0xf1f8e4, haze: 0xd3e6c8 },
  // Open sky over the islands.
  sky_islands: { lean: -0.45, reach: 0.2, shade: 0x22381a, depth: 0.37, blur: 1, tint: 0xfff8ee, haze: 0xe4eef9 },
  // Teal mist: faint, very soft casts.
  whispering_marsh: { lean: -0.3, reach: 0.12, shade: 0x0b2826, depth: 0.40, blur: 1.8, tint: 0xe6f4f2, haze: 0xbfdcdc },
  // Bright stone plaza in a high sun.
  cliffside_exchange: { lean: -0.45, reach: 0.18, shade: 0x4a3a2c, depth: 0.32, blur: 0.8, tint: 0xfffaf0, haze: 0xece8e0 },
  // Afternoon sun over the river and the bridge.
  great_river: { lean: -0.5, reach: 0.2, shade: 0x33300f, depth: 0.38, blur: 1, tint: 0xfff3dc, haze: 0xe6e8d4 },
  // Golden late sun over dry grass.
  bone_yard: { lean: -0.5, reach: 0.24, shade: 0x4a2c10, depth: 0.37, blur: 1, tint: 0xffefd4, haze: 0xf6dfbe },
};

/** The light a backdrop family is painted in; the plains' for any family without one of its own. */
export function campLight(family: string | null | undefined): CampLight {
  return (family && LIGHTS[family]) || PLAINS;
}

/**
 * An indoor rest's light (docs/camp.md §3.2): the scene's own picture, lit by
 * whatever lamp or doorway it has, so a neutral room light from above and a
 * little to the right, as outdoors. Short, soft, warm-brown shadows.
 */
export const INDOOR_LIGHT: CampLight = { lean: -0.15, reach: 0.2, shade: 0x26170c, depth: 0.46, blur: 1.4, tint: 0xffffff, haze: 0xffffff };

/** How far toward the haze the farthest lane leans, and how much of the painting shows through it. */
export const HAZE_MIX = 0.32;
export const HAZE_FADE = 0.08;

/**
 * The tint and opacity of something standing `depth` back (0 the nearest
 * lane, 1 the farthest): the light's tint, leaning toward its haze and a
 * touch see-through the further back it stands.
 */
export function campDepthShade(light: CampLight, depth: number): { tint: number; alpha: number } {
  const d = Math.min(1, Math.max(0, depth));
  const mix = HAZE_MIX * d;
  let tint = 0;
  for (const shift of [16, 8, 0]) {
    const a = (light.tint >> shift) & 0xff;
    const b = (light.haze >> shift) & 0xff;
    tint |= Math.round(a + (b - a) * mix) << shift;
  }
  return { tint, alpha: 1 - HAZE_FADE * d };
}

/** Every family with a light of its own (for tests). */
export function litFamilies(): string[] {
  return Object.keys(LIGHTS);
}
