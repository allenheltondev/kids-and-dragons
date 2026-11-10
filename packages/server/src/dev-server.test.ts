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
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOM_OPEN_NEW_LIMIT, TOO_MANY_ROOMS } from "./handlers/code-guard.ts";

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
  // Windows forcibly terminates a process for kill(SIGTERM), without running
  // Node's signal handlers. Bridge a private IPC message to the same handler.
  const args = process.platform === "win32"
    ? ["--import", "tsx", "--input-type=module", "--eval", `process.on("message", m => { if (m === "kad-test-stop") process.emit("SIGTERM"); }); await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`]
    : ["--import", "tsx", SCRIPT];
  const proc = spawn(process.execPath, args, {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", KAD_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
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

async function stopServer(): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  if (process.platform === "win32") child.send("kad-test-stop");
  else child.kill("SIGTERM");
  await exited;
}

async function post(route: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/**
 * A request from another address on this machine. Everything else here
 * arrives from 127.0.0.1, which the room-opening budget never counts
 * (handlers/code-guard.ts); 127.0.0.2 is a client like any other.
 */
function fromElsewhere(
  method: "GET" | "POST",
  route: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        localAddress: "127.0.0.2",
        headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // Not every answer is JSON; the status is what these tests read.
          }
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
        });
      },
    );
    req.once("error", reject);
    req.end(payload);
  });
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
  await stopServer();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /api/room on the dev server: the room-opening budget", () => {
  it("refuses another address that keeps opening rooms, as the Lambda does, and never this machine", async () => {
    const anonymous = { mode: "travel", displayName: "Host" };
    for (let i = 0; i < ROOM_OPEN_NEW_LIMIT; i++) {
      expect((await fromElsewhere("POST", "/api/room", { body: anonymous })).status, `room ${i}`).toBe(200);
    }
    const refused = await fromElsewhere("POST", "/api/room", { body: anonymous });
    expect(refused.status).toBe(429);
    expect(refused.json.error).toMatchObject({ code: "SLOW_DOWN", message: TOO_MANY_ROOMS });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

    // 127.0.0.1 is the end-to-end suite and the load smoke test: hundreds of rooms a minute.
    for (let i = 0; i < ROOM_OPEN_NEW_LIMIT + 5; i++) {
      expect((await post("/api/room", anonymous)).status, `local room ${i}`).toBe(200);
    }
  }, 60_000);
});

describe("session tokens on the dev server", () => {
  it("takes one from the header on API routes, and from the query string on the event stream alone", async () => {
    const opened = await post("/api/room", { mode: "travel", displayName: "Host" });
    expect(opened.status).toBe(200);
    const code = String(opened.json.code);
    const token = String(opened.json.sessionToken);

    const state = (init: RequestInit, query = "") => fetch(`${base}/api/state?code=${code}${query}`, init);
    expect((await state({ headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    // The answer an unknown code gets, exactly as in production.
    expect((await state({}, `&token=${encodeURIComponent(token)}`)).status).toBe(404);

    // `EventSource` cannot set a header, so the stream is the one exception.
    const stop = new AbortController();
    const stream = await fetch(`${base}/events/${code}?sinceSeq=0&token=${encodeURIComponent(token)}`, { signal: stop.signal });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    stop.abort();
    expect((await fetch(`${base}/events/${code}?sinceSeq=0`)).status).toBe(404);
  }, 30_000);
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
    await stopServer();
    const table = await readFile(path.join(dataDir, "dev-table.json"), "utf8");
    // The run row and its state both carry it.
    expect(table.match(/"location":\s*"Grandma's house"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
