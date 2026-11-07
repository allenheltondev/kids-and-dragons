/**
 * Hero colours without a canvas (docs/hero-looks.md §5): paintings and coat
 * masks made of numbers, a `PixelIO` that serves them by URL and counts what
 * is asked for, and the region's mean colour as a phone would see it.
 *
 * No real hero has a shipped mask yet (#667, #668), so every test of a
 * coloured hero lists the paintings it pretends have one
 * (coat-masks.ts `setCoatMaskPaintings`) and serves them from here.
 */

import { maskPathBeside } from "../world/art-paths";
import type { PixelIO, Pixels } from "../world/hero-coat-pass";
import { hexToRgb, linearToOklab, toLinear, type Lab } from "../world/oklab";

/**
 * A little hero: a shaded body inside an outline, a mane across the top of it
 * in its own colour, on a transparent ground; and her RGB coat mask (owner,
 * 2026-11-07): red the body (her main part), green the mane (her accent
 * part), the two meeting across a soft edge that never adds to more than the
 * whole pixel, and blue her whole figure (the painting's alpha).
 */
export function syntheticPainting(body: string, size = 24, mane = "#853A85"): { painting: Pixels; mask: Pixels } {
  const [r, g, b] = hexToRgb(body);
  const [mr, mg, mb] = hexToRgb(mane);
  const painting = new Uint8ClampedArray(size * size * 4);
  const mask = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  // The mane's lower edge, and how soft it is, in pixels.
  const maneLine = c - size * 0.18;
  const maneSoft = Math.max(1, size / 24);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot((x - c) / (size * 0.42), (y - c) / (size * 0.42));
      if (d > 1) continue;
      // Shading: lighter top left, darker bottom right, as a painted body is.
      const shade = 1.08 - 0.3 * ((x + y) / (2 * size));
      const edge = d > 0.86;
      // How much of this pixel is mane: 1 above its line, 0 below, soft across it.
      const m = Math.max(0, Math.min(1, (maneLine - y) / maneSoft + 0.5));
      const paint = (body: number, mane: number) => Math.min(255, Math.round((body * (1 - m) + mane * m) * 255 * shade));
      painting[i] = edge ? 59 : paint(r, mr);
      painting[i + 1] = edge ? 29 : paint(g, mg);
      painting[i + 2] = edge ? 54 : paint(b, mb);
      painting[i + 3] = 255;
      // The parts: inside the outline, with a soft edge, the body and the mane sharing the line between them.
      const w = edge ? 0 : Math.max(0, Math.min(1, (0.86 - d) / 0.12));
      mask[i] = Math.round(w * (1 - m) * 255);
      mask[i + 1] = Math.round(w * m * 255);
      mask[i + 2] = 255;
      mask[i + 3] = 255;
    }
  }
  return { painting: { width: size, height: size, data: painting }, mask: { width: size, height: size, data: mask } };
}

/** A painting URL and its mask's, served as a synthetic hero. */
export function servePainting(files: Map<string, Pixels>, paintingUrl: string, body = "#E2CDEC", size = 24, { mask: withMask = true }: { mask?: boolean } = {}): void {
  const { painting, mask } = syntheticPainting(body, size);
  files.set(paintingUrl, painting);
  if (withMask) files.set(maskPathBeside(paintingUrl), mask);
}

/** What a `PixelIO` was asked for. */
export interface ServedIO extends PixelIO {
  asked: string[];
  /** Set to make every slice wait: a throttled phone. */
  delayMs: number;
}

/** A `PixelIO` over `files`: a URL not there fails like a 404. Encoded results are their own pixels. */
export function pixelIO(files: Map<string, Pixels>, { delayMs = 0, available }: { delayMs?: number; available?: (url: string) => boolean } = {}): ServedIO {
  const io: ServedIO = {
    asked: [],
    delayMs,
    async decode(url) {
      io.asked.push(url);
      const pixels = files.get(url);
      if (!pixels || (available && !available(url))) throw new Error(`${url}: 404`);
      return { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(pixels.data) };
    },
    async encode(pixels) {
      return { source: pixels, blob: new Blob([pixels.data.slice().buffer as ArrayBuffer], { type: "image/png" }) };
    },
    pause: () => new Promise((resolve) => setTimeout(resolve, io.delayMs)),
  };
  return io;
}

/** Object URLs a test can count (made and revoked) and read back (`blobs`: what each was made of). */
export function fakeUrls(): { create(blob: Blob): string; revoke(url: string): void; live: Set<string>; made: number; blobs: Map<string, Blob> } {
  const urls = {
    live: new Set<string>(),
    blobs: new Map<string, Blob>(),
    made: 0,
    create(blob: Blob): string {
      urls.made += 1;
      const url = `blob:tint-${String(urls.made)}`;
      urls.live.add(url);
      urls.blobs.set(url, blob);
      return url;
    },
    revoke(url: string): void {
      urls.live.delete(url);
    },
  };
  return urls;
}

/**
 * The mean colour of the masked region, in OKLab: what a phone shows of it at
 * portrait size, where the pixels average together (in linear light). The
 * region is the mask's channel at `maskOffset`: red (0) her main part, green
 * (1) her accent, blue (2) her figure.
 */
export function regionMean(pixels: ArrayLike<number>, mask: ArrayLike<number>, maskStride = 4, maskOffset = 0): Lab {
  let w = 0;
  const sum = [0, 0, 0];
  for (let p = 0; p * 4 < pixels.length; p++) {
    const m = mask[p * maskStride + maskOffset]! / 255;
    if (m <= 0) continue;
    w += m;
    for (let k = 0; k < 3; k++) sum[k]! += m * toLinear(pixels[p * 4 + k]! / 255);
  }
  const [r, g, b] = sum.map((s) => s / w) as [number, number, number];
  return linearToOklab(r, g, b);
}
