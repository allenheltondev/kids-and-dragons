/**
 * The post-deploy smoke test (tools/deploy/smoke.ts) against a stand-in site: a healthy one
 * passes every check, and each way a deploy can be broken fails the check that names it.
 */

import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSiteSmoke } from "./smoke";

interface Site {
  page: string;
  bundle: { status: number; body: string };
  health: { status: number; body: unknown };
  config: { status: number; body: unknown };
  state: { status: number; body: unknown };
  rules: { status: number; body: unknown };
  manifest: { status: number; body: unknown };
  /** How many of the next requests to /api/health answer 503 first, as a cold start can. */
  notYet: number;
}

const healthy = (): Site => ({
  page: '<!doctype html><html><head><script type="module" crossorigin src="/bundle/index-abc123.js"></script></head><body></body></html>',
  bundle: { status: 200, body: "console.log('game')" },
  health: { status: 200, body: { ok: true, service: "kad-api", content: { chapters: 41, campaigns: 3, rulesVersion: 1 }, store: "ok" } },
  config: { status: 200, body: { region: "us-east-1", realtime: { httpDomain: "a.example", realtimeDomain: "b.example", namespace: "room" }, auth: { userPoolId: "pool", clientId: "client" } } },
  state: { status: 400, body: { ok: false, error: { code: "ILLEGAL", message: "runId or code is required" } } },
  rules: { status: 200, body: { version: 1 } },
  manifest: { status: 200, body: { cast: {} } },
  notYet: 0,
});

let site: Site;
let server: http.Server;
let base: string;
const asked: string[] = [];

beforeEach(async () => {
  site = healthy();
  asked.length = 0;
  server = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const url = req.url ?? "";
    if (url === "/") return send(200, site.page, "text/html");
    if (url.startsWith("/bundle/")) return send(site.bundle.status, site.bundle.body, "text/javascript");
    if (url === "/api/health?deep=1") {
      if (site.notYet > 0) {
        site.notYet--;
        return send(503, { message: "Service Unavailable" });
      }
      return send(site.health.status, site.health.body);
    }
    if (url === "/api/config") return send(site.config.status, site.config.body);
    if (url === "/api/state") return send(site.state.status, site.state.body);
    if (url === "/content/rules.json") return send(site.rules.status, site.rules.body);
    if (url === "/assets/manifest.json") return send(site.manifest.status, site.manifest.body);
    return send(404, { message: "Not Found" });
  });
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server.close();
});

const run = () => runSiteSmoke({ site: base, tries: 3, wait: 0 });
const failed = async () => (await run()).filter((c) => !c.ok).map((c) => c.name);

describe("deploy:smoke", () => {
  it("passes every check against a healthy site, and asks for the deep health check", async () => {
    const checks = await run();
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks).toHaveLength(11);
    expect(asked).toContain("/api/health?deep=1");
    expect(asked).toContain("/bundle/index-abc123.js");
  });

  it("takes a site address with a trailing slash", async () => {
    const checks = await runSiteSmoke({ site: `${base}/`, tries: 1, wait: 0 });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("fails on an API that cannot boot, and says which part", async () => {
    site.health = { status: 503, body: { ok: false, service: "kad-api", failed: "boot" } };
    const checks = await run();
    expect(checks.find((c) => c.name === "the API is healthy")).toMatchObject({ ok: false, detail: "HTTP 503, failed: boot" });
    expect(checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "the API is healthy",
      "the API loaded its chapters",
      "the API can read its table",
      "the site's content is the version the API loaded",
    ]);
  });

  it("fails on an API that shipped no chapters", async () => {
    site.health = { status: 503, body: { ok: false, failed: "content", content: { chapters: 0, campaigns: 0, rulesVersion: 1 } } };
    expect(await failed()).toEqual(["the API is healthy", "the API loaded its chapters", "the API can read its table"]);
  });

  it("fails on an API that cannot read its table", async () => {
    site.health = { status: 503, body: { ok: false, failed: "store", store: "unreachable", content: { chapters: 41, campaigns: 3, rulesVersion: 1 } } };
    expect(await failed()).toEqual(["the API is healthy", "the API can read its table"]);
  });

  it("fails on the old health answer, which said ok and checked nothing", async () => {
    site.health = { status: 200, body: { ok: true, service: "kad-api", time: "2026-11-11T00:00:00.000Z" } };
    expect(await failed()).toEqual(["the API loaded its chapters", "the API can read its table", "the site's content is the version the API loaded"]);
  });

  it("fails when the page names a bundle the site no longer has", async () => {
    site.bundle = { status: 404, body: "" };
    expect(await failed()).toEqual(["the site serves that bundle"]);
  });

  it("fails when the page names no bundle at all", async () => {
    site.page = "<html><body>Under maintenance</body></html>";
    expect(await failed()).toEqual(["the page names a script bundle"]);
  });

  it("fails when the client's configuration is missing a field", async () => {
    site.config = { status: 200, body: { realtime: { httpDomain: "a.example", realtimeDomain: "b.example" }, auth: { userPoolId: "pool" } } };
    const checks = await run();
    expect(checks.find((c) => c.name === "the API hands the client its configuration")).toMatchObject({ ok: false, detail: "HTTP 200, missing auth.clientId" });
  });

  it("fails when a routed request crashes rather than being refused", async () => {
    site.state = { status: 500, body: { ok: false, error: { code: "ILLEGAL", message: "something went wrong on our side; try again" } } };
    expect(await failed()).toEqual(["a routed request is refused in the API's own shape"]);
  });

  it("fails when the site and the API hold different content", async () => {
    site.rules = { status: 200, body: { version: 2 } };
    const checks = await run();
    expect(checks.find((c) => c.name === "the site's content is the version the API loaded")).toMatchObject({ ok: false, detail: "site 2, API 1" });
  });

  it("fails when the art's index is missing", async () => {
    site.manifest = { status: 404, body: { message: "Not Found" } };
    expect(await failed()).toEqual(["the site serves the art's index"]);
  });

  it("waits out a cold start: a 503 or two, then the real answer", async () => {
    site.notYet = 2;
    const checks = await run();
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(asked.filter((u) => u === "/api/health?deep=1")).toHaveLength(3);
  });

  it("gives up on an API that never recovers, after the tries it was given", async () => {
    site.notYet = 99;
    expect(await failed()).toContain("the API is healthy");
    expect(asked.filter((u) => u === "/api/health?deep=1")).toHaveLength(3);
  });

  it("fails every check, without throwing, when nothing answers at all", async () => {
    server.close();
    const checks = await runSiteSmoke({ site: "http://127.0.0.1:9", tries: 1, wait: 0 });
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => !c.ok)).toBe(true);
    expect(checks[0]?.detail).toMatch(/no answer/);
  });
});

describe("deploy:smoke, run as a command", () => {
  const cli = path.resolve("tools/deploy/smoke.ts");

  it("exits 0 and prints a line per check against a healthy site", async () => {
    const result = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
      // Not spawnSync: the stand-in site lives in this process and must keep answering.
      const child = spawn(process.execPath, [cli, "--site", base, "--tries", "1", "--wait", "0"]);
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.on("close", (status: number | null) => resolve({ status, stdout }));
    });
    expect(result.stdout).toMatch(/All 11 checks passed\./);
    expect(result.stdout).toMatch(/pass {2}the API can read its table: store: ok/);
    expect(result.status).toBe(0);
  }, 60_000);

  it("exits 2 with its usage when no site is given", () => {
    const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage: npm run deploy:smoke -- --site/);
  }, 60_000);
});
