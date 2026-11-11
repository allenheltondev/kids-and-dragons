/**
 * The asset store's local half (docs/asset-store.md): the config, the lock, the
 * per-checkout stat cache, and the walk that finds media on disk.
 *
 * Plain-node TypeScript (erasable syntax only, built-ins only) so that `pull`
 * and `verify` run in a ship-mode deploy with no node_modules, exactly as
 * tools/voice/verify-site.ts does.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile } from "../../packages/shared/src/asset-cache.ts";
import {
  CONFIG_FILE,
  LOCK_FILE,
  emptyLock,
  matchesRules,
  parseLock,
  serializeLock,
  type AssetLock,
  type AssetRules,
  type LockEntry,
} from "../../packages/shared/src/asset-store.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/+$/, "");

export interface AssetConfig extends AssetRules {
  /** The store's public read URL (its CloudFront distribution). Null until the store stack is deployed. */
  storeUrl: string | null;
  /** The bucket writers upload to. Null means: read it from the stack's outputs. */
  bucket: string | null;
  /** The CloudFormation stack infra/asset-store.yaml was deployed as. */
  stack: string;
  region: string;
  /** True once `assets:migrate --untrack` has taken the media out of git; arms `assets:verify`'s git check. */
  untracked: boolean;
}

export function loadConfig(root: string): AssetConfig {
  const raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), "utf8")) as Partial<AssetConfig>;
  const config: AssetConfig = {
    storeUrl: raw.storeUrl ?? null,
    bucket: raw.bucket ?? null,
    stack: raw.stack ?? "kad-asset-store",
    region: raw.region ?? "us-east-1",
    untracked: raw.untracked ?? false,
    roots: raw.roots ?? [],
    extensions: (raw.extensions ?? []).map((e) => e.toLowerCase()),
    exclude: raw.exclude ?? [],
  };
  // The environment wins, so a fork, a trial store or a test can point elsewhere without an edit.
  if (process.env.KAD_ASSET_STORE_URL) config.storeUrl = process.env.KAD_ASSET_STORE_URL;
  if (process.env.KAD_ASSET_BUCKET) config.bucket = process.env.KAD_ASSET_BUCKET;
  return config;
}

/** Rewrite one key of assets.config.json, keeping the rest of the file (and its comments) as written. */
export function setConfigValue(root: string, key: keyof AssetConfig, value: unknown): void {
  const file = path.join(root, CONFIG_FILE);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  raw[key] = value;
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
}

export function lockPath(root: string): string {
  return path.join(root, LOCK_FILE);
}

/** The lock, or an empty one when this commit predates the store. */
export function loadLock(root: string): AssetLock {
  const file = lockPath(root);
  return fs.existsSync(file) ? parseLock(fs.readFileSync(file, "utf8")) : emptyLock();
}

export function hasLock(root: string): boolean {
  return fs.existsSync(lockPath(root));
}

export function saveLock(root: string, lock: AssetLock): void {
  fs.writeFileSync(lockPath(root), serializeLock(lock));
}

// ---------------------------------------------------------------------------
// The stat cache: `.assets/state.json`, gitignored, one per checkout.
//
// Two jobs. It skips re-hashing two gigabytes on every `status` (a file whose
// size and mtime match what was hashed is not hashed again), and it remembers
// which version of each file this checkout last pulled or pushed, which is how
// `pull` tells "deleted upstream, safe to remove" from "your new painting".
// ---------------------------------------------------------------------------

export interface StatRecord extends LockEntry {
  mtimeMs: number;
  /** The sha256 this checkout last pulled or pushed for the path, if any. */
  synced?: string;
}

export interface State {
  files: Record<string, StatRecord>;
}

function statePath(root: string): string {
  return path.join(root, ".assets", "state.json");
}

export function loadState(root: string): State {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(root), "utf8")) as State;
    return { files: raw.files ?? {} };
  } catch {
    return { files: {} };
  }
}

export function saveState(root: string, state: State): void {
  const file = statePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
}

/** The file's hash, from the stat cache when size and mtime say it has not changed. Null when there is no file. */
export async function hashOnDisk(root: string, rel: string, state: State): Promise<LockEntry | null> {
  const full = path.join(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const known = state.files[rel];
  if (known && known.bytes === stat.size && known.mtimeMs === stat.mtimeMs) return { sha256: known.sha256, bytes: known.bytes };
  const entry = await hashFile(full);
  state.files[rel] = { ...entry, mtimeMs: stat.mtimeMs, ...(known?.synced ? { synced: known.synced } : {}) };
  return entry;
}

/** Record that this checkout now has exactly the store's version of a path. */
export function markSynced(root: string, rel: string, entry: LockEntry, state: State): void {
  const stat = fs.statSync(path.join(root, rel));
  state.files[rel] = { ...entry, mtimeMs: stat.mtimeMs, synced: entry.sha256 };
}

/** Every file on disk under the rules' roots with a managed extension, repo-relative, sorted. */
export function scanDisk(root: string, rules: AssetRules): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel);
      else if (entry.isFile() && matchesRules(childRel, rules)) out.push(childRel);
    }
  };
  for (const r of rules.roots) walk(path.join(root, r), r.replace(/\/+$/, ""));
  return out.sort();
}

export function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input });
}

/** Files git tracks that the rules manage: what must not be in git once the store has them. */
export function trackedMedia(root: string, rules: AssetRules): string[] {
  return git(root, ["ls-files", "-z", "--", ...rules.roots])
    .split("\0")
    .filter((p) => p && matchesRules(p, rules))
    .sort();
}

/** Run `work` over `items` with at most `limit` in flight. Rejects with the first error after the rest settle. */
export async function pool<T>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await work(items[i]!, i);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.all(runners);
  if (firstError !== null) throw firstError;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** A progress line every so often, for runs over thousands of files; quiet under a test. */
export function progress(label: string, total: number): (done: number) => void {
  const step = Math.max(50, Math.ceil(total / 20));
  return (done: number) => {
    if (process.env.VITEST) return;
    if (done === total || done % step === 0) process.stderr.write(`  ${label} ${done}/${total}\n`);
  };
}
