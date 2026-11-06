import { Container, Graphics, MeshPlane, Rectangle, Texture, type Sprite } from "pixi.js";

export interface RestMotion {
  tick(elapsed: number, still: boolean): void;
  destroy(): void;
}

/** Warp a small patch of the painting, with all four edges pinned to the original. */
function warp(parent: Container, source: Texture, box: Rectangle, steam = false): RestMotion {
  const texture = new Texture({
    source: source.source,
    frame: new Rectangle(source.frame.x + box.x, source.frame.y + box.y, box.width, box.height),
  });
  const plane = new MeshPlane({ texture, verticesX: 12, verticesY: 10 });
  plane.label = "indoor-rest-motion";
  plane.position.set(box.x, box.y);
  plane.visible = false;
  parent.addChild(plane);
  const { buffer } = plane.geometry.getAttribute("aPosition");
  const positions = buffer.data as Float32Array;
  const original = positions.slice();
  return {
    tick(elapsed, still) {
      plane.visible = !still;
      if (still) return;
      for (let i = 0; i < positions.length; i += 2) {
        const x = original[i]!;
        const y = original[i + 1]!;
        const u = x / box.width;
        const v = y / box.height;
        const envelope = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
        if (steam) {
          const curl = elapsed * 1.8 + v * 5;
          positions[i] = x + envelope * 11 * Math.sin(curl);
          positions[i + 1] = y - envelope * 9 * Math.cos(curl);
        } else {
          const swing = elapsed * 1.05;
          positions[i] = x + envelope * 10 * Math.sin(swing);
          positions[i + 1] = y - envelope * 5 * Math.sin(swing) ** 2;
        }
      }
      buffer.update();
    },
    destroy: () => plane.destroy({ texture: true }),
  };
}

export function indoorRestMotion(art: string | null | undefined, painting: Sprite, backdrop: Container): RestMotion | undefined {
  // These coordinates are registered to the original 1920 × 1080 paintings.
  const texture = painting.texture;
  if (texture.width !== 1920 || texture.height !== 1080) return;
  const layer = new Container({ position: painting.position, scale: painting.scale });
  let effect: RestMotion;
  switch (art) {
    case "scenes/gemfall/mosshome-guest-tree":
      effect = warp(layer, texture, new Rectangle(340, 135, 490, 230));
      break;
    case "scenes/gemfall/marda-thorn-inn":
      effect = warp(layer, texture, new Rectangle(215, 268, 90, 124), true);
      break;
    case "scenes/riftlight/ashspan-bridge-house": {
      const embers = new Graphics()
        .ellipse(1453, 424, 9, 7).ellipse(1481, 424, 9, 7)
        .ellipse(1453, 450, 9, 7).ellipse(1481, 450, 9, 7)
        .fill({ color: 0xffc06a, alpha: 0.22 });
      embers.label = "indoor-rest-motion";
      embers.blendMode = "add";
      embers.visible = false;
      layer.addChild(embers);
      effect = {
        tick(elapsed, still) {
          embers.visible = !still;
          embers.alpha = 0.48 + 0.23 * Math.sin(elapsed * 2.1) + 0.14 * Math.sin(elapsed * 3.4);
        },
        destroy: () => embers.destroy(),
      };
      break;
    }
    default:
      layer.destroy();
      return;
  }
  backdrop.addChild(layer);
  return {
    tick: effect.tick,
    destroy() {
      effect.destroy();
      layer.destroy();
    },
  };
}
