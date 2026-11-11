/**
 * The local blob cache for the asset store (docs/asset-store.md): node-only, and
 * built-ins only, so `node tools/assets/cli.ts pull` runs in a ship-mode deploy
 * with no node_modules. Not exported from the package index; the client never
 * sees it.
 *
 * One cache per machine (`~/.cache/kad-assets`, or `KAD_ASSET_CACHE`), shared
 * by every checkout and worktree, keyed by hash. A blob is only ever written
 * after its bytes hash to its name, and written to a temporary file then
 * renamed, so a cache entry is either whole and right or absent.
 *
 * Files are *copied* out of the cache into the working tree, never linked: the
 * art tools rewrite paintings in place, and a hard link would let one of them
 * rewrite the cached copy every other checkout trusts.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blobKey, type LockEntry } from "./asset-store.ts";

export function defaultCacheDir(): string {
  if (process.env.KAD_ASSET_CACHE) return process.env.KAD_ASSET_CACHE;
  const xdg = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(xdg, "kad-assets");
}

export function cachedBlobPath(cacheDir: string, sha256: string): string {
  return path.join(cacheDir, "sha256", sha256.slice(0, 2), sha256);
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 and size of a file, streamed so a 40 MB painting is not held twice. */
export async function hashFile(file: string): Promise<LockEntry> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

/** Write bytes so that a reader sees either nothing or all of them. */
export function writeAtomic(file: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

/** Fetch one blob from the store's public URL (`https://…` or, for trials and tests, `file://…`). Null when the store has no such blob. */
export async function fetchStoreBlob(storeUrl: string, key: string): Promise<Uint8Array | null> {
  const base = storeUrl.replace(/\/+$/, "");
  if (base.startsWith("file://")) {
    const file = path.join(fileURLToPath(base), key);
    return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
  }
  const url = `${base}/${key}`;
  let lastError: unknown;
  // A few tries: a CI runner pulling two thousand files will meet a reset or two.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      // CloudFront in front of a private bucket answers 403 for a key that is not there.
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * The cached copy of a lock entry's bytes, fetched from the store if this
 * machine does not have it yet. Throws when the store lacks it or serves bytes
 * that do not hash to the entry: a lock pointing at a blob nobody uploaded is
 * a broken commit, and saying so beats serving a hole.
 */
export async function ensureCached(storeUrl: string, cacheDir: string, repoPath: string, entry: LockEntry): Promise<string> {
  const cached = cachedBlobPath(cacheDir, entry.sha256);
  if (fs.existsSync(cached)) return cached;
  const key = blobKey(entry.sha256, repoPath);
  const bytes = await fetchStoreBlob(storeUrl, key);
  if (bytes === null) throw new Error(`${repoPath}: the store has no ${key} (was it pushed? npm run assets:push)`);
  const got = hashBytes(bytes);
  if (got !== entry.sha256) throw new Error(`${repoPath}: the store served ${key} with sha256 ${got}`);
  writeAtomic(cached, bytes);
  return cached;
}
