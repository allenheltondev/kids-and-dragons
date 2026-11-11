/**
 * Writing to the asset store through the MCP server instead of AWS credentials
 * (docs/asset-store.md, "Credentials"; docs/mcp-server.md).
 *
 * For each blob, `request_uploads` answers "stored" (nothing to do) or a
 * presigned PUT URL with headers to send exactly; this PUTs the bytes there.
 * S3 itself checks them against the hash and refuses an overwrite, so the key
 * that allows this can add correct blobs and do nothing else.
 *
 * The key: `KAD_MCP_TOKEN`, or none at all in a cloud session whose environment
 * has the key as a network secret for the server's host (the proxy adds the
 * Authorization header, and the key never enters the session).
 *
 * Built-ins only (fetch), like the rest of tools/assets' plain-node path.
 */

import { BLOB_PREFIX } from "../../packages/shared/src/asset-store.ts";
import type { BlobStore } from "./stores.ts";

const VERSION = "2026-07-28";

interface UploadAnswer {
  path: string;
  status: "stored" | "upload" | "refused";
  url?: string;
  headers?: Record<string, string>;
  reason?: string;
}

export class McpBlobStore implements BlobStore {
  readonly name: string;
  private readonly url: string;
  private readonly token: string | null;
  private nextId = 1;

  constructor(url: string, token: string | null) {
    this.url = url;
    this.token = token;
    this.name = `${url} (MCP)`;
  }

  /** Always "not yet": request_uploads answers "stored" for a blob that is, in the same round trip. */
  has(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async put(key: string, bytes: Uint8Array, _contentType: string, path?: string): Promise<boolean> {
    const m = new RegExp(`^${BLOB_PREFIX}/[0-9a-f]{2}/([0-9a-f]{64})(\\.[a-z0-9]+)?$`).exec(key);
    if (!m) throw new Error(`${key}: the MCP server stores blobs only; this needs AWS credentials (--writer aws)`);
    const sha256 = m[1]!;
    const result = (await this.callTool("request_uploads", { files: [{ path: path ?? `blob${m[2] ?? ""}`, sha256, bytes: bytes.length }] })) as {
      uploads: UploadAnswer[];
    };
    const answer = result.uploads[0];
    if (!answer) throw new Error(`${key}: request_uploads gave no answer`);
    if (answer.status === "stored") return false;
    if (answer.status === "refused") throw new Error(`${path ?? key}: the MCP server refused it: ${answer.reason}`);
    const res = await fetch(answer.url!, { method: "PUT", headers: answer.headers, body: bytes });
    // 412: someone stored these exact bytes first. Same blob, so this is done.
    if (res.status === 412) return false;
    if (!res.ok) throw new Error(`${path ?? key}: upload refused with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": VERSION,
      "mcp-method": "tools/call",
      "mcp-name": name,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "kad-assets-cli", version: "1.0.0" },
          },
        },
      }),
    });
    const text = await res.text();
    if (res.status === 401) {
      throw new Error(
        `The MCP server at ${this.url} wants a key: set KAD_MCP_TOKEN, or give the cloud environment the key as a network secret for its host (docs/mcp-server.md).`,
      );
    }
    if (!res.ok) throw new Error(`MCP ${name}: HTTP ${res.status}: ${text.slice(0, 300)}`);
    const message = parseMessage(text, res.headers.get("content-type") ?? "");
    if (message.error) throw new Error(`MCP ${name}: ${message.error.message}`);
    const result = message.result as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> } | undefined;
    if (!result) throw new Error(`MCP ${name}: no result`);
    if (result.isError) throw new Error(`MCP ${name}: ${result.content?.map((c) => c.text).join(" ") ?? "error"}`);
    return result.structuredContent ?? (JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>);
  }
}

/** A JSON body, or the last `data:` message of a server-sent-event stream. */
function parseMessage(text: string, contentType: string): { result?: unknown; error?: { message: string } } {
  if (contentType.includes("text/event-stream")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    return JSON.parse(data.at(-1) ?? "{}") as { result?: unknown; error?: { message: string } };
  }
  return JSON.parse(text) as { result?: unknown; error?: { message: string } };
}
