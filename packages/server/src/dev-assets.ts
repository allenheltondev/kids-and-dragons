/**
 * The dev server's fallback to the asset store (docs/asset-store.md).
 *
 * `/assets/*` is served from the working tree, as in prod it is served from the
 * site bucket. Once the art lives in the store, a fresh clone has none of it on
 * disk until `npm run assets:pull`, so a request for a painting that is not
 * there is answered from the store instead: looked up in assets.lock.json,
 * fetched once into the machine's blob cache, and served from the same origin
 * (so a Pixi texture needs no CORS). A file on disk always wins, so a painting
 * an agent has just made shows at once, before it is pushed.
 *
 * Only for the real tree: with KAD_ASSETS_DIR pointing elsewhere, the lock does
 * not describe what is served, and nothing falls back.
 */

import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { CONFIG_FILE, LOCK_FILE, contentTypeFor, parseLock, type AssetLock } from "../../shared/src/asset-store.ts";
import { defaultCacheDir, ensureCached } from "../../shared/src/asset-cache.ts";

type Handler = (req: Request, res: Response, next: NextFunction) => void;

export function assetStoreFallback(repoRoot: string, assetsDir: string): Handler | null {
  if (path.resolve(assetsDir) !== path.resolve(repoRoot, "assets")) return null;
  const configFile = path.join(repoRoot, CONFIG_FILE);
  const lockFile = path.join(repoRoot, LOCK_FILE);
  if (!fs.existsSync(configFile)) return null;
  const config = JSON.parse(fs.readFileSync(configFile, "utf8")) as { storeUrl?: string | null };
  const storeUrl = process.env.KAD_ASSET_STORE_URL ?? config.storeUrl ?? null;
  if (!storeUrl) return null;
  const cacheDir = path.resolve(defaultCacheDir());

  // Re-read the lock when it changes (a git pull, an assets:push) without a restart.
  let lock: AssetLock | null = null;
  let lockMtime = -1;
  const currentLock = (): AssetLock | null => {
    try {
      const mtime = fs.statSync(lockFile).mtimeMs;
      if (mtime !== lockMtime) {
        lock = parseLock(fs.readFileSync(lockFile, "utf8"));
        lockMtime = mtime;
      }
    } catch {
      lock = null;
      lockMtime = -1;
    }
    return lock;
  };

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path).replace(/^\/+/, "");
    } catch {
      return next();
    }
    if (rel.split("/").includes("..")) return next();
    if (fs.existsSync(path.join(assetsDir, rel))) return next();
    const repoPath = `assets/${rel}`;
    const entry = currentLock()?.files[repoPath];
    if (!entry) return next();
    ensureCached(storeUrl, cacheDir, repoPath, entry).then(
      (cached) => {
        res.type(contentTypeFor(repoPath));
        // The cache lives under ~/.cache, which `send` would refuse as a dotfile path.
        res.sendFile(cached, { dotfiles: "allow" });
      },
      (error: unknown) => {
        console.warn(`[assets] ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
        next();
      },
    );
  };
}
