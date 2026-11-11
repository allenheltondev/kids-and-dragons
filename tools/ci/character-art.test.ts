import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blobUrl } from "../../packages/shared/src/asset-store";
import { characterChanges, review, storeLink } from "./character-art.mjs";

const A = "aa".repeat(32);
const B = "bb".repeat(32);
const C = "cc".repeat(32);
const lock = (files: Record<string, string>) => ({ version: 1, files: Object.fromEntries(Object.entries(files).map(([p, sha256]) => [p, { sha256, bytes: 10 }])) });

describe("character art needs the owner's approval (#729)", () => {
  it("lists hero art the lock adds or repaints, and nothing else", () => {
    const base = lock({
      "assets/characters/unicorn/fledgling/assembled.png": A,
      "assets/character-rigs/thornguard/sworn/griffin/assembled.png": A,
      "assets/gear-portraits/old.png": A,
      "assets/cast/pib/assembled.png": A,
    });
    const head = lock({
      "assets/characters/unicorn/fledgling/assembled.png": B,
      "assets/character-rigs/thornguard/sworn/griffin/assembled.png": A,
      "assets/gear-portraits/new.png": C,
      "assets/cast/pib/assembled.png": B,
      "assets/scenes/forest.png": C,
    });
    expect(characterChanges(base, head)).toEqual([
      { path: "assets/characters/unicorn/fledgling/assembled.png", sha256: B, change: "repainted" },
      { path: "assets/gear-portraits/new.png", sha256: C, change: "added" },
    ]);
    expect(characterChanges(null, lock({ "assets/characters/x.png": A }))).toHaveLength(1);
    expect(characterChanges(base, lock({}))).toEqual([]);
  });

  it("links each painting where npm run assets:url does", () => {
    const p = "assets/characters/unicorn/fledgling/assembled.PNG";
    expect(storeLink("https://assets.example/", A, p)).toBe(blobUrl("https://assets.example", A, p));
    expect(storeLink(null, A, p)).toBeNull();
  });

  it("fails without the label, passes with it, and passes when there is nothing to look at", () => {
    const changes = [{ path: "assets/characters/x.png", sha256: A, change: "added" as const }];
    const red = review({ changes, labels: ["art"], storeUrl: "https://assets.example" });
    expect(red.ok).toBe(false);
    expect(red.report).toContain("art-approved");
    expect(red.report).toContain(`https://assets.example/sha256/aa/${A}.png`);
    expect(review({ changes, labels: ["art-approved"], storeUrl: null }).ok).toBe(true);
    expect(review({ changes: [], labels: [], storeUrl: null }).ok).toBe(true);
  });

  it("reads the locks at the two commits it is given", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-character-art-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, encoding: "utf8" }).trim();
      git("init", "-q");
      fs.writeFileSync(path.join(dir, "README.md"), "before the cutover\n");
      git("add", "-A");
      git("commit", "-qm", "pre-cutover");
      const preCutover = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, "assets.config.json"), JSON.stringify({ storeUrl: "https://assets.example" }));
      fs.writeFileSync(path.join(dir, "assets.lock.json"), JSON.stringify(lock({ "assets/cast/a.png": A })));
      git("add", "-A");
      git("commit", "-qm", "cutover");
      const base = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(dir, "assets.lock.json"), JSON.stringify(lock({ "assets/cast/a.png": A, "assets/characters/x.png": B })));
      git("commit", "-qam", "hero");
      const head = git("rev-parse", "HEAD");

      const script = path.resolve("tools/ci/character-art.mjs");
      const run = (from: string, to: string, labels: string[]) =>
        spawnSync("node", [script, from, to, "--labels", JSON.stringify(labels)], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
      const red = run(base, head, []);
      expect(red.status).toBe(1);
      expect(red.stdout).toContain(`https://assets.example/sha256/bb/${B}.png`);
      expect(run(base, head, ["art-approved"]).status).toBe(0);
      expect(run(preCutover, preCutover, []).status).toBe(0);
      // The cutover adds every path at once, all of it art already in git.
      expect(run(preCutover, head, []).status).toBe(0);

      // A read that fails is not "no lock": an unknown commit, or a lock blob that cannot be
      // fetched, fails the check instead of passing it.
      expect(run("0".repeat(40), head, []).status).toBe(2);
      const blob = git("rev-parse", `${head}:assets.lock.json`);
      fs.rmSync(path.join(dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
      const unreadable = run(base, head, ["art-approved"]);
      expect(unreadable.status).toBe(2);
      expect(unreadable.stderr).toContain("cannot be cleared");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
