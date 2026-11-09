/**
 * What makes a shelf of colours quick (docs/hero-looks.md §5.3): a preview is
 * tinted at a small size, and a painting and its mask are decoded once for
 * every pass that needs them (`cachedIO`), not once a tile.
 */

import { describe, expect, it } from "vitest";
import { TintCancelled, cachedIO, decodedSize, runTint, type PixelIO, type Pixels } from "./hero-coat-pass";
import { PREVIEW_TINT_PX, sizedTint, type HeroCoatRequest } from "./hero-art";

const pixels = (width: number, height: number): Pixels => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) });

/** A `PixelIO` that counts its decodes and answers each with a little opaque square. */
function counting(fail: Set<string> = new Set()): PixelIO & { calls: { url: string; size: number | undefined }[] } {
  const io = {
    calls: [] as { url: string; size: number | undefined }[],
    async decode(url: string, _signal: AbortSignal, size?: number): Promise<Pixels> {
      io.calls.push({ url, size });
      if (fail.has(url)) throw new Error(`${url}: 404`);
      return pixels(4, 4);
    },
    async encode(p: Pixels) {
      return { source: p, blob: new Blob([]) };
    },
    pause: async () => undefined,
  };
  return io;
}

const live = (): AbortSignal => new AbortController().signal;

describe("the size a preview is decoded at", () => {
  it("fits the longer side, keeps the shape, and never grows a painting", () => {
    expect(decodedSize(1024, 1024, PREVIEW_TINT_PX)).toEqual({ width: 320, height: 320 });
    expect(decodedSize(1254, 1000, 320)).toEqual({ width: 320, height: 255 });
    expect(decodedSize(200, 100, 320)).toEqual({ width: 200, height: 100 });
    expect(decodedSize(1024, 1024, undefined)).toEqual({ width: 1024, height: 1024 });
  });

  it("is part of a request's identity, so a preview never stands in for her full-size colour", () => {
    const request: HeroCoatRequest = { painting: "/assets/p.png", mask: "/assets/p.mask.png", paint: { kind: "figure" }, key: "/assets/p.mask.png|figure" };
    expect(sizedTint(request, 320)).toEqual({ ...request, size: 320, key: "/assets/p.mask.png|figure@320" });
    expect(sizedTint(request, undefined)).toBe(request);
    expect(sizedTint(null, 320)).toBeNull();
  });

  it("is what a pass decodes its painting and mask at", async () => {
    const io = counting();
    await runTint({ painting: "/p.png", mask: "/p.mask.png", paint: { kind: "figure" }, size: 320 }, io, live());
    expect(io.calls).toEqual([{ url: "/p.mask.png", size: 320 }]);
  });
});

describe("decoded paintings kept for the next passes (cachedIO)", () => {
  it("decodes one painting at one size once, however many passes ask", async () => {
    const io = counting();
    const kept = cachedIO(io);
    const [a, b] = await Promise.all([kept.decode("/p.png", live(), 320), kept.decode("/p.png", live(), 320)]);
    await kept.decode("/p.png", live(), 320);
    expect(io.calls).toEqual([{ url: "/p.png", size: 320 }]);
    expect(a).toBe(b);
    // Another size is another decode.
    await kept.decode("/p.png", live());
    expect(io.calls).toHaveLength(2);
  });

  it("keeps the most recently used few, letting the oldest go", async () => {
    const io = counting();
    const kept = cachedIO(io, 2);
    await kept.decode("/a.png", live());
    await kept.decode("/b.png", live());
    await kept.decode("/a.png", live());
    await kept.decode("/c.png", live());
    // b was the least recently used: decoded again; a is still kept.
    await kept.decode("/a.png", live());
    await kept.decode("/b.png", live());
    expect(io.calls.map((c) => c.url)).toEqual(["/a.png", "/b.png", "/c.png", "/b.png"]);
  });

  it("does not keep a failure: the next pass asks again", async () => {
    const io = counting(new Set(["/gone.png"]));
    const kept = cachedIO(io);
    await expect(kept.decode("/gone.png", live())).rejects.toThrow("404");
    await expect(kept.decode("/gone.png", live())).rejects.toThrow("404");
    expect(io.calls).toHaveLength(2);
  });

  it("ends a pass cancelled mid-decode at once, and keeps the decode it shared for the next", async () => {
    let finish: (p: Pixels) => void = () => undefined;
    let calls = 0;
    const slow: PixelIO = {
      decode: () => {
        calls += 1;
        return new Promise<Pixels>((resolve) => {
          finish = resolve;
        });
      },
      encode: async (p) => ({ source: p, blob: new Blob([]) }),
      pause: async () => undefined,
    };
    const kept = cachedIO(slow);
    const stopping = new AbortController();
    const cancelled = kept.decode("/p.png", stopping.signal, 320);
    let state = "waiting";
    cancelled.then(() => (state = "decoded"), (e: unknown) => (state = e instanceof TintCancelled ? "cancelled" : "failed"));
    stopping.abort();
    await Promise.resolve();
    await Promise.resolve();
    // Cancelled before the decode it shares has finished: the cache can start the next pass.
    expect(state).toBe("cancelled");

    const next = kept.decode("/p.png", live(), 320);
    finish(pixels(4, 4));
    expect((await next).width).toBe(4);
    expect(calls).toBe(1);
  });

  it("answers a cancelled pass as cancelled, while the decode it shares goes on for the others", async () => {
    const io = counting();
    const kept = cachedIO(io);
    const stopped = new AbortController();
    stopped.abort();
    await expect(kept.decode("/p.png", stopped.signal)).rejects.toBeInstanceOf(TintCancelled);
    await kept.decode("/p.png", live());
    expect(io.calls).toHaveLength(1);
  });
});
