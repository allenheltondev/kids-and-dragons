/**
 * `assets:push --writer mcp` end to end: the real MCP endpoint behind a local
 * HTTP server, and a stand-in for S3 that enforces what the presigned URL's
 * signed headers make the real one enforce (write-once, and the bytes must hash
 * to the checksum), writing into a folder that `pull` then reads as the store.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpEndpoint } from "../../packages/server/src/mcp/handler";
import { MemoryKeyStore, mintKey } from "../../packages/server/src/mcp/keys";
import { checksumHeader, type UploadSigner } from "../../packages/server/src/mcp/uploads";
import { push, pull } from "./commands";
import { loadLock } from "./lib";
import { McpBlobStore } from "./mcp-store";

let tmp: string;
let server: http.Server;
let base: string;
let storeDir: string;
let keys: MemoryKeyStore;
const puts: string[] = [];

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kad-mcp-push-"));
  storeDir = path.join(tmp, "store");
  keys = new MemoryKeyStore();
  puts.length = 0;
  const signer: UploadSigner = {
    has: (key) => Promise.resolve(fs.existsSync(path.join(storeDir, key))),
    presignPut: (key, contentType, sha256, bytes) =>
      Promise.resolve({
        url: `${base}/s3/${key}`,
        headers: { "Content-Length": String(bytes), "Content-Type": contentType, "If-None-Match": "*", "x-amz-checksum-sha256": checksumHeader(sha256) },
      }),
  };
  const endpoint = mcpEndpoint({ keys, signer });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.url?.startsWith("/s3/")) {
        const key = req.url.slice(4);
        const file = path.join(storeDir, key);
        if (req.headers["if-none-match"] !== "*") return res.writeHead(403).end("unconditional write refused by policy");
        if (Number(req.headers["content-length"]) !== body.length) return res.writeHead(403).end("SignatureDoesNotMatch");
        if (fs.existsSync(file)) return res.writeHead(412).end();
        const digest = createHash("sha256").update(body).digest("base64");
        if (req.headers["x-amz-checksum-sha256"] !== digest) return res.writeHead(400).end("BadDigest");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        puts.push(key);
        return res.writeHead(200).end();
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      void endpoint(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: req.method === "POST" ? body : undefined })).then(async (r) => {
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    });
  });
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function repo(): string {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, "assets", "cast", "pib"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(
    path.join(root, "assets.config.json"),
    JSON.stringify({ storeUrl: `file://${storeDir}`, mcpUrl: `${base}/api/mcp`, roots: ["assets"], extensions: ["png"], exclude: [] }),
  );
  fs.writeFileSync(path.join(root, "assets/cast/pib/assembled.png"), "pib, painted by an agent");
  return root;
}

describe("assets:push through the MCP server", () => {
  it("uploads new art with an upload key, records it, and a second push uploads nothing", async () => {
    const root = repo();
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    const store = new McpBlobStore(`${base}/api/mcp`, key);
    const cacheDir = path.join(tmp, "cache");

    const first = await push(root, store, { cacheDir });
    expect(first.uploaded).toEqual(["assets/cast/pib/assembled.png"]);
    expect(puts).toHaveLength(1);
    const entry = loadLock(root).files["assets/cast/pib/assembled.png"]!;
    expect(fs.readFileSync(path.join(storeDir, puts[0]!), "utf8")).toBe("pib, painted by an agent");
    expect(puts[0]).toBe(`sha256/${entry.sha256.slice(0, 2)}/${entry.sha256}.png`);

    // Same bytes at a second path: the server says "stored", nothing goes up.
    fs.mkdirSync(path.join(root, "assets/cast/copy"), { recursive: true });
    fs.copyFileSync(path.join(root, "assets/cast/pib/assembled.png"), path.join(root, "assets/cast/copy/assembled.png"));
    const second = await push(root, store, { cacheDir });
    expect(second.recorded).toEqual(["assets/cast/copy/assembled.png"]);
    expect(second.uploaded).toEqual([]);
    expect(puts).toHaveLength(1);

    // And what went up comes back down from the store.
    fs.rmSync(path.join(root, "assets/cast"), { recursive: true });
    const pulled = await pull(root, { cacheDir: path.join(tmp, "fresh") , force: true });
    expect(pulled.fetched.sort()).toEqual(["assets/cast/copy/assembled.png", "assets/cast/pib/assembled.png"]);
  });

  it("says what to do without a key, and writes no lock", async () => {
    const root = repo();
    await expect(push(root, new McpBlobStore(`${base}/api/mcp`, null), { cacheDir: path.join(tmp, "c") })).rejects.toThrow(/wants a key: set KAD_MCP_TOKEN/);
    expect(fs.existsSync(path.join(root, "assets.lock.json"))).toBe(false);
  });

  it("is refused with a read-only key", async () => {
    const root = repo();
    const { key } = await mintKey(keys, { label: "reader", scopes: ["assets:read"] });
    await expect(push(root, new McpBlobStore(`${base}/api/mcp`, key), { cacheDir: path.join(tmp, "c") })).rejects.toThrow(/request_uploads/);
  });

  it("does not upload a blob the store already has, and refuses history writes", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    const store = new McpBlobStore(`${base}/api/mcp`, key);
    const bytes = new TextEncoder().encode("same bytes");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const blob = `sha256/${sha.slice(0, 2)}/${sha}.png`;
    expect(await store.put(blob, bytes, "image/png", "assets/a.png")).toBe(true);
    expect(await store.put(blob, bytes, "image/png", "assets/a.png")).toBe(false);
    await expect(store.put("history/x.json", bytes, "application/json")).rejects.toThrow(/AWS credentials/);
  });
});
