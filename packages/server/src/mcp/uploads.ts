/**
 * Upload URLs into the asset store (docs/asset-store.md, docs/mcp-server.md).
 *
 * The MCP server never carries a painting: a tool's arguments and results land
 * in a model's context, and a 2 MB PNG as base64 would not fit. It hands out
 * presigned PUT URLs instead, and the bytes go straight to S3. Each URL signs
 * headers the uploader must send unchanged:
 *
 *   If-None-Match: *            the bucket refuses any other kind of blob write,
 *                               and S3 answers 412 if the blob is already there;
 *   x-amz-checksum-sha256       S3 hashes what arrives and refuses a mismatch, so
 *                               a URL for one hash can never store other bytes;
 *   Content-Length              the size asked for, which is capped;
 *   x-amz-meta-kad-*            the provenance stamp (#732): the key's label, agent and tags,
 *                               the path and the issue. Public, like the blob;
 *   Content-Type, Cache-Control what the CDN serves the blob with.
 *
 * So holding an upload key lets an agent add correct blobs and nothing else: it
 * cannot overwrite, delete, or file bytes under a hash they do not have.
 */

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BLOB_CACHE_CONTROL, blobKey, contentTypeFor, isSha256, stampMetadata, type BlobStamp } from "../../../shared/src/asset-store.ts";

/** Fifteen minutes: long enough for a slow upload of a large painting, short enough to be useless later. */
export const UPLOAD_URL_SECONDS = 900;
/** Larger than any painting or clip in the repo by a wide margin. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

export interface UploadSigner {
  has(key: string): Promise<boolean>;
  /** `stamp` goes on the object as signed x-amz-meta-* headers (#732). */
  presignPut(key: string, contentType: string, sha256: string, bytes: number, stamp: BlobStamp): Promise<PresignedPut>;
}

export interface UploadRequest {
  /** The repo path the file is for. Its extension sets the type; the whole path is logged, for the audit trail. */
  path: string;
  sha256: string;
  bytes: number;
}

export type UploadAnswer =
  | { path: string; key: string; status: "stored" }
  | { path: string; key: string; status: "upload"; method: "PUT"; url: string; headers: Record<string, string>; expires_at: string }
  | { path: string; status: "refused"; reason: string };

/** The base64 of the raw digest, which is what S3 wants in x-amz-checksum-sha256. */
export function checksumHeader(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function refuse(path: string, reason: string): UploadAnswer {
  return { path, status: "refused", reason };
}

/** Who is uploading, for every blob in one request: the key's label, agent and tags, and the issue. */
export type UploadStamp = Omit<BlobStamp, "path" | "at">;

/** One answer per request: already stored, a URL to upload to, or why not. */
export async function planUploads(
  signer: UploadSigner,
  files: UploadRequest[],
  stamp: UploadStamp,
  now: Date = new Date(),
): Promise<UploadAnswer[]> {
  const expires = new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString();
  return Promise.all(
    files.map(async (file): Promise<UploadAnswer> => {
      if (!isSha256(file.sha256)) return refuse(file.path, "sha256 must be 64 lower-case hex characters");
      if (!Number.isInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_UPLOAD_BYTES) {
        return refuse(file.path, `bytes must be between 1 and ${MAX_UPLOAD_BYTES}`);
      }
      const contentType = contentTypeFor(file.path);
      // SVG can carry script, and the store's CDN serves it to any origin: SVGs stay in git.
      if (contentType === "application/octet-stream" || contentType === "image/svg+xml") {
        return refuse(file.path, "not an image or audio type the store accepts (by its extension)");
      }
      const key = blobKey(file.sha256, file.path);
      if (await signer.has(key)) return { path: file.path, key, status: "stored" };
      const put = await signer.presignPut(key, contentType, file.sha256, file.bytes, { ...stamp, path: file.path, at: now.toISOString() });
      return { path: file.path, key, status: "upload", method: "PUT", url: put.url, headers: put.headers, expires_at: expires };
    }),
  );
}

export class S3UploadSigner implements UploadSigner {
  private readonly s3: S3Client;
  private readonly bucket: string;
  constructor(bucket: string, s3?: S3Client) {
    this.bucket = bucket;
    // WHEN_REQUIRED: otherwise the SDK adds a CRC32 of its own to the signature,
    // which the uploader cannot know to send.
    this.s3 = s3 ?? new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });
  }

  async has(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  async presignPut(key: string, contentType: string, sha256: string, bytes: number, stamp: BlobStamp): Promise<PresignedPut> {
    const metadata = stampMetadata(stamp);
    const metaHeaders = Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`x-amz-meta-${k}`, v]));
    const headers: Record<string, string> = {
      // Signed, so the upload is exactly the size asked for and checked against MAX_UPLOAD_BYTES.
      "Content-Length": String(bytes),
      "Content-Type": contentType,
      "Cache-Control": BLOB_CACHE_CONTROL,
      "If-None-Match": "*",
      "x-amz-checksum-sha256": checksumHeader(sha256),
      ...metaHeaders,
    };
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentLength: bytes,
      ContentType: headers["Content-Type"],
      CacheControl: headers["Cache-Control"],
      IfNoneMatch: "*",
      ChecksumSHA256: headers["x-amz-checksum-sha256"],
      Metadata: metadata,
    });
    const url = await getSignedUrl(this.s3, command, {
      expiresIn: UPLOAD_URL_SECONDS,
      // Signed as headers, not hoisted into the query string, so the uploader must send them.
      // The stamp too: as signed headers it cannot be dropped or changed by the uploader.
      unhoistableHeaders: new Set(["x-amz-checksum-sha256", ...Object.keys(metaHeaders)]),
      signableHeaders: new Set(["content-length", "content-type", "cache-control", "if-none-match", "x-amz-checksum-sha256", ...Object.keys(metaHeaders)]),
    });
    return { url, headers };
  }
}
