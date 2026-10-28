/**
 * Where rendered clips are kept (docs/voice-narration-plan.md §5).
 *
 * A clip store answers two questions, "do you have this key?" and "keep these
 * bytes under it". The answer to the first *is* the generation cache: a key
 * that exists is never rendered again, from any branch, machine or CI run.
 *
 * Three implementations behind one interface, so the render loop is tested
 * without a network and a first run can be tried against a folder:
 *  - `S3ClipStore`: the site bucket, under `voice/` and nowhere else;
 *  - `DirClipStore`: a folder laid out like the bucket;
 *  - `MemoryClipStore`: for tests.
 */

import fs from "node:fs";
import path from "node:path";
import {
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { CLIP_CACHE_CONTROL, CLIP_CONTENT_TYPE, clipObjectKey } from "../../packages/shared/src/voice-clips";

export interface StoredClip {
  ms: number;
}

export interface ClipStore {
  /** Where this store is, for reports: a bucket name or a folder. */
  readonly name: string;
  /** The clip's recorded length, or null when it is not there. */
  head(key: string): Promise<StoredClip | null>;
  /** Keep a clip. Never replaces one that exists (a key names its bytes). Returns whether it was written. */
  put(key: string, bytes: Uint8Array, clip: StoredClip): Promise<boolean>;
}

export class MemoryClipStore implements ClipStore {
  readonly name = "memory";
  readonly clips = new Map<string, { bytes: Uint8Array; clip: StoredClip }>();
  head(key: string): Promise<StoredClip | null> {
    return Promise.resolve(this.clips.get(key)?.clip ?? null);
  }
  put(key: string, bytes: Uint8Array, clip: StoredClip): Promise<boolean> {
    if (this.clips.has(key)) return Promise.resolve(false);
    this.clips.set(key, { bytes, clip });
    return Promise.resolve(true);
  }
}

/** A folder laid out as the bucket is, with each clip's length beside it, so a trial run needs no AWS. */
export class DirClipStore implements ClipStore {
  readonly name: string;
  constructor(private readonly root: string) {
    this.name = root;
  }
  private file(key: string): string {
    return path.join(this.root, clipObjectKey(key));
  }
  head(key: string): Promise<StoredClip | null> {
    const file = this.file(key);
    if (!fs.existsSync(file)) return Promise.resolve(null);
    const ms = Number(fs.readFileSync(`${file}.ms`, "utf8"));
    return Promise.resolve({ ms: Number.isFinite(ms) ? ms : 0 });
  }
  put(key: string, bytes: Uint8Array, clip: StoredClip): Promise<boolean> {
    const file = this.file(key);
    if (fs.existsSync(file)) return Promise.resolve(false);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(`${file}.ms`, String(clip.ms));
    return Promise.resolve(true);
  }
}

/** The metadata key a clip's length rides under (S3 sends it back as `x-amz-meta-ms`). */
const LENGTH = "ms";

/**
 * The site bucket, `voice/<key[0:2]>/<key>.webm`. Uploaded with the immutable
 * cache header CloudFront and the service worker rely on, and with a
 * conditional write (`If-None-Match: *`) so a clip that already exists is never
 * replaced, even by a racing run: S3 answers 412 and that is "already there".
 *
 * Writes only the `voice/` prefix. `deploy.sh` never syncs or deletes it.
 */
export class S3ClipStore implements ClipStore {
  constructor(
    private readonly s3: Pick<S3Client, "send">,
    private readonly bucket: string,
  ) {}
  get name(): string {
    return `s3://${this.bucket}`;
  }
  async head(key: string): Promise<StoredClip | null> {
    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: clipObjectKey(key) }));
      const ms = Number(out.Metadata?.[LENGTH]);
      return { ms: Number.isFinite(ms) ? ms : 0 };
    } catch (error) {
      if (isStatus(error, 404) || (error as { name?: string }).name === "NotFound") return null;
      throw error;
    }
  }
  async put(key: string, bytes: Uint8Array, clip: StoredClip): Promise<boolean> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: clipObjectKey(key),
          Body: bytes,
          ContentType: CLIP_CONTENT_TYPE,
          CacheControl: CLIP_CACHE_CONTROL,
          Metadata: { [LENGTH]: String(clip.ms) },
          IfNoneMatch: "*",
        }),
      );
      return true;
    } catch (error) {
      if (isStatus(error, 412) || (error as { name?: string }).name === "PreconditionFailed") return false;
      throw error;
    }
  }
}

function isStatus(error: unknown, status: number): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === status;
}

/** Every store at once: has it only when all do; writes the ones that lack it. */
export class StoreSet implements ClipStore {
  constructor(private readonly stores: readonly ClipStore[]) {}
  get name(): string {
    return this.stores.map((s) => s.name).join(", ");
  }
  /** The length, if every store has the clip; null if any lacks it, since then it must be rendered or copied. */
  async head(key: string): Promise<StoredClip | null> {
    const heads = await Promise.all(this.stores.map((s) => s.head(key)));
    return heads.every((h) => h !== null) ? (heads[0] ?? null) : null;
  }
  async put(key: string, bytes: Uint8Array, clip: StoredClip): Promise<boolean> {
    const wrote = await Promise.all(this.stores.map((s) => s.put(key, bytes, clip)));
    return wrote.some(Boolean);
  }
}
