import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { EncounterState } from "@kad/shared";
import { wagonDefense } from "../screens/wagon-defense";

/** A physical wagon above the defended lane; never a second source of rules. */
export function createWagonStage(size: number) {
  const container = new Container();
  container.label = "wagon-defense";
  const ground = new Graphics();
  const intentions = new Graphics();
  const cart = new Container();
  cart.label = "sausage-wagon";
  cart.y = size * .88;
  cart.addChild(new Graphics().ellipse(0, size * .2, size * .75, size * .13).fill({ color: 0x211910, alpha: .5 }));
  container.addChild(ground, intentions, cart);
  let targetX = size, first = true, alive = true;
  const fallback = new Graphics().roundRect(-size * .6, -size * .35, size * 1.2, size * .5, 10).fill(0x9b6a35)
    .circle(-size * .4, size * .15, size * .15).circle(size * .4, size * .15, size * .15).fill(0x3e2c22);
  cart.addChild(fallback);
  void Assets.load<Texture>("/assets/story-props/sausage-wagon.webp").then(texture => {
    if (!alive) return;
    fallback.visible = false;
    const sprite = new Sprite(texture);
    sprite.anchor.set(.5, .7);
    sprite.scale.set(size * 1.25 / Math.max(texture.width, texture.height));
    cart.addChild(sprite);
  }).catch(() => { /* Cart silhouette stays usable without artwork. */ });
  return { container,
    update(encounter: EncounterState) {
      const wagon = wagonDefense(encounter);
      if (!wagon) return;
      targetX = size * (1.2 + 4.5 * wagon.progress / wagon.target);
      if (first) { cart.x = targetX; first = false; }
      ground.clear();
      for (const y of [.88, 1.08]) ground.moveTo(size * .3, size * y).lineTo(size * 6.7, size * y)
        .stroke({ color: 0xbca478, width: size * .06, alpha: .8 });
      intentions.clear();
      for (const threat of wagon.threats) {
        const x = (threat.from.x + .5) * size, y = (threat.from.y + .7) * size;
        const tx = (threat.to.x + .5) * size, ty = (threat.to.y + .7) * size;
        const angle = Math.atan2(ty - y, tx - x), endX = tx - Math.cos(angle) * size * .38, endY = ty - Math.sin(angle) * size * .38;
        intentions.moveTo(x, y).lineTo(endX, endY).stroke({ color: 0xffb38a, width: 5, alpha: .7 });
        intentions.moveTo(endX - Math.cos(angle - .5) * 18, endY - Math.sin(angle - .5) * 18).lineTo(endX, endY)
          .lineTo(endX - Math.cos(angle + .5) * 18, endY - Math.sin(angle + .5) * 18).stroke({ color: 0xffd2b6, width: 5 });
      }
    },
    tick(dt: number, still: boolean) {
      const gap = targetX - cart.x;
      cart.x = still || Math.abs(gap) < .2 ? targetX : cart.x + gap * Math.min(1, dt * 3);
      cart.rotation = still || Math.abs(gap) < 1 ? 0 : Math.sin(cart.x / size * 25) * .025;
    },
    destroy() { alive = false; container.destroy({ children: true }); },
  };
}
