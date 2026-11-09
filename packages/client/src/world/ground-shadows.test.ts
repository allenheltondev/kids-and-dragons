// @vitest-environment jsdom
/** One shadow layer under what casts onto it (ground-shadows.ts): each shadow follows its owner and goes with it. */

import { describe, expect, it } from "vitest";
import { Container, Texture, type Filter, type Graphics } from "pixi.js";
import { BEHIND_REACH, createShadowLayer, groundShadow, shadeRgb, shadedPixel } from "./ground-shadows";
import { INDOOR_LIGHT, campLight } from "./camp-light";

describe("ground shadows", () => {
  it("draws only a contact shade with no outline, and casts the outline along the light with one", () => {
    expect(groundShadow(INDOOR_LIGHT, 40, 100).getChildByLabel("camp-cast-body", true)).toBeNull();
    const shadow = groundShadow(campLight("great_river"), 40, 100, Texture.WHITE, { canvas: 120, offsetY: 6 });
    const cast = shadow.getChildByLabel("camp-cast-body", true)!;
    expect(cast.y).toBe(6);
    // The river's sun is on the right: the projection leans left, and lies down toward the viewer.
    const projection = cast.parent!;
    expect(projection.skew.x).toBeLessThan(0);
    expect(projection.scale.y).toBeLessThan(0);
  });

  it("draws every shadow opaque, so two that overlap are no darker than one: the layer alone sets how dark", () => {
    const light = campLight("open_plains");
    const layer = createShadowLayer(light);
    expect(layer.layer.alpha).toBeCloseTo(light.depth);
    for (const shadow of [groundShadow(light, 40, 100, Texture.WHITE, { canvas: 120 }), groundShadow(INDOOR_LIGHT, 40, 100)]) {
      const parts: Container[] = [];
      const walk = (c: Container): void => {
        parts.push(c);
        for (const child of c.children) walk(child as Container);
      };
      walk(shadow);
      // Nothing in a shadow is drawn see-through: an opaque shape over an opaque shape is that shape,
      // so the layer's one opacity is all that darkens the ground, once.
      for (const part of parts) expect(part.alpha).toBe(1);
      const contact = shadow.getChildByLabel("camp-ground-contact") as Graphics;
      const fills = contact.context.instructions.filter((i) => i.action === "fill");
      expect(fills.length).toBeGreaterThan(0);
      for (const fill of fills) expect((fill.data as { style: { alpha: number } }).style.alpha).toBe(1);
    }
  });

  it("fills every silhouette with the light's one shade, whatever colours its painting has", () => {
    const light = campLight("great_river");
    const layer = createShadowLayer(light);
    // The layer's first filter is the fill, before the blur, with the light's shade.
    const fill = layer.layer.filters[0] as Filter;
    expect(fill.glProgram.fragment).toContain("uShade * coverage");
    const uniforms = (fill.resources as unknown as { shadeUniforms: { uniforms: { uShade: Float32Array } } }).shadeUniforms.uniforms;
    expect([...uniforms.uShade]).toEqual([...new Float32Array(shadeRgb(light.shade))]);
    const shade = shadeRgb(light.shade);
    // A red blanket, a blue tent and a white sheep, fully covering: the same pixel, the shade itself.
    const red = shadedPixel(light.shade, [0.8, 0.1, 0.1, 1]);
    expect(shadedPixel(light.shade, [0.1, 0.2, 0.9, 1])).toEqual(red);
    expect(shadedPixel(light.shade, [1, 1, 1, 1])).toEqual(red);
    expect(red).toEqual([...shade, 1]);
    // A painting's soft edge keeps its coverage, in the same shade.
    const edge = shadedPixel(light.shade, [0.12, 0.2, 0.08, 0.4]);
    expect(edge[3]).toBeCloseTo(0.4);
    expect(edge[0] / edge[3]).toBeCloseTo(shade[0]);
  });

  it("casts a tent's shadow back from its pegs, under it, and everything else's toward the viewer", () => {
    const light = campLight("open_plains");
    /** Where the top of an outline 1 tall lands, on the ground. */
    const top = (behind: boolean) => {
      const shadow = groundShadow(light, 40, 100, Texture.WHITE, { canvas: 120, behind });
      const projection = shadow.getChildByLabel("camp-cast-body", true)!.parent!;
      projection.updateLocalTransform();
      return projection.localTransform.apply({ x: 0, y: -1 });
    };
    const forward = top(false);
    const back = top(true);
    // Forward: down the screen, toward the viewer. Back: up it, behind the tent.
    expect(forward.y).toBeGreaterThan(0);
    expect(back.y).toBeLessThan(0);
    expect(back.y).toBeCloseTo(-light.reach * BEHIND_REACH);
    // Both to the lower or upper left: the sun is at the upper right.
    expect(forward.x).toBeCloseTo(light.lean);
    expect(back.x).toBeCloseTo(light.lean);
    // Cast back, its contact shade sits inside the footprint, ending at the pegs.
    const contact = groundShadow(light, 40, 100, Texture.WHITE, { canvas: 120, behind: true }).getChildByLabel("camp-ground-contact")!;
    expect(contact.getLocalBounds().maxY).toBeLessThanOrEqual(2);
  });

  it("keeps each shadow at its owner's place, size and fade, and drops it when the owner goes", () => {
    const layer = createShadowLayer(INDOOR_LIGHT);
    expect(layer.layer.alpha).toBeCloseTo(INDOOR_LIGHT.depth);
    const world = new Container();
    const owner = new Container();
    owner.label = "hero";
    world.addChild(owner);
    layer.cast(owner, groundShadow(INDOOR_LIGHT, 40, 100));
    owner.position.set(120, 340);
    owner.scale.set(0.5);
    owner.alpha = 0.4;
    layer.sync();
    const holder = layer.layer.getChildByLabel("cast:hero")!;
    expect([holder.x, holder.y, holder.scale.x, holder.alpha]).toEqual([120, 340, 0.5, 0.4]);
    // New art: the same holder, the new shadow.
    const next = groundShadow(INDOOR_LIGHT, 50, 100);
    layer.recast(holder.children[0] as Container, next);
    expect(holder.children).toEqual([next]);
    owner.destroy();
    layer.sync();
    expect(layer.layer.children).toHaveLength(0);
    layer.cast(world, groundShadow(INDOOR_LIGHT, 40, 100));
    layer.clear();
    expect(layer.layer.children).toHaveLength(0);
  });
});
