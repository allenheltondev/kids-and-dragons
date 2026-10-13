/**
 * Paints rig parts off the main thread (rig-look.ts does the painting;
 * rig-look-pool.ts hands the work out).
 *
 * A tap repaints up to nine 1024² part images and encodes each one as PNG.
 * On the main thread that work competes with the very figure it is for — the
 * rig animates every frame — and a tap took a second to show. Here it runs
 * beside it, a part per worker at a time.
 *
 * Each worker keeps the parts it has been sent decoded, by id, so a part is
 * decoded once however many times it is repainted.
 */

import { encodePng, opaqueBounds, paintPart } from "./rig-look";
import type { Box, RigLook } from "./rig-look";

export type PaintRequest =
  | { type: "paint"; id: number; partId: string; name: string; bytes: Uint8Array; look: RigLook }
  | { type: "warm"; partId: string; bytes: Uint8Array }
  | { type: "forget"; partId: string };

export interface PaintResponse {
  id: number;
  png: Uint8Array | null;
}

const decoded = new Map<string, Promise<{ bitmap: ImageBitmap; box: Box } | null>>();

self.onmessage = async (event: MessageEvent<PaintRequest>): Promise<void> => {
  const request = event.data;
  if (request.type === "forget") {
    const entry = decoded.get(request.partId);
    decoded.delete(request.partId);
    void entry?.then((source) => source?.bitmap.close());
    return;
  }
  let source = decoded.get(request.partId);
  if (!source) {
    source = createImageBitmap(new Blob([request.bytes as BlobPart], { type: "image/png" }))
      .then((bitmap) => ({ bitmap, box: opaqueBounds(bitmap) }))
      .catch(() => null);
    decoded.set(request.partId, source);
  }
  if (request.type === "warm") return;
  const ready = await source;
  const png = ready ? await encodePng(paintPart(ready.bitmap, request.name, request.look, ready.box)) : null;
  const response: PaintResponse = { id: request.id, png };
  (self as unknown as Worker).postMessage(response, png ? [png.buffer] : []);
};
