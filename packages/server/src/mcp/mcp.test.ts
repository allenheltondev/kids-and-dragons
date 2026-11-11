import { S3Client } from "@aws-sdk/client-s3";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { toRequest, toResult } from "../lambda/mcp";
import { MemoryKeyStore, bearerKey, listKeys, mintKey, revokeKey, verifyKey, KeyError } from "./keys";
import { readStamp, type BlobStamp } from "../../../shared/src/asset-store";
import { mcpEndpoint } from "./handler";
import { S3UploadSigner, checksumHeader, planUploads, type UploadSigner } from "./uploads";

const VERSION = "2026-07-28";
const SHA = "ab".repeat(32);
const SHA2 = "cd".repeat(32);

class FakeSigner implements UploadSigner {
  readonly stored = new Set<string>();
  readonly stamps: BlobStamp[] = [];
  has(key: string): Promise<boolean> {
    return Promise.resolve(this.stored.has(key));
  }
  presignPut(key: string, contentType: string, sha256: string, _bytes: number, stamp: BlobStamp) {
    this.stamps.push(stamp);
    return Promise.resolve({ url: `https://bucket.example/${key}?sig`, headers: { "Content-Type": contentType, "If-None-Match": "*", "x-amz-checksum-sha256": checksumHeader(sha256) } });
  }
}

describe("keys", () => {
  let store: MemoryKeyStore;
  beforeEach(() => {
    store = new MemoryKeyStore();
  });

  it("mints a key shown once, stores only a hash, and verifies it", async () => {
    const { key, info } = await mintKey(store, { label: "cloud-agent", scopes: ["assets:write"] });
    expect(key).toMatch(/^kadmcp_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    const row = store.rows.get(info.id)!;
    expect(JSON.stringify(row)).not.toContain(key.split(".")[1]!);
    expect(info).not.toHaveProperty("secretHash");
    const verified = await verifyKey(store, key);
    expect(verified).toMatchObject({ id: info.id, label: "cloud-agent", scopes: ["assets:write"] });
    expect(store.rows.get(info.id)!.lastUsedAt).not.toBeNull();
  });

  it("makes ids a command line can take as they are: never starting with a dash", async () => {
    for (let i = 0; i < 300; i++) {
      const { info } = await mintKey(store, { label: `k${i}`, scopes: ["assets:read"] });
      expect(info.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("refuses a wrong secret, a malformed key, an expired key and a revoked one alike", async () => {
    const now = new Date("2026-11-11T00:00:00Z");
    const { key, info } = await mintKey(store, { label: "a", scopes: ["assets:read"], days: 1, now });
    const [head, secret] = key.split(".") as [string, string];
    const flipped = `${head}.${secret[0] === "A" ? "B" : "A"}${secret.slice(1)}`;
    expect(await verifyKey(store, flipped, now)).toBeNull();
    expect(await verifyKey(store, "kadmcp_nope", now)).toBeNull();
    expect(await verifyKey(store, key, new Date("2026-11-12T00:00:01Z"))).toBeNull();
    expect(await verifyKey(store, key, now)).not.toBeNull();
    await revokeKey(store, info.id);
    expect(await verifyKey(store, key, now)).toBeNull();
    await expect(revokeKey(store, info.id)).rejects.toThrow(KeyError);
  });

  it("refuses unknown scopes, no scopes, a missing label and silly lifetimes", async () => {
    await expect(mintKey(store, { label: "a", scopes: ["assets:admin"] })).rejects.toThrow(/Unknown scope/);
    await expect(mintKey(store, { label: "a", scopes: [] })).rejects.toThrow(/at least one scope/);
    await expect(mintKey(store, { label: " ", scopes: ["assets:read"] })).rejects.toThrow(/label/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:read"], days: 0 })).rejects.toThrow(/days/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:read"], days: 400 })).rejects.toThrow(/days/);
  });

  it("carries an agent and tags, refusing anything unfit to stamp in public", async () => {
    const { key } = await mintKey(store, { label: "cloud agent", scopes: ["assets:write"], agent: "codex", tags: ["env=codex-cloud", "repo=kids-and-dragons"] });
    expect(await verifyKey(store, key)).toMatchObject({ agent: "codex", tags: { env: "codex-cloud", repo: "kids-and-dragons" } });
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], agent: "Codex Agent" })).rejects.toThrow(/agent/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], tags: ["email=someone@example.com"] })).rejects.toThrow(/tag/);
    await expect(mintKey(store, { label: "a", scopes: ["assets:write"], tags: ["novalue"] })).rejects.toThrow(/key=value/);
    await expect(mintKey(store, { label: "Ann's laptop <ann@example.com>", scopes: ["assets:write"] })).rejects.toThrow(/plain words/);
    const plain = await mintKey(store, { label: "b", scopes: ["assets:read"] });
    expect(await verifyKey(store, plain.key)).toMatchObject({ agent: null, tags: {} });
  });

  it("lists keys without their hashes, oldest first", async () => {
    await mintKey(store, { label: "first", scopes: ["assets:read"], now: new Date("2026-01-01T00:00:00Z") });
    await mintKey(store, { label: "second", scopes: ["operator:read", "assets:write", "assets:write"], now: new Date("2026-02-01T00:00:00Z") });
    const keys = await listKeys(store);
    expect(keys.map((k) => k.label)).toEqual(["first", "second"]);
    expect(keys[1]!.scopes).toEqual(["assets:write", "operator:read"]);
    expect(JSON.stringify(keys)).not.toContain("secretHash");
  });

  it("reads a bearer header", () => {
    expect(bearerKey("Bearer kadmcp_x.y")).toBe("kadmcp_x.y");
    expect(bearerKey("bearer  kadmcp_x.y ")).toBe("kadmcp_x.y");
    expect(bearerKey("Basic abc")).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });
});

describe("upload URLs", () => {
  it("answers stored, upload or refused per file", async () => {
    const signer = new FakeSigner();
    signer.stored.add(`sha256/ab/${SHA}.png`);
    const answers = await planUploads(signer, [
      { path: "assets/cast/pib/assembled.png", sha256: SHA, bytes: 10 },
      { path: "assets/audio/rain.webm", sha256: SHA2, bytes: 10 },
      { path: "assets/notes.txt", sha256: SHA2, bytes: 10 },
      { path: "assets/x.png", sha256: "nope", bytes: 10 },
      { path: "assets/x.png", sha256: SHA2, bytes: 0 },
      { path: "assets/brand/logo.svg", sha256: SHA2, bytes: 10 },
    ], { uploader: "agent", via: "mcp" });
    expect(answers.map((a) => a.status)).toEqual(["stored", "upload", "refused", "refused", "refused", "refused"]);
    expect(answers[1]).toMatchObject({ key: `sha256/cd/${SHA2}.webm`, method: "PUT", headers: { "Content-Type": "audio/webm", "If-None-Match": "*" } });
  });

  it("refuses a file whose stamp would not fit, rather than store a shortened one", async () => {
    const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" }, requestChecksumCalculation: "WHEN_REQUIRED" });
    const signer = new S3UploadSigner("kad-asset-store-test", s3);
    signer.has = () => Promise.resolve(false);
    const [answer] = await planUploads(signer, [{ path: `assets/${"é".repeat(400)}.png`, sha256: SHA, bytes: 10 }], { uploader: "agent", via: "mcp" });
    expect(answer).toMatchObject({ status: "refused", reason: expect.stringMatching(/stamp .* over S3's 2048/) });
  });

  it("signs the write-once and checksum headers, so an uploader cannot drop them", async () => {
    const s3 = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" }, requestChecksumCalculation: "WHEN_REQUIRED" });
    const stamp = { uploader: "cloud agent", via: "mcp" as const, agent: "codex", tags: { env: "codex-cloud" }, path: "assets/cast/pib/assembled.png", issue: 704, at: "2026-11-11T12:00:00.000Z" };
    const put = await new S3UploadSigner("kad-asset-store-test", s3).presignPut(`sha256/ab/${SHA}.png`, "image/png", SHA, 1234, stamp);
    const url = new URL(put.url);
    expect(url.hostname).toBe("kad-asset-store-test.s3.us-east-1.amazonaws.com");
    expect(url.pathname).toBe(`/sha256/ab/${SHA}.png`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")!.split(";")).toEqual([
      "cache-control", "content-length", "content-type", "host", "if-none-match", "x-amz-checksum-sha256",
      // The provenance stamp (#732): signed, so the uploader can neither drop nor change it.
      "x-amz-meta-kad-agent", "x-amz-meta-kad-at", "x-amz-meta-kad-issue", "x-amz-meta-kad-path", "x-amz-meta-kad-tags", "x-amz-meta-kad-uploader", "x-amz-meta-kad-via",
    ]);
    // Nothing of the stamp rides in the query string, where it would not have to be sent.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().startsWith("x-amz-meta"))).toBe(false);
    expect(readStamp((name) => put.headers[name])).toEqual(stamp);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(Object.fromEntries(Object.entries(put.headers).filter(([k]) => !k.startsWith("x-amz-meta-")))).toEqual({
      "Content-Length": "1234",
      "Content-Type": "image/png",
      "Cache-Control": "public,max-age=31536000,immutable",
      "If-None-Match": "*",
      "x-amz-checksum-sha256": Buffer.from(SHA, "hex").toString("base64"),
    });
  });
});

describe("the endpoint", () => {
  let keys: MemoryKeyStore;
  let signer: FakeSigner;
  let endpoint: ReturnType<typeof mcpEndpoint>;

  beforeEach(() => {
    keys = new MemoryKeyStore();
    signer = new FakeSigner();
    endpoint = mcpEndpoint({ keys, signer });
  });

  async function rpc(key: string | null, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const res = await endpoint(
      new Request("https://kd.example/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": VERSION,
          "mcp-method": method,
          ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": VERSION, "io.modelcontextprotocol/clientCapabilities": {} } },
        }),
      }),
    );
    return { status: res.status, body: (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string } } };
  }

  const toolNames = async (key: string) => ((await rpc(key, "tools/list")).body.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();

  it("refuses a request with no key, a bad key or a revoked one", async () => {
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await rpc("kadmcp_aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "tools/list")).status).toBe(401);
    const { key, info } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    expect((await rpc(key, "tools/list")).status).toBe(200);
    await revokeKey(keys, info.id);
    expect((await rpc(key, "tools/list")).status).toBe(401);
  });

  it("advertises the 2026-07-28 revision", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:read"] });
    const { status, body } = await rpc(key, "server/discover");
    expect(status).toBe(200);
    expect(body.result!.supportedVersions).toContain(VERSION);
  });

  it("registers only the tools a key's scopes reach", async () => {
    const write = await mintKey(keys, { label: "w", scopes: ["assets:write"] });
    const read = await mintKey(keys, { label: "r", scopes: ["assets:read"] });
    const operator = await mintKey(keys, { label: "o", scopes: ["operator:read"] });
    expect(await toolNames(write.key)).toEqual(["check_uploads", "request_uploads", "whoami"]);
    expect(await toolNames(read.key)).toEqual(["check_uploads", "whoami"]);
    expect(await toolNames(operator.key)).toEqual(["whoami"]);
    const refused = await rpc(read.key, "tools/call", { name: "request_uploads", arguments: { files: [{ path: "a.png", sha256: SHA, bytes: 1 }] } });
    expect(refused.body.error?.code ?? (refused.body.result as { isError?: boolean }).isError).toBeTruthy();
  });

  it("hands out upload URLs, and says what is already stored", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"], agent: "codex", tags: ["env=codex-cloud"] });
    signer.stored.add(`sha256/ab/${SHA}.png`);
    const { body } = await rpc(key, "tools/call", {
      name: "request_uploads",
      arguments: { files: [{ path: "assets/a.png", sha256: SHA, bytes: 3 }, { path: "assets/b.png", sha256: SHA2, bytes: 3 }], issue: 704 },
    });
    // The new blob is stamped with the key and the issue; the stored one is not re-signed.
    expect(signer.stamps).toEqual([
      expect.objectContaining({ uploader: "agent", via: "mcp", agent: "codex", tags: { env: "codex-cloud" }, path: "assets/b.png", issue: 704 }),
    ]);
    const uploads = (body.result!.structuredContent as { uploads: Array<{ status: string; url?: string }> }).uploads;
    expect(uploads.map((u) => u.status)).toEqual(["stored", "upload"]);
    expect(uploads[1]!.url).toBe(`https://bucket.example/sha256/cd/${SHA2}.png?sig`);

    const checked = await rpc(key, "tools/call", { name: "check_uploads", arguments: { files: [{ path: "assets/a.png", sha256: SHA }, { path: "assets/b.png", sha256: SHA2 }] } });
    expect((checked.body.result!.structuredContent as { files: Array<{ stored: boolean }> }).files.map((f) => f.stored)).toEqual([true, false]);

    const who = await rpc(key, "tools/call", { name: "whoami", arguments: {} });
    expect(who.body.result!.structuredContent).toMatchObject({ label: "agent", agent: "codex", tags: { env: "codex-cloud" }, scopes: ["assets:write"] });
  });

  it("rejects bad arguments as a validation error, not a crash", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:write"] });
    const { status, body } = await rpc(key, "tools/call", { name: "request_uploads", arguments: { files: [{ path: "a.png", sha256: "short", bytes: 1 }] } });
    expect(status).toBe(200);
    expect(body.error ?? (body.result as { isError?: boolean })?.isError).toBeTruthy();
  });

  it("refuses browser origins", async () => {
    const { key } = await mintKey(keys, { label: "agent", scopes: ["assets:read"] });
    expect((await rpc(key, "tools/list", {}, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("the Lambda adapter", () => {
  it("turns an HTTP API v2 event into the request the endpoint reads, and back", async () => {
    const event = {
      rawPath: "/api/mcp",
      rawQueryString: "a=1",
      headers: { host: "kd.example", authorization: "Bearer kadmcp_x.y", "content-type": "application/json" },
      requestContext: { http: { method: "POST" }, domainName: "abc.execute-api.us-east-1.amazonaws.com" },
      body: Buffer.from('{"jsonrpc":"2.0"}').toString("base64"),
      isBase64Encoded: true,
    } as unknown as APIGatewayProxyEventV2;
    const request = toRequest(event);
    expect(request.url).toBe("https://kd.example/api/mcp?a=1");
    expect(request.headers.get("authorization")).toBe("Bearer kadmcp_x.y");
    expect(await request.text()).toBe('{"jsonrpc":"2.0"}');
    const result = await toResult(new Response("ok", { status: 201, headers: { "x-a": "b" } }));
    expect(result).toEqual({ statusCode: 201, headers: { "x-a": "b", "content-type": "text/plain;charset=UTF-8" }, body: "ok" });
  });
});
