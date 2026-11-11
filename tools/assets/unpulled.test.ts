/**
 * #725: after the cutover a checkout has the lock and none of the art until it pulls. The art
 * tools must say so, not report every delivered painting as owed (art:inventory) or broken
 * (art:verify). Drives the real tools against a temporary tree.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeLock } from "../../packages/shared/src/asset-store";
import { unpulledArt } from "./lib";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SHA = "ab".repeat(32);
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kad-unpulled-"));
  fs.mkdirSync(path.join(tmp, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "manifest.json"), path.join(tmp, "assets", "manifest.json"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function lock(paths: string[]): void {
  const files = Object.fromEntries(paths.map((p) => [p, { sha256: SHA, bytes: 3 }]));
  fs.writeFileSync(path.join(tmp, "assets.lock.json"), serializeLock({ version: 1, files }));
}

function place(p: string): void {
  fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true });
  fs.writeFileSync(path.join(tmp, p), "art");
}

const inventory = () => spawnSync("node", [path.join(ROOT, "tools/art/inventory.ts")], { cwd: tmp, encoding: "utf8" });
const verify = () =>
  spawnSync("python3", [path.join(ROOT, "tools/art/verify.py")], { cwd: tmp, encoding: "utf8", env: { ...process.env, KAD_REPO_ROOT: tmp } });

describe("an unpulled tree (#725)", () => {
  it("names the lock's art that is not on disk, and nothing before the cutover", () => {
    expect(unpulledArt(tmp)).toEqual([]);
    lock(["assets/cast/pib/assembled.png", "assets/audio/rain.webm", "art/source/pib.png"]);
    expect(unpulledArt(tmp)).toEqual(["assets/audio/rain.webm", "assets/cast/pib/assembled.png"]);
    place("assets/audio/rain.webm");
    expect(unpulledArt(tmp)).toEqual(["assets/cast/pib/assembled.png"]);
    expect(unpulledArt(tmp, "art")).toEqual(["art/source/pib.png"]);
  });

  it("stops art:inventory with what to do, instead of reporting delivered art as owed", () => {
    lock(["assets/cast/pib/assembled.png"]);
    const before = inventory();
    expect(before.status).toBe(1);
    expect(before.stderr).toMatch(/1 file\(s\) assets\.lock\.json names under assets\/ are not on disk/);
    expect(before.stderr).toMatch(/npm run assets:pull -- assets/);
    expect(before.stdout).not.toMatch(/image asset inventory/);

    place("assets/cast/pib/assembled.png");
    // Past the guard; the bare tree has no canon/ for the rest of the report, which is fine here.
    expect(inventory().stderr).not.toMatch(/not on disk/);
  });

  it("stops art:verify the same way", () => {
    lock(["assets/cast/pib/assembled.png"]);
    const before = verify();
    expect(before.status).not.toBe(0);
    expect(before.stderr).toMatch(/art:verify: 1 file\(s\) assets\.lock\.json names under assets\/ are not on disk/);

    place("assets/cast/pib/assembled.png");
    expect(verify().stderr).not.toMatch(/not on disk/);
  });
});
