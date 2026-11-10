import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filesUnder, KEEP_DAYS, parseListing, staleBundleKeys } from "./stale-bundles.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("the bundle files a deploy may delete", () => {
  const current = new Set(["index-aaa.js", "chunks/camp-bbb.js"]);

  it("keeps everything this build ships, however old", () => {
    const listed = [
      { Key: "bundle/index-aaa.js", LastModified: daysAgo(400) },
      { Key: "bundle/chunks/camp-bbb.js", LastModified: daysAgo(400) },
    ];
    expect(staleBundleKeys(listed, current, NOW)).toEqual([]);
  });

  it("keeps the previous build's files while a page that names them may still be open", () => {
    const listed = [
      { Key: "bundle/index-old.js", LastModified: daysAgo(0) },
      { Key: "bundle/chunks/camp-old.js", LastModified: daysAgo(KEEP_DAYS - 1) },
    ];
    expect(staleBundleKeys(listed, current, NOW)).toEqual([]);
  });

  it("deletes a file no build has shipped for the whole keep window", () => {
    const listed = [
      { Key: "bundle/index-ancient.js", LastModified: daysAgo(KEEP_DAYS + 1) },
      { Key: "bundle/chunks/camp-ancient.js", LastModified: daysAgo(90) },
      { Key: "bundle/index-old.js", LastModified: daysAgo(2) },
    ];
    expect(staleBundleKeys(listed, current, NOW)).toEqual(["bundle/chunks/camp-ancient.js", "bundle/index-ancient.js"]);
  });

  it("never names a key outside bundle/, whatever the listing holds", () => {
    const listed = [
      { Key: "voice/abc.mp3", LastModified: daysAgo(900) },
      { Key: "index.html", LastModified: daysAgo(900) },
      { Key: "assets/manifest.json", LastModified: daysAgo(900) },
      { Key: "bundlex/index-ancient.js", LastModified: daysAgo(900) },
    ];
    expect(staleBundleKeys(listed, current, NOW)).toEqual([]);
  });

  it("keeps a file whose age it cannot read", () => {
    expect(staleBundleKeys([{ Key: "bundle/index-ancient.js", LastModified: "last Tuesday" }], current, NOW)).toEqual([]);
  });
});

describe("reading the bucket listing", () => {
  it("takes the CLI's object, a bare array, or nothing at all", () => {
    const object = { Key: "bundle/a.js", LastModified: daysAgo(1) };
    expect(parseListing(JSON.stringify({ Contents: [object], KeyCount: 1 }))).toEqual([object]);
    expect(parseListing(JSON.stringify([object]))).toEqual([object]);
    // An empty prefix: the CLI prints nothing, or an object with no Contents.
    expect(parseListing("")).toEqual([]);
    expect(parseListing("{}")).toEqual([]);
    expect(parseListing("null")).toEqual([]);
  });

  it("drops entries with no key or no date rather than guessing", () => {
    expect(parseListing(JSON.stringify({ Contents: [{ Key: "bundle/a.js" }, { LastModified: daysAgo(1) }, null] }))).toEqual([]);
  });
});

describe("node tools/deploy/stale-bundles.ts", () => {
  const script = path.join(import.meta.dirname, "stale-bundles.ts");
  const build = (files: string[]): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-bundle-"));
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), "x");
    }
    return dir;
  };
  const listing = JSON.stringify({
    Contents: [
      { Key: "bundle/index-aaa.js", LastModified: "2020-01-01T00:00:00Z" },
      { Key: "bundle/chunks/camp-bbb.js", LastModified: "2020-01-01T00:00:00Z" },
      { Key: "bundle/index-ancient.js", LastModified: "2020-01-01T00:00:00Z" },
      { Key: "bundle/index-recent.js", LastModified: new Date().toISOString() },
    ],
  });

  it("walks the build, nested folders included, with forward slashes", () => {
    expect(filesUnder(build(["index-aaa.js", "chunks/camp-bbb.js"]))).toEqual(new Set(["index-aaa.js", "chunks/camp-bbb.js"]));
  });

  it("prints the stale keys, one per line, with plain node", () => {
    const dir = build(["index-aaa.js", "chunks/camp-bbb.js"]);
    const out = execFileSync(process.execPath, [script, dir], { input: listing, encoding: "utf8" });
    expect(out.trim().split(/\r?\n/)).toEqual(["bundle/index-ancient.js"]);
  });

  it("refuses an empty build, which would call the whole bucket stale", () => {
    const dir = build([]);
    expect(() => execFileSync(process.execPath, [script, dir], { input: listing, encoding: "utf8", stdio: "pipe" })).toThrow(/refusing/);
  });
});
