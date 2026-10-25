/**
 * The dev server's `/api/room`, over real HTTP.
 *
 * `dev-server.ts` is a script: importing it starts listening, so there is no
 * app to hand a test. This starts the real file in a child process, on a free
 * port and a throwaway data directory, and talks to it the way the client does.
 * What it guards is the two entry points drifting apart: the table name a TV
 * sends is vetted and kept by `lambda/http.ts`, and a name typed against the
 * dev server must come out the same (lambda/http.test.ts has the other half).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./dev-server.ts", import.meta.url));

let child: ChildProcess;
let dataDir: string;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(port: number): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ["--import", "tsx", SCRIPT], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", KAD_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dev server did not start:\n${log}`)), 45_000);
    const onData = (chunk: Buffer): void => {
      log += chunk.toString();
      if (log.includes("Kids & Dragons dev server") && log.includes("table ")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited early (${String(code)}):\n${log}`));
    });
  });
  return proc;
}

async function post(route: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** The room as the TV that opened it sees it. */
async function watch(opened: Record<string, unknown>) {
  return post(`/api/room/${String(opened.code)}/watch`, {}, { "x-kad-device-token": String(opened.deviceToken) });
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "kad-dev-server-"));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = await startServer(port);
}, 60_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/room on the dev server: the table's name", () => {
  it("keeps the name a TV gave its table, trimmed, in the room state", async () => {
    const opened = await post("/api/room", { mode: "party", display: true, location: "  Kitchen   table " });
    expect(opened.status).toBe(200);

    const watched = await watch(opened.json);
    expect(watched.status).toBe(200);
    expect(watched.json).toMatchObject({ state: { location: "Kitchen table" } });
  }, 30_000);

  it("treats a blank name as no name, and turns a refused one away as the Lambda does", async () => {
    const blank = await post("/api/room", { mode: "party", display: true, location: "   " });
    expect(blank.status).toBe(200);
    expect(((await watch(blank.json)).json.state as { location?: string }).location).toBeUndefined();

    const refused = await post("/api/room", { mode: "party", display: true, location: "F U C K" });
    expect(refused.status).toBe(409);
  }, 30_000);

  it("leaves the name on the run, which is what a saved game reads it from", async () => {
    const opened = await post("/api/room", { mode: "party", display: true, location: "Grandma's house" });
    expect(opened.status).toBe(200);

    // The dev table is flushed when the server is told to stop.
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    const table = await readFile(path.join(dataDir, "dev-table.json"), "utf8");
    // The run row and its state both carry it.
    expect(table.match(/"location":\s*"Grandma's house"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
