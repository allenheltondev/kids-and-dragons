/**
 * Quiet stand-ins for camp art that is not painted yet (docs/camp.md §9,
 * #620; assets/manifest.json → `camp`, owed in `npm run art:inventory`).
 *
 * The camp has always drawn something where a piece's art is missing, so a
 * layout reads before its paintings land. Phase 2 has a lot of art still to
 * paint (tents, the cookfire, every shop and find piece), and a kid has to be
 * able to find her own tent and see where a piece went before then. So the
 * stand-ins are plain and soft, clearly placeholders without shouting: a
 * soft-edged tent in her color, a pale rounded silhouette for a piece at its
 * true height and width, a souvenir line only when she has souvenirs to hang.
 * Each is drawn on the piece's own registration (ground contact at the
 * container's origin, `heightPx` tall), so the painting drops into its place.
 * Their names are small labels the camp lays out clear of each other
 * (camp-boxes.ts), drawn over everything rather than inside the pieces.
 */

import { Container, Graphics, Text } from "pixi.js";

const INK = 0xfdf6e3;
const NEUTRAL = 0xc9b99a;
/** The silhouette's pale cloth: a placeholder, never a painting. */
const GHOST = 0xf3ead6;

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
 * A small label, `size` canvas px, anchored at its top middle. Text needs a 2D
 * canvas to measure with; where there is none (a test without the fake), the
 * picture stands alone.
 */
export function standInLabel(words: string, size: number): Text | null {
  try {
    const text = new Text({
      text: words,
      style: { fontFamily: "Nunito, system-ui, sans-serif", fontSize: size, fontWeight: "700", fill: INK, stroke: { color: 0x1d1a2c, width: Math.max(3, size * 0.2) }, align: "center" },
    });
    text.label = "camp-stand-in-label";
    text.anchor.set(0.5, 0);
    return text;
  } catch {
    return null;
  }
}

/** What a stand-in was drawn at, before its container's scale: for the tests that hold her gear to her size. */
const drawn = new WeakMap<Container, { width: number; height: number }>();
export function standInSize(standIn: Container): { width: number; height: number } | undefined {
  return drawn.get(standIn);
}

/** The tent's outline: a soft bell, its ridge rounded rather than a point. */
function tentPath(g: Graphics, w: number, h: number, grow = 0): Graphics {
  const hw = w / 2 + grow;
  const top = -h - grow;
  return g
    .moveTo(-hw, 0)
    .bezierCurveTo(-hw * 0.82, -h * 0.35, -hw * 0.34, top * 0.82, -hw * 0.1, top * 0.98)
    .quadraticCurveTo(0, top * 1.02, hw * 0.1, top * 0.98)
    .bezierCurveTo(hw * 0.34, top * 0.82, hw * 0.82, -h * 0.35, hw, 0)
    .closePath();
}

/**
 * A hero's tent before its painting: a soft-edged tent in her color, `widthPx`
 * wide (fitted to her, camp-ownership.ts), her decorations along its sides.
 * An empty seat's tent is pale and plain.
 */
export function tentStandIn(heightPx: number, options: { accent?: string; widthPx?: number; decorations?: number; owned?: boolean }): Container {
  const out = new Container();
  out.label = "camp-stand-in:tent";
  const owned = options.owned ?? options.accent !== undefined;
  const cloth = owned ? colorOf(options.accent) : NEUTRAL;
  const w = options.widthPx ?? heightPx * 1.1;
  const h = heightPx;
  drawn.set(out, { width: w, height: h });
  const soft = Math.max(2, h * 0.025);
  const g = new Graphics();
  // A feathered edge: the same shape a little bigger and faint, then the cloth.
  tentPath(g, w, h, soft * 1.6).fill({ color: shade(cloth, 0.5), alpha: owned ? 0.18 : 0.1 });
  tentPath(g, w, h, soft * 0.7).fill({ color: shade(cloth, 0.55), alpha: owned ? 0.35 : 0.18 });
  tentPath(g, w, h).fill({ color: cloth, alpha: owned ? 0.92 : 0.45 });
  // Light from the upper left, and the door: a rounded arch, a little darker.
  g.moveTo(-w * 0.04, -h * 0.97).bezierCurveTo(-w * 0.22, -h * 0.7, -w * 0.38, -h * 0.3, -w * 0.46, 0).lineTo(-w * 0.1, 0).closePath().fill({ color: 0xffffff, alpha: owned ? 0.12 : 0.06 });
  g.moveTo(-w * 0.13, 0).quadraticCurveTo(-w * 0.12, -h * 0.5, 0, -h * 0.52).quadraticCurveTo(w * 0.12, -h * 0.5, w * 0.13, 0).closePath().fill({ color: shade(cloth, 0.45), alpha: owned ? 0.55 : 0.25 });
  out.addChild(g);
  // Her decorations hang along the left side, one soft dot each.
  const count = Math.max(0, Math.min(3, options.decorations ?? 0));
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const x = -w * 0.42 + t * w * 0.3;
    const y = -h * (0.12 + 0.62 * t);
    const deco = new Graphics().circle(x, y, h * 0.045).fill({ color: 0xffd36e, alpha: 0.95 }).circle(x, y, h * 0.06).fill({ color: 0xffd36e, alpha: 0.25 });
    deco.label = "camp-stand-in:decoration";
    out.addChild(deco);
  }
  return out;
}

/** The souvenir line on her tent: two slim pegs and a line, a pennant per souvenir. Nothing while she has none. */
export function souvenirStandIn(heightPx: number, options: { accent?: string; souvenirs: number }): Container {
  const out = new Container();
  out.label = "camp-stand-in:souvenirs";
  const n = Math.max(0, Math.min(4, options.souvenirs));
  if (n === 0) return out;
  const w = heightPx * 1.1;
  const g = new Graphics();
  g.moveTo(-w / 2, 0).lineTo(-w / 2, -heightPx).moveTo(w / 2, 0).lineTo(w / 2, -heightPx).stroke({ width: Math.max(2, heightPx * 0.04), color: 0x6b4f2a, alpha: 0.8 });
  g.moveTo(-w / 2, -heightPx * 0.92).quadraticCurveTo(0, -heightPx * 0.72, w / 2, -heightPx * 0.92).stroke({ width: 2, color: 0xe8dcc0, alpha: 0.8 });
  out.addChild(g);
  const color = colorOf(options.accent);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 1) / (n + 1)) * w;
    const y = -heightPx * (0.92 - 0.2 * (1 - Math.pow((2 * x) / w, 2)));
    const p = new Graphics().poly([x - heightPx * 0.08, y, x + heightPx * 0.08, y, x, y + heightPx * 0.22]).fill({ color, alpha: 0.9 });
    p.label = "camp-stand-in:souvenir";
    out.addChild(p);
  }
  return out;
}

/** Any other piece before its painting: a pale, rounded silhouette at its true height and width. */
export function pieceStandIn(heightPx: number, widthPx = heightPx * 0.6): Container {
  const out = new Container();
  out.label = "camp-stand-in:piece";
  const w = Math.max(8, widthPx);
  const h = Math.max(8, heightPx);
  const r = Math.min(w, h) * 0.45;
  const g = new Graphics()
    .roundRect(-w / 2 - 3, -h - 3, w + 6, h + 6, r + 3)
    .fill({ color: GHOST, alpha: 0.08 })
    .roundRect(-w / 2, -h, w, h, r)
    .fill({ color: GHOST, alpha: 0.2 })
    .stroke({ width: 2, color: GHOST, alpha: 0.32 });
  out.addChild(g);
  return out;
}

/**
 * The crew's name on its banner pole (`CrewIdentity`), laid out by camp-boxes.ts
 * under the pole's foot, clear of the flag: `text` is one line or two (a "\n"),
 * `size` canvas px; its middle top is at the container's origin.
 */
export function bannerName(text: string, size: number): Container | null {
  try {
    const name = new Text({
      text,
      style: {
        fontFamily: "Nunito, system-ui, sans-serif",
        fontSize: size,
        fontWeight: "800",
        fill: 0xfff3d6,
        stroke: { color: 0x5a1f28, width: Math.max(3, size * 0.25) },
        align: "center",
        lineHeight: size * 1.3,
      },
    });
    name.anchor.set(0.5, 0);
    name.label = "camp-banner-name";
    return name;
  } catch {
    return null;
  }
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
