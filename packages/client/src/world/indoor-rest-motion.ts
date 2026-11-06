import { Graphics, MeshPlane, Rectangle, Texture, type Sprite } from "pixi.js";

interface RestMotion {
  tick(elapsed: number, still: boolean): void;
  destroy(): void;
}

/** Warp a small patch of the painting, with all four edges pinned to the original. */
function warp(parent: Sprite, box: Rectangle, steam = false): RestMotion {
  const source = parent.texture;
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

export function indoorRestMotion(art: string | null | undefined, parent: Sprite): RestMotion | undefined {
  // These coordinates are registered to the original 1920 × 1080 paintings.
  if (parent.texture.width !== 1920 || parent.texture.height !== 1080) return;
  switch (art) {
    case "scenes/gemfall/mosshome-guest-tree":
      return warp(parent, new Rectangle(340, 135, 490, 230));
    case "scenes/gemfall/marda-thorn-inn":
      return warp(parent, new Rectangle(215, 268, 90, 124), true);
    case "scenes/riftlight/ashspan-bridge-house": {
      const embers = new Graphics()
        .ellipse(1453, 424, 9, 7).ellipse(1481, 424, 9, 7)
        .ellipse(1453, 450, 9, 7).ellipse(1481, 450, 9, 7)
        .fill({ color: 0xffc06a, alpha: 0.22 });
      embers.label = "indoor-rest-motion";
      embers.blendMode = "add";
      embers.visible = false;
      parent.addChild(embers);
      return {
        tick(elapsed, still) {
          embers.visible = !still;
          embers.alpha = 0.48 + 0.23 * Math.sin(elapsed * 2.1) + 0.14 * Math.sin(elapsed * 3.4);
        },
        destroy: () => embers.destroy(),
      };
    }
  }
}
