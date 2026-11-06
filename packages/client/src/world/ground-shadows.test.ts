// @vitest-environment jsdom
/** One shadow layer under what casts onto it (ground-shadows.ts): each shadow follows its owner and goes with it. */

import { describe, expect, it } from "vitest";
import { Container, Texture } from "pixi.js";
import { createShadowLayer, groundShadow } from "./ground-shadows";
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
