/**
 * Where a painting came from (#732, docs/asset-store.md "Provenance"): one
 * answer joined from the three places that each know part of it.
 *
 *  - **git**: the commits that recorded these bytes at this path in
 *    assets.lock.json, and the pull request each came in by. The durable record.
 *  - **the prompt record**: the entry for this path in a `docs/*-prompts.json`
 *    (or `art/source/**`) file: the issue, the generator, the prompt, who
 *    uploaded it.
 *  - **the store's stamp**: who first put these bytes in the store, with which
 *    key and agent, for which issue (signed at upload, public with the blob).
 *
 * Any of the three can be missing (art from before the store has no stamp;
 * old art has no prompt record), and the answer says which.
 */

import fs from "node:fs";
import path from "node:path";
import { LOCK_FILE, blobKey, readStamp, type BlobStamp } from "../../packages/shared/src/asset-store.ts";
import { git, loadConfig, loadLock } from "./lib.ts";

export interface LockCommit {
  commit: string;
  date: string;
  subject: string;
  /** The pull request, from a squash-merge subject's "(#123)". */
  pr?: number;
}

export interface PromptRecord {
  file: string;
  entry: Record<string, unknown>;
}

export interface Provenance {
  path: string;
  sha256: string;
  key: string;
  /** Oldest first: the first is the commit that recorded these bytes here. */
  commits: LockCommit[];
  prompts: PromptRecord[];
  stamp: BlobStamp | null;
}

/** Read a blob's stamp from the store's public URL (HEAD), or from a folder store's sidecar. */
export async function storeStamp(storeUrl: string, key: string): Promise<BlobStamp | null> {
  const base = storeUrl.replace(/\/+$/, "");
  if (base.startsWith("file://")) {
    const sidecar = path.join(new URL(base).pathname, `${key}.stamp.json`);
    if (!fs.existsSync(sidecar)) return null;
    const meta = JSON.parse(fs.readFileSync(sidecar, "utf8")) as Record<string, string>;
    return readStamp((name) => meta[name]);
  }
  const res = await fetch(`${base}/${key}`, { method: "HEAD" });
  if (!res.ok) return null;
  return readStamp((name) => res.headers.get(name));
}

/** Every object, anywhere in a prompt-record JSON file, whose `path` is this path. */
export function findPromptRecords(root: string, repoPath: string): PromptRecord[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json") && (entry.name.includes("prompts") || full.includes(`${path.sep}art${path.sep}source${path.sep}`))) files.push(full);
    }
  };
  walk(path.join(root, "docs"));
  walk(path.join(root, "art", "source"));

  const found: PromptRecord[] = [];
  for (const file of files.sort()) {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (obj.path === repoPath || obj.path === `/${repoPath}`) found.push({ file: path.relative(root, file), entry: obj });
        Object.values(obj).forEach(visit);
      }
    };
    visit(data);
  }
  return found;
}

/** The commits that put exactly these bytes at exactly this path into the lock, oldest first. */
export function lockCommits(root: string, repoPath: string, sha256: string): LockCommit[] {
  // The lock's own line for it, exactly as serializeLock writes it: -S finds the commits
  // that added (or removed) that string, whichever branch they were made on.
  const line = `${JSON.stringify(repoPath)}: { "sha256": "${sha256}"`;
  const out = git(root, ["log", "--all", "--reverse", "--format=%H%x09%cI%x09%s", `-S${line}`, "--", LOCK_FILE]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [commit, date, ...rest] = row.split("\t") as [string, string, ...string[]];
      const subject = rest.join("\t");
      const pr = /\(#(\d+)\)\s*$/.exec(subject);
      return { commit, date, subject, ...(pr ? { pr: Number(pr[1]) } : {}) };
    });
}

export async function provenance(root: string, rawPath: string): Promise<Provenance> {
  const repoPath = rawPath.replace(/^\.\//, "");
  const lock = loadLock(root);
  const entry = lock.files[repoPath];
  if (!entry) throw new Error(`${repoPath} is not in ${LOCK_FILE}; provenance covers art the store holds.`);
  const key = blobKey(entry.sha256, repoPath);
  const config = loadConfig(root);
  return {
    path: repoPath,
    sha256: entry.sha256,
    key,
    commits: lockCommits(root, repoPath, entry.sha256),
    prompts: findPromptRecords(root, repoPath),
    stamp: config.storeUrl ? await storeStamp(config.storeUrl, key) : null,
  };
}

export function formatProvenance(p: Provenance): string[] {
  const lines = [`${p.path}`, `  bytes      sha256 ${p.sha256}`];
  if (p.commits.length === 0) lines.push("  git        no commit records these bytes here yet (not committed?)");
  for (const [i, c] of p.commits.entries()) {
    lines.push(`  ${i === 0 ? "recorded" : "again   "}   ${c.commit.slice(0, 10)} ${c.date.slice(0, 10)}${c.pr ? ` PR #${c.pr}` : ""}  ${c.subject}`);
  }
  if (p.prompts.length === 0) lines.push("  prompt     no prompt record names this path");
  for (const r of p.prompts) {
    const e = r.entry;
    const bits = [
      e.issue !== undefined ? `issue #${String(e.issue)}` : null,
      e.generator ? `generator ${String(e.generator)}` : null,
      e.uploadedBy ? `uploaded by ${String(e.uploadedBy)}` : null,
    ].filter(Boolean);
    lines.push(`  prompt     ${r.file}${e.id ? ` (${String(e.id)})` : ""}${bits.length ? `: ${bits.join(", ")}` : ""}`);
    if (typeof e.prompt === "string") lines.push(`             "${e.prompt.slice(0, 140)}${e.prompt.length > 140 ? "…" : ""}"`);
  }
  if (!p.stamp) lines.push("  store      no stamp (uploaded before stamps existed, or the store is not configured)");
  else {
    const s = p.stamp;
    const who = [s.uploader, s.agent ? `agent ${s.agent}` : null, s.tags ? Object.entries(s.tags).map(([k, v]) => `${k}=${v}`).join(" ") : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`  store      first uploaded ${s.at.slice(0, 16).replace("T", " ")} via ${s.via} by ${who}${s.issue ? `, for issue #${s.issue}` : ""}${s.path && s.path !== p.path ? `, as ${s.path}` : ""}`);
  }
  return lines;
}
