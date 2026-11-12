/**
 * Keeping a chapter's recorded narration for no signal (#547): which clips a chapter plays, which
 * the worker has kept, and asking for the rest. The worker that keeps them is tested in
 * sw/sw-voice.test.ts; here it is only the thing that answers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipPath, type VoiceManifest } from "@kad/shared";

const controlledMock = vi.hoisted(() => vi.fn<(ms?: number) => Promise<boolean>>());
vi.mock("../sw/warm", () => ({ controlled: controlledMock }));

import { CLIP_BYTES_ESTIMATE, KEEP_LANES, keepVoices, keptPaths, loadVoicePack, manifestClipPaths } from "./voice-pack";

const key = (n: number): string => n.toString(16).padStart(64, "0");
const MANIFEST: VoiceManifest = {
  "ch/@goal": { "": [{ clip: key(1), ms: 100 }] },
  "ch/scene_a/0": { "": [{ clip: key(2), ms: 100 }, { clip: key(3), ms: 100 }], "party=2": [{ clip: key(2), ms: 100 }, { clip: key(4), ms: 100 }] },
  "ch/scene_b/0": { "": [{ clip: key(3), ms: 100 }] },
};
const ALL = [1, 2, 3, 4].map((n) => clipPath(key(n)));

/** A Cache Storage that holds `kept` voice paths. */
function stubCaches(kept: string[]): void {
  vi.stubGlobal("caches", {
    open: async () => ({ keys: async () => kept.map((path) => new Request(`https://kad.test${path}`)) }),
  });
}

beforeEach(() => controlledMock.mockResolvedValue(true));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what a chapter plays", () => {
  it("lists every clip once, in the order the chapter says them, variants included", () => {
    expect(manifestClipPaths(MANIFEST)).toEqual(ALL);
    expect(manifestClipPaths({})).toEqual([]);
  });

  it("finds the chapter's recordings by its manifest, and weighs them by the clip", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(MANIFEST)));
    expect(await loadVoicePack("ch", fetcher as unknown as typeof fetch)).toEqual({ paths: ALL, bytes: 4 * CLIP_BYTES_ESTIMATE });
    expect(fetcher).toHaveBeenCalledWith("/content/voice/manifest/ch.json");
  });

  it("has nothing to keep for a chapter nobody recorded, a signal that is not there, or an empty manifest", async () => {
    expect(await loadVoicePack("ch", (async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await loadVoicePack("ch", (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await loadVoicePack("ch", (async () => new Response("{}")) as unknown as typeof fetch)).toBeNull();
    expect(await loadVoicePack("ch", (async () => new Response("null")) as unknown as typeof fetch)).toBeNull();
  });
});

describe("what the worker has kept", () => {
  it("counts the chapter's clips among everything it holds", async () => {
    stubCaches([ALL[0]!, ALL[2]!, clipPath(key(99))]);
    expect([...(await keptPaths(ALL))]).toEqual([ALL[0], ALL[2]]);
  });

  it("is empty where there is no Cache Storage", async () => {
    vi.stubGlobal("caches", undefined);
    expect((await keptPaths(ALL)).size).toBe(0);
  });
});

describe("keeping a chapter", () => {
  it("cannot, with no worker in charge of the page, and asks for nothing", async () => {
    controlledMock.mockResolvedValue(false);
    stubCaches([]);
    const fetcher = vi.fn();
    expect(await keepVoices(ALL, undefined, fetcher as unknown as typeof fetch)).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks only for what is not kept, low priority, and counts what was already there", async () => {
    stubCaches([ALL[0]!]);
    const asked: string[] = [];
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      asked.push(path);
      expect((init as { priority?: string }).priority).toBe("low");
      return new Response("", { status: 200 });
    });
    const progress: number[] = [];
    const result = await keepVoices(ALL, (done) => progress.push(done), fetcher as unknown as typeof fetch);
    expect(result).toBe("kept");
    expect(asked.sort()).toEqual(ALL.slice(1).sort());
    expect(progress[0]).toBe(1);
    expect(progress.at(-1)).toBe(4);
  });

  it("says some are missing when the site lacks a clip or the signal goes, and carries on to the rest", async () => {
    stubCaches([]);
    const fetcher = vi.fn(async (path: string) => {
      if (path === ALL[1]) return new Response("denied", { status: 403 });
      if (path === ALL[2]) throw new TypeError("offline");
      return new Response("", { status: 200 });
    });
    expect(await keepVoices(ALL, undefined, fetcher as unknown as typeof fetch)).toBe("partial");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("asks a few at a time, never all at once", async () => {
    stubCaches([]);
    const many = Array.from({ length: 12 }, (_, n) => clipPath(key(n)));
    let live = 0;
    let most = 0;
    const fetcher = vi.fn(async () => {
      live += 1;
      most = Math.max(most, live);
      await new Promise((resolve) => setTimeout(resolve, 1));
      live -= 1;
      return new Response("", { status: 200 });
    });
    expect(await keepVoices(many, undefined, fetcher as unknown as typeof fetch)).toBe("kept");
    expect(most).toBe(KEEP_LANES);
  });
});
