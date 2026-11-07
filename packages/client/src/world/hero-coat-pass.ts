/**
 * One tinting pass (docs/hero-looks.md §5.1, §5.3): a painting and its coat
 * mask fetched, decoded, recoloured (hero-coat.ts) and encoded into the two
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
 * Loaded only when a hero has a colour and her painting a mask: never in the
 * first paint.
 */

import type { CoatPaint } from "@kad/shared";
import { coatRegionStats, tintCoatPixels } from "./hero-coat";

/** What a pass is asked to make. */
export interface TintJob {
  painting: string;
  mask: string;
  paint: CoatPaint;
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
  decode(url: string, signal: AbortSignal): Promise<Pixels>;
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
  const [painting, mask] = await Promise.all([io.decode(job.painting, signal), io.decode(job.mask, signal)]);
  check(signal);
  if (painting.width !== mask.width || painting.height !== mask.height) {
    throw new Error(`coat mask ${job.mask} is ${mask.width}x${mask.height}, its painting ${painting.width}x${painting.height}`);
  }
  const stats = coatRegionStats(painting.data, mask.data, 4);
  const total = painting.width * painting.height;
  const out = new Uint8ClampedArray(painting.data.length);
  for (let from = 0; from < total; from += slice) {
    if (from > 0) {
      await io.pause();
      check(signal);
    }
    tintCoatPixels(painting.data, mask.data, job.paint, stats, out, { from, to: Math.min(total, from + slice), maskStride: 4 });
  }
  check(signal);
  const encoded = await io.encode({ width: painting.width, height: painting.height, data: out });
  return { width: painting.width, height: painting.height, ...encoded };
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
    async decode(url, signal) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const canvas = canvasOf(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no 2d canvas");
      context.drawImage(bitmap, 0, 0);
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
  const sliced = slicedTintRunner(canvasIO());
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return sliced;
  return workerTintRunner(() => new Worker(new URL("./hero-coat.worker.ts", import.meta.url), { type: "module" }), sliced);
}
