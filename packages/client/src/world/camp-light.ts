/**
 * The light each camp backdrop is painted in, so what stands on it is lit by
 * the same sun (docs/camp.md §3.1). Every painting has its own: the plains'
 * sun is high at the back left, the river's at the back right, the forest's
 * falls through the canopy behind the clearing, the volcanic sky glows red
 * along the horizon.
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
  /** How dark the shadows are, merged (0..1). */
  depth: number;
  /** How soft their edges are: the blur's strength at the painting's own size. */
  blur: number;
  /** The light's colour, multiplied over every piece and figure. */
  tint: number;
}

/** Plains light: a warm sun high behind the camp's left shoulder. */
const PLAINS: CampLight = { lean: 0.55, reach: 0.2, shade: 0x1f3312, depth: 0.50, blur: 1, tint: 0xfff4e4 };

const LIGHTS: Readonly<Record<string, CampLight>> = {
  open_plains: PLAINS,
  // A red sky lit from the horizon: long casts toward the viewer, rust shade, a warm cast.
  red_sky_volcanic: { lean: 0.12, reach: 0.27, shade: 0x2e0c06, depth: 0.5, blur: 1.2, tint: 0xffdcc6 },
  // Low bright sun over snow from the left: blue shade, cool white light.
  frozen_north: { lean: 0.6, reach: 0.24, shade: 0x34508a, depth: 0.44, blur: 0.8, tint: 0xeef4ff },
  // Light through the canopy behind the glade: short, soft, green-dark casts forward.
  enchanted_forest: { lean: 0.08, reach: 0.14, shade: 0x12280f, depth: 0.54, blur: 1.6, tint: 0xf1f8e4 },
  // A sun behind the great tree at the left, over open sky.
  sky_islands: { lean: 0.5, reach: 0.2, shade: 0x22381a, depth: 0.46, blur: 1, tint: 0xfff8ee },
  // Teal mist, lit from the glowing water behind: faint, very soft casts.
  whispering_marsh: { lean: -0.05, reach: 0.12, shade: 0x0b2826, depth: 0.50, blur: 1.8, tint: 0xe6f4f2 },
  // Bright stone plaza in a high sun from the left.
  cliffside_exchange: { lean: 0.45, reach: 0.18, shade: 0x4a3a2c, depth: 0.40, blur: 0.8, tint: 0xfffaf0 },
  // Afternoon sun from the right over the river and the bridge.
  great_river: { lean: -0.5, reach: 0.2, shade: 0x33300f, depth: 0.48, blur: 1, tint: 0xfff3dc },
  // Golden late sun from the left over dry grass.
  bone_yard: { lean: 0.6, reach: 0.24, shade: 0x4a2c10, depth: 0.46, blur: 1, tint: 0xffefd4 },
};

/** The light a backdrop family is painted in; the plains' for any family without one of its own. */
export function campLight(family: string | null | undefined): CampLight {
  return (family && LIGHTS[family]) || PLAINS;
}

/** Every family with a light of its own (for tests). */
export function litFamilies(): string[] {
  return Object.keys(LIGHTS);
}
