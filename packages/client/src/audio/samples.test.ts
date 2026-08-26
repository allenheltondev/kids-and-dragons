/**
 * Real audio as an *upgrade*.
 *
 * The rule every test here defends: a file that is missing, 404s, or will not
 * decode leaves the synthesized recipe playing. The failure mode of an asset
 * pipeline must never be a table sitting in silence wondering whether the game
 * is broken — the same promise the live-narration layer makes about authored
 * text, for the same reason.
 */

import { describe, expect, it, vi } from "vitest";
import { createSampleLibrary } from "./samples";
import { cueUrl, musicUrl } from "./paths";

/** Enough of a context for the library: it only ever decodes. */
function fakeCtx(decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>): BaseAudioContext {
  return { decodeAudioData: decode } as unknown as BaseAudioContext;
}

const BUFFER = { duration: 1 } as AudioBuffer;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("loading real audio", () => {
  it("serves a decoded file once it has arrived", async () => {
    const fetchImpl = vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 }));
    const library = createSampleLibrary(fakeCtx(async () => BUFFER), {
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(library.cue("dice")).toBeNull(); // nothing fetched yet
    library.preload();
    await settle();
    expect(library.cue("dice")).toBe(BUFFER);
  });

  it("stays null for a cue nobody has sourced yet", async () => {
    // The ordinary state of this repo: a 404 is a placeholder, not an error.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const library = createSampleLibrary(fakeCtx(async () => BUFFER), {
      fetch: fetchImpl as unknown as typeof fetch,
    });
    library.preload();
    await settle();
    expect(library.cue("dice")).toBeNull();
  });

  it("stays null when the bytes will not decode", async () => {
    const fetchImpl = vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 }));
    const log = vi.fn();
    const library = createSampleLibrary(
      fakeCtx(() => Promise.reject(new Error("not opus"))),
      { fetch: fetchImpl as unknown as typeof fetch, log },
    );
    library.preload();
    await settle();
    expect(library.cue("dice")).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it("asks for each url once, however many times it is wanted", async () => {
    // A missing file is fetched once per session, not once per cue fired.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 }));
    const library = createSampleLibrary(fakeCtx(async () => BUFFER), {
      fetch: fetchImpl as unknown as typeof fetch,
    });
    library.preload();
    library.preload();
    library.wantMusic("forest");
    library.wantMusic("forest");
    await settle();
    const urls = (fetchImpl.mock.calls as unknown as [string][]).map((call) => call[0]);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain(cueUrl("dice"));
    expect(urls).toContain(musicUrl("forest"));
  });

  it("works with no fetch at all", () => {
    // A very old TV, or a test environment: inert, never thrown.
    const library = createSampleLibrary(fakeCtx(async () => BUFFER), { fetch: undefined });
    expect(() => {
      library.preload();
      library.wantMusic("forest");
    }).not.toThrow();
    expect(library.cue("tap")).toBeNull();
  });
});
