import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobKey, serializeLock } from "../../shared/src/asset-store";
import { hashBytes } from "../../shared/src/asset-cache";
import { assetStoreFallback } from "./dev-assets";

let tmp: string;
let close: (() => void) | null = null;

beforeEach(() => {
  // A dotted cache folder on purpose: the real one is ~/.cache.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kad-dev-assets-"));
  process.env.KAD_ASSET_CACHE = path.join(tmp, ".cache", "kad-assets");
});

afterEach(() => {
  close?.();
  close = null;
  delete process.env.KAD_ASSET_CACHE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function repo(storeUrl: string | null): string {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, "assets", "cast", "pib"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets.config.json"), JSON.stringify({ storeUrl }));
  return root;
}

async function serve(root: string): Promise<string> {
  const app = express();
  const fallback = assetStoreFallback(root, path.join(root, "assets"));
  if (fallback) app.use("/assets", fallback);
  app.use("/assets", express.static(path.join(root, "assets"), { fallthrough: false }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  close = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("the dev server's asset store fallback", () => {
  it("serves art the tree does not have from the store, and art the tree has from disk", async () => {
    const storeDir = path.join(tmp, "store");
    const root = repo(`file://${storeDir}`);
    const painting = new TextEncoder().encode("pib, from the store");
    const sha = hashBytes(painting);
    fs.mkdirSync(path.dirname(path.join(storeDir, blobKey(sha, "x.png"))), { recursive: true });
    fs.writeFileSync(path.join(storeDir, blobKey(sha, "x.png")), painting);
    fs.writeFileSync(
      path.join(root, "assets.lock.json"),
      serializeLock({ version: 1, files: { "assets/cast/pib/assembled.png": { sha256: sha, bytes: painting.length } } }),
    );
    fs.writeFileSync(path.join(root, "assets", "manifest.json"), "{}");
    const base = await serve(root);

    const fromStore = await fetch(`${base}/assets/cast/pib/assembled.png`);
    expect(fromStore.status).toBe(200);
    expect(fromStore.headers.get("content-type")).toBe("image/png");
    expect(await fromStore.text()).toBe("pib, from the store");

    // An unpushed edit on disk wins.
    fs.writeFileSync(path.join(root, "assets/cast/pib/assembled.png"), "pib, just painted");
    expect(await (await fetch(`${base}/assets/cast/pib/assembled.png`)).text()).toBe("pib, just painted");

    expect((await fetch(`${base}/assets/manifest.json`)).status).toBe(200);
    expect((await fetch(`${base}/assets/cast/nobody.png`)).status).toBe(404);
  });

  it("is off with no store configured", () => {
    expect(assetStoreFallback(repo(null), path.join(tmp, "repo", "assets"))).toBeNull();
  });

  it("is off when the served folder is not the tree the lock describes", () => {
    const root = repo("file:///nowhere");
    expect(assetStoreFallback(root, path.join(tmp, "elsewhere"))).toBeNull();
  });
});
