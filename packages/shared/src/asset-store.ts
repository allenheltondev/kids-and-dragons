/**
 * The asset store: where the art and audio live once they are out of git
 * (docs/asset-store.md).
 *
 * The bytes live in S3, content-addressed: a file is `sha256/<hh>/<sha256>.<ext>`
 * in the store bucket, written once and never replaced. Git keeps only
 * `assets.lock.json`, which says which bytes sit at which path in this commit:
 *
 *     "assets/cast/pib/assembled.png": { "sha256": "…", "bytes": 81234 }
 *
 * so a commit still names exactly the art it shipped with, a diff still says
 * which picture changed, and checking out an old commit and pulling gives back
 * that commit's art.
 *
 * The one place that knows the layout, so the CLI that uploads (tools/assets),
 * the dev server that falls back to the store, and the git merge driver cannot
 * disagree. Pure: strings in, strings out. Node-free, so plain `node` can run
 * the tools that import it with no dependencies installed.
 */

export const LOCK_FILE = "assets.lock.json";
export const CONFIG_FILE = "assets.config.json";

/** A key names its bytes, so a blob never changes: cache it for a year. */
export const BLOB_CACHE_CONTROL = "public,max-age=31536000,immutable";

/** The store's prefix for blobs. Everything under it is immutable and public through the store's CDN. */
export const BLOB_PREFIX = "sha256";

export interface LockEntry {
  /** Hex SHA-256 of the file's bytes: the blob's name in the store. */
  sha256: string;
  bytes: number;
}

export interface AssetLock {
  version: 1;
  /** Repo-relative path, forward slashes → the bytes that belong there. */
  files: Record<string, LockEntry>;
}

/** Which files the store manages, from assets.config.json. */
export interface AssetRules {
  /** Top-level folders whose media live in the store. */
  roots: string[];
  /** Lower-case extensions, no dot. */
  extensions: string[];
  /**
   * Prefixes under a root that hold generated output (contact sheets, shots).
   * A *new* file there is not picked up by `assets:push` unless named; one
   * already in the lock is managed like any other.
   */
  exclude?: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}

/** The lower-case extension of a path, without the dot ("" for none). */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * The store key for a file's bytes: `sha256/ab/abcdef….png`. The extension is
 * there for people and browsers reading the store; the hash alone is the identity.
 */
export function blobKey(sha256: string, path: string): string {
  if (!isSha256(sha256)) throw new Error(`not a sha256: ${sha256}`);
  const ext = extensionOf(path);
  return `${BLOB_PREFIX}/${sha256.slice(0, 2)}/${sha256}${ext ? `.${ext}` : ""}`;
}

/** The public URL of a blob, given the store's base URL (no trailing slash needed). */
export function blobUrl(storeUrl: string, sha256: string, path: string): string {
  return `${storeUrl.replace(/\/+$/, "")}/${blobKey(sha256, path)}`;
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  webm: "audio/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

/** Whether a path is under one of the rules' roots and has one of their extensions. */
export function matchesRules(path: string, rules: AssetRules): boolean {
  if (!rules.roots.some((root) => path.startsWith(`${root.replace(/\/+$/, "")}/`))) return false;
  return rules.extensions.includes(extensionOf(path));
}

/** Whether a new file at this path should be picked up without being named: matches, and is not generated output. */
export function isPushCandidate(path: string, rules: AssetRules): boolean {
  return matchesRules(path, rules) && !(rules.exclude ?? []).some((prefix) => path.startsWith(prefix));
}

/** Whether a path is at or under one of the prefixes ("assets", "assets/cast/", or an exact file). None means everything. */
export function underAny(path: string, prefixes: readonly string[]): boolean {
  if (prefixes.length === 0) return true;
  return prefixes.some((raw) => {
    const prefix = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
  });
}

export function emptyLock(): AssetLock {
  return { version: 1, files: {} };
}

/** Read a lock, refusing anything malformed rather than guessing at it. */
export function parseLock(text: string): AssetLock {
  const raw = JSON.parse(text) as { version?: unknown; files?: unknown };
  if (raw.version !== 1) throw new Error(`${LOCK_FILE}: unknown version ${String(raw.version)}`);
  if (typeof raw.files !== "object" || raw.files === null) throw new Error(`${LOCK_FILE}: no "files"`);
  const files: Record<string, LockEntry> = {};
  for (const [path, value] of Object.entries(raw.files as Record<string, unknown>)) {
    const entry = value as { sha256?: unknown; bytes?: unknown };
    if (typeof entry.sha256 !== "string" || !isSha256(entry.sha256)) throw new Error(`${LOCK_FILE}: ${path} has no valid sha256`);
    if (typeof entry.bytes !== "number" || !Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error(`${LOCK_FILE}: ${path} has no valid byte count`);
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error(`${LOCK_FILE}: ${path} is not a plain repo-relative path`);
    files[path] = { sha256: entry.sha256, bytes: entry.bytes };
  }
  return { version: 1, files };
}

/**
 * One entry per line, sorted by path, so a diff shows exactly which files
 * changed, and two branches adding art in different folders merge cleanly.
 * The output is canonical: `serializeLock(parseLock(x)) === x` for any lock
 * this wrote, which `assets:verify` checks.
 */
export function serializeLock(lock: AssetLock): string {
  const paths = Object.keys(lock.files).sort(comparePaths);
  const lines = paths.map((path, i) => {
    const entry = lock.files[path]!;
    const comma = i === paths.length - 1 ? "" : ",";
    return `    ${JSON.stringify(path)}: { "sha256": "${entry.sha256}", "bytes": ${entry.bytes} }${comma}`;
  });
  return `{\n  "version": 1,\n  "files": {${lines.length ? `\n${lines.join("\n")}\n  ` : ""}}\n}\n`;
}

/** Byte order, not locale order: the same on every machine. */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameEntry(a: LockEntry | undefined, b: LockEntry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.sha256 === b.sha256 && a.bytes === b.bytes;
}

export interface LockMerge {
  lock: AssetLock;
  /** Paths both sides changed differently. Ours is kept for each; the merge must not be committed as is. */
  conflicts: string[];
}

/**
 * A three-way merge by path, for the git merge driver: a path one side changed
 * takes that side; a path both changed the same way is fine; a path both
 * changed differently is a real conflict (two new paintings at one path).
 * Line-based merging would conflict on two pictures added in the same folder
 * on two branches, which is the ordinary case once several agents paint at once.
 */
export function mergeLocks(base: AssetLock, ours: AssetLock, theirs: AssetLock): LockMerge {
  const files: Record<string, LockEntry> = {};
  const conflicts: string[] = [];
  const paths = new Set([...Object.keys(base.files), ...Object.keys(ours.files), ...Object.keys(theirs.files)]);
  for (const path of paths) {
    const b = base.files[path];
    const o = ours.files[path];
    const t = theirs.files[path];
    let pick: LockEntry | undefined;
    if (sameEntry(o, t)) pick = o;
    else if (sameEntry(o, b)) pick = t;
    else if (sameEntry(t, b)) pick = o;
    else {
      conflicts.push(path);
      pick = o;
    }
    if (pick) files[path] = pick;
  }
  return { lock: { version: 1, files }, conflicts: conflicts.sort(comparePaths) };
}

/**
 * The .gitignore lines that keep managed media out of git once they live in the
 * store. Written by `assets:migrate --untrack`, checked by `assets:verify`.
 */
export function ignoreBlock(rules: AssetRules): string[] {
  const lines: string[] = [];
  for (const root of rules.roots) {
    for (const ext of rules.extensions) {
      lines.push(`/${root.replace(/\/+$/, "")}/**/*.${ext}`);
      lines.push(`/${root.replace(/\/+$/, "")}/**/*.${ext.toUpperCase()}`);
    }
  }
  return lines;
}

/**
 * The `git filter-repo` arguments that drop every managed file from history:
 * the step after the cutover (docs/asset-store.md, "Rewriting history").
 * Case-insensitive, like `matchesRules`.
 */
export function filterRepoArgs(rules: AssetRules): string[] {
  const roots = rules.roots.map((r) => r.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const exts = rules.extensions.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return ["--invert-paths", "--path-regex", `(?i)^(${roots})/.*\\.(${exts})$`];
}

// ---------------------------------------------------------------------------
// Provenance stamps (#732)
//
// Every blob is written with a few x-amz-meta-* headers saying who first put
// it there and why. They are part of the presigned URL's signature, so an
// uploader holding an MCP key can neither drop nor forge them.
//
// **Stamps are public.** The store's CDN returns an object's metadata with it,
// so a stamp holds only what the repository already shows: a key's label and
// agent, its tags, the repo path, an issue number, a time. Never an AWS
// identity, an email or a secret. And it names only the *first* uploader of
// some bytes, since a blob is written once; git (the lock's history and the
// prompt records) is the durable record of who used it where.
// ---------------------------------------------------------------------------

export interface BlobStamp {
  /** Who uploaded: an MCP key's label, or the operator's chosen name for an AWS write. */
  uploader: string;
  /** How: through the MCP server, or with AWS credentials. */
  via: "mcp" | "aws";
  /** The agent the key was minted for (e.g. "codex"), when it says. */
  agent?: string;
  /** The key's free-form tags. */
  tags?: Record<string, string>;
  /** The repo path the bytes were uploaded for. */
  path?: string;
  /** The art issue the upload was for. */
  issue?: number;
  /** ISO time of the upload. */
  at: string;
}

/** The metadata key names, without S3's `x-amz-meta-` prefix. */
export const STAMP_FIELDS = {
  uploader: "kad-uploader",
  via: "kad-via",
  agent: "kad-agent",
  tags: "kad-tags",
  path: "kad-path",
  issue: "kad-issue",
  at: "kad-at",
} as const;

/**
 * S3's limit on an object's user metadata: the UTF-8 bytes of every key and value together.
 * Counted here with the `x-amz-meta-` prefix on each key, which is stricter than S3 needs.
 */
export const STAMP_MAX_BYTES = 2048;

export class StampTooLargeError extends Error {}

/**
 * Header-safe, and never shortened: a stamp is written once and can never be repaired, so a
 * value is kept whole or the upload is refused (stampMetadata). Printable ASCII passes through
 * as it is, which keeps repo paths and key tags their own size; anything else (non-ASCII,
 * control characters) and `%` itself are percent-encoded as UTF-8, so `decodeURIComponent`
 * reads every value back exactly.
 */
export function stampValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x20 && code < 0x7f && ch !== "%" ? ch : encodeURIComponent(ch);
  }
  return out;
}

/** The bytes a stamp takes against STAMP_MAX_BYTES. */
export function stampBytes(metadata: Record<string, string>): number {
  const encoder = new TextEncoder();
  return Object.entries(metadata).reduce((sum, [k, v]) => sum + encoder.encode(`x-amz-meta-${k}`).length + encoder.encode(v).length, 0);
}

/**
 * The stamp as S3 object metadata (`Metadata` for the SDK; send each as `x-amz-meta-<name>`).
 * Throws StampTooLargeError rather than shorten anything.
 */
export function stampMetadata(stamp: BlobStamp): Record<string, string> {
  const out: Record<string, string> = {
    [STAMP_FIELDS.uploader]: stampValue(stamp.uploader),
    [STAMP_FIELDS.via]: stamp.via,
    [STAMP_FIELDS.at]: stampValue(stamp.at),
  };
  if (stamp.agent) out[STAMP_FIELDS.agent] = stampValue(stamp.agent);
  if (stamp.tags && Object.keys(stamp.tags).length > 0) {
    out[STAMP_FIELDS.tags] = stampValue(
      Object.keys(stamp.tags)
        .sort()
        .map((k) => `${k}=${stamp.tags![k]}`)
        .join(";"),
    );
  }
  if (stamp.path) out[STAMP_FIELDS.path] = stampValue(stamp.path);
  if (stamp.issue !== undefined) out[STAMP_FIELDS.issue] = String(stamp.issue);
  const bytes = stampBytes(out);
  if (bytes > STAMP_MAX_BYTES) {
    throw new StampTooLargeError(
      `the provenance stamp would be ${bytes} bytes, over S3's ${STAMP_MAX_BYTES}: shorten the path or the key's tags (a stamp is never cut short)`,
    );
  }
  return out;
}

/** A stamp back from metadata or response headers (either `kad-uploader` or `x-amz-meta-kad-uploader`). Null when unstamped. */
export function readStamp(get: (name: string) => string | null | undefined): BlobStamp | null {
  const field = (name: string): string | undefined => {
    const raw = get(name) ?? get(`x-amz-meta-${name}`);
    if (raw === null || raw === undefined || raw === "") return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const uploader = field(STAMP_FIELDS.uploader);
  if (!uploader) return null;
  const via = field(STAMP_FIELDS.via) === "mcp" ? "mcp" : "aws";
  const tagsText = field(STAMP_FIELDS.tags);
  const tags = tagsText
    ? Object.fromEntries(
        tagsText
          .split(";")
          .filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf("=");
            return eq < 0 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
          }),
      )
    : undefined;
  const issue = field(STAMP_FIELDS.issue);
  return {
    uploader,
    via,
    ...(field(STAMP_FIELDS.agent) ? { agent: field(STAMP_FIELDS.agent) } : {}),
    ...(tags ? { tags } : {}),
    ...(field(STAMP_FIELDS.path) ? { path: field(STAMP_FIELDS.path) } : {}),
    ...(issue && /^\d+$/.test(issue) ? { issue: Number(issue) } : {}),
    at: field(STAMP_FIELDS.at) ?? "",
  };
}
