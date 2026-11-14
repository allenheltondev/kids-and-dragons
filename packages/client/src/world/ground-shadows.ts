/**
 * Shadows on the ground, cast by one light (camp-light.ts): the camp's
 * (camp.ts) and an indoor rest's packed camp (scene.ts) draw them the same way.
 *
 * Each thing standing on the ground casts its own outline, sheared along the
 * ground where the light sends it, and a contact shade under its feet, both
 * drawn opaque. They all lie on one layer under what casts them, which is
 * filled with the light's shade (`shadeFill`: every pixel's colour replaced
 * by it, only its coverage kept, so a red blanket and a blue tent cast the
 * same shadow), blurred, and laid down at the light's depth as one: an opaque
 * shape over another is the same opaque shape, so two shadows that overlap
 * merge, as real shadows do, rather than one darkening the other.
 * Each follows what casts it (`sync`, every frame).
 */

import { isTvBrowser } from "../display/tv";
import { BlurFilter, Container, Filter, GlProgram, Graphics, Sprite, defaultFilterVert, type Texture } from "pixi.js";
import { ANCHOR_X, ANCHOR_Y } from "./art-paths";
import type { CampLight } from "./camp-light";

/** Where an outline is drawn on its canvas, as its art is (figure-scale.ts `fitCanvas`). */
export interface CastFit {
  /** The side of the square canvas it is drawn at. */
  canvas: number;
  /** The art's own offset off the ground contact, so the cast meets its feet. */
  offsetX?: number;
  offsetY?: number;
  /** Drawn turned round. */
  mirrored?: boolean;
  /**
   * Cast back, up the ground behind it, rather than toward the viewer: the
   * default. A shadow thrown down the screen and pooled under the feet makes
   * a figure look like it hovers over it (playtest, 2026-11-14); cast back,
   * it starts at the feet and lies on the ground behind, as a tent's from its
   * pegs (owner, 2026-11-06). `false` throws it toward the viewer.
   */
  behind?: boolean;
}

/** How much further a shadow cast back reaches than one cast forward: the ground behind is foreshortened less. */
export const BEHIND_REACH = 1.4;

/**
 * One thing's shadow: its outline (`texture`, drawn on `fit`'s canvas) cast
 * along the ground, and a contact shade `width` wide under it; with no
 * texture, only the contact shade. `height` is its drawn height.
 */
export function groundShadow(light: CampLight, width: number, height: number, texture?: Texture, fit?: CastFit): Container {
  const shadow = new Container();
  shadow.label = "camp-ground-shadow";
  const behind = fit?.behind ?? true;
  if (texture) {
    const projection = new Container();
    // The outline's top lands `lean` across and `reach` toward the viewer (both of its height).
    const reach = behind ? -light.reach * BEHIND_REACH : light.reach;
    projection.scale.set(1, -Math.hypot(light.lean, reach));
    projection.skew.x = Math.atan2(light.lean, reach);
    const cast = new Sprite(texture);
    cast.label = "camp-cast-body";
    cast.anchor.set(ANCHOR_X, ANCHOR_Y);
    const canvas = fit?.canvas ?? height;
    cast.width = cast.height = canvas;
    cast.x = fit?.offsetX ?? 0;
    cast.y = fit?.offsetY ?? 0;
    if (fit?.mirrored) cast.scale.x *= -1;
    projection.addChild(cast);
    shadow.addChild(projection);
  }
  // Where it touches the ground: darkest, a little toward the cast.
  const contactRy = Math.max(height * 0.055, 6);
  const contact = new Graphics()
    // Cast back, it sits inside the footprint, its bottom edge on the pegs rather than past them.
    .ellipse(width * 0.06 * Math.sign(light.lean), behind ? 1 - contactRy : height * 0.015, width * 0.48, contactRy)
    .fill({ color: 0xffffff });
  contact.label = "camp-ground-contact";
  shadow.addChild(contact);
  return shadow;
}

/**
 * Fills what is drawn under it with one colour: each pixel becomes the
 * colour, premultiplied by the pixel's own coverage, whatever colour it was.
 * The silhouette of any painting, whatever its colours, comes out the one
 * shade (`shadedPixel` is the same arithmetic, for tests). The stage renders
 * with WebGL only (PixiStage.tsx), so a GL program is all it needs.
 */
const SHADE_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uShade;
void main(void)
{
    float coverage = texture(uTexture, vTextureCoord).a;
    finalColor = vec4(uShade * coverage, coverage);
}
`;

/** The shade as the fill's uniform: its channels from 0 to 1. */
export function shadeRgb(shade: number): [number, number, number] {
  return [((shade >> 16) & 0xff) / 255, ((shade >> 8) & 0xff) / 255, (shade & 0xff) / 255];
}

/** What the fill makes of one premultiplied pixel (`SHADE_FRAGMENT`). */
export function shadedPixel(shade: number, pixel: readonly [number, number, number, number]): [number, number, number, number] {
  const [r, g, b] = shadeRgb(shade);
  const coverage = pixel[3];
  return [r * coverage, g * coverage, b * coverage, coverage];
}

export function shadeFill(shade: number): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: SHADE_FRAGMENT, name: "ground-shadow-fill" }),
    resources: { shadeUniforms: { uShade: { value: new Float32Array(shadeRgb(shade)), type: "vec3<f32>" } } },
  });
}

export interface ShadowLayer {
  /** The layer: add it under whatever casts onto it. */
  layer: Container;
  /** `owner` casts `shadow`: it lies on the layer and follows `owner` there. */
  cast(owner: Container, shadow: Container): void;
  /** The shadow `old` was, now drawn as `next` (new art loaded). */
  recast(old: Container, next: Container): void;
  /** Every shadow to its owner's place, size and fade; one whose owner is gone goes too. */
  sync(): void;
  /** How many screen pixels a unit of the layer is, so the softness is the same at any size. */
  setScale(scale: number): void;
  /** Takes every shadow off the layer. */
  clear(): void;
}

export function createShadowLayer(light: CampLight, label = "camp-shadows"): ShadowLayer {
  const layer = new Container();
  layer.label = label;
  const fill = shadeFill(light.shade);
  // The layer spans the whole camp and is filtered every frame the figures breathe. On a
  // television it is drawn at half size with one blur pass: a shadow is soft by nature, and
  // a set-top GPU otherwise spends more on it than on the camp it lies under.
  const tv = isTvBrowser();
  const blur = new BlurFilter({ strength: light.blur, quality: tv ? 1 : 2, resolution: tv ? 0.5 : 1 });
  if (tv) fill.resolution = 0.5;
  layer.filters = [fill, blur];
  layer.alpha = light.depth;
  const casts = new Map<Container, { owner: Container; holder: Container }>();

  function follow(owner: Container, holder: Container): void {
    holder.position.copyFrom(owner.position);
    holder.scale.copyFrom(owner.scale);
    holder.alpha = owner.alpha;
    holder.visible = owner.visible && owner.renderable;
  }

  return {
    layer,
    cast(owner, shadow) {
      const holder = new Container();
      holder.label = `cast:${owner.label}`;
      holder.addChild(shadow);
      layer.addChild(holder);
      casts.set(shadow, { owner, holder });
      follow(owner, holder);
    },
    recast(old, next) {
      const entry = casts.get(old);
      casts.delete(old);
      old.destroy({ children: true });
      if (!entry) return;
      entry.holder.addChild(next);
      casts.set(next, entry);
    },
    sync() {
      for (const [shadow, { owner, holder }] of casts) {
        if (owner.destroyed || shadow.destroyed || owner.parent === null) {
          casts.delete(shadow);
          holder.destroy({ children: true });
          continue;
        }
        follow(owner, holder);
      }
    },
    setScale(scale) {
      // The blur works in screen pixels.
      blur.strength = light.blur * scale;
    },
    clear() {
      for (const { holder } of casts.values()) holder.destroy({ children: true });
      casts.clear();
    },
  };
}
