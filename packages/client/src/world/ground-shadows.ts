/**
 * Shadows on the ground, cast by one light (camp-light.ts): the camp's
 * (camp.ts) and an indoor rest's packed camp (scene.ts) draw them the same way.
 *
 * Each thing standing on the ground casts its own outline, sheared along the
 * ground where the light sends it, and a contact shade under its feet, both
 * drawn solid in the light's shade. They all lie on one layer under what casts
 * them, which is blurred and laid down at the light's depth as one: two
 * shadows that overlap merge, as real shadows do, rather than one darkening
 * the other. Each follows what casts it (`sync`, every frame).
 */

import { BlurFilter, Container, Graphics, Sprite, type Texture } from "pixi.js";
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
}

/**
 * One thing's shadow: its outline (`texture`, drawn on `fit`'s canvas) cast
 * along the ground, and a contact shade `width` wide under it; with no
 * texture, only the contact shade. `height` is its drawn height.
 */
export function groundShadow(light: CampLight, width: number, height: number, texture?: Texture, fit?: CastFit): Container {
  const shadow = new Container();
  shadow.label = "camp-ground-shadow";
  if (texture) {
    const projection = new Container();
    // The outline's top lands `lean` across and `reach` toward the viewer (both of its height).
    projection.scale.set(1, -Math.hypot(light.lean, light.reach));
    projection.skew.x = Math.atan2(light.lean, light.reach);
    const cast = new Sprite(texture);
    cast.label = "camp-cast-body";
    cast.anchor.set(ANCHOR_X, ANCHOR_Y);
    const canvas = fit?.canvas ?? height;
    cast.width = cast.height = canvas;
    cast.x = fit?.offsetX ?? 0;
    cast.y = fit?.offsetY ?? 0;
    if (fit?.mirrored) cast.scale.x *= -1;
    cast.tint = light.shade;
    cast.alpha = 0.72;
    projection.addChild(cast);
    shadow.addChild(projection);
  }
  // Where it touches the ground: darkest, a little toward the cast.
  const contact = new Graphics()
    .ellipse(width * 0.06 * Math.sign(light.lean), height * 0.015, width * 0.48, Math.max(height * 0.055, 6))
    .fill({ color: light.shade, alpha: 0.9 });
  contact.label = "camp-ground-contact";
  shadow.addChild(contact);
  return shadow;
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
  const blur = new BlurFilter({ strength: light.blur, quality: 2 });
  layer.filters = [blur];
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
