/**
 * Hands rig-part repaints to a few workers (rig-look.worker.ts), or paints on
 * the main thread where workers or OffscreenCanvas are not available.
 *
 * A part always goes to the same worker, so that worker's decoded copy of it
 * is reused; the parts of one figure spread across the pool, so a tap that
 * changes nine of them paints several at once.
 */

import { encodePng, opaqueBounds, paintPart } from "./rig-look";
import type { Box, RigLook } from "./rig-look";
import type { PaintRequest, PaintResponse } from "./rig-look.worker";

let workers: Worker[] | null | undefined;
let nextId = 1;
const waiting = new Map<number, (png: Uint8Array | null) => void>();

function pool(): Worker[] | null {
  if (workers !== undefined) return workers;
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      workers = null;
      return workers;
    }
    const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    workers = Array.from({ length: size }, () => {
      const worker = new Worker(new URL("./rig-look.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<PaintResponse>) => {
        const resolve = waiting.get(event.data.id);
        waiting.delete(event.data.id);
        resolve?.(event.data.png);
      };
      return worker;
    });
  } catch {
    workers = null;
  }
  return workers;
}

function workerFor(partId: string, all: Worker[]): Worker {
  let hash = 0;
  for (const ch of partId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return all[Math.abs(hash) % all.length] as Worker;
}

/** Main-thread fallback: decoded parts by id, as a worker would keep them. */
const local = new Map<string, Promise<{ bitmap: ImageBitmap; box: Box } | null>>();

function decodeLocal(partId: string, bytes: Uint8Array): Promise<{ bitmap: ImageBitmap; box: Box } | null> {
  let source = local.get(partId);
  if (!source) {
    source = createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }))
      .then((bitmap) => ({ bitmap, box: opaqueBounds(bitmap) }))
      .catch(() => null);
    local.set(partId, source);
  }
  return source;
}

/** Decode a part ahead of its first repaint, so a first tap only paints. */
export function warmPart(partId: string, bytes: Uint8Array): void {
  const all = pool();
  if (all && all.length > 0) {
    const request: PaintRequest = { type: "warm", partId, bytes };
    workerFor(partId, all).postMessage(request);
    return;
  }
  void decodeLocal(partId, bytes);
}

/** One part, painted for `look`, as PNG bytes. */
export function paintPartPng(
  partId: string,
  name: string,
  bytes: Uint8Array,
  look: RigLook,
): Promise<Uint8Array | null> {
  const all = pool();
  if (all && all.length > 0) {
    const id = nextId++;
    const request: PaintRequest = { type: "paint", id, partId, name, bytes, look };
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      workerFor(partId, all).postMessage(request);
    });
  }
  return decodeLocal(partId, bytes).then((ready) => (ready ? encodePng(paintPart(ready.bitmap, name, look, ready.box)) : null));
}

/** Let go of a part's decoded copy — its figure is gone. */
export function forgetPart(partId: string): void {
  const all = pool();
  if (all && all.length > 0) {
    const request: PaintRequest = { type: "forget", partId };
    workerFor(partId, all).postMessage(request);
  }
  const entry = local.get(partId);
  local.delete(partId);
  void entry?.then((ready) => ready?.bitmap.close());
}
