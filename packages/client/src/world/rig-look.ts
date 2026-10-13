/**
 * A character's chosen look, painted onto the rig's own part images.
 *
 * Creation asks for a main color, a second color, markings and (for a horned
 * or winged creature) a horn or wing style, and a child who taps "Rose" expects
 * the creature in front of them to turn rose. This is what makes it.
 *
 * **It repaints the art rather than tinting over it.** The old recolour pushed
 * one flat hue into the rig's `mane`/`accent` tint slots, and that is what
 * flattened the shading (rive-rig.ts header). Here every pixel keeps its own
 * value and its own place in the shading ramp; only its hue moves, and only
 * when that hue is one the species palette says belongs to the slot being
 * changed (`assets/manifest.json` → `paletteRule`: every region follows the
 * mane hue H, and the accent sits on the signature part). Eyes, cheeks, belly
 * colors and outlines that are not the slot's hue stay exactly as painted.
 *
 * Markings and horn/wing styles are drawn over the part, clipped to its own
 * silhouette, so they move with it in every clip.
 *
 * Pure canvas — no Rive, no Pixi, no DOM where an OffscreenCanvas will do —
 * so the pixel half can be unit tested, the painting can run in a worker
 * (rig-look.worker.ts), and the rig module only hands images in and out.
 */

export type SignaturePart = "horn" | "wings" | "mane" | "tail";

export interface RigLook {
  /** The species' own palette — what the art was painted in. */
  from: { mane: string; accent: string };
  /** What the player picked. Equal to `from` means "as painted". */
  to: { mane: string; accent: string };
  signature: SignaturePart;
  /** Pattern id, or undefined for none. */
  markings?: string;
  /** Wing overlay id, or undefined when the wings are drawn as painted. */
  wingStyle?: string;
  /** Horn overlay id, or undefined when the horn is drawn as painted. */
  hornStyle?: string;
}

/**
 * A creature whose signature *is* its mane (bigfoot) wears the second color
 * there — or the second color would have nowhere to go — and the main color
 * until a second one is picked.
 */
function maneSignatureTarget(look: RigLook): string {
  return look.to.accent.toLowerCase() !== look.from.accent.toLowerCase() ? look.to.accent : look.to.mane;
}

/**
 * What one part's picture depends on, as a string: "" when the part is
 * exactly as painted. Keyed per part so a tap repaints only what it changes —
 * a marking never re-encodes the wings, a wing style touches nothing else.
 */
export function partLookKey(part: string, look: RigLook): string {
  const isSignature = part === look.signature;
  const main = isSignature && look.signature === "mane"
    ? [look.from.mane, maneSignatureTarget(look)]
    : [look.from.mane, look.to.mane];
  const keys: string[] = [];
  if (main[0]?.toLowerCase() !== main[1]?.toLowerCase()) keys.push(`m:${main.join(">")}`);
  if (isSignature && look.signature !== "mane" && look.from.accent.toLowerCase() !== look.to.accent.toLowerCase()) {
    keys.push(`a:${look.from.accent}>${look.to.accent}`);
  }
  if (look.markings !== undefined && MARKED_PARTS.has(part)) keys.push(`k:${look.markings}:${look.to.mane}:${look.to.accent}`);
  if (part === "wings" && look.wingStyle !== undefined) keys.push(`w:${look.wingStyle}:${look.to.accent}`);
  if (part === "horn" && look.hornStyle !== undefined) keys.push(`h:${look.hornStyle}`);
  return keys.join("|").toLowerCase();
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

export interface Hsv {
  /** Degrees, 0–360. */
  h: number;
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function rgbToHsv(r8: number, g8: number, b8: number): Hsv {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Writes 0–255 RGB into `out` at `i`. */
function hsvInto(h: number, s: number, v: number, out: Uint8ClampedArray, i: number): void {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  out[i] = (r + m) * 255;
  out[i + 1] = (g + m) * 255;
  out[i + 2] = (b + m) * 255;
}

/** Shortest signed distance from `a` to `b` round the wheel. */
export function hueDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much a pixel belongs to a slot: 1 inside `inner` degrees of the slot's
 * hue, easing to 0 by `outer`. Near-grey pixels have no trustworthy hue, so
 * saturation gates it too — a white coat and a black outline never "belong" to
 * a hue they only carry by rounding.
 */
function membership(h: number, s: number, slotHue: number, inner = 32, outer = 58): number {
  const d = Math.abs(hueDelta(h, slotHue));
  const hue = d <= inner ? 1 : d >= outer ? 0 : 1 - (d - inner) / (outer - inner);
  return hue * smoothstep(0.02, 0.07, s);
}

/** One slot's move: rotate hue, and lean saturation/value toward the target. */
interface SlotShift {
  fromHue: number;
  dh: number;
  sRatio: number;
  vRatio: number;
  /** Extra saturation for pale pixels, 0 when the hue barely moves. */
  coatWash: number;
}

function slotShift(from: string, to: string): SlotShift | null {
  if (from.toLowerCase() === to.toLowerCase()) return null;
  const a = hexToHsv(from);
  const b = hexToHsv(to);
  // Ratios softened (^0.7) and clamped: the target is a swatch, the pixel is
  // somewhere on a shading ramp, and a full ratio blows highlights out.
  const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  return {
    fromHue: a.h,
    dh: hueDelta(a.h, b.h),
    sRatio: clamp((b.s / Math.max(a.s, 0.01)) ** 0.5, 0.55, 1.5),
    vRatio: clamp((b.v / Math.max(a.v, 0.01)) ** 0.7, 0.55, 1.6),
    coatWash: 0.16 * smoothstep(10, 40, Math.abs(hueDelta(a.h, b.h))),
  };
}

/**
 * Recolor RGBA pixels in place. `main` moves the species' mane-hued pixels;
 * `second` (signature part only) moves accent-hued ones. Exported for tests.
 */
export function recolorPixels(
  data: Uint8ClampedArray,
  main: { from: string; to: string } | null,
  second: { from: string; to: string } | null,
): void {
  const m = main ? slotShift(main.from, main.to) : null;
  const a = second ? slotShift(second.from, second.to) : null;
  if (!m && !a) return;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue;
    // rgbToHsv, inlined: this runs on every pixel of every part per tap.
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;
    const v = Math.max(r, g, b);
    const d = v - Math.min(r, g, b);
    if (d === 0) continue; // grey: no hue to belong to anything
    const s = d / v;
    let h = v === r ? ((g - b) / d) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    const wm = m ? membership(h, s, m.fromHue) : 0;
    const wa = a ? membership(h, s, a.fromHue) : 0;
    // A pixel follows the slot it belongs to more strongly — never both.
    const shift = wa > wm ? a : m;
    const w = wa > wm ? wa : wm;
    if (!shift || w <= 0) continue;
    // Value only moves on properly colored pixels: a near-white coat that
    // shares the mane's hue must stay a near-white coat.
    const strong = smoothstep(0.15, 0.4, s);
    const nh = h + shift.dh * w;
    // Pale coat pixels get a wash of the new color on top of the ratio: a
    // near-white coat rotated by hue alone stays near-white, and "I picked
    // Rose" has to read on a creature that is mostly coat.
    const wash = shift.coatWash * w * (1 - strong) * v;
    const ns = Math.min(1, s * (1 + (shift.sRatio - 1) * w) + wash);
    const nv = Math.min(1, v * (1 + (shift.vRatio - 1) * w * strong));
    hsvInto(nh, ns, nv, data, i);
  }
}

// ---------------------------------------------------------------------------
// Overlays — markings, horn and wing styles
// ---------------------------------------------------------------------------

/** Parts a marking pattern is drawn on. Never the head: it would cover the eyes. */
const MARKED_PARTS = new Set(["body", "leg_l", "leg_r", "arm_l", "arm_r"]);

/** Deterministic, so a part looks the same every time it is repainted. */
function seeded(seed: string): () => number {
  let x = 2166136261;
  for (const ch of seed) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  return () => {
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A drawing surface: offscreen wherever it exists, so this runs in a worker. */
export type Surface = HTMLCanvasElement | OffscreenCanvas;

function makeSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(surface: Surface, readback = false): Ctx | null {
  return surface.getContext("2d", readback ? { willReadFrequently: true } : undefined) as Ctx | null;
}

function star(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4 - Math.PI / 2;
    const rr = k % 2 === 0 ? r : r * 0.32;
    ctx.lineTo(x + Math.cos(angle) * rr, y + Math.sin(angle) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Which pixels of a part an overlay belongs on, or null for none on this part.
 *
 * Not the part's whole silhouette: a cut part carries scraps of its
 * neighbors with straight cut edges — a wing comes with a slice of neck and
 * back, hidden under the body — and a pattern on those shows as a hard-edged
 * patch through every soft fur edge. So the region is chosen by color, from
 * the species palette: a wing style lands on the wing's own (accent) color, a
 * marking on anything that is not accent-colored and not outline-dark.
 */
function overlayRegion(part: string, look: RigLook): "signature" | "coat" | "all" | null {
  if (part === "wings" && look.wingStyle !== undefined) return "signature";
  if (part === "horn" && look.hornStyle !== undefined) return "all";
  if (look.markings !== undefined && MARKED_PARTS.has(part)) return "coat";
  return null;
}

function maskOf(
  pixels: ImageData,
  box: Box,
  like: Surface,
  region: "signature" | "coat" | "all",
  look: RigLook,
): Surface {
  const mask = makeSurface(like.width, like.height);
  const mctx = context(mask);
  if (!mctx) return like;
  const out = new ImageData(box.w, box.h);
  const accent = hexToHsv(look.from.accent).h;
  const src = pixels.data;
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3] ?? 0;
    if (alpha === 0) continue;
    const { h, s, v } = rgbToHsv(src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0);
    const signature = membership(h, s, accent, 28, 50) * smoothstep(0.15, 0.3, s);
    let keep = 1;
    if (region === "signature") keep = signature;
    else if (region === "coat") keep = (1 - signature) * smoothstep(0.3, 0.5, v);
    out.data[i + 3] = alpha * keep;
  }
  mctx.putImageData(out, box.x, box.y);
  return mask;
}

/** Darker shade of a hex, as an rgba() string. */
function shade(hex: string, v: number, alpha: number): string {
  const c = hexToHsv(hex);
  const px = new Uint8ClampedArray(4);
  hsvInto(c.h, Math.min(1, c.s * 1.1 + 0.1), Math.min(1, c.v * v), px, 0);
  return `rgba(${String(px[0])},${String(px[1])},${String(px[2])},${String(alpha)})`;
}

/**
 * Draw `paint` into its own layer, keep only what lands on the part, and lay
 * the layer onto the part with `mode`. Patterns are drawn in part pixels, and
 * every part of a figure is cut from the same 1024 canvas, so a stripe is the
 * same width on a leg as on the body.
 */
function overlay(
  target: Surface,
  mask: CanvasImageSource,
  box: Box,
  mode: GlobalCompositeOperation,
  alpha: number,
  paint: (ctx: Ctx, w: number, h: number) => void,
): void {
  const layer = makeSurface(target.width, target.height);
  const lctx = context(layer);
  const tctx = context(target);
  if (!lctx || !tctx) return;
  // Painted in the part's own box, so "the root of the wing" and "a stripe
  // every 60px across the body" mean the part and not the 1024 canvas.
  lctx.save();
  lctx.translate(box.x, box.y);
  paint(lctx, box.w, box.h);
  lctx.restore();
  lctx.globalCompositeOperation = "destination-in";
  lctx.drawImage(mask, 0, 0);
  tctx.save();
  tctx.globalCompositeOperation = mode;
  tctx.globalAlpha = alpha;
  tctx.drawImage(layer, 0, 0);
  tctx.restore();
}

function drawMarkings(canvas: Surface, mask: CanvasImageSource, box: Box, part: string, kind: string, look: RigLook): void {
  const rand = seeded(`${kind}:${part}`);
  const ink = shade(look.to.mane, 0.8, 1);
  switch (kind) {
    case "dapple":
      overlay(canvas, mask, box, "multiply", 0.6, (ctx, w, h) => {
        ctx.fillStyle = ink;
        const count = Math.ceil((w * h) / 3400);
        for (let k = 0; k < count; k++) {
          ctx.beginPath();
          ctx.arc(rand() * w, rand() * h, 10 + rand() * 16, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      return;
    case "stripe":
      overlay(canvas, mask, box, "multiply", 0.65, (ctx, w, h) => {
        ctx.fillStyle = ink;
        // Tiger stripes: wavy bands of uneven width, rather than a ruled
        // row of bars. Full height — a part's box runs past its silhouette,
        // so a band that stops short can miss the creature altogether.
        for (let x = 8 + rand() * 20; x < w; x += 52 + rand() * 20) {
          const width = 16 + rand() * 12;
          const lean = (rand() - 0.5) * 40;
          const wave = (rand() - 0.5) * 50;
          ctx.beginPath();
          ctx.moveTo(x - width / 2, -4);
          ctx.bezierCurveTo(x - width / 2 + wave, h * 0.35, x + lean - wave - width * 0.3, h * 0.7, x + lean - width * 0.3, h + 4);
          ctx.lineTo(x + lean + width * 0.3, h + 4);
          ctx.bezierCurveTo(x + lean - wave + width * 0.3, h * 0.7, x + width / 2 + wave, h * 0.35, x + width / 2, -4);
          ctx.closePath();
          ctx.fill();
        }
      });
      return;
    case "starfall":
      overlay(canvas, mask, box, "source-over", 0.95, (ctx, w, h) => {
        // A soft glow under each star so it reads on a pale coat too.
        ctx.shadowColor = shade(look.to.accent, 0.7, 0.9);
        ctx.shadowBlur = 6;
        ctx.fillStyle = shade(look.to.accent, 1.1, 1);
        const count = Math.ceil((w * h) / 3600);
        for (let k = 0; k < count; k++) star(ctx, rand() * w, rand() * h, 12 + rand() * 10);
      });
      return;
    default:
      return;
  }
}

function drawWings(canvas: Surface, mask: CanvasImageSource, box: Box, kind: string, look: RigLook): void {
  const rand = seeded(`wings:${kind}`);
  const ink = shade(look.to.accent, 0.55, 1);
  switch (kind) {
    case "feathered":
      // Rows of scalloped feather edges.
      overlay(canvas, mask, box, "multiply", 0.7, (ctx, w, h) => {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 6;
        for (let row = 0, y = 24; y < h + 30; row++, y += 36) {
          for (let x = row % 2 === 0 ? 0 : 20; x < w + 40; x += 40) {
            ctx.beginPath();
            ctx.arc(x, y, 20, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.stroke();
          }
        }
      });
      return;
    case "leathery":
      // A darker membrane, with veins fanning out from the root.
      overlay(canvas, mask, box, "multiply", 0.35, (ctx, w, h) => {
        ctx.fillStyle = ink;
        ctx.fillRect(0, 0, w, h);
      });
      overlay(canvas, mask, box, "multiply", 0.6, (ctx, w, h) => {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        const rootX = w * 0.15;
        const rootY = h * 0.85;
        for (let k = 0; k < 5; k++) {
          const t = (k + 0.5) / 5;
          const tx = w * (0.25 + 0.75 * t);
          const ty = h * (0.05 + 0.25 * (1 - t));
          ctx.beginPath();
          ctx.moveTo(rootX, rootY);
          ctx.quadraticCurveTo((rootX + tx) / 2, (rootY + ty) / 2 - h * 0.08, tx, ty);
          ctx.stroke();
        }
      });
      return;
    case "starlit":
      // Night sky: a deep wash with stars on it.
      // `color` first, so a gold wing turns night-blue rather than the mud a
      // multiply of blue over yellow makes; then a multiply to deepen it.
      const night = (ctx: Ctx, w: number, h: number): void => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "#2b2a7a");
        g.addColorStop(1, "#5b3aa0");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      overlay(canvas, mask, box, "color", 0.9, night);
      overlay(canvas, mask, box, "multiply", 0.55, night);
      overlay(canvas, mask, box, "source-over", 1, (ctx, w, h) => {
        ctx.fillStyle = "#fff8d6";
        const count = Math.ceil((w * h) / 9000);
        for (let k = 0; k < count; k++) star(ctx, rand() * w, rand() * h, 7 + rand() * 9);
      });
      return;
    default:
      return;
  }
}

function drawHorn(canvas: Surface, mask: CanvasImageSource, box: Box, kind: string): void {
  switch (kind) {
    case "crystal":
      // Pale and glassy, with bright facets.
      overlay(canvas, mask, box, "color", 0.8, (ctx, w, h) => {
        ctx.fillStyle = "#7fd8ff";
        ctx.fillRect(0, 0, w, h);
      });
      overlay(canvas, mask, box, "screen", 0.6, (ctx, w, h) => {
        ctx.fillStyle = "#cfefff";
        ctx.fillRect(0, 0, w, h);
      });
      overlay(canvas, mask, box, "source-over", 0.85, (ctx, w, h) => {
        ctx.fillStyle = "#ffffff";
        for (let y = 6; y < h; y += 22) {
          ctx.beginPath();
          ctx.moveTo(w * 0.5, y);
          ctx.lineTo(w * 0.62, y + 8);
          ctx.lineTo(w * 0.5, y + 16);
          ctx.lineTo(w * 0.42, y + 8);
          ctx.closePath();
          ctx.fill();
        }
      });
      return;
    case "curved":
      // Smooth and glossy: one long highlight in place of the spiral's bands.
      overlay(canvas, mask, box, "screen", 0.6, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0.2, "rgba(255,255,255,0)");
        g.addColorStop(0.45, "rgba(255,255,255,1)");
        g.addColorStop(0.7, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });
      return;
    default:
      return;
  }
}

/**
 * One part, repainted for `look`. `source` is the part exactly as the rig
 * carries it; the result is the same size, so it drops into the rig's image
 * slot without moving a pivot.
 */
export function paintPart(
  source: CanvasImageSource & { width: number; height: number },
  part: string,
  look: RigLook,
  /** The part's opaque box, if known (`opaqueBounds`). */
  bounds?: Box,
): Surface {
  const canvas = makeSurface(source.width, source.height);
  const ctx = context(canvas, true);
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0);

  const isSignature = part === look.signature;
  const main = { from: look.from.mane, to: look.to.mane };
  const second = { from: look.from.accent, to: look.to.accent };
  // Only the part's own box: the rig's part images are full 1024 canvases
  // that are mostly transparent, and the pixel pass is the slow half.
  const box = bounds ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
  let mask: Surface = canvas;
  if (box.w > 0 && box.h > 0) {
    const pixels = ctx.getImageData(box.x, box.y, box.w, box.h);
    // Where an overlay may land, judged on the pixels as painted — before
    // the recolor moves the hues it is judged by.
    const region = overlayRegion(part, look);
    if (region) mask = maskOf(pixels, box, canvas, region, look);
    if (isSignature && look.signature === "mane") {
      recolorPixels(pixels.data, { from: look.from.mane, to: maneSignatureTarget(look) }, null);
    } else {
      recolorPixels(pixels.data, main, isSignature ? second : null);
    }
    ctx.putImageData(pixels, box.x, box.y);
  }

  if (look.markings !== undefined && MARKED_PARTS.has(part)) drawMarkings(canvas, mask, box, part, look.markings, look);
  if (part === "wings" && look.wingStyle !== undefined) drawWings(canvas, mask, box, look.wingStyle, look);
  if (part === "horn" && look.hornStyle !== undefined) drawHorn(canvas, mask, box, look.hornStyle);
  return canvas;
}

/** A painted surface as PNG bytes — the form a Rive image asset is fed in. */
export async function encodePng(surface: Surface): Promise<Uint8Array | null> {
  try {
    const blob =
      "convertToBlob" in surface
        ? await surface.convertToBlob({ type: "image/png" })
        : await new Promise<Blob | null>((resolve) => surface.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box holding every visible pixel of an image. */
export function opaqueBounds(source: CanvasImageSource & { width: number; height: number }): Box {
  const canvas = makeSurface(source.width, source.height);
  const ctx = context(canvas, true);
  if (!ctx) return { x: 0, y: 0, w: source.width, h: source.height };
  ctx.drawImage(source, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((data[row + x * 4 + 3] ?? 0) !== 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
