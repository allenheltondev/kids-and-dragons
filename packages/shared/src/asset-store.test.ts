import { describe, expect, it } from "vitest";
import {
  blobKey,
  contentTypeFor,
  emptyLock,
  filterRepoArgs,
  ignoreBlock,
  isPushCandidate,
  matchesRules,
  mergeLocks,
  parseLock,
  serializeLock,
  underAny,
  type AssetLock,
  type AssetRules,
} from "./asset-store";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const rules: AssetRules = { roots: ["assets", "art"], extensions: ["png", "webm"], exclude: ["art/review/"] };
const lock = (files: Record<string, string>): AssetLock => ({
  version: 1,
  files: Object.fromEntries(Object.entries(files).map(([p, sha]) => [p, { sha256: sha, bytes: 1 }])),
});

describe("asset store layout", () => {
  it("names a blob by its hash, sharded, with the extension for people", () => {
    expect(blobKey(A, "assets/cast/pib/assembled.PNG")).toBe(`sha256/aa/${A}.png`);
    expect(blobKey(A, "art/source/README")).toBe(`sha256/aa/${A}`);
    expect(() => blobKey("nope", "x.png")).toThrow();
  });

  it("serves the types browsers and Pixi expect", () => {
    expect(contentTypeFor("a/b.webp")).toBe("image/webp");
    expect(contentTypeFor("a/b.webm")).toBe("audio/webm");
    expect(contentTypeFor("a/b.xyz")).toBe("application/octet-stream");
  });

  it("manages media under the roots only, case-insensitively, and leaves generated output to be named", () => {
    expect(matchesRules("assets/cast/x.png", rules)).toBe(true);
    expect(matchesRules("assets/cast/x.PNG", rules)).toBe(true);
    expect(matchesRules("assets/manifest.json", rules)).toBe(false);
    expect(matchesRules("packages/client/src/assets/x.png", rules)).toBe(false);
    expect(matchesRules("assetsx/x.png", rules)).toBe(false);
    expect(isPushCandidate("art/review/sheet.png", rules)).toBe(false);
    expect(isPushCandidate("art/source/sheet.png", rules)).toBe(true);
  });

  it("matches prefixes on path segments", () => {
    expect(underAny("assets/cast/x.png", [])).toBe(true);
    expect(underAny("assets/cast/x.png", ["assets/"])).toBe(true);
    expect(underAny("assets/cast/x.png", ["./assets/cast"])).toBe(true);
    expect(underAny("assets/castle/x.png", ["assets/cast"])).toBe(false);
    expect(underAny("assets/cast/x.png", ["assets/cast/x.png"])).toBe(true);
  });
});

describe("the lock", () => {
  it("round-trips in a canonical, sorted, line-per-file form", () => {
    const text = serializeLock(lock({ "b/z.png": B, "a/y.png": A }));
    expect(text.split("\n")[3]).toContain('"a/y.png"');
    expect(serializeLock(parseLock(text))).toBe(text);
    expect(serializeLock(emptyLock())).toBe('{\n  "version": 1,\n  "files": {}\n}\n');
    expect(serializeLock(parseLock(serializeLock(emptyLock())))).toBe(serializeLock(emptyLock()));
  });

  it("refuses what it did not write", () => {
    expect(() => parseLock('{"version":2,"files":{}}')).toThrow(/version/);
    expect(() => parseLock('{"version":1,"files":{"a.png":{"sha256":"x","bytes":1}}}')).toThrow(/sha256/);
    expect(() => parseLock(`{"version":1,"files":{"../a.png":{"sha256":"${A}","bytes":1}}}`)).toThrow(/plain/);
    expect(() => parseLock(`{"version":1,"files":{"a.png":{"sha256":"${A}","bytes":-1}}}`)).toThrow(/byte/);
  });
});

describe("merging locks by path", () => {
  it("merges two paintings added beside each other on two branches", () => {
    const base = lock({ "assets/a.png": A });
    const { lock: merged, conflicts } = mergeLocks(base, lock({ "assets/a.png": A, "assets/b.png": B }), lock({ "assets/a.png": A, "assets/c.png": C }));
    expect(conflicts).toEqual([]);
    expect(Object.keys(merged.files).sort()).toEqual(["assets/a.png", "assets/b.png", "assets/c.png"]);
  });

  it("takes the side that changed, keeps deletions, and agrees with itself", () => {
    const base = lock({ "x.png": A, "gone.png": A, "same.png": A });
    const { lock: merged, conflicts } = mergeLocks(base, lock({ "x.png": B, "same.png": C }), lock({ "x.png": A, "gone.png": A, "same.png": C }));
    expect(conflicts).toEqual([]);
    expect(merged.files["x.png"]?.sha256).toBe(B);
    expect(merged.files["gone.png"]).toBeUndefined();
    expect(merged.files["same.png"]?.sha256).toBe(C);
  });

  it("stops on one path painted two ways, keeping ours", () => {
    const { lock: merged, conflicts } = mergeLocks(lock({ "x.png": A }), lock({ "x.png": B }), lock({ "x.png": C }));
    expect(conflicts).toEqual(["x.png"]);
    expect(merged.files["x.png"]?.sha256).toBe(B);
  });
});

describe("leaving git", () => {
  it("ignores every managed extension in both cases under each root", () => {
    const block = ignoreBlock(rules);
    expect(block).toContain("/assets/**/*.png");
    expect(block).toContain("/art/**/*.WEBM");
    expect(block).toHaveLength(8);
  });

  it("writes a filter-repo regex that matches exactly the managed paths", () => {
    const [, , pattern] = filterRepoArgs(rules);
    const re = new RegExp(pattern!.replace("(?i)", ""), "i");
    expect(re.test("assets/cast/x.png")).toBe(true);
    expect(re.test("art/source/deep/x.WEBM")).toBe(true);
    expect(re.test("assets/manifest.json")).toBe(false);
    expect(re.test("packages/client/src/assets/x.png")).toBe(false);
  });
});
