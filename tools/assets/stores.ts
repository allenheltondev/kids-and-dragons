/**
 * Where `assets:push` and `assets:migrate` write blobs (docs/asset-store.md).
 *
 * A blob store answers "do you have this key?" and "keep these bytes under it",
 * and never replaces a key it has: the key is the hash of the bytes, so there is
 * nothing to replace it with. Two implementations:
 *  - `S3BlobStore`: the store bucket, with a conditional write (`If-None-Match: *`)
 *    so two agents pushing the same painting at once both succeed and neither
 *    overwrites the other. The bucket policy refuses an unconditional write.
 *  - `DirBlobStore`: a folder laid out as the bucket is, for a trial run with no
 *    AWS and for the tests. Serve it to `pull` as `KAD_ASSET_STORE_URL=file:///that/folder`.
 *
 * The S3 SDK is imported only when an S3 store is made, so the read-only
 * commands (pull, verify, status) run under plain node with no node_modules.
 */

import fs from "node:fs";
import path from "node:path";
import { BLOB_CACHE_CONTROL } from "../../packages/shared/src/asset-store.ts";
import { writeAtomic } from "../../packages/shared/src/asset-cache.ts";
import type { AssetConfig } from "./lib.ts";

export interface BlobStore {
  readonly name: string;
  has(key: string): Promise<boolean>;
  /**
   * Keep bytes under a key. Returns false when the key was already there (nothing written).
   * `path` is the repo path the bytes are for, when there is one: the MCP server logs it.
   */
  put(key: string, bytes: Uint8Array, contentType: string, path?: string): Promise<boolean>;
}

export class DirBlobStore implements BlobStore {
  readonly name: string;
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    this.name = root;
  }
  has(key: string): Promise<boolean> {
    return Promise.resolve(fs.existsSync(path.join(this.root, key)));
  }
  put(key: string, bytes: Uint8Array): Promise<boolean> {
    const file = path.join(this.root, key);
    if (fs.existsSync(file)) return Promise.resolve(false);
    writeAtomic(file, bytes);
    return Promise.resolve(true);
  }
}

/** The minimal slice of S3Client the store uses, so tests can hand it a fake. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

interface S3Commands {
  HeadObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
}

export class S3BlobStore implements BlobStore {
  readonly bucket: string;
  private readonly s3: S3Like;
  private readonly commands: S3Commands;
  constructor(s3: S3Like, bucket: string, commands: S3Commands) {
    this.s3 = s3;
    this.bucket = bucket;
    this.commands = commands;
  }
  get name(): string {
    return `s3://${this.bucket}`;
  }
  async has(key: string): Promise<boolean> {
    try {
      await this.s3.send(new this.commands.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isStatus(error, 404) || (error as { name?: string }).name === "NotFound") return false;
      throw error;
    }
  }
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    try {
      await this.s3.send(
        new this.commands.PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: BLOB_CACHE_CONTROL,
          ChecksumAlgorithm: "SHA256",
          IfNoneMatch: "*",
        }),
      );
      return true;
    } catch (error) {
      // 412: someone (maybe this run's own retry) already wrote it. Same bytes, by construction.
      if (isStatus(error, 412) || (error as { name?: string }).name === "PreconditionFailed") return false;
      throw error;
    }
  }
}

function isStatus(error: unknown, status: number): boolean {
  return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === status;
}

export interface WriteTarget {
  /** A folder instead of S3 (a trial, or a test). */
  dir?: string;
  /** A bucket by name, over the config and the stack. */
  bucket?: string;
  /** How to write: AWS credentials, or the MCP server. Default: KAD_ASSET_WRITER, else aws. */
  writer?: string;
}

/**
 * The store to write to: `--dir`, else `--bucket`, else assets.config.json's
 * `bucket` (or `KAD_ASSET_BUCKET`), else the store stack's `BucketName` output.
 * Needs AWS credentials for anything but `--dir`.
 */
export async function openWriteStore(config: AssetConfig, target: WriteTarget): Promise<BlobStore> {
  if (target.dir) return new DirBlobStore(path.resolve(target.dir));
  const writer = target.writer ?? process.env.KAD_ASSET_WRITER ?? "aws";
  if (writer === "mcp") {
    if (!config.mcpUrl) throw new Error('Writing through the MCP server needs its URL: "mcpUrl" in assets.config.json, or KAD_MCP_URL.');
    const { McpBlobStore } = await import("./mcp-store.ts");
    return new McpBlobStore(config.mcpUrl, process.env.KAD_MCP_TOKEN || null);
  }
  if (writer !== "aws") throw new Error(`Unknown writer "${writer}": aws (AWS credentials) or mcp (the MCP server and a key).`);
  const s3sdk = await import("@aws-sdk/client-s3");
  let bucket = target.bucket ?? config.bucket ?? undefined;
  if (!bucket) {
    const { CloudFormationClient, DescribeStacksCommand } = await import("@aws-sdk/client-cloudformation");
    const cfn = new CloudFormationClient({ region: config.region });
    try {
      const out = await cfn.send(new DescribeStacksCommand({ StackName: config.stack }));
      bucket = out.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === "BucketName")?.OutputValue;
    } catch (error) {
      throw new Error(
        `Could not read stack ${config.stack} in ${config.region} (${(error as Error).message}).\n` +
          `  Pushing needs AWS credentials that may write to the store (docs/asset-store.md, "Credentials"),\n` +
          `  or name the bucket: --bucket NAME, KAD_ASSET_BUCKET, or "bucket" in assets.config.json.`,
      );
    }
    if (!bucket) throw new Error(`Stack ${config.stack} has no BucketName output. Was infra/asset-store.yaml deployed as ${config.stack}?`);
  }
  const s3 = new s3sdk.S3Client({ region: config.region });
  return new S3BlobStore(s3 as unknown as S3Like, bucket, s3sdk as unknown as S3Commands);
}
