/**
 * One tinting pass (docs/hero-looks.md §5.1, §5.3): a painting and its coat
 * mask fetched, decoded, recoloured (hero-coat.ts `tintHeroPixels`: her two
 * colours, or a gilded special's gold over her figure) and encoded into the two
 * things a hero is drawn with: an image a Pixi texture is made from, and a
 * PNG an object URL is made from. One pass, so the TV and every phone show
 * the same hero.
 *
 * **Off the main thread.** Where the browser has a Worker and an
 * `OffscreenCanvas`, the pass runs in hero-coat.worker.ts; else here, in
 * slices between frames. The hero draws as painted until it is done either
 * way. A pass is cancelled through its `AbortSignal`: a queued one never
 * starts, a running one stops at its next slice.
 *
 * The decoding and encoding are a seam (`PixelIO`), so the sliced runner is
 * the one the tests run, on pixels, with no canvas.
 *
 * Two more jobs ride the same pass, so they share its worker, cache and
 * lifetimes:
 *
 *   - **Gilded on a cut-out with no mask** (`mask: null`): a transparent
 *     painting's alpha is her figure (the mask's blue channel matches it
 *     there), so gold needs no mask. An opaque painting with no mask fails
 *     the pass and she draws as painted.
 *   - **Her figure** (`{ kind: "figure" }`): the mask's blue channel as an
 *     alpha mask (white, alpha = blue), which a sparkle's DOM overlay is
 *     clipped by over an opaque gear portrait (CSS cannot pick a channel).
 *
 * Loaded only when a hero has a look to paint and her painting can take it:
 * never in the first paint.
 */

import type { CoatPaint } from "@kad/shared";
import { FIGURE_FROM_ALPHA, MASK_CHANNEL, heroRegionStats, tintHeroPixels, type HeroMask } from "./hero-coat";

/** What a pass paints: her look (`CoatPaint`), or her figure as an alpha mask (a sparkle's clip in the DOM). */
export type TintPaint = CoatPaint | { kind: "figure" };

/** What a pass is asked to make. */
export interface TintJob {
  painting: string;
  /** Her RGB coat mask, or null for a gilded cut-out read by its own alpha. */
  mask: string | null;
  paint: TintPaint;
  /** Made no bigger than this on its longer side (a preview); absent, at the painting's size. */
  size?: number;
}

/** RGBA pixels, as a canvas's `ImageData` holds them. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** What a pass made. */
export interface TintImage {
  width: number;
  height: number;
  /** What a Pixi texture is made from (an `ImageBitmap` or a canvas). */
  source: unknown;
  /** The tinted painting as a PNG, for an object URL. */
  blob: Blob;
}

export type TintRunner = (job: TintJob, signal: AbortSignal) => Promise<TintImage>;

/** How pixels come in and go out: a canvas in the page, an `OffscreenCanvas` in the worker, plain arrays in tests. */
export interface PixelIO {
  /** A painting's pixels, made no bigger than `size` on its longer side when one is given. */
  decode(url: string, signal: AbortSignal, size?: number): Promise<Pixels>;
  encode(pixels: Pixels): Promise<{ source: unknown; blob: Blob }>;
  /** Wait before the next slice (a frame, a macrotask). */
  pause(): Promise<void>;
}

/** About how many pixels one slice recolours: a few milliseconds on a midrange phone. */
export const SLICE_PIXELS = 32_768;

export class TintCancelled extends Error {
  override name = "AbortError";
}

function check(signal: AbortSignal): void {
  if (signal.aborted) throw new TintCancelled("cancelled");
}

/**
 * The pass itself, a slice at a time: the region's means, then the swap over
 * every pixel, pausing between slices and stopping when cancelled. A mask
 * that is not on its painting's canvas draws her as painted (an error, which
 * the cache remembers), never a misregistered colour.
 */
export async function runTint(job: TintJob, io: PixelIO, signal: AbortSignal, slice = SLICE_PIXELS): Promise<TintImage> {
  check(signal);
  if (job.paint.kind === "figure") return runFigure(job, io, signal, slice);
  const paint = job.paint;
  const [painting, mask] = await Promise.all([io.decode(job.painting, signal, job.size), job.mask ? io.decode(job.mask, signal, job.size) : Promise.resolve(null)]);
  check(signal);
  let view: HeroMask;
  if (mask) {
    if (painting.width !== mask.width || painting.height !== mask.height) {
      throw new Error(`coat mask ${job.mask} is ${mask.width}x${mask.height}, its painting ${painting.width}x${painting.height}`);
    }
    view = { data: mask.data, stride: 4, figure: MASK_CHANNEL.figure };
  } else {
    // No mask: only gold, and only on a cut-out, whose alpha is her figure.
    if (paint.kind !== "gilded") throw new Error(`no coat mask for ${job.painting}`);
    if (!hasTransparency(painting.data)) throw new Error(`${job.painting} is opaque: her figure needs its mask`);
    view = { data: painting.data, ...FIGURE_FROM_ALPHA };
  }
  const stats = statsOf(painting, mask, view);
  const total = painting.width * painting.height;
  const out = new Uint8ClampedArray(painting.data.length);
  for (let from = 0; from < total; from += slice) {
    if (from > 0) {
      await io.pause();
      check(signal);
    }
    tintHeroPixels(painting.data, view, paint, stats, out, { from, to: Math.min(total, from + slice) });
  }
  check(signal);
  const encoded = await io.encode({ width: painting.width, height: painting.height, data: out });
  return { width: painting.width, height: painting.height, ...encoded };
}

/**
 * Her parts' means on a painting and its mask, worked out once for the pair: every colour a
 * shelf tries on one painting shares them, and decoded pixels are shared (`cachedIO`).
 */
const STATS = new WeakMap<Pixels, WeakMap<Pixels, ReturnType<typeof heroRegionStats>>>();
function statsOf(painting: Pixels, mask: Pixels | null, view: HeroMask): ReturnType<typeof heroRegionStats> {
  const key = mask ?? painting;
  const byPainting = STATS.get(key) ?? new WeakMap<Pixels, ReturnType<typeof heroRegionStats>>();
  STATS.set(key, byPainting);
  let stats = byPainting.get(painting);
  if (!stats) {
    stats = heroRegionStats(painting.data, view);
    byPainting.set(painting, stats);
  }
  return stats;
}

/** How many decoded paintings and masks a page keeps for its next passes. */
export const DECODED_KEPT = 4;

/**
 * `io`, keeping its last few decodes (by URL and size), so a shelf of colours on one painting
 * fetches and decodes that painting and its mask once, not once a tile, and the figure she stands
 * as reuses them on every tap. A decode is shared, so it is not cancelled with the pass that
 * asked first; each pass waits for it only until its own signal is cancelled, so a cancelled
 * pass ends at once and the next one starts (`untilCancelled`). A failure is not kept. The pixels
 * are only read by a pass, never written.
 */
export function cachedIO(io: PixelIO, kept = DECODED_KEPT): PixelIO {
  const decodes = new Map<string, Promise<Pixels>>();
  const never = new AbortController().signal;
  return {
    ...io,
    decode(url, signal, size) {
      const key = `${url}@${String(size ?? "")}`;
      let decoded = decodes.get(key);
      if (decoded) {
        // Most recently used last.
        decodes.delete(key);
      } else {
        decoded = io.decode(url, never, size);
        decoded.catch(() => {
          if (decodes.get(key) === decoded) decodes.delete(key);
        });
      }
      decodes.set(key, decoded);
      while (decodes.size > kept) decodes.delete(decodes.keys().next().value!);
      return untilCancelled(decoded, signal);
    },
  };
}

/** `shared`, for one pass: it rejects as cancelled the moment `signal` is, whatever `shared` is still doing. */
function untilCancelled<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new TintCancelled("cancelled"));
  return new Promise<T>((resolve, reject) => {
    const cancelled = (): void => reject(new TintCancelled("cancelled"));
    signal.addEventListener("abort", cancelled, { once: true });
    shared.then(
      (value) => {
        signal.removeEventListener("abort", cancelled);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancelled);
        reject(error);
      },
    );
  });
}

/** The size a painting of `width` × `height` is decoded at for a longest side of `size` (never larger). */
export function decodedSize(width: number, height: number, size: number | undefined): { width: number; height: number } {
  const scale = size === undefined ? 1 : Math.min(1, size / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a painting has any see-through pixel: a cut-out, not an opaque portrait. */
function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return true;
  return false;
}

/** Her figure as an alpha mask: white, its alpha the mask's blue channel. */
async function runFigure(job: TintJob, io: PixelIO, signal: AbortSignal, slice: number): Promise<TintImage> {
  if (!job.mask) throw new Error(`no coat mask for ${job.painting}`);
  const mask = await io.decode(job.mask, signal, job.size);
  check(signal);
  const total = mask.width * mask.height;
  const out = new Uint8ClampedArray(mask.data.length);
  for (let from = 0; from < total; from += slice) {
    if (from > 0) {
      await io.pause();
      check(signal);
    }
    const to = Math.min(total, from + slice);
    for (let p = from; p < to; p++) {
      const i = p * 4;
      out[i] = 255;
      out[i + 1] = 255;
      out[i + 2] = 255;
      out[i + 3] = mask.data[i + MASK_CHANNEL.figure]!;
    }
  }
  check(signal);
  const encoded = await io.encode({ width: mask.width, height: mask.height, data: out });
  return { width: mask.width, height: mask.height, ...encoded };
}

/** A runner that does every pass on this thread through `io`, one slice at a time. */
export function slicedTintRunner(io: PixelIO, slice = SLICE_PIXELS): TintRunner {
  return (job, signal) => runTint(job, io, signal, slice);
}

// ---------------------------------------------------------------------------
// In the page
// ---------------------------------------------------------------------------

/** Decodes with the page's own canvas: the fallback where there is no worker or OffscreenCanvas. */
export function canvasIO(): PixelIO {
  const canvasOf = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  return {
    async decode(url, signal, size) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const { width, height } = decodedSize(bitmap.width, bitmap.height, size);
      const canvas = canvasOf(width, height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no 2d canvas");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return { width: image.width, height: image.height, data: image.data };
    },
    async encode({ width, height, data }) {
      const canvas = canvasOf(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d canvas");
      context.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
      return { source: canvas, blob };
    },
    pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

interface WorkerAnswer {
  id: number;
  error?: string;
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  blob?: Blob;
}

/**
 * The worker's runner: one module worker for the page, every pass posted to
 * it and cancelled by a message. If the worker cannot be made, or dies, the
 * pass (and every later one) runs in slices here instead.
 */
export function workerTintRunner(make: () => Worker, fallback: TintRunner): TintRunner {
  let worker: Worker | null = null;
  let broken = false;
  let next = 1;
  const waiting = new Map<number, { resolve: (image: TintImage) => void; reject: (error: unknown) => void }>();
  const start = (): Worker | null => {
    if (worker || broken) return worker;
    try {
      worker = make();
    } catch {
      broken = true;
      return null;
    }
    worker.onmessage = (event: MessageEvent<WorkerAnswer>) => {
      const answer = event.data;
      const pending = waiting.get(answer.id);
      if (!pending) {
        answer.bitmap?.close();
        return;
      }
      waiting.delete(answer.id);
      if (answer.error !== undefined || !answer.bitmap || !answer.blob) {
        pending.reject(answer.error === "cancelled" ? new TintCancelled("cancelled") : new Error(answer.error ?? "tint failed"));
      } else {
        pending.resolve({ width: answer.width!, height: answer.height!, source: answer.bitmap, blob: answer.blob });
      }
    };
    worker.onerror = () => {
      // A worker that cannot run (a browser without module workers) hands
      // what it held, and everything after, to the page.
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [, pending] of waiting) pending.reject(new Error("worker failed"));
      waiting.clear();
    };
    return worker;
  };
  return (job, signal) => {
    const w = start();
    if (!w) return fallback(job, signal);
    const id = next++;
    return new Promise<TintImage>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      signal.addEventListener("abort", () => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        w.postMessage({ cancel: id });
        reject(new TintCancelled("cancelled"));
      }, { once: true });
      w.postMessage({ id, job });
    }).catch((error: unknown) => {
      if (error instanceof TintCancelled || !broken) throw error;
      return fallback(job, signal);
    });
  };
}

/** The page's runner: the worker where it can run, else slices on this thread. */
export function defaultTintRunner(): TintRunner {
  const sliced = slicedTintRunner(cachedIO(canvasIO()));
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return sliced;
  return workerTintRunner(() => new Worker(new URL("./hero-coat.worker.ts", import.meta.url), { type: "module" }), sliced);
}
