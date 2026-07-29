/**
 * Repo-root-relative paths.
 *
 * The dev server serves `assets/` and `content/` straight out of the working
 * tree (architecture §7 — dev is a laptop and three real devices on a LAN;
 * CloudFront + S3 serve the same two prefixes in prod, so client URLs are
 * identical in both). Resolving from `import.meta.url` rather than `cwd` means
 * `npm run dev:server` works from any directory.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** `<repo>/` — this file lives at `<repo>/packages/server/src/paths.ts`. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Overridable via env so a test (or a working tree whose content is still being
 * authored) can point at a different tree without touching code.
 */
export function contentDir(): string {
  return process.env.KAD_CONTENT_DIR ?? path.join(REPO_ROOT, "content");
}

export function assetsDir(): string {
  return process.env.KAD_ASSETS_DIR ?? path.join(REPO_ROOT, "assets");
}

/**
 * Local dev persistence lives in `.data/` (gitignored). A dev-server restart
 * must not lose the table — a character surviving `Ctrl-C` is the whole point
 * of persisting anything locally.
 */
export function dataDir(): string {
  return process.env.KAD_DATA_DIR ?? path.join(REPO_ROOT, ".data");
}
