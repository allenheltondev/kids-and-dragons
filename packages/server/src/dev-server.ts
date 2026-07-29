/**
 * Local dev server — architecture §7.
 *
 * Express on `0.0.0.0:8787`, speaking exactly the protocol in §4 so that the
 * move to API Gateway + Lambda + AppSync Events is wiring, not a rewrite:
 *
 *   this file            →  Lambda entry points (one per route)
 *   MemoryRepository     →  DynamoRepository
 *   LocalSseChannel      →  AppSyncEventsChannel
 *   DevIdentity          →  Cognito + KMS-signed device tokens
 *
 * Everything under `handlers/` is already transport-free and stays untouched by
 * that move. What lives here and nowhere else: HTTP shapes, static files,
 * logging, and the **dev-only bootstrap** that stands in for Cognito so the
 * very first request from a phone on the LAN works with no accounts at all.
 *
 * Binding `0.0.0.0` is not incidental. Nearly all development happens with a
 * laptop and three real devices on the same Wi-Fi (§7); a server on `localhost`
 * is a server nobody at the table can reach.
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { ChannelMessage, Role, RoomMode } from "@kad/shared";
import { LocalSseChannel } from "./channel/room-channel.ts";
import { ContentError, loadContent, type ContentStore } from "./content/loader.ts";
import { loadSharedRuntime } from "./engine/shared-engine.ts";
import { applyAction } from "./handlers/action.ts";
import { setPresence } from "./handlers/presence.ts";
import { PresenceTracker } from "./presence-tracker.ts";
import type { ActionError, HandlerDeps } from "./handlers/deps.ts";
import { iso } from "./handlers/deps.ts";
import { createRoom, joinRoom } from "./handlers/room.ts";
import { getState } from "./handlers/state.ts";
import { DevIdentity, type DeviceIdentity, type SessionIdentity } from "./identity.ts";
import { newId } from "./ids.ts";
import { assetsDir, contentDir, dataDir } from "./paths.ts";
import { MemoryRepository } from "./store/memory-repository.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

/** Assigned round-robin so three characters are never the same colour. */
const PLAYER_COLORS = ["#7FD4C1", "#F2A65A", "#9A8CF2", "#E86A92", "#63B4E8", "#B7D96B"];

/** Everything that does not come out of `@kad/shared`; see `withRuntime()`. */
type BaseDeps = Omit<HandlerDeps, "engine" | "rng">;

async function main(): Promise<void> {
  // Content first, and loudly: a missing chapter must fail here, on a laptop,
  // never at the table (architecture §5).
  let content: ContentStore;
  try {
    content = await loadContent();
  } catch (err) {
    if (err instanceof ContentError) {
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const repo = await MemoryRepository.open({
    filePath: path.join(dataDir(), "dev-table.json"),
  });
  const channel = new LocalSseChannel();
  const presence = new PresenceTracker();
  const identity = new DevIdentity(repo);

  const base: BaseDeps = {
    repo,
    channel,
    content,
    identity,
    random: cryptoRandom,
    now: () => Date.now(),
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(requestLog);
  app.use(devCors);

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  app.post("/api/room", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const mode = readMode(req.body?.mode);
    if (!mode) return sendError(res, 400, "ILLEGAL", "mode must be \"party\" or \"travel\"");

    // Dev-only bootstrap: no Cognito, so the first request also creates the
    // household and its owner. In prod the household already exists and the
    // device token already names a player.
    const existing = await resolvePrincipal(req, base);
    const host =
      existing ?? (await bootstrapHousehold(base, String(req.body?.displayName ?? "Host")));

    const created = await createRoom(
      {
        householdId: host.principal.householdId,
        mode,
        campaignId: req.body?.campaignId ?? null,
      },
      deps,
    );
    if (!created.ok) return sendError(res, statusFor(created.error), created.error.code, created.error.message);

    const joined = await joinRoom({ code: created.value.code, principal: host.principal }, deps);
    if (!joined.ok) return sendError(res, statusFor(joined.error), joined.error.code, joined.error.message);

    res.json({
      ...joined.value,
      code: created.value.code,
      roomCode: created.value.code,
      expiresAt: created.value.expiresAt,
      // The dev stand-in for QR pairing: the client stores this in
      // localStorage and is that player forever after (§4.5).
      ...(host.deviceToken ? { deviceToken: host.deviceToken } : {}),
    });
  });

  app.post("/api/room/:code/join", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const code = String(req.params.code ?? "").toUpperCase();
    const room = await base.repo.getRoom(code);
    if (!room) return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);

    const existing = await resolvePrincipal(req, base);
    // Dev-only: an unbound device gets a player created for it on the spot, so
    // a phone that has never seen this laptop can still join in one tap.
    const joiner =
      existing ??
      (await bootstrapPlayer(base, room.householdId, {
        displayName: String(req.body?.displayName ?? "Player"),
        role: req.body?.role === "child" ? "child" : "adult",
        userAgent: req.get("user-agent"),
      }));

    const joined = await joinRoom({ code, principal: joiner.principal }, deps);
    if (!joined.ok) return sendError(res, statusFor(joined.error), joined.error.code, joined.error.message);

    res.json({
      ...joined.value,
      code,
      roomCode: code,
      expiresAt: room.expiresAt,
      ...(joiner.deviceToken ? { deviceToken: joiner.deviceToken } : {}),
    });
  });

  // -------------------------------------------------------------------------
  // Actions and reconnect
  // -------------------------------------------------------------------------

  app.post("/api/action", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const body = req.body ?? {};
    if (typeof body.runId !== "string" || typeof body.playerId !== "string" || !body.intent) {
      return sendError(res, 400, "ILLEGAL", "expected { runId, playerId, seq, intent }");
    }
    // Prefer the room session token; a device token still works for the dev
    // bootstrap paths that have not joined yet.
    const session = await resolveSession(req, base);
    if (session && session.runId !== body.runId) {
      return sendError(res, 403, "FORBIDDEN", "that session belongs to another run");
    }
    const principal =
      (session
        ? { householdId: session.householdId, playerId: session.playerId, role: session.role }
        : undefined) ?? (await resolvePrincipal(req, base))?.principal;

    /*
     * No principal, no action. Binding the token when one is *present* is not
     * enough: omitting it entirely would fall through to trusting the body's
     * playerId, and party player IDs are in the room state every client holds.
     * The check has to be "prove who you are", not "don't lie if you tell me".
     */
    if (!principal) {
      return sendError(res, 401, "FORBIDDEN", "this action needs a room session token");
    }

    const response = await applyAction(
      {
        runId: body.runId,
        playerId: body.playerId,
        seq: Number(body.seq ?? 0),
        intent: body.intent,
        principal,
      },
      deps,
    );
    // The rejection is part of the protocol, not an HTTP failure: the client
    // reads `error.code` and resyncs. 200 keeps that path free of fetch()
    // error handling on a phone with a flaky connection.
    res.json(response);
  });

  app.get("/api/state", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    // A room code resolves to a run without any identity at all, which is how
    // the TV attaches: it is a pure display client (spec §2.1) that may be
    // hard-refreshed at any time and has no player, no device, and no token.
    let runId = typeof req.query.runId === "string" ? req.query.runId : "";
    const code = typeof req.query.code === "string" ? req.query.code.toUpperCase() : "";
    if (!runId && !code) return sendError(res, 400, "ILLEGAL", "runId or code is required");

    /*
     * The room is what expires, not the run: rooms carry a 6-hour TTL
     * (architecture §3) and run state has none. So whenever a caller names a
     * code — which a stored session always does — the room has to still be
     * open, even if the caller also knows the runId. Skipping that check
     * restores a session whose SSE endpoint 404s and whose token is dead,
     * leaving a phone showing an old game it cannot play instead of saying
     * the room is gone.
     */
    if (code) {
      const room = await base.repo.getRoom(code);
      if (!room) return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);
      if (runId && room.runId !== runId) {
        return sendError(res, 404, "NOT_FOUND", `room ${code} is not that run`);
      }
      runId = room.runId;
    }
    const raw = req.query.sinceSeq;
    const sinceSeq = typeof raw === "string" && raw !== "" ? Number(raw) : undefined;

    const result = await getState({ runId, sinceSeq }, deps);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // -------------------------------------------------------------------------
  // Realtime — the local stand-in for the AppSync Events channel `room/<code>`
  // -------------------------------------------------------------------------

  app.get("/events/:code", async (req: Request, res: Response) => {
    const code = String(req.params.code ?? "").toUpperCase();
    const room = await base.repo.getRoom(code);
    if (!room) return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);

    const state = await base.repo.getState(room.runId);
    if (!state) return sendError(res, 404, "NOT_FOUND", `run ${room.runId} has no state`);

    // Snapshot on connect, then patches from that snapshot's seq. Anything
    // published between the read and the attach is covered by the channel's
    // replay buffer, so the client never sees a patch it cannot apply — and
    // `attach` owns teardown when the phone walks out of Wi-Fi range.
    const snapshot: ChannelMessage = {
      kind: "snapshot",
      seq: state.seq,
      runId: state.runId,
      state,
    };
    // `attach` owns its own teardown on close, and its detach is idempotent —
    // the close handler below is only about presence.
    channel.attach(code, res, { preamble: snapshot, sinceSeq: state.seq });

    /*
     * The stream is the only evidence of who is still at the table. A phone
     * that closes its tab or walks out of Wi-Fi never sends anything again, so
     * without this its party member stays `connected` forever and every
     * ready-gate waits on a device that is gone (see handlers/presence.ts).
     *
     * A display client carries no session and is nobody's presence.
     */
    const viewer = await resolveSession(req, base);
    if (viewer && viewer.runId === room.runId) {
      const runId = room.runId;
      const playerId = viewer.playerId;
      // Counted, not toggled: a refresh overlaps two streams and the old one
      // often closes last, which would mark a player away while they are
      // sitting right there (see presence-tracker.ts).
      if (presence.open(runId, playerId)) {
        void setPresence({ runId, playerId, connected: true }, base);
      }
      res.on("close", () => {
        if (presence.close(runId, playerId)) {
          void setPresence({ runId, playerId, connected: false }, base).catch(() => undefined);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // Static + health
  // -------------------------------------------------------------------------

  // Same URLs as prod, where CloudFront serves both prefixes from S3.
  app.use("/assets", express.static(assetsDir(), { fallthrough: false }));
  app.use("/content", express.static(contentDir(), { fallthrough: false }));

  app.get("/api/health", async (_req: Request, res: Response) => {
    const engine = await loadSharedRuntime().then(
      () => "ready" as const,
      () => "unavailable" as const,
    );
    res.json({
      ok: true,
      service: "kad-dev-server",
      time: iso(Date.now()),
      uptimeSeconds: Math.round(process.uptime()),
      engine,
      content: {
        root: content.root,
        chapters: content.chapterIds().length,
        rulesVersion: content.rules().version,
      },
      rooms: channel.roomCodes().length,
    });
  });

  app.use((req: Request, res: Response) => {
    sendError(res, 404, "NOT_FOUND", `no route ${req.method} ${req.path}`);
  });

  // Error shape matches ActionResponse.error so the client has one parser.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err);
    if (res.headersSent) return;
    sendError(res, 500, "ILLEGAL", err instanceof Error ? err.message : String(err));
  });

  const server = http.createServer(app);
  server.listen(PORT, HOST, () => {
    console.log(`\n  Kids & Dragons dev server`);
    for (const url of lanUrls(PORT)) console.log(`    ${url}`);
    console.log(`    content  ${content.root} (${content.chapterIds().length} chapters)`);
    console.log(`    table    ${path.join(dataDir(), "dev-table.json")}\n`);
  });

  const shutdown = (): void => {
    server.close();
    // Flush the dev table before exiting so a Ctrl-C never costs a character.
    void repo.flush().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Dev-only bootstrap — the stand-in for Cognito + QR pairing (§4.5).
// Every function below this line disappears when roadmap Chapter 1 lands.
// ---------------------------------------------------------------------------

interface BootstrappedPrincipal {
  principal: DeviceIdentity;
  /** Present only when a new device was just bound. */
  deviceToken?: string;
}

async function bootstrapHousehold(
  deps: BaseDeps,
  displayName: string,
): Promise<BootstrappedPrincipal> {
  const householdId = newId("h");
  await deps.repo.putHousehold({
    id: householdId,
    displayName: `${displayName}'s household`,
    // No Cognito locally, so there is no real sub. Named so it is obvious in
    // the dev table that this household was never authenticated.
    ownerSub: `dev-${householdId}`,
    createdAt: iso(deps.now()),
  });
  return bootstrapPlayer(deps, householdId, { displayName, role: "adult" });
}

async function bootstrapPlayer(
  deps: BaseDeps,
  householdId: string,
  input: { displayName: string; role: Role; userAgent?: string | undefined },
): Promise<BootstrappedPrincipal> {
  const existing = await deps.repo.listPlayers(householdId);
  const playerId = newId("p");
  await deps.repo.putPlayer({
    id: playerId,
    householdId,
    displayName: input.displayName,
    color: PLAYER_COLORS[existing.length % PLAYER_COLORS.length] ?? "#7FD4C1",
    role: input.role,
  });
  const { token, deviceId } = await deps.identity.issueDeviceToken({
    householdId,
    playerId,
    role: input.role,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return {
    principal: { deviceId, householdId, playerId, role: input.role },
    deviceToken: token,
  };
}

/** Header first, body second — a real client always sends the header. */
async function resolvePrincipal(
  req: Request,
  deps: BaseDeps,
): Promise<BootstrappedPrincipal | null> {
  const token = req.get("x-kad-device-token") ?? req.body?.deviceToken;
  if (typeof token !== "string" || token === "") return null;
  const principal = await deps.identity.resolveDevice(token);
  return principal ? { principal } : null;
}

/**
 * The room-scoped token issued at join, presented as `Authorization: Bearer`.
 *
 * This is what actually authenticates play. Without it `applyAction` receives
 * no principal at all and falls back to trusting the `playerId` in the request
 * body — and party player IDs are in the room state every client already has,
 * so any phone in the room could roll and choose as anybody else. It is a
 * family game, but "she taps and it moves someone else's character" is a bad
 * evening, and the fix is a token we were already issuing and never reading.
 */
async function resolveSession(req: Request, deps: BaseDeps): Promise<SessionIdentity | null> {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  // `EventSource` cannot set headers, so the SSE stream has nowhere to put its
  // token but the query string. Everything else uses the header.
  const query = typeof req.query?.token === "string" ? req.query.token : "";
  const body = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : "";
  const token = match?.[1] ?? (query || body);
  if (!token) return null;
  return deps.identity.resolveSession(token);
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/**
 * Binds the game runtime per request rather than at boot. `@kad/shared` is compiled
 * on the fly by `tsx`, so a syntax error in it would otherwise take the whole
 * dev server down mid-session; this way it is a 503 on `/api/action` and the
 * next request after the fix works.
 */
async function withRuntime(base: BaseDeps, res: Response): Promise<HandlerDeps | null> {
  try {
    const runtime = await loadSharedRuntime();
    return { ...base, engine: runtime.engine, rng: runtime.rng };
  } catch (err) {
    sendError(res, 503, "ILLEGAL", `game engine unavailable: ${String(err)}`);
    return null;
  }
}

function readMode(value: unknown): RoomMode | null {
  return value === "party" || value === "travel" ? value : null;
}

function statusFor(error: ActionError): number {
  switch (error.code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "STALE_SEQ":
    case "ILLEGAL":
      return 409;
  }
}

function sendError(res: Response, status: number, code: ActionError["code"], message: string): void {
  res.status(status).json({ ok: false, error: { code, message } });
}

function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    // SSE streams never "finish" until the client leaves, which is exactly the
    // number you want to see for them.
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
}

/**
 * Dev-only CORS. The Vite dev server proxies `/api` and `/events` (so the
 * browser sees one origin), but curl from a phone and one-off debugging hit
 * 8787 directly, and a CORS error there is a confusing way to lose ten minutes.
 */
function devCors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", req.get("origin") ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-kad-device-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

/** Crypto-backed uniform [0, 1). Room codes must not be guessable. */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 0x1_0000_0000;
}

/** Printed at boot so a phone can be pointed at the laptop without ipconfig. */
function lanUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
