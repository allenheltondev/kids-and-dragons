/**
 * Labelled stand-ins for camp art that is not painted yet (docs/camp.md §9,
 * #620; assets/manifest.json → `camp`, owed in `npm run art:inventory`).
 *
 * The camp has always drawn an outline where a piece's art is missing, so a
 * layout reads before its paintings land. Phase 2 has a lot of art still to
 * paint (tents, the cookfire, every shop and find piece), and a kid has to be
 * able to find her own tent and see where a piece went before then, so the
 * stand-ins say what they are: a tent in her color with her name under it,
 * a souvenir line with a pennant per souvenir, and a named box for a piece.
 * Each is drawn on the piece's own registration (ground contact at the
 * container's origin, `heightPx` tall), so the painting drops into its place.
 */

import { Container, Graphics, Text } from "pixi.js";

const OUTLINE = 0x8b6cf5;
const INK = 0xfdf6e3;
const NEUTRAL = 0xc9b99a;

/** Hex "#RRGGBB" to a Pixi color; anything else is the neutral cloth. */
export function colorOf(hex: string | undefined): number {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : NEUTRAL;
}

/** A darker shade of `color`, for seams and the door. */
function shade(color: number, by = 0.6): number {
  const r = Math.round(((color >> 16) & 0xff) * by);
  const g = Math.round(((color >> 8) & 0xff) * by);
  const b = Math.round((color & 0xff) * by);
  return (r << 16) | (g << 8) | b;
}

/**
 * A label under a stand-in, sized to its piece. Text needs a 2D canvas to
 * measure with; where there is none (a test without the fake), the picture
 * stands alone.
 */
export function standInLabel(words: string, heightPx: number, place: "below" | "inside" = "below"): Container | null {
  try {
    const size = Math.max(14, Math.min(34, heightPx * 0.16));
    const text = new Text({
      text: words,
      style: { fontFamily: "Nunito, system-ui, sans-serif", fontSize: size, fontWeight: "700", fill: INK, stroke: { color: 0x1d1a2c, width: Math.max(3, size * 0.2) }, align: "center" },
    });
    text.label = "camp-stand-in-label";
    text.anchor.set(0.5, place === "below" ? 0 : 0.5);
    text.y = place === "below" ? size * 0.25 : -heightPx / 2;
    return text;
  } catch {
    return null;
  }
}

/** A hero's tent before its painting: a ridge tent in her color, her decorations on it, her name under it. */
export function tentStandIn(heightPx: number, options: { accent?: string; label?: string; decorations?: number }): Container {
  const out = new Container();
  out.label = "camp-stand-in:tent";
  const cloth = colorOf(options.accent);
  const w = heightPx * 1.25;
  const g = new Graphics();
  g.poly([-w / 2, 0, 0, -heightPx, w / 2, 0]).fill({ color: cloth }).stroke({ width: Math.max(2, heightPx * 0.03), color: shade(cloth, 0.45) });
  g.poly([-w * 0.14, 0, 0, -heightPx * 0.55, w * 0.14, 0]).fill({ color: shade(cloth, 0.55) });
  g.moveTo(0, -heightPx).lineTo(0, -heightPx * 1.08).stroke({ width: Math.max(2, heightPx * 0.025), color: 0x6b4f2a });
  out.addChild(g);
  // Her decorations hang along the ridge, one bright diamond each.
  const count = Math.max(0, Math.min(3, options.decorations ?? 0));
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const x = -w / 2 + t * w;
    const y = -heightPx * (1 - Math.abs(x) / (w / 2)) + heightPx * 0.12;
    const d = heightPx * 0.07;
    const deco = new Graphics().poly([x, y - d, x + d, y, x, y + d, x - d, y]).fill({ color: 0xffd36e }).stroke({ width: 2, color: 0x6b4f2a });
    deco.label = "camp-stand-in:decoration";
    out.addChild(deco);
  }
  // Her name over the ridge, where the hero resting at its door does not cover it.
  const label = options.label ? standInLabel(options.label, heightPx) : null;
  if (label) {
    (label as Text).anchor?.set(0.5, 1);
    label.y = -heightPx * 1.12;
    out.addChild(label);
  }
  return out;
}

/** The souvenir line beside a tent: two pegs and a line, a pennant per souvenir she carries. */
export function souvenirStandIn(heightPx: number, options: { accent?: string; souvenirs: number }): Container {
  const out = new Container();
  out.label = "camp-stand-in:souvenirs";
  const w = heightPx * 1.1;
  const g = new Graphics();
  g.moveTo(-w / 2, 0).lineTo(-w / 2, -heightPx).moveTo(w / 2, 0).lineTo(w / 2, -heightPx).stroke({ width: Math.max(2, heightPx * 0.05), color: 0x6b4f2a });
  g.moveTo(-w / 2, -heightPx * 0.92).quadraticCurveTo(0, -heightPx * 0.72, w / 2, -heightPx * 0.92).stroke({ width: 2, color: 0xe8dcc0 });
  out.addChild(g);
  const n = Math.max(0, Math.min(4, options.souvenirs));
  const color = colorOf(options.accent);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 1) / (n + 1)) * w;
    const y = -heightPx * (0.92 - 0.2 * (1 - Math.pow((2 * x) / w, 2)));
    const p = new Graphics().poly([x - heightPx * 0.09, y, x + heightPx * 0.09, y, x, y + heightPx * 0.24]).fill({ color }).stroke({ width: 2, color: shade(color, 0.45) });
    p.label = "camp-stand-in:souvenir";
    out.addChild(p);
  }
  return out;
}

/** Any other piece before its painting: an outlined box, named. */
export function pieceStandIn(heightPx: number, label: string): Container {
  const out = new Container();
  out.label = "camp-stand-in:piece";
  // Slim and see-through, so a tall piece (a banner pole, a lantern string)
  // does not hide whoever stands near it; named along its foot.
  const w = Math.min(Math.max(heightPx * 0.4, 70), 150);
  const g = new Graphics()
    .roundRect(-w / 2, -heightPx, w, heightPx, Math.min(16, heightPx * 0.1))
    .fill({ color: 0x2a2f4a, alpha: 0.28 })
    .stroke({ width: 3, color: OUTLINE, alpha: 0.85 });
  out.addChild(g);
  const text = standInLabel(label, 170, "below");
  if (text) out.addChild(text);
  return out;
}

/** The crew's name on its banner (`CrewIdentity`): over the banner pole, painted or not. */
export function bannerName(heightPx: number, name: string): Container | null {
  const text = standInLabel(name, heightPx * 0.7, "inside");
  if (!text) return null;
  text.y = -heightPx * 0.78;
  text.label = "camp-banner-name";
  return text;
}

/** The glow under a hotspot a new piece fits (§12.5): a soft gold ring on the ground. */
export function hotspotGlow(widthPx: number): Graphics {
  const g = new Graphics();
  g.label = "camp-hotspot-glow";
  for (let ring = 6; ring > 0; ring--) {
    const s = ring / 6;
    g.ellipse(0, 0, widthPx * 0.6 * s, widthPx * 0.16 * s).fill({ color: 0xffd36e, alpha: 0.07 });
  }
  g.ellipse(0, 0, widthPx * 0.6, widthPx * 0.16).stroke({ width: 3, color: 0xffd36e, alpha: 0.9 });
  return g;
}
