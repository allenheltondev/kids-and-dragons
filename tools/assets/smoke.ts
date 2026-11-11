/**
 * The asset store's smoke test against a real deployment (#723, docs/asset-store.md "Smoke test").
 *
 *   KAD_MCP_TOKEN=kadmcp_… npm run assets:smoke -- --mcp-url https://<stage>/api/mcp [--store-url URL] [--issue 723]
 *
 * Proves, with one fresh test blob, what the unit tests can only fake: the MCP server answers
 * and refuses as it should, the upload URL S3 signs really enforces write-once, the checksum,
 * the size and the provenance stamp, and the store's CDN serves the bytes and the stamp back.
 * Uses an `assets:write` key for production, the only account with a store, minted for the
 * test and revoked after it.
 *
 * Leaves one small blob in the store (a second set of bytes lands only if a refusal check
 * fails). It is write-once and stays, like every blob, labelled `smoke/…` in its stamp's path.
 *
 * Built-ins only (fetch), like the rest of tools/assets' plain-node path.
 */

import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { blobKey, readStamp } from "../../packages/shared/src/asset-store.ts";
import { loadConfig, REPO_ROOT } from "./lib.ts";
import { McpBlobStore } from "./mcp-store.ts";

export interface SmokeOptions {
  mcpUrl: string;
  storeUrl: string;
  key: string;
  issue: number;
  log?: (line: string) => void;
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

interface UploadAnswer {
  status: string;
  url?: string;
  headers?: Record<string, string>;
  key?: string;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function runSmoke(options: SmokeOptions): Promise<SmokeCheck[]> {
  const log = options.log ?? (() => {});
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail: string): boolean => {
    checks.push({ name, ok, detail });
    log(`  ${ok ? "pass" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
    return ok;
  };
  const mcp = new McpBlobStore(options.mcpUrl, options.key);
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  // Bytes no one has stored before, so every answer below is about this run.
  const a = new TextEncoder().encode(`kad asset-store smoke ${stamp} ${randomBytes(16).toString("hex")}`);
  const b = new TextEncoder().encode(`kad asset-store smoke ${stamp} ${randomBytes(16).toString("hex")} tampered-target`);
  const pathA = `smoke/${stamp}-a.png`;
  const pathB = `smoke/${stamp}-b.png`;

  // 1. Who may call.
  const stranger = new McpBlobStore(options.mcpUrl, `kadmcp_${"0".repeat(16)}.${"A".repeat(43)}`);
  try {
    await stranger.callTool("whoami", {});
    check("a made-up key is refused", false, "the server answered whoami");
  } catch (error) {
    check("a made-up key is refused", /wants a key|401/.test((error as Error).message), (error as Error).message.slice(0, 120));
  }
  let label = "";
  try {
    const who = await mcp.callTool("whoami", {});
    label = String(who.label ?? "");
    const scopes = (who.scopes as string[] | undefined) ?? [];
    check("whoami answers for the key", scopes.includes("assets:write"), `label "${label}", scopes ${scopes.join(", ")}`);
  } catch (error) {
    check("whoami answers for the key", false, (error as Error).message);
    return checks;
  }

  // 2. An upload URL, used exactly as given.
  const ask = async (path: string, bytes: Uint8Array): Promise<UploadAnswer> => {
    const result = (await mcp.callTool("request_uploads", { files: [{ path, sha256: sha256(bytes), bytes: bytes.length }], issue: options.issue })) as {
      uploads: UploadAnswer[];
    };
    return result.uploads[0]!;
  };
  const answerA = await ask(pathA, a);
  if (!check("request_uploads gives a URL for new bytes", answerA.status === "upload" && !!answerA.url, `status ${answerA.status}`)) return checks;
  const put = (url: string, headers: Record<string, string>, body: Uint8Array) => fetch(url, { method: "PUT", headers, body });
  const first = await put(answerA.url!, answerA.headers!, a);
  check("the upload URL stores the bytes", first.ok, `HTTP ${first.status}`);
  const again = await put(answerA.url!, answerA.headers!, a);
  check("a second upload of the same blob is refused (write-once)", again.status === 412, `HTTP ${again.status}`);
  const askedAgain = await ask(pathA, a);
  check("request_uploads now answers stored", askedAgain.status === "stored", `status ${askedAgain.status}`);

  // 3. What the signature must refuse. Each on a fresh URL for bytes B, which never land.
  const answerB = await ask(pathB, b);
  if (answerB.status !== "upload" || !answerB.url) {
    check("request_uploads gives a URL for the refusal checks", false, `status ${answerB.status}`);
  } else {
    const headers = answerB.headers!;
    const tampered = new Uint8Array(b);
    tampered[tampered.length - 1]! ^= 1;
    const refused = async (name: string, h: Record<string, string>, body: Uint8Array) => {
      try {
        const res = await put(answerB.url!, h, body);
        check(name, res.status >= 400 && res.status < 500, `HTTP ${res.status}`);
      } catch (error) {
        // A request that never left this machine proves nothing about the store.
        check(name, false, `the request failed here: ${(error as Error).message}`);
      }
    };
    const without = (name: string): Record<string, string> =>
      Object.fromEntries(Object.entries(headers).filter(([h]) => h.toLowerCase() !== name));
    await refused("bytes that do not match the hash are refused", headers, tampered);
    // fetch will not send a body that disagrees with its own Content-Length, so the longer
    // body goes without the signed length: the signature no longer matches what arrives.
    await refused("a body of a different size is refused", without("content-length"), new Uint8Array([...b, 0x21]));
    await refused("an upload without If-None-Match is refused", without("if-none-match"), b);
    const forged = { ...headers };
    const uploaderHeader = Object.keys(forged).find((h) => h.toLowerCase() === "x-amz-meta-kad-uploader");
    if (uploaderHeader) {
      forged[uploaderHeader] = "someone-else";
      await refused("a changed provenance stamp is refused", forged, b);
    } else {
      check("a changed provenance stamp is refused", false, "the upload URL carries no stamp header");
    }
    const stored = await mcp.callTool("check_uploads", { files: [{ path: pathB, sha256: sha256(b) }] });
    const files = (stored.files as Array<{ stored: boolean }> | undefined) ?? [];
    check("none of the refused uploads stored anything", files[0]?.stored === false, `stored ${String(files[0]?.stored)}`);
  }

  // 4. The store's CDN serves the bytes and their stamp, without credentials.
  const key = blobKey(sha256(a), pathA);
  const res = await fetch(`${options.storeUrl.replace(/\/+$/, "")}/${key}`);
  if (check("the store serves the blob", res.ok, `HTTP ${res.status} for ${key}`)) {
    const body = new Uint8Array(await res.arrayBuffer());
    check("the served bytes are the uploaded bytes", sha256(body) === sha256(a), "");
    const served = readStamp((name) => res.headers.get(name));
    check(
      "the served stamp names this key and issue",
      served?.uploader === label && served.via === "mcp" && served.issue === options.issue && served.path === pathA,
      served ? `uploader "${served.uploader}", via ${served.via}, issue ${String(served.issue)}, path ${served.path}` : "no stamp headers",
    );
  }
  const missing = await fetch(`${options.storeUrl.replace(/\/+$/, "")}/${blobKey("f".repeat(64), "x.png")}`, { method: "HEAD" });
  check("a blob that does not exist is not served", missing.status === 403 || missing.status === 404, `HTTP ${missing.status}`);

  return checks;
}

// Compare URLs, not a URL with a path: on Windows, or with a space in the path, the two never
// match and the tool would print nothing and exit 0 (#739).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { "mcp-url": { type: "string" }, "store-url": { type: "string" }, issue: { type: "string" } },
  });
  const config = loadConfig(REPO_ROOT);
  const mcpUrl = values["mcp-url"] ?? config.mcpUrl;
  const storeUrl = values["store-url"] ?? config.storeUrl;
  const key = process.env.KAD_MCP_TOKEN;
  if (!mcpUrl || !storeUrl || !key) {
    console.error("usage: KAD_MCP_TOKEN=kadmcp_… npm run assets:smoke -- [--mcp-url URL] [--store-url URL] [--issue N]");
    console.error("  The key needs assets:write; mint a one-day production key for it and revoke it after (docs/asset-store.md, \"Smoke test\").");
    process.exit(2);
  }
  console.log(`assets:smoke against ${mcpUrl} and ${storeUrl}`);
  runSmoke({ mcpUrl, storeUrl, key, issue: Number(values.issue ?? 723), log: (l) => console.log(l) }).then(
    (checks) => {
      const failed = checks.filter((c) => !c.ok);
      console.log(failed.length ? `\n${failed.length} of ${checks.length} checks failed.` : `\nAll ${checks.length} checks passed.`);
      process.exit(failed.length ? 1 : 0);
    },
    (error: unknown) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
