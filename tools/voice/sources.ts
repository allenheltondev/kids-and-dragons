/**
 * Asking where clips are, and whether every clip a manifest plays is there
 * (docs/voice-narration-plan.md §4, `voice:verify`).
 *
 * Dependency-free on purpose: `deploy.sh` runs `verify-site.ts` with plain
 * `node` (it strips the types), and a production deploy ships CI's artifact
 * without `node_modules`. Only `node:` modules and the shared layout, imported
 * with their `.ts` extension, so Node can resolve them.
 */

import { clipPath } from "../../packages/shared/src/voice-clips.ts";

export interface StoredClip {
  ms: number;
}

/** Somewhere clips can be looked up: a store (store.ts), or a site that serves them. */
export interface ClipSource {
  /** Where this is, for reports: a bucket name, a folder or a site. */
  readonly name: string;
  /** The clip's recorded length, or null when it is not there. */
  head(key: string): Promise<StoredClip | null>;
}

/** The object metadata a clip's length rides under (S3 sends it back as `x-amz-meta-ms`). */
export const CLIP_LENGTH_META = "ms";

export interface Finding {
  /** The manifest file, the address within it, or the destination the finding is about. */
  at: string;
  message: string;
}

type Fetcher = (url: string, init: { method: string }) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

/**
 * A deployed site, asked over HTTPS exactly as a browser would ask: `HEAD
 * <site>/voice/<key[0:2]>/<key>.webm`. Needs no AWS permission. A 404 or 403
 * (S3 behind CloudFront answers 403 for an object it does not have) is "not
 * there"; anything else that is not a success is an error, which the caller
 * reports as unknown rather than missing. The length comes from the object's
 * `x-amz-meta-ms`, when CloudFront passes it on.
 */
export class SiteClipSource implements ClipSource {
  readonly name: string;
  private readonly fetcher: Fetcher;
  private readonly attempts: number;
  constructor(site: string, fetcher: Fetcher = fetch, attempts = 3) {
    this.name = site.replace(/\/+$/, "");
    this.fetcher = fetcher;
    this.attempts = attempts;
  }
  async head(key: string): Promise<StoredClip | null> {
    const url = `${this.name}${clipPath(key)}`;
    let last = "";
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      try {
        const response = await this.fetcher(url, { method: "HEAD" });
        if (response.status === 404 || response.status === 403) return null;
        if (response.status >= 200 && response.status < 300) {
          const ms = Number(response.headers.get(`x-amz-meta-${CLIP_LENGTH_META}`));
          return { ms: Number.isFinite(ms) ? ms : 0 };
        }
        last = `HTTP ${String(response.status)}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`${url}: ${last}`);
  }
}

/**
 * Every clip a manifest names, asked of each destination: present, and the
 * length the manifest says. A clip a destination lacks is broken there, since
 * the manifest deploys with the content and the browser will fetch it. A
 * destination that cannot answer is reported, not failed: not knowing is not
 * knowing it is bad.
 */
export async function checkSources(
  clips: ReadonlyMap<string, number>,
  sources: readonly ClipSource[],
  concurrency = 16,
): Promise<{ failures: Finding[]; notes: Finding[]; checked: number }> {
  const failures: Finding[] = [];
  const notes: Finding[] = [];
  const jobs = sources.flatMap((source) => [...clips].map(([key, ms]) => ({ source, key, ms })));
  let next = 0;
  let checked = 0;
  const work = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      try {
        const head = await job.source.head(job.key);
        checked += 1;
        if (head === null) {
          failures.push({ at: job.source.name, message: `has no clip ${job.key}, which a manifest plays. Render it there: \`npm run voice:generate -- --render\` with this destination` });
        } else if (head.ms > 0 && Math.abs(head.ms - job.ms) > 1) {
          failures.push({ at: job.source.name, message: `clip ${job.key.slice(0, 12)} is ${String(head.ms)} ms there, but the manifest says ${String(job.ms)} ms` });
        }
      } catch (error) {
        notes.push({ at: job.source.name, message: `could not check ${job.key.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, jobs.length)) }, work));
  return { failures, notes, checked };
}
