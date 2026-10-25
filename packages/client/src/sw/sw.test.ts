/**
 * The service worker's decisions (policy.ts) and the script the build makes of
 * it (sw-build.ts). The worker's behaviour end to end — a reload with no
 * network opening the adventure book — is e2e/offline.spec.ts, against a real
 * production build.
 */

import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUSH_BODY, PUSH_TAG, PUSH_TITLE, turnPushPayload, type FieldGuide, type WorldMap } from "@kad/shared";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildId, buildServiceWorker, campaignFiles, fileIndexOf, fingerprint, precacheOf } from "../../sw-build";
import {
  SW_FILES_BUDGET_BYTES,
  SW_FILES_BUDGET_FLOOR_BYTES,
  SW_PUSH_BODY,
  SW_PUSH_TAG,
  SW_PUSH_TITLE,
  SW_SHELL_TIMEOUT_MS,
  swAfterInstallError,
  swBudgetFor,
  swCacheable,
  swEvictions,
  swIsQuotaError,
  swNoticeWindow,
  swPushNotice,
  swQuotaTrim,
  swShellAnswer,
  swOverLimit,
  swReadVersionedKey,
  swShellEntry,
  swStaleBundles,
  swStaleVersions,
  swStrategyFor,
  swVersionedKey,
  SW_PRECACHE_CONTENT,
} from "./policy";
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

  it("routes hashed code, content, every asset (art, audio) and unindexed pictures", () => {
    expect(at("/bundle/index-abc123.js")).toBe("bundle");
    expect(at("/content/field-guide.json")).toBe("content");
    expect(at("/assets/world/realm-atlas-detail-v1.webp")).toBe("asset");
    expect(at("/assets/character-rigs/starweaver/sworn/unicorn/assembled.png")).toBe("asset");
    expect(at("/assets/audio/cues/dice.webm")).toBe("asset");
    expect(at("/brand/dragon-mark.png")).toBe("image");
  });

  it("leaves alone what it should not keep: other origins, non-GETs, partial audio, everything else", () => {
    expect(swStrategyFor({ method: "GET", mode: "cors", hasRange: false, url: "https://fonts.example/a.webp" }, ORIGIN)).toBe("passthrough");
    expect(at("/content/items.json", { method: "HEAD" })).toBe("passthrough");
    expect(at("/assets/audio/theme.webm", { hasRange: true })).toBe("passthrough");
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
  });

  it("keeps the previous build's code for the pages still running it, and only that far back", () => {
    const cached = ["/bundle/a1.js", "/bundle/b1.js", "/bundle/c1.js", "/__kad/bundle-list"];
    // Build C takes over from B: B's chunks stay for B's open tabs; A's go;
    // the worker's own record of the list is never treated as code.
    expect(swStaleBundles(cached, ["/bundle/c1.js"], ["/bundle/b1.js"])).toEqual(["/bundle/a1.js"]);
    expect(swOverLimit([1, 2, 3, 4], 3)).toEqual([1]);
    expect(swOverLimit([1, 2], 3)).toEqual([]);
  });
});

describe("the offline app's page", () => {
  it("is known by its entry script, so a worker saves only its own build's page", () => {
    const html = '<script type="module" crossorigin src="/bundle/index-a1B2.js"></script><link rel="modulepreload" href="/bundle/jsx-x.js">';
    expect(swShellEntry(html)).toBe("/bundle/index-a1B2.js");
    expect(swShellEntry("<html><body>no app here</body></html>")).toBeNull();
  });
});

describe("a page load on a slow or captive network (#454)", () => {
  it("waits only a few seconds for the network", () => {
    expect(SW_SHELL_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000);
    expect(SW_SHELL_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("takes the network's page whenever it wins", () => {
    expect(swShellAnswer("ok", true)).toBe("network");
    expect(swShellAnswer("ok", false)).toBe("network");
  });

  it("shows the saved app when the network is still out at the timeout", () => {
    expect(swShellAnswer("pending", true)).toBe("saved");
  });

  it("shows the saved app when the network fails fast", () => {
    expect(swShellAnswer("failed", true)).toBe("saved");
  });

  it("with no saved app, waits for the network however long, and fails only with it", () => {
    expect(swShellAnswer("pending", false)).toBe("wait");
    expect(swShellAnswer("failed", false)).toBe("fail");
  });
});

describe("room on the phone (#457)", () => {
  const MB = 1024 * 1024;

  it("budgets a fifth of the quota, between the floor and the cap", () => {
    expect(swBudgetFor(10_000 * MB)).toBe(SW_FILES_BUDGET_BYTES);
    expect(swBudgetFor(500 * MB)).toBe(100 * MB);
    expect(swBudgetFor(100 * MB)).toBe(SW_FILES_BUDGET_FLOOR_BYTES);
  });

  it("falls back to the fixed budget where the browser will not say", () => {
    expect(swBudgetFor(undefined)).toBe(SW_FILES_BUDGET_BYTES);
    expect(swBudgetFor(0)).toBe(SW_FILES_BUDGET_BYTES);
    expect(swBudgetFor(Number.NaN)).toBe(SW_FILES_BUDGET_BYTES);
    expect(swBudgetFor(Number.POSITIVE_INFINITY)).toBe(SW_FILES_BUDGET_BYTES);
  });

  it("knows a full disk when it sees one", () => {
    expect(swIsQuotaError({ name: "QuotaExceededError" })).toBe(true);
    expect(swIsQuotaError({ name: "Error", code: 22 })).toBe(true);
    expect(swIsQuotaError(new Error("install: /content/rules.json is not the bytes this build fingerprinted"))).toBe(false);
    expect(swIsQuotaError(new TypeError("Failed to fetch"))).toBe(false);
    expect(swIsQuotaError(null)).toBe(false);
    expect(swIsQuotaError("QuotaExceededError")).toBe(false);
  });

  it("trims and retries an install once on a full disk, and fails on anything else", () => {
    const full = { name: "QuotaExceededError" };
    expect(swAfterInstallError(full, 0)).toBe("trim-and-retry");
    expect(swAfterInstallError(full, 1)).toBe("fail");
    // The stale-edge guarantee: a content file whose bytes are not this build's still fails install.
    expect(swAfterInstallError(new Error("install: /content/field-guide.json is not the bytes this build fingerprinted"), 0)).toBe("fail");
    expect(swAfterInstallError(new TypeError("Failed to fetch"), 0)).toBe("fail");
  });

  it("trims to about half of what is saved, oldest first, and never content", () => {
    const meta = {
      "/content/rules.json?v=1": { bytes: 10, used: 0 },
      "/assets/old.webp?v=2": { bytes: 40, used: 1 },
      "/assets/mid.webp?v=3": { bytes: 30, used: 2 },
      "/assets/new.webp?v=4": { bytes: 20, used: 3 },
    };
    // 100 saved: down to 45, so the two oldest pictures go, and the content stays.
    expect(swQuotaTrim(meta)).toEqual(["/assets/old.webp?v=2", "/assets/mid.webp?v=3"]);
    expect(swQuotaTrim({ "/content/rules.json?v=1": { bytes: 40, used: 0 } })).toEqual([]);
    expect(swQuotaTrim({})).toEqual([]);
  });
});

describe("fingerprinted files", () => {
  it("are saved under their fingerprint, and read back from it", () => {
    const key = swVersionedKey("/assets/x/assembled.png", "0123456789abcdef");
    expect(key).toBe("/assets/x/assembled.png?v=0123456789abcdef");
    expect(swReadVersionedKey(key)).toEqual({ path: "/assets/x/assembled.png", fingerprint: "0123456789abcdef" });
    expect(swReadVersionedKey("/__kad/files-meta")).toBeNull();
  });

  it("are dropped when a deploy changes or removes them, and kept when it does not", () => {
    const index = { "/assets/a.webp": "aaaa", "/assets/b.webp": "bbbb" };
    expect(swStaleVersions(["/assets/a.webp?v=aaaa", "/assets/b.webp?v=old0", "/assets/gone.webp?v=cccc"], index)).toEqual([
      "/assets/b.webp?v=old0",
      "/assets/gone.webp?v=cccc",
    ]);
  });

  it("go least recently used first when over budget, down to 90%, and content never goes", () => {
    const meta = {
      "/assets/old.png?v=1": { bytes: 60, used: 1 },
      "/content/rules.json?v=2": { bytes: 10, used: 0 },
      "/assets/mid.webp?v=3": { bytes: 30, used: 2 },
      "/assets/new.webp?v=4": { bytes: 30, used: 3 },
    };
    expect(swEvictions(meta, 200)).toEqual([]);
    expect(swEvictions(meta, 100)).toEqual(["/assets/old.png?v=1"]);
    expect(swEvictions(meta, 40)).toEqual(["/assets/old.png?v=1", "/assets/mid.webp?v=3", "/assets/new.webp?v=4"]);
  });

  it("fingerprint the way the worker checks them: the first 16 hex digits of SHA-256", () => {
    const bytes = new TextEncoder().encode("a unicorn");
    expect(fingerprint(bytes)).toBe(createHash("sha256").update(bytes).digest("hex").slice(0, 16));
  });

  it("cover every uploaded file under the indexed directories, but no dotfiles", () => {
    const root = `${mkdtempSync(`${tmpdir()}/kad-index-`)}/`;
    mkdirSync(`${root}assets/world`, { recursive: true });
    mkdirSync(`${root}content`, { recursive: true });
    writeFileSync(`${root}assets/world/realm.webp`, "painting");
    writeFileSync(`${root}assets/.DS_Store`, "junk");
    writeFileSync(`${root}content/rules.json`, "{}");
    expect(fileIndexOf(`${root}assets/`, [""])).toEqual({
      "/world/realm.webp": fingerprint(new TextEncoder().encode("painting")),
    });
    expect(fileIndexOf(root, ["assets", "content"])).toEqual({
      "/assets/world/realm.webp": fingerprint(new TextEncoder().encode("painting")),
      "/content/rules.json": fingerprint(new TextEncoder().encode("{}")),
    });
  });
});

describe("the precached content", () => {
  it("includes the bestiary beside the rules", () => {
    expect(SW_PRECACHE_CONTENT).toContain("/content/bestiary.json");
    expect(SW_PRECACHE_CONTENT).toContain("/content/rules.json");
  });
});

describe("the built sw.js", () => {
  const files = ["/bundle/index-a1.js", "/bundle/index-a1.css", "/bundle/extra-z9.js", "/bundle/lantern-b2.webp"];
  const source = buildServiceWorker({
    bundleFiles: files,
    campaignFiles: ["/content/campaigns/gemfall.json"],
    fileIndexUrl: "/bundle/files-x1.json",
    build: "abc123def456",
  });

  it("is one classic script: no import or export survives", () => {
    expect(() => new Script(source)).not.toThrow();
    expect(source).not.toMatch(/^\s*(?:import|export)\b/m);
  });

  it("carries this build's files, and saves the complete bundle at install", () => {
    expect(source).toContain(`const __KAD_BUNDLE__ = ${JSON.stringify([...files].sort())};`);
    expect(precacheOf(files)).toContain("/bundle/extra-z9.js");
    expect(source).toContain('"/content/campaigns/gemfall.json"');
    expect(source).toContain('const __KAD_FILE_INDEX__ = "/bundle/files-x1.json";');
  });

  it("carries the build id the page reports, and still imports nothing (#459)", () => {
    expect(source).toContain('const __KAD_BUILD__ = "abc123def456";');
    expect(source).not.toMatch(/\bimport\s*[({"'\w]/);
    expect(buildId({ KAD_BUILD: "0123456789abcdef", GITHUB_SHA: "ffff" })).toBe("0123456789ab");
    expect(buildId({ GITHUB_SHA: "fedcba9876543210" })).toBe("fedcba987654");
    expect(buildId({})).toBe("dev");
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

describe("\"It's your turn\" (#466)", () => {
  it("says the shared words, and only those (#320)", () => {
    expect(SW_PUSH_TITLE).toBe(PUSH_TITLE);
    expect(SW_PUSH_BODY).toBe(PUSH_BODY);
    expect(SW_PUSH_BODY).toBe("It's your turn in Kids & Dragons");
    expect(SW_PUSH_TAG).toBe(PUSH_TAG);
  });

  it("shows its own words whatever the push carried, and opens only a room on this site", () => {
    expect(swPushNotice(turnPushPayload("abcd"))).toEqual({ title: PUSH_TITLE, body: PUSH_BODY, tag: PUSH_TAG, url: "/p/ABCD" });
    expect(swPushNotice({ title: "Ada's turn!", body: "Ada, roll for the troll", url: "/p/ABCDEF" })).toEqual({
      title: PUSH_TITLE,
      body: PUSH_BODY,
      tag: PUSH_TAG,
      url: "/p/ABCDEF",
    });
    for (const url of ["https://evil.example/p/ABCD", "//evil.example", "/account", "/p/abcd", "/p/ABCD/../x", 7]) {
      expect(swPushNotice({ url }).url).toBe("/");
    }
    expect(swPushNotice(null).url).toBe("/");
  });

  it("brings forward a window on the room, else any of the app's, else none", () => {
    const origin = "https://kad.example";
    const windows = [{ url: "https://other.example/p/ABCD" }, { url: `${origin}/journal` }, { url: `${origin}/p/ABCD` }];
    expect(swNoticeWindow(windows, "/p/ABCD", origin)).toEqual({ index: 2, navigate: false });
    expect(swNoticeWindow(windows, "/p/WXYZ", origin)).toEqual({ index: 1, navigate: true });
    expect(swNoticeWindow([{ url: "not a url" }, windows[0]!], "/p/ABCD", origin)).toEqual({ index: -1, navigate: false });
  });

  /** The built worker, run with just enough of a worker scope to take a push. */
  function runWorker() {
    const listeners: Record<string, (event: unknown) => void> = {};
    const shown: { title: string; options: Record<string, unknown> }[] = [];
    const opened: string[] = [];
    const scope = {
      location: new URL("https://kad.example/sw.js"),
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
      registration: {
        showNotification: async (title: string, options: Record<string, unknown>) => {
          shown.push({ title, options });
        },
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url);
          return null;
        },
      },
    };
    const context = createContext({ self: scope, URL, console });
    new Script(
      buildServiceWorker({ bundleFiles: ["/bundle/index-a1.js"], campaignFiles: [], fileIndexUrl: "/bundle/files-x1.json", build: "b" }),
    ).runInContext(context);
    const dispatch = async (type: string, event: Record<string, unknown>) => {
      const work: Promise<unknown>[] = [];
      listeners[type]?.({ ...event, waitUntil: (p: Promise<unknown>) => work.push(p) });
      await Promise.all(work);
    };
    return { listeners, shown, opened, dispatch };
  }

  it("the built worker shows the notice for a push, and opens the room on a tap", async () => {
    const sw = runWorker();
    expect(Object.keys(sw.listeners)).toEqual(expect.arrayContaining(["push", "notificationclick"]));

    await sw.dispatch("push", { data: { json: () => ({ ...turnPushPayload("WXYZ"), body: "secret" }) } });
    expect(sw.shown).toEqual([
      { title: PUSH_TITLE, options: expect.objectContaining({ body: PUSH_BODY, tag: PUSH_TAG, data: { url: "/p/WXYZ" } }) },
    ]);

    // A push with nothing readable in it still shows the notice.
    await sw.dispatch("push", { data: { json: () => { throw new SyntaxError("not json"); } } });
    expect(sw.shown[1]?.options).toMatchObject({ body: PUSH_BODY, data: { url: "/" } });

    let closed = false;
    await sw.dispatch("notificationclick", { notification: { data: { url: "/p/WXYZ" }, close: () => (closed = true) } });
    expect(closed).toBe(true);
    expect(sw.opened).toEqual(["/p/WXYZ"]);
  });
});
