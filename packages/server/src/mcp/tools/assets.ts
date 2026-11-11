/**
 * The asset store's tools (docs/mcp-server.md, "Assets"). `npm run assets:push`
 * calls `request_uploads` itself, so an agent normally never calls these by
 * hand; they are here for the CLI, and for an agent that wants to check before
 * it commits a lock.
 */

import { z } from "zod";
import { blobKey, isSha256 } from "../../../../shared/src/asset-store.ts";
import type { VerifiedKey } from "../keys.ts";
import type { ToolRegistrar } from "../server.ts";
import { READ, WRITE, guarded } from "../shared.ts";
import { planUploads, type UploadSigner } from "../uploads.ts";

const MAX_FILES = 200;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/).describe("Hex SHA-256 of the file's bytes, lower case.");
const path = z.string().min(1).max(512).describe("The repo path the file is for, e.g. assets/cast/pib/assembled.png. The extension sets its type.");

export function registerAssetTools(server: ToolRegistrar, ctx: { signer: UploadSigner; key: VerifiedKey }): void {
  server.registerTool(
    "request_uploads",
    {
      title: "Request upload URLs",
      description:
        "Get presigned PUT URLs to add files to the asset store. For each file: 'stored' (already there, nothing to do), " +
        "'upload' (PUT the exact bytes to url with exactly these headers, within 15 minutes), or 'refused' with a reason. " +
        "S3 rejects bytes that do not match sha256, and a 412 on PUT means someone stored the same bytes first, which is success. " +
        "Then record the file in assets.lock.json (npm run assets:push does all of this).",
      inputSchema: z.object({
        files: z.array(z.object({ path, sha256, bytes: z.number().int().positive() })).min(1).max(MAX_FILES),
        issue: z.number().int().positive().optional().describe("The art issue these files are for. Stamped on each blob with the key's label and agent."),
      }),
      outputSchema: z.looseObject({ uploads: z.array(z.looseObject({ path: z.string(), status: z.string() })) }),
      // Asking twice is harmless: a stored blob reads as stored, a pending one gets a fresh URL.
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async ({ files, issue }: { files: Array<{ path: string; sha256: string; bytes: number }>; issue?: number }) => {
      const uploads = await planUploads(ctx.signer, files, {
        uploader: ctx.key.label,
        via: "mcp",
        ...(ctx.key.agent ? { agent: ctx.key.agent } : {}),
        ...(Object.keys(ctx.key.tags).length ? { tags: ctx.key.tags } : {}),
        ...(issue !== undefined ? { issue } : {}),
      });
      console.info(
        JSON.stringify({
          msg: "MCP upload URLs",
          key: ctx.key.label,
          agent: ctx.key.agent,
          issue,
          upload: uploads.filter((u) => u.status === "upload").map((u) => u.path),
          stored: uploads.filter((u) => u.status === "stored").length,
          refused: uploads.filter((u) => u.status === "refused").length,
        }),
      );
      return { uploads };
    }),
  );

  server.registerTool(
    "check_uploads",
    {
      title: "Check files are stored",
      description:
        "Whether the asset store holds each file's bytes. Use before committing assets.lock.json to be sure every blob it names was uploaded.",
      inputSchema: z.object({ files: z.array(z.object({ path, sha256 })).min(1).max(MAX_FILES) }),
      outputSchema: z.looseObject({ files: z.array(z.looseObject({ path: z.string(), stored: z.boolean() })) }),
      annotations: READ,
    },
    guarded(async ({ files }: { files: Array<{ path: string; sha256: string }> }) => {
      const out = await Promise.all(
        files.map(async (f) => {
          if (!isSha256(f.sha256)) return { path: f.path, stored: false };
          const key = blobKey(f.sha256, f.path);
          return { path: f.path, key, stored: await ctx.signer.has(key) };
        }),
      );
      return { files: out };
    }),
  );
}
