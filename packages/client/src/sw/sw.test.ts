/**
 * The service worker's decisions (policy.ts) and the script the build makes of
 * it (sw-build.ts). The worker's behaviour end to end — a reload with no
 * network opening the adventure book — is e2e/offline.spec.ts, against a real
 * production build.
 */

import { Script } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FieldGuide, WorldMap } from "@kad/shared";
import { buildServiceWorker, campaignFiles, precacheOf } from "../../sw-build";
import { swCacheable, swOverLimit, swStaleBundles, swStrategyFor } from "./policy";
import { offlineArtFor } from "./warm";

const ORIGIN = "https://kad.example";
const at = (path: string, extra: Partial<{ method: string; mode: string; hasRange: boolean }> = {}) =>
  swStrategyFor({ method: "GET", mode: "cors", hasRange: false, url: ORIGIN + path, ...extra }, ORIGIN);

describe("what the worker does with a request", () => {
  it("never touches live game state", () => {
    expect(at("/api/journal")).toBe("passthrough");
    expect(at("/api/action", { method: "POST" })).toBe("passthrough");
    expect(at("/events/ABCD?sinceSeq=0")).toBe("passthrough");
  });

  it("answers every page load with the app, from the network first", () => {
    expect(at("/journal", { mode: "navigate" })).toBe("shell");
    expect(at("/p/ABCD", { mode: "navigate" })).toBe("shell");
  });

  it("serves hashed code from the cache, content from the network first, art stale-while-revalidate", () => {
    expect(at("/bundle/index-abc123.js")).toBe("bundle");
    expect(at("/content/field-guide.json")).toBe("content");
    expect(at("/assets/world/realm-atlas-detail-v1.webp")).toBe("image");
    expect(at("/brand/dragon-mark.png")).toBe("image");
  });

  it("leaves alone what it should not keep: other origins, non-GETs, partial audio, everything else", () => {
    expect(swStrategyFor({ method: "GET", mode: "cors", hasRange: false, url: "https://fonts.example/a.webp" }, ORIGIN)).toBe("passthrough");
    expect(at("/content/items.json", { method: "HEAD" })).toBe("passthrough");
    expect(at("/assets/audio/theme.webp", { hasRange: true })).toBe("passthrough");
    expect(at("/assets/audio/theme.ogg")).toBe("passthrough");
    expect(at("/sw.js")).toBe("passthrough");
  });

  it("keeps only whole same-origin successes", () => {
    expect(swCacheable({ ok: true, status: 200, type: "basic" })).toBe(true);
    expect(swCacheable({ ok: true, status: 206, type: "basic" })).toBe(false);
    expect(swCacheable({ ok: false, status: 404, type: "basic" })).toBe(false);
    expect(swCacheable({ ok: true, status: 200, type: "opaque" })).toBe(false);
  });

  it("drops code a deploy replaced, and the oldest art past the cap", () => {
    expect(swStaleBundles(["/bundle/a.js", "/bundle/old.js"], ["/bundle/a.js", "/bundle/b.js"])).toEqual(["/bundle/old.js"]);
    expect(swOverLimit([1, 2, 3, 4], 3)).toEqual([1]);
    expect(swOverLimit([1, 2], 3)).toEqual([]);
  });
});

describe("the built sw.js", () => {
  const files = ["/bundle/index-a1.js", "/bundle/index-a1.css", "/bundle/rive-z9.wasm", "/bundle/lantern-b2.webp"];
  const source = buildServiceWorker(files, ["/content/campaigns/gemfall.json"]);

  it("is one classic script: no import or export survives", () => {
    expect(() => new Script(source)).not.toThrow();
    expect(source).not.toMatch(/^\s*(?:import|export)\b/m);
  });

  it("carries this build's files, and saves all but the Rive runtime at install", () => {
    expect(source).toContain(`const __KAD_BUNDLE__ = ${JSON.stringify([...files].sort())};`);
    expect(precacheOf(files)).not.toContain("/bundle/rive-z9.wasm");
    expect(source).toContain('"/content/campaigns/gemfall.json"');
  });

  it("precaches every campaign the deploy uploads", () => {
    const content = fileURLToPath(new URL("../../../../content", import.meta.url));
    expect(campaignFiles(content)).toContain("/content/campaigns/gemfall.json");
  });
});

describe("the art saved for the offline book", () => {
  const world = {
    image: { src: "/assets/world/realm.webp", width: 10, height: 10 },
    atlas: {
      image: { width: 10, height: 10 },
      levels: [
        { image: { width: 5, height: 5 }, tiles: [{ src: "/assets/world/l0.webp", x: 0, y: 0, width: 5, height: 5 }] },
        { image: { width: 10, height: 10 }, tiles: [{ src: "/assets/world/l1-a.webp", x: 0, y: 0, width: 5, height: 5 }] },
      ],
      patches: [{ id: "p", tiles: [{ src: "/assets/world/patch.webp" }] }],
    },
  } as unknown as WorldMap;
  const guide = {
    entries: {
      wisp: { id: "wisp", art: "/assets/entities/wisp/portrait.webp" },
      troll: { id: "troll", art: "/assets/entities/troll/portrait.webp" },
    },
  } as unknown as FieldGuide;

  it("is the painting, every atlas level, and only what the household has found", () => {
    expect(offlineArtFor(world, guide, ["wisp"])).toEqual([
      "/assets/world/realm.webp",
      "/assets/world/l0.webp",
      "/assets/world/l1-a.webp",
      "/assets/entities/wisp/portrait.webp",
    ]);
  });

  it("is nothing before the world and the guide have loaded", () => {
    expect(offlineArtFor(null, null, ["wisp"])).toEqual([]);
  });
});
