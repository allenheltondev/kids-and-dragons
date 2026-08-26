/**
 * Real audio, when there is any.
 *
 * ---------------------------------------------------------------------------
 * THE UPGRADE RULE
 *
 * Every cue has a synthesized recipe (synth.ts) and may also have a file
 * (paths.ts). The file wins when it is there and decodes; everything else —
 * no file yet, a 404, a corrupt download, a browser that will not decode
 * Opus, a phone on aeroplane mode — falls back to the recipe, silently.
 *
 * That is the same shape as the live-narration layer's authored fallback, and
 * it is here for the same reason: the failure mode of an asset pipeline must
 * never be a table sitting in silence wondering whether the game is broken.
 * It also means audio can be replaced one file at a time — drop in `dice.webm`
 * and the dice are real while everything else is still a sine wave.
 *
 * ---------------------------------------------------------------------------
 * WHEN THINGS LOAD
 *
 * Fetching starts at unlock (the first gesture), not at import: a display
 * client that never makes a sound should never spend a byte on audio, and the
 * unlock gesture is the first moment we know sound is wanted. Each file is
 * fetched once, decoded once, and cached as an `AudioBuffer` — a decoded cue
 * is a few tens of kilobytes and there are thirteen of them.
 *
 * Nothing waits on a load. A cue fired before its file has arrived plays the
 * recipe; the file is used from the next time onward. A sound is worth having
 * at the moment it belongs to or not at all.
 */

import type { CueId } from "./cue";
import { CUE_SPECS, cueUrl, musicUrl } from "./paths";

export interface SampleLibrary {
  /** Start fetching everything. Idempotent; never rejects. */
  preload(): void;
  /** The decoded cue, or null to use the recipe. */
  cue(id: CueId): AudioBuffer | null;
  /** The decoded loop for a biome, or null to use the synth pad. */
  music(biome: string): AudioBuffer | null;
  /** Ask for a biome's loop. Safe to call for a biome with no file. */
  wantMusic(biome: string): void;
}

/** Injected in tests; the browser's `fetch` + `decodeAudioData` in the game. */
export interface SampleLoaderOptions {
  fetch?: typeof globalThis.fetch;
  log?: (line: string) => void;
}

export function createSampleLibrary(
  ctx: BaseAudioContext,
  options: SampleLoaderOptions = {},
): SampleLibrary {
  const fetchImpl = options.fetch ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const log = options.log ?? (() => undefined);

  const buffers = new Map<string, AudioBuffer>();
  /** Urls already attempted, so a missing file is fetched once per session
      rather than once per cue. */
  const attempted = new Set<string>();

  function load(url: string): void {
    if (!fetchImpl || attempted.has(url)) return;
    attempted.add(url);
    void fetchImpl(url)
      .then((response) => {
        // A 404 is the ordinary state of a cue nobody has sourced yet, not an
        // error worth a console line at a table.
        if (!response.ok) return null;
        return response.arrayBuffer();
      })
      .then((bytes) => (bytes ? ctx.decodeAudioData(bytes) : null))
      .then((buffer) => {
        if (buffer) buffers.set(url, buffer);
      })
      .catch((error: unknown) => {
        log(`audio: ${url} unavailable — ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  return {
    preload() {
      for (const id of Object.keys(CUE_SPECS) as CueId[]) load(cueUrl(id));
    },
    cue(id) {
      return buffers.get(cueUrl(id)) ?? null;
    },
    music(biome) {
      return buffers.get(musicUrl(biome)) ?? null;
    },
    wantMusic(biome) {
      load(musicUrl(biome));
    },
  };
}
