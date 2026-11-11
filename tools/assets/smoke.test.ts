/**
 * `assets:smoke` against a local stand-in for the deployment: the real MCP endpoint, a fake S3
 * that refuses any PUT whose signed headers differ from the ones it signed (as SigV4 does),
 * and a fake CDN in front of it. The smoke test must pass against a store that behaves, and
 * fail, by name, against one that does not.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mcpEndpoint } from "../../packages/server/src/mcp/handler";
import { MemoryKeyStore, mintKey } from "../../packages/server/src/mcp/keys";
import { checksumHeader, type UploadSigner } from "../../packages/server/src/mcp/uploads";
import { stampMetadata } from "../../packages/shared/src/asset-store";
import { runSmoke } from "./smoke";

interface Flaws {
  /** Stores a second write over the first, as a bucket without the write-once policy would. */
  overwrites?: boolean;
  /** Leaves the stamp headers out of the signature. */
  unsignedStamp?: boolean;
  /** The CDN drops the x-amz-meta headers. */
  cdnDropsStamp?: boolean;
}

let server: http.Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function deployment(flaws: Flaws = {}) {
  const keys = new MemoryKeyStore();
  const blobs = new Map<string, { body: Buffer; meta: Record<string, string> }>();
  const signed = new Map<string, Record<string, string>>();
  let base = "";
  const signer: UploadSigner = {
    has: (key) => Promise.resolve(blobs.has(key)),
    presignPut: (key, contentType, sha256, bytes, stamp) => {
      const meta = Object.fromEntries(Object.entries(stampMetadata(stamp)).map(([k, v]) => [`x-amz-meta-${k}`, v]));
      const headers = {
        "Content-Length": String(bytes),
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "If-None-Match": "*",
        "x-amz-checksum-sha256": checksumHeader(sha256),
        ...meta,
      };
      const sig = randomBytes(8).toString("hex");
      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      if (flaws.unsignedStamp) for (const k of Object.keys(meta)) delete lower[k];
      signed.set(sig, lower);
      return Promise.resolve({ url: `${base}/s3/${key}?X-Amz-Signature=${sig}`, headers });
    },
  };
  const endpoint = mcpEndpoint({ keys, signer });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://local");
      if (url.pathname.startsWith("/s3/") && req.method === "PUT") {
        const want = signed.get(url.searchParams.get("X-Amz-Signature") ?? "");
        if (!want) return res.writeHead(403).end("SignatureDoesNotMatch");
        for (const [name, value] of Object.entries(want)) {
          const got = name === "content-length" ? String(body.length) : req.headers[name];
          if (got !== value) return res.writeHead(403).end(`SignatureDoesNotMatch: ${name}`);
        }
        const key = url.pathname.slice(4);
        if (blobs.has(key) && !flaws.overwrites) return res.writeHead(412).end();
        if (createHash("sha256").update(body).digest("base64") !== req.headers["x-amz-checksum-sha256"]) return res.writeHead(400).end("BadDigest");
        const meta = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith("x-amz-meta-")).map(([k, v]) => [k, String(v)]));
        blobs.set(key, { body, meta });
        return res.writeHead(200).end();
      }
      if (url.pathname.startsWith("/cdn/")) {
        const blob = blobs.get(url.pathname.slice(5));
        if (!blob) return res.writeHead(403).end("AccessDenied");
        return res.writeHead(200, flaws.cdnDropsStamp ? {} : blob.meta).end(req.method === "HEAD" ? undefined : blob.body);
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
  await new Promise((resolve) => server!.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { key } = await mintKey(keys, { label: "smoke test", scopes: ["assets:write"], agent: "smoke" });
  return { mcpUrl: `${base}/api/mcp`, storeUrl: `${base}/cdn`, key, blobs };
}

const failed = (checks: Array<{ name: string; ok: boolean }>) => checks.filter((c) => !c.ok).map((c) => c.name);

describe("npm run assets:smoke", () => {
  it("passes against a store that enforces its upload URLs, and leaves only the one good blob", async () => {
    const d = await deployment();
    const checks = await runSmoke({ mcpUrl: d.mcpUrl, storeUrl: d.storeUrl, key: d.key, issue: 723 });
    expect(failed(checks)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(14);
    expect(d.blobs.size).toBe(1);
    const [blob] = [...d.blobs.values()];
    expect(blob!.meta["x-amz-meta-kad-issue"]).toBe("723");
  });

  it("stops at whoami when the key is not a live one", async () => {
    const d = await deployment();
    const checks = await runSmoke({ mcpUrl: d.mcpUrl, storeUrl: d.storeUrl, key: `kadmcp_${"1".repeat(16)}.${"B".repeat(43)}`, issue: 723 });
    expect(failed(checks)).toEqual(["whoami answers for the key"]);
    expect(d.blobs.size).toBe(0);
  });

  it("names what a misconfigured store lets through", async () => {
    const overwrites = await deployment({ overwrites: true });
    expect(failed(await runSmoke({ ...overwrites, issue: 723 }))).toEqual(["a second upload of the same blob is refused (write-once)"]);
    server!.close();

    const unsigned = await deployment({ unsignedStamp: true });
    expect(failed(await runSmoke({ ...unsigned, issue: 723 }))).toEqual(["a changed provenance stamp is refused", "none of the refused uploads stored anything"]);
    server!.close();

    const cdn = await deployment({ cdnDropsStamp: true });
    expect(failed(await runSmoke({ ...cdn, issue: 723 }))).toEqual(["the served stamp names this key and issue"]);
  });
});

describe("npm run assets:smoke, run as a command", () => {
  it("starts from a folder whose path has a space, and without a key prints its usage and exits 2", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad smoke "));
    try {
      // A copy of the script beside a link to the repo's code, so its imports still resolve.
      const copy = path.join(dir, "tools", "assets");
      fs.mkdirSync(copy, { recursive: true });
      for (const f of fs.readdirSync(path.join(root, "tools", "assets"))) if (f.endsWith(".ts")) fs.copyFileSync(path.join(root, "tools", "assets", f), path.join(copy, f));
      fs.symlinkSync(path.join(root, "packages"), path.join(dir, "packages"));
      fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
      fs.copyFileSync(path.join(root, "assets.config.json"), path.join(dir, "assets.config.json"));
      const env = { ...process.env };
      delete env.KAD_MCP_TOKEN;
      const result = spawnSync(process.execPath, [path.join(copy, "smoke.ts")], { cwd: dir, encoding: "utf8", env });
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain("usage: KAD_MCP_TOKEN=");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
