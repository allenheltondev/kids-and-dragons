/**
 * The asset store's commands (docs/asset-store.md). Each takes the repo root and
 * returns what it found or did, so the tests drive them in process against a
 * temporary repo and a folder store; tools/assets/cli.ts is only argument parsing.
 *
 * The working tree is reconciled against the lock with three states per path,
 * the same way git reconciles against the index:
 *
 *   lock     what this commit says belongs at the path
 *   disk     what is in the working tree now
 *   synced   what this checkout last pulled or pushed for it (.assets/state.json)
 *
 * so `pull` replaces only what it put there itself, and never a painting an
 * agent has just made and not pushed.
 */

import fs from "node:fs";
import path from "node:path";
import { cachedBlobPath, defaultCacheDir, ensureCached, hashBytes, writeAtomic } from "../../packages/shared/src/asset-cache.ts";
import {
  LOCK_FILE,
  blobKey,
  blobUrl,
  contentTypeFor,
  filterRepoArgs,
  ignoreBlock,
  isPushCandidate,
  matchesRules,
  parseLock,
  serializeLock,
  underAny,
  type AssetLock,
  type LockEntry,
} from "../../packages/shared/src/asset-store.ts";
import {
  formatBytes,
  git,
  hasLock,
  hashOnDisk,
  loadConfig,
  loadLock,
  loadState,
  lockPath,
  markSynced,
  pool,
  progress,
  saveLock,
  saveState,
  scanDisk,
  setConfigValue,
  trackedMedia,
  type AssetConfig,
  type State,
} from "./lib.ts";
import type { BlobStore } from "./stores.ts";

export type Log = (line: string) => void;
const quiet: Log = () => {};

const CONCURRENCY = 16;

function normalize(arg: string): string {
  return arg.replace(/^\.\//, "").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export interface StatusResult {
  /** In the lock, on disk, the right bytes. */
  ok: string[];
  /** In the lock, not on disk, never had here: `pull` fetches it. */
  missing: string[];
  /** On disk as last pulled, but the lock has moved on: `pull` updates it. */
  stale: string[];
  /** Changed here since it was last pulled or pushed: `push` uploads it. */
  modified: string[];
  /** On disk, not in the lock, a file `push` would pick up. */
  added: string[];
  /** Pulled or pushed here once, now deleted from disk, still in the lock: `push --prune` records the deletion. */
  deleted: string[];
  /** Not in the lock, still on disk exactly as last synced: the lock dropped it, and `pull` removes it. */
  dropped: string[];
}

export async function status(root: string, prefixes: string[] = [], state: State = loadState(root)): Promise<StatusResult> {
  const config = loadConfig(root);
  const lock = loadLock(root);
  const result: StatusResult = { ok: [], missing: [], stale: [], modified: [], added: [], deleted: [], dropped: [] };
  const lockPaths = Object.keys(lock.files).filter((p) => underAny(p, prefixes)).sort();
  const disk = await hashAll(root, lockPaths, state);
  for (const p of lockPaths) {
    const want = lock.files[p]!;
    const have = disk.get(p) ?? null;
    const synced = state.files[p]?.synced;
    if (have === null) (synced ? result.deleted : result.missing).push(p);
    else if (have.sha256 === want.sha256) result.ok.push(p);
    else if (synced && have.sha256 === synced) result.stale.push(p);
    else result.modified.push(p);
  }
  const extras = scanDisk(root, config).filter((p) => !(p in lock.files) && underAny(p, prefixes));
  const extraHashes = await hashAll(root, extras, state);
  for (const p of extras) {
    const synced = state.files[p]?.synced;
    if (synced && extraHashes.get(p)?.sha256 === synced) result.dropped.push(p);
    else if (isPushCandidate(p, config) || namedExplicitly(p, prefixes, config)) result.added.push(p);
  }
  return result;
}

/** A file under an `exclude` prefix (generated output) counts as new only when the command named it, or a folder holding it. */
function namedExplicitly(p: string, prefixes: string[], config: AssetConfig): boolean {
  return prefixes.some((raw) => {
    const arg = normalize(raw);
    if (!(p === arg || p.startsWith(`${arg}/`))) return false;
    return (config.exclude ?? []).some((ex) => `${arg}/`.startsWith(ex) || arg === ex.replace(/\/+$/, ""));
  });
}

async function hashAll(root: string, paths: string[], state: State): Promise<Map<string, LockEntry | null>> {
  const out = new Map<string, LockEntry | null>();
  await pool(paths, CONCURRENCY, async (p) => {
    out.set(p, await hashOnDisk(root, p, state));
  });
  return out;
}

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

export interface PullOptions {
  prefixes?: string[];
  /** Replace local changes too, as a fresh checkout would. */
  force?: boolean;
  cacheDir?: string;
  log?: Log;
}

export interface PullResult {
  fetched: string[];
  updated: string[];
  removed: string[];
  /** Local changes left alone (push them, or pull --force). */
  kept: string[];
  bytesDownloaded: number;
}

/**
 * Make the working tree match the lock: fetch what is missing, update what is
 * stale, remove what the lock dropped, and leave local changes alone unless
 * `force`. Needs no credentials: it reads the store's public URL.
 */
export async function pull(root: string, options: PullOptions = {}): Promise<PullResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  const prefixes = options.prefixes ?? [];
  const result: PullResult = { fetched: [], updated: [], removed: [], kept: [], bytesDownloaded: 0 };
  if (!hasLock(root)) {
    log(`No ${LOCK_FILE}: this commit keeps its art in git. Nothing to pull.`);
    return result;
  }
  const lock = loadLock(root);
  if (!config.storeUrl) throw new Error(`assets.config.json has no storeUrl (or set KAD_ASSET_STORE_URL). See docs/asset-store.md, "Standing the store up".`);
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const state = loadState(root);
  const s = await status(root, prefixes, state);

  for (const p of s.ok) markSynced(root, p, lock.files[p]!, state);
  for (const p of s.dropped) {
    fs.rmSync(path.join(root, p));
    delete state.files[p];
    result.removed.push(p);
  }

  const toWrite = [...s.missing, ...s.stale, ...(options.force ? [...s.modified, ...s.deleted] : [])];
  result.kept = [...(options.force ? [] : s.modified)];
  // A deletion not yet pushed is a local change too: kept unless forced.
  if (!options.force) result.kept.push(...s.deleted);

  const tick = progress("pulled", toWrite.length);
  let done = 0;
  await pool(toWrite, CONCURRENCY, async (p) => {
    const entry = lock.files[p]!;
    const had = fs.existsSync(cachedBlobPath(cacheDir, entry.sha256));
    const cached = await ensureCached(config.storeUrl!, cacheDir, p, entry);
    if (!had) result.bytesDownloaded += entry.bytes;
    const target = path.join(root, p);
    const existed = fs.existsSync(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(cached, target);
    markSynced(root, p, entry, state);
    (existed ? result.updated : result.fetched).push(p);
    tick(++done);
  });
  saveState(root, state);

  log(
    `pull: ${result.fetched.length} fetched, ${result.updated.length} updated, ${result.removed.length} removed, ` +
      `${s.ok.length} already current (${formatBytes(result.bytesDownloaded)} downloaded)`,
  );
  if (result.kept.length > 0) {
    log(`  ${result.kept.length} local change(s) left alone; npm run assets:push to keep them, or pull --force to drop them:`);
    for (const p of result.kept.slice(0, 20)) log(`    ${p}`);
    if (result.kept.length > 20) log(`    … and ${result.kept.length - 20} more`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// push (and migrate, which is a push of everything git tracks)
// ---------------------------------------------------------------------------

export interface PushOptions {
  prefixes?: string[];
  /** Remove lock entries for deleted files under `prefixes` (which are then required). */
  prune?: boolean;
  dryRun?: boolean;
  cacheDir?: string;
  log?: Log;
  /** Push exactly these files, whatever status says: migrate's whole tracked set. */
  files?: string[];
}

export interface PushResult {
  /** Paths whose lock entry was added or changed. */
  recorded: string[];
  /** Blobs written to the store (a blob already there is recorded but not uploaded). */
  uploaded: string[];
  pruned: string[];
  bytesUploaded: number;
}

/**
 * Upload new and changed media to the store and record them in the lock. The
 * lock is written only after every upload it names has succeeded, so a lock in
 * a commit never points at a blob nobody stored.
 */
export async function push(root: string, store: BlobStore, options: PushOptions = {}): Promise<PushResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  const prefixes = options.prefixes ?? [];
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  if (options.prune && prefixes.length === 0) {
    throw new Error("push --prune needs the folders or files whose deletions to record (e.g. --prune assets/cast/old-goblin), so a partial pull can never empty the lock.");
  }
  const state = loadState(root);
  const lock = loadLock(root);
  const result: PushResult = { recorded: [], uploaded: [], pruned: [], bytesUploaded: 0 };

  let targets: string[];
  if (options.files) {
    targets = options.files;
  } else {
    for (const arg of prefixes) {
      const p = normalize(arg);
      const full = path.join(root, p);
      if (fs.existsSync(full) && fs.statSync(full).isFile() && !matchesRules(p, config)) {
        throw new Error(`${p} is not a file the store manages (assets.config.json: roots ${config.roots.join(", ")}; extensions ${config.extensions.join(", ")}).`);
      }
    }
    const s = await status(root, prefixes, state);
    targets = [...s.modified, ...s.added];
    if (s.stale.length > 0) log(`  ${s.stale.length} file(s) are older than the lock (run npm run assets:pull); not pushed.`);
    if (options.prune) {
      for (const p of [...s.deleted, ...s.missing]) {
        if (!options.dryRun) delete lock.files[p];
        delete state.files[p];
        result.pruned.push(p);
      }
    } else if (s.deleted.length > 0) {
      log(`  ${s.deleted.length} deleted file(s) are still in the lock; record the deletion with push --prune <folder>:`);
      for (const p of s.deleted.slice(0, 10)) log(`    ${p}`);
    }
  }

  const tick = progress("pushed", targets.length);
  let done = 0;
  await pool(targets, CONCURRENCY, async (p) => {
    const full = path.join(root, p);
    const bytes = new Uint8Array(fs.readFileSync(full));
    const entry: LockEntry = { sha256: hashBytes(bytes), bytes: bytes.length };
    const key = blobKey(entry.sha256, p);
    if (!options.dryRun) {
      if (!(await store.has(key))) {
        if (await store.put(key, bytes, contentTypeFor(p), p)) {
          result.uploaded.push(p);
          result.bytesUploaded += bytes.length;
        }
      }
      // This machine's cache has it now too, so another worktree's pull is free.
      const cached = cachedBlobPath(cacheDir, entry.sha256);
      if (!fs.existsSync(cached)) writeAtomic(cached, bytes);
      lock.files[p] = entry;
      markSynced(root, p, entry, state);
    }
    result.recorded.push(p);
    tick(++done);
  });
  result.recorded.sort();
  result.uploaded.sort();

  if (!options.dryRun && (result.recorded.length > 0 || result.pruned.length > 0 || !hasLock(root))) saveLock(root, lock);
  saveState(root, state);
  const verb = options.dryRun ? "would record" : "recorded";
  log(
    `push: ${verb} ${result.recorded.length} file(s) in ${LOCK_FILE}, uploaded ${result.uploaded.length} to ${store.name} ` +
      `(${formatBytes(result.bytesUploaded)})${result.pruned.length ? `, pruned ${result.pruned.length}` : ""}`,
  );
  if (!options.dryRun && (result.recorded.length > 0 || result.pruned.length > 0)) log(`  Commit ${LOCK_FILE} with the change that uses them.`);
  return result;
}

export interface MigrateOptions {
  dryRun?: boolean;
  cacheDir?: string;
  log?: Log;
}

/**
 * Step one of the cutover: every media file git tracks under the rules goes to
 * the store and into the lock. Re-runnable; a blob already stored is skipped.
 * Nothing leaves git until `untrack`.
 */
export async function migrate(root: string, store: BlobStore, options: MigrateOptions = {}): Promise<PushResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  if (config.untracked) throw new Error("This repo is already migrated (assets.config.json untracked: true). New art goes up with npm run assets:push.");
  const files = trackedMedia(root, config);
  const total = files.reduce((sum, p) => sum + fs.statSync(path.join(root, p)).size, 0);
  log(`migrate: ${files.length} tracked media file(s), ${formatBytes(total)}, to ${store.name}`);
  return push(root, store, { files, dryRun: options.dryRun, cacheDir: options.cacheDir, log });
}

const IGNORE_START = "# >>> asset store: media live in S3 (assets.config.json, docs/asset-store.md). Written by assets:migrate --untrack.";
const IGNORE_END = "# <<< asset store";

export interface UntrackResult {
  untracked: string[];
}

/**
 * Step two of the cutover, once the store has everything: take the media out of
 * the git index (they stay on disk), ignore them from now on, and arm the
 * guards. Refuses unless every tracked media file is in the lock with the same
 * bytes and every lock entry can be fetched from the public store URL, which
 * is the URL every fresh clone, CI job and deploy will pull from.
 */
export async function untrack(root: string, options: { log?: Log } = {}): Promise<UntrackResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  if (!config.storeUrl) throw new Error("Set storeUrl in assets.config.json first (the store stack's StoreUrl output): untrack proves every file can be pulled from it.");
  const lock = loadLock(root);
  const tracked = trackedMedia(root, config);
  const state = loadState(root);
  const problems: string[] = [];
  for (const p of tracked) {
    const want = lock.files[p];
    const have = await hashOnDisk(root, p, state);
    if (!want) problems.push(`${p}: tracked by git but not in ${LOCK_FILE}`);
    else if (!have || have.sha256 !== want.sha256) problems.push(`${p}: changed since it was migrated`);
  }
  saveState(root, state);
  if (problems.length > 0) throw new Error(`Run npm run assets:migrate again first:\n  ${problems.slice(0, 20).join("\n  ")}`);
  const missing = await missingFromStore(config.storeUrl, lock);
  if (missing.length > 0) throw new Error(`The store at ${config.storeUrl} cannot serve ${missing.length} file(s) in the lock, e.g. ${missing[0]}. Push them before untracking.`);

  if (tracked.length > 0) git(root, ["rm", "--cached", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul"], tracked.join("\0"));
  writeIgnoreBlock(root, config);
  setConfigValue(root, "untracked", true);
  log(`untrack: ${tracked.length} file(s) taken out of git and ignored; they stay on disk.`);
  log(`  Next: git add .gitignore assets.config.json ${LOCK_FILE} && git commit, then see docs/asset-store.md, "Rewriting history".`);
  return { untracked: tracked };
}

export function writeIgnoreBlock(root: string, config: AssetConfig): void {
  const file = path.join(root, ".gitignore");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const block = [IGNORE_START, ...ignoreBlock(config), IGNORE_END].join("\n");
  const start = text.indexOf(IGNORE_START);
  const end = text.indexOf(IGNORE_END);
  const next =
    start >= 0 && end > start
      ? `${text.slice(0, start)}${block}${text.slice(end + IGNORE_END.length)}`
      : `${text.replace(/\n*$/, "\n")}\n${block}\n`;
  fs.writeFileSync(file, next);
}

export function readIgnoreBlock(root: string): string[] | null {
  const file = path.join(root, ".gitignore");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf(IGNORE_START);
  const end = text.indexOf(IGNORE_END);
  if (start < 0 || end < start) return null;
  return text.slice(start + IGNORE_START.length, end).split("\n").map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** Whether the store's public URL answers for a key. HEAD, so nothing is downloaded. */
export async function storeHas(storeUrl: string, key: string): Promise<boolean> {
  const base = storeUrl.replace(/\/+$/, "");
  if (base.startsWith("file://")) return fs.existsSync(path.join(new URL(base).pathname, key));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${base}/${key}`, { method: "HEAD" });
      if (res.ok) return true;
      if (res.status === 404 || res.status === 403) return false;
      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

async function missingFromStore(storeUrl: string, lock: AssetLock, only?: Set<string>): Promise<string[]> {
  // One request per blob, not per path: the same bytes at two paths are one object.
  const byKey = new Map<string, string>();
  for (const [p, entry] of Object.entries(lock.files)) {
    if (only && !only.has(p)) continue;
    const key = blobKey(entry.sha256, p);
    if (!byKey.has(key)) byKey.set(key, p);
  }
  const missing: string[] = [];
  await pool([...byKey], 32, async ([key, p]) => {
    if (!(await storeHas(storeUrl, key))) missing.push(p);
  });
  return missing.sort();
}

export interface VerifyOptions {
  /** Check every lock entry can be fetched from the store (default: when a storeUrl is configured). */
  store?: boolean;
  /** Only check these lock paths against the store (e.g. those a pull request changed). */
  storePaths?: string[];
  /** Require every lock entry under these prefixes on disk, with the right bytes. */
  present?: string[];
  log?: Log;
}

export interface VerifyResult {
  problems: string[];
}

/**
 * The gate (CI's checks job, and deploy.sh before it uploads the art):
 *  - the lock parses and is in canonical form, so a hand edit or a botched
 *    merge cannot slip through;
 *  - once untracked, no managed media is committed to git, and the ignore block
 *    matches the rules;
 *  - every blob the lock names is in the store (a lock pointing at art nobody
 *    uploaded would deploy holes);
 *  - with `present`, the working tree holds exactly the lock's bytes there,
 *    which is what deploy.sh checks before it syncs `assets/` with --delete.
 */
export async function verify(root: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  const problems: string[] = [];
  let lock: AssetLock | null = null;

  if (hasLock(root)) {
    const text = fs.readFileSync(lockPath(root), "utf8");
    try {
      lock = parseLock(text);
      if (serializeLock(lock) !== text) problems.push(`${LOCK_FILE} is not in canonical form (unsorted, hand-edited, or a merge left it so). Rewrite it with npm run assets:push.`);
      for (const p of Object.keys(lock.files)) {
        if (!matchesRules(p, config)) problems.push(`${LOCK_FILE}: ${p} is outside assets.config.json's roots and extensions`);
      }
    } catch (error) {
      problems.push((error as Error).message);
    }
  } else if (config.untracked) {
    problems.push(`assets.config.json says the media are out of git, but there is no ${LOCK_FILE}.`);
  }

  if (config.untracked) {
    const tracked = trackedMedia(root, config);
    for (const p of tracked.slice(0, 20)) problems.push(`${p} is committed to git; media go to the store: npm run assets:push, then git rm --cached ${p}`);
    if (tracked.length > 20) problems.push(`… and ${tracked.length - 20} more media files committed to git`);
    const block = readIgnoreBlock(root);
    const want = ignoreBlock(config);
    if (block === null || block.join("\n") !== want.join("\n")) problems.push(".gitignore's asset-store block is missing or does not match assets.config.json (npm run assets:verify -- --fix-ignore)");
  }

  const checkStore = options.store ?? config.storeUrl !== null;
  if (checkStore && lock) {
    if (!config.storeUrl) problems.push("assets.config.json has no storeUrl to check the store against");
    else {
      const only = options.storePaths ? new Set(options.storePaths) : undefined;
      const missing = await missingFromStore(config.storeUrl, lock, only);
      for (const p of missing.slice(0, 20)) problems.push(`${p}: in ${LOCK_FILE} but not in the store (${blobKey(lock.files[p]!.sha256, p)}); push it with npm run assets:push`);
      if (missing.length > 20) problems.push(`… and ${missing.length - 20} more missing from the store`);
    }
  }

  if (options.present && options.present.length > 0) {
    if (!lock) {
      // A commit from before the store keeps its art in git; there is nothing to compare.
    } else {
      const state = loadState(root);
      const paths = Object.keys(lock.files).filter((p) => underAny(p, options.present!));
      const disk = await hashAll(root, paths, state);
      saveState(root, state);
      const wrong = paths.filter((p) => disk.get(p)?.sha256 !== lock!.files[p]!.sha256).sort();
      for (const p of wrong.slice(0, 20)) problems.push(`${p}: ${disk.get(p) ? "differs from" : "missing; expected"} ${LOCK_FILE} (npm run assets:pull -- ${options.present.join(" ")})`);
      if (wrong.length > 20) problems.push(`… and ${wrong.length - 20} more not as the lock says`);
    }
  }

  if (problems.length === 0) log(`assets:verify: ok${lock ? ` (${Object.keys(lock.files).length} files in ${LOCK_FILE})` : ` (no ${LOCK_FILE}; media still in git)`}`);
  else for (const p of problems) log(`  FAIL  ${p}`);
  return { problems };
}

// ---------------------------------------------------------------------------
// url, history
// ---------------------------------------------------------------------------

/** The public store URL of a path's bytes as the lock has them: for a review doc, a PR comment, a chat. */
export function urlFor(root: string, p: string): string {
  const config = loadConfig(root);
  const lock = loadLock(root);
  const entry = lock.files[normalize(p)];
  if (!entry) throw new Error(`${p} is not in ${LOCK_FILE} (push it first: npm run assets:push -- ${p})`);
  if (!config.storeUrl) throw new Error("assets.config.json has no storeUrl");
  return blobUrl(config.storeUrl, entry.sha256, p);
}

/** The command that drops every managed file from history, for after the cutover. */
export function filterRepoCommand(root: string): string {
  const args = filterRepoArgs(loadConfig(root));
  return `git filter-repo ${args.map((a) => (a.startsWith("--") ? a : `'${a}'`)).join(" ")}`;
}

export interface HistoryChange {
  commit: string;
  date: string;
  path: string;
  /** Null for a deletion. */
  sha256: string | null;
  bytes: number;
}

export interface ArchiveResult {
  changes: HistoryChange[];
  uploaded: number;
  file: string;
}

/**
 * Before the rewrite: every version of every managed file in history goes to
 * the store, and a change log (commit, date, path → sha256) goes beside it at
 * `history/<stamp>.json` and in `.assets/`. With git filter-repo's commit-map,
 * that is enough to rebuild any old commit's art after its blobs have left git.
 * Needs a full clone (not shallow) to be complete.
 */
export async function archiveHistory(root: string, store: BlobStore, options: { log?: Log; dryRun?: boolean } = {}): Promise<ArchiveResult> {
  const log = options.log ?? quiet;
  const config = loadConfig(root);
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    log("  warning: this clone is shallow, so the archive covers only the history it has. git fetch --unshallow first for all of it.");
  }
  const raw = git(root, ["log", "--all", "--raw", "--no-abbrev", "--no-renames", "--format=@@%H %cI", "--", ...config.roots]);
  const changes: Array<Omit<HistoryChange, "sha256" | "bytes"> & { blob: string | null }> = [];
  let commit = "";
  let date = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      [commit, date] = line.slice(2).split(" ") as [string, string];
      continue;
    }
    const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) ([A-Z])\d*\t(.+)$/.exec(line);
    if (!m) continue;
    const [, blob, kind, file] = m as unknown as [string, string, string, string];
    if (!matchesRules(file, config)) continue;
    changes.push({ commit, date, path: file, blob: kind === "D" ? null : blob });
  }
  const blobs = [...new Set(changes.map((c) => c.blob).filter((b): b is string => b !== null))];
  log(`archive-history: ${changes.length} change(s) to managed files, ${blobs.length} distinct blob(s)`);

  const info = new Map<string, LockEntry>();
  let uploaded = 0;
  const tick = progress("archived", blobs.length);
  let done = 0;
  // One `git cat-file` per blob keeps memory flat; paintings are megabytes, not gigabytes.
  await pool(blobs, 8, async (blob) => {
    const bytes = await catBlob(root, blob);
    const entry = { sha256: hashBytes(bytes), bytes: bytes.length };
    info.set(blob, entry);
    const sample = changes.find((c) => c.blob === blob)!.path;
    const key = blobKey(entry.sha256, sample);
    if (!options.dryRun && !(await store.has(key)) && (await store.put(key, bytes, contentTypeFor(sample)))) uploaded++;
    tick(++done);
  });

  const out: HistoryChange[] = changes.map((c) => ({
    commit: c.commit,
    date: c.date,
    path: c.path,
    sha256: c.blob ? info.get(c.blob)!.sha256 : null,
    bytes: c.blob ? info.get(c.blob)!.bytes : 0,
  }));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const body = new TextEncoder().encode(`${JSON.stringify({ head: git(root, ["rev-parse", "HEAD"]).trim(), changes: out }, null, 1)}\n`);
  const file = path.join(root, ".assets", `history-${stamp}.json`);
  if (!options.dryRun) {
    writeAtomic(file, body);
    await store.put(`history/${stamp}.json`, body, "application/json");
  }
  log(`  uploaded ${uploaded} blob(s); change log at ${path.relative(root, file)} and history/${stamp}.json in the store`);
  return { changes: out, uploaded, file };
}

async function catBlob(root: string, blob: string): Promise<Uint8Array> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile("git", ["cat-file", "blob", blob], { cwd: root, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(new Uint8Array(stdout));
    });
  });
}

