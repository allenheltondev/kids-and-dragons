/**
 * The asset store's commands against a real git repo in a temp folder and a
 * folder standing in for the bucket (served to `pull` as a file:// store URL),
 * so the whole cutover and the everyday loop run with no network.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobKey, parseLock, serializeLock } from "../../packages/shared/src/asset-store";
import { hashBytes } from "../../packages/shared/src/asset-cache";
import { archiveHistory, migrate, pull, push, readIgnoreBlock, status, untrack, urlFor, verify } from "./commands";
import { loadConfig, loadLock } from "./lib";
import { DirBlobStore, S3BlobStore } from "./stores";

let tmp: string;
let storeDir: string;
let cacheDir: string;

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

/** A repo shaped like this one: art and audio tracked in git, a manifest beside them. */
function makeRepo(): string {
  const root = path.join(tmp, "origin");
  fs.mkdirSync(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "test@example.com");
  sh(root, "config", "user.name", "test");
  write(root, "assets.config.json", JSON.stringify({
    storeUrl: `file://${storeDir}`,
    bucket: null,
    stack: "kad-asset-store",
    region: "us-east-1",
    untracked: false,
    roots: ["assets", "art"],
    extensions: ["png", "webm"],
    exclude: ["art/review/"],
  }));
  write(root, ".gitignore", ".assets/\n");
  write(root, "assets/manifest.json", "{}");
  write(root, "assets/cast/pib/assembled.png", "pib v1");
  write(root, "assets/cast/gullet/assembled.png", "gullet v1");
  write(root, "assets/audio/rain.webm", "rain");
  write(root, "art/source/pib.png", "pib source");
  write(root, "art/review/old/sheet.png", "a reviewed sheet");
  write(root, "packages/client/src/assets/chrome.png", "bundled, stays in git");
  sh(root, "add", "-A");
  sh(root, "commit", "-qm", "art in git");
  return root;
}

function clone(from: string, name: string): string {
  const dest = path.join(tmp, name);
  sh(tmp, "clone", "-q", from, dest);
  sh(dest, "config", "user.email", "test@example.com");
  sh(dest, "config", "user.name", "test");
  return dest;
}

async function cutover(root: string): Promise<void> {
  await migrate(root, new DirBlobStore(storeDir), { cacheDir });
  await untrack(root);
  sh(root, "add", "-A");
  sh(root, "commit", "-qm", "art to the store");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kad-assets-"));
  storeDir = path.join(tmp, "store");
  cacheDir = path.join(tmp, "cache");
  delete process.env.KAD_ASSET_STORE_URL;
  delete process.env.KAD_ASSET_BUCKET;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("the cutover", () => {
  it("migrates every tracked media file and nothing else, and a second run uploads nothing", async () => {
    const root = makeRepo();
    write(root, "assets/cast/new/untracked.png", "not committed yet");
    const store = new DirBlobStore(storeDir);
    const first = await migrate(root, store, { cacheDir });
    expect(first.recorded).toEqual([
      "art/review/old/sheet.png",
      "art/source/pib.png",
      "assets/audio/rain.webm",
      "assets/cast/gullet/assembled.png",
      "assets/cast/pib/assembled.png",
    ]);
    const lock = loadLock(root);
    expect(lock.files["assets/manifest.json"]).toBeUndefined();
    expect(lock.files["packages/client/src/assets/chrome.png"]).toBeUndefined();
    const pib = lock.files["assets/cast/pib/assembled.png"]!;
    expect(fs.readFileSync(path.join(storeDir, blobKey(pib.sha256, "x.png")), "utf8")).toBe("pib v1");
    const again = await migrate(root, store, { cacheDir });
    expect(again.uploaded).toEqual([]);
  });

  it("untracks only once the store can serve everything, then keeps media out of git", async () => {
    const root = makeRepo();
    await migrate(root, new DirBlobStore(storeDir), { cacheDir });
    write(root, "assets/cast/pib/assembled.png", "pib edited after migrate");
    await expect(untrack(root)).rejects.toThrow(/changed since it was migrated/);
    write(root, "assets/cast/pib/assembled.png", "pib v1");

    fs.rmSync(path.join(storeDir, blobKey(loadLock(root).files["assets/audio/rain.webm"]!.sha256, "x.webm")));
    await expect(untrack(root)).rejects.toThrow(/cannot serve 1 file/);
    await migrate(root, new DirBlobStore(storeDir), { cacheDir });

    const { untracked } = await untrack(root);
    expect(untracked).toHaveLength(5);
    sh(root, "add", "-A");
    sh(root, "commit", "-qm", "cutover");
    const tracked = sh(root, "ls-files").split("\n");
    expect(tracked).toContain("assets.lock.json");
    expect(tracked).toContain("assets/manifest.json");
    expect(tracked).toContain("packages/client/src/assets/chrome.png");
    expect(tracked.filter((p) => /^(assets|art)\/.*\.(png|webm)$/.test(p))).toEqual([]);
    expect(fs.existsSync(path.join(root, "assets/cast/pib/assembled.png"))).toBe(true);
    expect(loadConfig(root).untracked).toBe(true);
    expect(readIgnoreBlock(root)).toContain("/assets/**/*.png");
    expect((await verify(root)).problems).toEqual([]);

    // A painting force-added to git after the cutover fails the gate.
    write(root, "assets/cast/sneaky.png", "binary in git");
    sh(root, "add", "-f", "assets/cast/sneaky.png");
    expect((await verify(root)).problems.join("\n")).toMatch(/sneaky\.png is committed to git/);
  });
});

describe("pull", () => {
  it("does nothing for a commit from before the store", async () => {
    const root = makeRepo();
    const result = await pull(root, { cacheDir });
    expect(result.fetched).toEqual([]);
  });

  it("fills a fresh clone from the store, and a second pull downloads nothing", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const work = clone(origin, "work");
    expect(fs.existsSync(path.join(work, "assets/cast/pib/assembled.png"))).toBe(false);
    expect((await verify(work, { present: ["assets"] })).problems).toHaveLength(3);

    // A machine of its own: migrate filled the origin's cache, which would make every blob free.
    const fresh = path.join(tmp, "work-cache");
    const first = await pull(work, { cacheDir: fresh, prefixes: ["assets"] });
    expect(first.fetched.sort()).toEqual(["assets/audio/rain.webm", "assets/cast/gullet/assembled.png", "assets/cast/pib/assembled.png"]);
    expect(fs.existsSync(path.join(work, "art/source/pib.png"))).toBe(false);
    expect(read(work, "assets/cast/pib/assembled.png")).toBe("pib v1");
    expect((await verify(work, { present: ["assets"] })).problems).toEqual([]);
    expect(sh(work, "status", "--porcelain")).toBe("");

    const second = await pull(work, { cacheDir: fresh });
    expect(second.fetched).toEqual(["art/review/old/sheet.png", "art/source/pib.png"]);
    expect(second.bytesDownloaded).toBe("a reviewed sheet".length + "pib source".length);
    expect((await pull(work, { cacheDir: fresh })).fetched).toEqual([]);
  });

  it("refuses a blob that does not hash to its name", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const sha = loadLock(origin).files["assets/cast/pib/assembled.png"]!.sha256;
    fs.writeFileSync(path.join(storeDir, blobKey(sha, "x.png")), "tampered");
    const work = clone(origin, "work");
    await expect(pull(work, { cacheDir: path.join(tmp, "fresh-cache") })).rejects.toThrow(/served .* with sha256/);
  });
});

describe("the everyday loop", () => {
  it("push records a new painting; another checkout's pull updates what it had and keeps its own edits", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const agent = clone(origin, "agent");
    const other = clone(origin, "other");
    await pull(agent, { cacheDir });
    await pull(other, { cacheDir });

    // The agent paints: one new picture, one repainted.
    write(agent, "assets/cast/posy/assembled.png", "posy v1");
    write(agent, "assets/cast/pib/assembled.png", "pib v2");
    const s = await status(agent);
    expect(s.added).toEqual(["assets/cast/posy/assembled.png"]);
    expect(s.modified).toEqual(["assets/cast/pib/assembled.png"]);
    expect(sh(agent, "status", "--porcelain")).toBe("");

    const pushed = await push(agent, new DirBlobStore(storeDir), { cacheDir: path.join(tmp, "agent-cache") });
    expect(pushed.recorded).toEqual(["assets/cast/pib/assembled.png", "assets/cast/posy/assembled.png"]);
    expect(sh(agent, "status", "--porcelain").trim()).toBe("M assets.lock.json");
    sh(agent, "commit", "-qam", "posy, and pib repainted");
    sh(agent, "push", "-q", "origin", "HEAD:refs/heads/agent");

    // Meanwhile the other checkout has its own unpushed edit to gullet.
    write(other, "assets/cast/gullet/assembled.png", "gullet, mine");
    sh(other, "pull", "-q", "origin", "agent");
    const pulled = await pull(other, { cacheDir: path.join(tmp, "other-cache") });
    expect(pulled.fetched).toEqual(["assets/cast/posy/assembled.png"]);
    expect(pulled.updated).toEqual(["assets/cast/pib/assembled.png"]);
    expect(pulled.kept).toEqual(["assets/cast/gullet/assembled.png"]);
    expect(read(other, "assets/cast/pib/assembled.png")).toBe("pib v2");
    expect(read(other, "assets/cast/gullet/assembled.png")).toBe("gullet, mine");

    const forced = await pull(other, { cacheDir: path.join(tmp, "other-cache"), force: true });
    expect(forced.updated).toEqual(["assets/cast/gullet/assembled.png"]);
    expect(read(other, "assets/cast/gullet/assembled.png")).toBe("gullet v1");
  });

  it("records a deletion only when told where, and other checkouts drop the file on pull", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const agent = clone(origin, "agent");
    const other = clone(origin, "other");
    await pull(agent, { cacheDir });
    await pull(other, { cacheDir });

    fs.rmSync(path.join(agent, "assets/cast/gullet"), { recursive: true });
    expect((await status(agent)).deleted).toEqual(["assets/cast/gullet/assembled.png"]);
    const store = new DirBlobStore(storeDir);
    await expect(push(agent, store, { cacheDir, prune: true })).rejects.toThrow(/needs the folders/);
    // A plain push leaves the lock alone: a deletion is never inferred.
    expect((await push(agent, store, { cacheDir })).pruned).toEqual([]);
    expect(loadLock(agent).files["assets/cast/gullet/assembled.png"]).toBeDefined();
    // And a pull does not resurrect it either: deleting it was a local change.
    expect((await pull(agent, { cacheDir })).kept).toEqual(["assets/cast/gullet/assembled.png"]);
    expect(fs.existsSync(path.join(agent, "assets/cast/gullet/assembled.png"))).toBe(false);

    const pruned = await push(agent, store, { cacheDir, prune: true, prefixes: ["assets/cast"] });
    expect(pruned.pruned).toEqual(["assets/cast/gullet/assembled.png"]);
    sh(agent, "commit", "-qam", "gullet retired");
    sh(agent, "push", "-q", "origin", "HEAD:refs/heads/agent");

    sh(other, "pull", "-q", "origin", "agent");
    expect((await pull(other, { cacheDir })).removed).toEqual(["assets/cast/gullet/assembled.png"]);
    expect(fs.existsSync(path.join(other, "assets/cast/gullet/assembled.png"))).toBe(false);
  });

  it("leaves generated output alone unless it is named", async () => {
    const origin = makeRepo();
    await cutover(origin);
    write(origin, "art/review/new/contact.png", "a fresh contact sheet");
    expect((await status(origin)).added).toEqual([]);
    expect((await status(origin, ["art/review/new"])).added).toEqual(["art/review/new/contact.png"]);
    const named = await push(origin, new DirBlobStore(storeDir), { cacheDir, prefixes: ["art/review/new"] });
    expect(named.recorded).toEqual(["art/review/new/contact.png"]);
    await expect(push(origin, new DirBlobStore(storeDir), { cacheDir, prefixes: ["assets/manifest.json"] })).rejects.toThrow(/not a file the store manages/);
  });

  it("gives a file's public URL", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const sha = loadLock(origin).files["assets/audio/rain.webm"]!.sha256;
    expect(urlFor(origin, "assets/audio/rain.webm")).toBe(`file://${storeDir}/sha256/${sha.slice(0, 2)}/${sha}.webm`);
  });
});

describe("verify", () => {
  it("fails a lock that names a blob nobody stored, and one not in canonical form", async () => {
    const origin = makeRepo();
    await cutover(origin);
    expect((await verify(origin)).problems).toEqual([]);

    const lock = loadLock(origin);
    lock.files["assets/cast/ghost.png"] = { sha256: "f".repeat(64), bytes: 3 };
    fs.writeFileSync(path.join(origin, "assets.lock.json"), serializeLock(lock));
    expect((await verify(origin)).problems.join("\n")).toMatch(/ghost\.png: in assets\.lock\.json but not in the store/);
    expect((await verify(origin, { storePaths: ["assets/cast/pib/assembled.png"] })).problems).toEqual([]);

    fs.writeFileSync(path.join(origin, "assets.lock.json"), JSON.stringify(parseLock(serializeLock(lock))));
    expect((await verify(origin, { store: false })).problems.join("\n")).toMatch(/canonical/);
  });
});

describe("merging the lock", () => {
  it("merges two branches that each added art to the same folder", async () => {
    const origin = makeRepo();
    await cutover(origin);
    const driver = `node ${path.resolve("tools/assets/merge-lock.ts")} %O %A %B`;
    sh(origin, "config", "merge.kad-assets-lock.driver", driver);
    write(origin, ".gitattributes", "assets.lock.json merge=kad-assets-lock\n");
    sh(origin, "add", ".gitattributes");
    sh(origin, "commit", "-qm", "driver");
    const store = new DirBlobStore(storeDir);

    sh(origin, "checkout", "-qb", "left");
    write(origin, "assets/cast/aa/assembled.png", "left");
    await push(origin, store, { cacheDir });
    sh(origin, "commit", "-qam", "left");

    sh(origin, "checkout", "-q", "main");
    write(origin, "assets/cast/ab/assembled.png", "right");
    await push(origin, store, { cacheDir });
    sh(origin, "commit", "-qam", "right");

    sh(origin, "merge", "-q", "--no-edit", "left");
    const merged = loadLock(origin).files;
    expect(merged["assets/cast/aa/assembled.png"]).toBeDefined();
    expect(merged["assets/cast/ab/assembled.png"]).toBeDefined();
    expect((await verify(origin)).problems).toEqual([]);
  });
});

describe("the S3 store", () => {
  it("writes conditionally and treats 412 and 404 as answers, not errors", async () => {
    const sent: Array<{ kind: string; input: Record<string, unknown> }> = [];
    const existing = new Set<string>(["sha256/aa/old.png"]);
    class Head { kind = "head"; constructor(public input: Record<string, unknown>) {} }
    class Put { kind = "put"; constructor(public input: Record<string, unknown>) {} }
    const s3 = {
      send(command: unknown): Promise<unknown> {
        const c = command as { kind: string; input: { Key: string } };
        sent.push(c as never);
        const there = existing.has(c.input.Key);
        if (c.kind === "head" && !there) return Promise.reject(Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
        if (c.kind === "put" && there) return Promise.reject(Object.assign(new Error("pf"), { $metadata: { httpStatusCode: 412 } }));
        existing.add(c.input.Key);
        return Promise.resolve({});
      },
    };
    const store = new S3BlobStore(s3, "kad-asset-store-test", { HeadObjectCommand: Head as never, PutObjectCommand: Put as never });
    expect(await store.has("sha256/aa/old.png")).toBe(true);
    expect(await store.has("sha256/bb/new.png")).toBe(false);
    expect(await store.put("sha256/bb/new.png", new Uint8Array([1]), "image/png")).toBe(true);
    expect(await store.put("sha256/aa/old.png", new Uint8Array([1]), "image/png")).toBe(false);
    const put = sent.find((c) => c.kind === "put")!.input;
    expect(put).toMatchObject({ Bucket: "kad-asset-store-test", IfNoneMatch: "*", ContentType: "image/png", CacheControl: "public,max-age=31536000,immutable" });
  });
});

describe("archive-history", () => {
  it("stores every version history ever held, with a change log that can rebuild any commit's art", async () => {
    const root = makeRepo();
    write(root, "assets/cast/pib/assembled.png", "pib v2");
    sh(root, "commit", "-qam", "pib repainted");
    fs.rmSync(path.join(root, "assets/audio/rain.webm"));
    sh(root, "commit", "-qam", "rain retired");
    const v2 = sh(root, "rev-parse", "HEAD~1").trim();

    const result = await archiveHistory(root, new DirBlobStore(storeDir));
    const pib = result.changes.filter((c) => c.path === "assets/cast/pib/assembled.png");
    expect(pib.map((c) => c.sha256)).toEqual([hashBytes(new TextEncoder().encode("pib v2")), hashBytes(new TextEncoder().encode("pib v1"))]);
    expect(pib[0]!.commit).toBe(v2);
    expect(result.changes.find((c) => c.path === "assets/audio/rain.webm" && c.sha256 === null)).toBeDefined();
    expect(result.changes.some((c) => c.path === "assets/manifest.json")).toBe(false);
    expect(result.uploaded).toBe(6);
    for (const c of result.changes.filter((c) => c.sha256)) {
      expect(fs.existsSync(path.join(storeDir, blobKey(c.sha256!, c.path)))).toBe(true);
    }
    const stored = fs.readdirSync(path.join(storeDir, "history"));
    expect(stored).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(storeDir, "history", stored[0]!), "utf8")).changes).toEqual(result.changes);
  });
});
