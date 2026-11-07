/**
 * The tinter's worker (docs/hero-looks.md §5.3): every pass off the main
 * thread, on an `OffscreenCanvas`. The page posts `{ id, job }` and gets back
 * `{ id, width, height, bitmap, blob }` (the bitmap transferred), or
 * `{ id, error }`; `{ cancel: id }` stops a pass that has not finished, which
 * answers "cancelled".
 *
 * Its fetches go through the page's service worker like the page's own, so a
 * painting and mask saved for offline (§5.4) are read from there.
 */

import { runTint, type PixelIO, type TintJob } from "./hero-coat-pass";

interface Scope {
  onmessage: ((event: MessageEvent<{ id?: number; job?: TintJob; cancel?: number }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as Scope;

const io: PixelIO = {
  async decode(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d canvas");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
  },
  async encode({ width, height, data }) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas");
    context.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { source: canvas.transferToImageBitmap(), blob };
  },
  // A macrotask between slices, so a cancel message is heard.
  pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

const running = new Map<number, AbortController>();

scope.onmessage = (event) => {
  const { id, job, cancel } = event.data;
  if (cancel !== undefined) {
    running.get(cancel)?.abort();
    return;
  }
  if (id === undefined || !job) return;
  const controller = new AbortController();
  running.set(id, controller);
  runTint(job, io, controller.signal)
    .then((image) => {
      const bitmap = image.source as ImageBitmap;
      scope.postMessage({ id, width: image.width, height: image.height, bitmap, blob: image.blob }, [bitmap]);
    })
    .catch((error: unknown) => {
      const message = controller.signal.aborted ? "cancelled" : error instanceof Error ? error.message : String(error);
      scope.postMessage({ id, error: message });
    })
    .finally(() => running.delete(id));
};
