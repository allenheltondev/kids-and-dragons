/**
 * Local dev server — architecture §7.
 *
 * Express on `0.0.0.0:8787`, speaking exactly the protocol in §4 so that the
 * move to API Gateway + Lambda + AppSync Events is wiring, not a rewrite:
 *
 *   this file            →  Lambda entry points (one per route)
 *   MemoryRepository     →  DynamoRepository
 *   LocalSseChannel      →  AppSyncEventsChannel
 *   DevIdentity          →  Cognito + signed device tokens
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
import type { ChannelMessage, RoomMode } from "@kad/shared";
import { LocalSseChannel } from "./channel/room-channel.ts";
import { ContentError, loadContent, type ContentStore } from "./content/loader.ts";
import { loadSharedRuntime } from "./engine/shared-engine.ts";
import { addPlayer, adoptDevice, createGuestHousehold, linkAccount, vetTypedName } from "./handlers/account.ts";
import { applyAction } from "./handlers/action.ts";
import { reportClientError } from "./handlers/client-error.ts";
import {
  admitCodeLookup,
  clientKeyFor,
  retryAfterSeconds,
  SLOW_DOWN,
} from "./handlers/code-guard.ts";
import { relayPreview } from "./handlers/preview.ts";
import { beatPresence, setPresence } from "./handlers/presence.ts";
import { PresenceTracker } from "./presence-tracker.ts";
import type { ActionError, HandlerDeps, HandlerResult } from "./handlers/deps.ts";
import { iso } from "./handlers/deps.ts";
import { admitNewPhone, bindNewPhone, createRoom, findRoom, joinRoom, settleRoom, watchRoom } from "./handlers/room.ts";
import { setVisitors } from "./handlers/visitors.ts";
import { removePlayer } from "./handlers/remove.ts";
import { handKeeper } from "./handlers/keeper.ts";
import { closeRoom, lockRoom, setQuiet, type HostPrincipal } from "./handlers/host.ts";
import { releaseSavedHero, resumeGame, stopForToday } from "./handlers/save.ts";
import { listHeroes } from "./handlers/heroes.ts";
import { getJournal } from "./handlers/journal.ts";
import { saveFlair } from "./handlers/profile.ts";
import { getState } from "./handlers/state.ts";
import { organizerRoute } from "./handlers/organizer.ts";
import { isSlowDown, pairFromDevice, redeemPairingCode } from "./handlers/pairing.ts";
import { isOut } from "./handlers/remove.ts";
import {
  forgetDevice,
  listSharedPlayers,
  seatOnSharedDevice,
  shareDevice,
  tabletHost,
} from "./handlers/shared-device.ts";
import {
  DevIdentity,
  type DeviceIdentity,
  type SessionIdentity,
  type SharedDeviceIdentity,
} from "./identity.ts";
import { installNarrator } from "./llm/install.ts";
import { assetsDir, contentDir, dataDir } from "./paths.ts";
import { verifyDevToken } from "./dev-auth.ts";
import { MemoryRepository } from "./store/memory-repository.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
/** Stream-based presence beside the heartbeats; off to run as production does. */
const STREAM_PRESENCE = process.env.KAD_STREAM_PRESENCE !== "off";
/** How long a quiet phone stays here; the handler's two minutes when unset. */
const PRESENCE_AWAY_MS = Number(process.env.KAD_PRESENCE_AWAY_MS) || undefined;

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
    /*
     * Roadmap chapter 6's playtest cheats — warp to any scene, load the next
     * d20 — are on here and only here. This is the same line `DevIdentity`
     * sits on above: the local server is allowed to do things a deployed one
     * must not, and the boundary is which file constructs the dependency
     * rather than a flag either of them could read. `lambda/runtime.ts` passes
     * a literal `false`, so there is nothing to misconfigure in prod.
     */
    playtest: true,
    /*
     * The live narration layer — roadmap chapter 7. Off unless
     * `LIVE_LLM_ENABLED=true` is in the environment, which is why the local
     * loop is unchanged for anybody who has not asked for it (§6.6).
     */
    // `assertCache: true` — this is the development environment §6.3 wants the
    // cache assertion loud in.
    narrator: installNarrator(content, true),
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
    const display = req.body?.display === true;
    if (display && mode !== "party") return sendError(res, 400, "ILLEGAL", "only a Party Mode room has a TV");

    // A shared tablet opens a room for the kid picked on it (#250), as in
    // lambda/http.ts: a session token back, never a device token.
    const shared = await resolveShared(req, base);
    if (shared !== undefined) {
      if (!shared) return forgottenDevice(res);
      if (display) {
        // The tablet as the TV (#274): its own household, nobody seated, no
        // device token or session handed back.
        const tv = await createRoom(
          { householdId: shared.householdId, mode, campaignId: req.body?.campaignId ?? null, hostDeviceId: shared.deviceId, display: true },
          deps,
        );
        if (!tv.ok) return sendError(res, statusFor(tv.error), tv.error.code, tv.error.message);
        return res.json({ ...tv.value, roomCode: tv.value.code, host: true });
      }
      const seat = await seatOnSharedDevice(
        { shared, playerId: req.body?.playerId, newPlayer: req.body?.newPlayer },
        base,
      );
      if (!seat.ok) return sendError(res, statusFor(seat.error), seat.error.code, seat.error.message);
      const opened = await createRoom(
        { householdId: shared.householdId, mode, campaignId: req.body?.campaignId ?? null, hostDeviceId: shared.deviceId },
        deps,
      );
      if (!opened.ok) return sendError(res, statusFor(opened.error), opened.error.code, opened.error.message);
      const seated = await joinRoom({ code: opened.value.code, principal: seat.value, device: "tablet" }, deps);
      if (!seated.ok) return sendError(res, statusFor(seated.error), seated.error.code, seated.error.message);
      return res.json({
        ...seated.value,
        code: opened.value.code,
        roomCode: opened.value.code,
        expiresAt: opened.value.expiresAt,
      });
    }

    // Anonymous play (§4.5): a device nobody has seen before gets a household on
    // the spot. It is a real household — the only thing it lacks is an owner,
    // and the only consequence is that it expires unless somebody signs in.
    const existing = await resolvePrincipal(req, base);
    const hostName = vetTypedName(req.body?.displayName, "Host");
    if (!existing && !hostName.ok) return sendError(res, statusFor(hostName.error), hostName.error.code, hostName.error.message);
    const host =
      existing ??
      (await createGuestHousehold(
        {
          displayName: hostName.ok ? hostName.value : "Host",
          userAgent: req.get("user-agent"),
          display,
        },
        base,
      ));

    const created = await createRoom(
      {
        householdId: host.principal.householdId,
        mode,
        campaignId: req.body?.campaignId ?? null,
        claimable: display,
        hostDeviceId: host.principal.deviceId,
      },
      deps,
    );
    if (!created.ok) return sendError(res, statusFor(created.error), created.error.code, created.error.message);

    // The TV opened the room: it is the lobby, not a seat (see lambda/http.ts).
    if (display) {
      return res.json({
        ...created.value,
        roomCode: created.value.code,
        host: true,
        ...(host.deviceToken ? { deviceToken: host.deviceToken } : {}),
      });
    }

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

    const typed = String(req.params.code ?? "").toUpperCase();
    const lookup = await admitCodeLookup(clientOf(req), deps);
    if (!lookup) return slowDown(res, deps);
    // Four letters, or an open room's six-letter visitor code (#249).
    const named = await findRoom(typed, base);
    if (!named) return sendError(res, 404, "NOT_FOUND", `no open room ${typed}`);
    await lookup.hit();
    const found = named.room;
    const code = found.code;
    const visitor = named.visitorCode ? { visitorCode: named.visitorCode } : {};

    // A shared tablet seats the kid picked on it, and never falls through to
    // `addPlayer` (#250, see lambda/http.ts).
    const shared = await resolveShared(req, base);
    if (shared !== undefined) {
      if (!shared) return forgottenDevice(res);
      const seat = await seatOnSharedDevice(
        { shared, playerId: req.body?.playerId, newPlayer: req.body?.newPlayer },
        base,
      );
      if (!seat.ok) return sendError(res, statusFor(seat.error), seat.error.code, seat.error.message);
      const seated = await joinRoom({ code, principal: seat.value, device: "tablet", ...visitor }, deps);
      if (!seated.ok) return sendError(res, statusFor(seated.error), seated.error.code, seated.error.message);
      return res.json({ ...seated.value, code, roomCode: code, expiresAt: found.expiresAt });
    }

    const existing = await resolvePrincipal(req, base);
    // Settled first for a new phone — see lambda/http.ts.
    const settled = existing ? null : await settleRoom(found, found.householdId, deps);
    if (settled && !settled.ok) {
      return sendError(res, statusFor(settled.error), settled.error.code, settled.error.message);
    }
    const room = settled ? settled.value : found;
    if (!room) return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);
    // An unbound device joining a room gets a player created for it on the spot,
    // so a phone that has never seen this game joins in one tap. On a visitor
    // code it is a visitor, in a guest household of its own (#249).
    // Admitted before anything is bound — see lambda/http.ts.
    const joinerName = vetTypedName(req.body?.displayName, "Player");
    if (!existing && !joinerName.ok) return sendError(res, statusFor(joinerName.error), joinerName.error.code, joinerName.error.message);
    let admitted: "family" | "visitor" | null = null;
    if (!existing) {
      const admission = await admitNewPhone(room, named.visitorCode, deps);
      if (!admission.ok) {
        return sendError(res, statusFor(admission.error), admission.error.code, admission.error.message);
      }
      admitted = admission.value;
    }
    const joiner =
      existing ??
      (await bindNewPhone(
        room,
        admitted ?? "family",
        { displayName: joinerName.ok ? joinerName.value : "Player", userAgent: req.get("user-agent") },
        base,
      ));

    const joined = await joinRoom({ code, principal: joiner.principal, ...visitor }, deps);
    if (!joined.ok) return sendError(res, statusFor(joined.error), joined.error.code, joined.error.message);

    res.json({
      ...joined.value,
      code,
      roomCode: code,
      expiresAt: room.expiresAt,
      ...(joiner.deviceToken ? { deviceToken: joiner.deviceToken } : {}),
    });
  });

  /*
   * How a display client attaches (§4.5). It needs no token *here* — the SSE
   * stream is open to anyone who knows the code — but the route exists locally
   * anyway, because in prod the channel is authorised per subscriber and the TV
   * gets its viewer token from exactly this call. A client path that only runs
   * against AWS is a client path that is never tested.
   */
  app.post("/api/room/:code/watch", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const code = String(req.params.code ?? "").toUpperCase();
    const lookup = await admitCodeLookup(clientOf(req), deps);
    if (!lookup) return slowDown(res, deps);
    // Optional: a TV that opened the room presents its binding to learn it is the host.
    // ...or a family tablet's shared token (#274).
    const tablet = await resolveShared(req, base);
    if (tablet === null) return forgottenDevice(res);
    const screen = tablet ? null : await resolvePrincipal(req, base);
    const result = await watchRoom(
      { code, deviceId: tablet?.deviceId ?? screen?.principal.deviceId, ...(tablet ? { householdId: tablet.householdId } : {}) },
      deps,
    );
    if (result.ok || result.error.code !== "NOT_FOUND") await lookup.hit();
    if (!result.ok) {
      return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    }
    res.json(result.value);
  });

  /*
   * Host controls (#263, #267): remove, lock, close. As in lambda/http.ts, the
   * host is a phone's device token or a tablet's token plus its seated
   * player's session (#250), and the body is checked only once the host is.
   */
  type HostAct = (
    code: string,
    principal: HostPrincipal,
    body: Record<string, unknown>,
    deps: HandlerDeps,
  ) => Promise<HandlerResult<{ seq: number }>>;
  const hostControl =
    (validate: (body: Record<string, unknown>) => string | null, act: HostAct) =>
    async (req: Request, res: Response) => {
      const deps = await withRuntime(base, res);
      if (!deps) return;

      const code = String(req.params.code ?? "").toUpperCase();
      const shared = await resolveShared(req, base);
      if (shared === null) return forgottenDevice(res);
      let principal: HostPrincipal;
      if (shared) {
        const seat = tabletHost(shared, await resolveSession(req, base), code, await deps.repo.getRoom(code));
        if (!seat.ok) return sendError(res, 401, seat.error.code, seat.error.message);
        principal = seat.value;
      } else {
        const host = await resolvePrincipal(req, base);
        if (!host) return sendError(res, 401, "FORBIDDEN", "running this room needs the device that opened it");
        principal = host.principal;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const invalid = validate(body);
      if (invalid !== null) return sendError(res, 400, "ILLEGAL", invalid);
      const lookup = await admitCodeLookup(clientOf(req), deps);
      if (!lookup) return slowDown(res, deps);
      const result = await act(code, principal, body, deps);
      const missed = !result.ok && result.error.code === "NOT_FOUND" && result.error.message.startsWith("no open room");
      if (!missed) await lookup.hit();
      if (result.ok) return res.json({ ok: true, seq: result.value.seq });
      sendError(res, statusFor(result.error), result.error.code, result.error.message);
    };

  app.post("/api/room/:code/remove", hostControl(
    (body) => (typeof body.playerId === "string" && body.playerId !== "" ? null : "expected { playerId }"),
    (code, principal, body, deps) => removePlayer({ code, principal, playerId: body.playerId as string }, deps),
  ));
  app.post("/api/room/:code/keeper", hostControl(
    (body) => (typeof body.playerId === "string" && body.playerId !== "" ? null : "expected { playerId }"),
    (code, principal, body, deps) => handKeeper({ code, principal, playerId: body.playerId as string }, deps),
  ));
  app.post("/api/room/:code/lock", hostControl(
    (body) => (typeof body.locked === "boolean" ? null : "expected { locked: true | false }"),
    (code, principal, body, deps) => lockRoom({ code, principal, locked: body.locked as boolean }, deps),
  ));
  app.post("/api/room/:code/quiet", hostControl(
    (body) => (typeof body.quiet === "boolean" ? null : "expected { quiet: true | false }"),
    (code, principal, body, deps) => setQuiet({ code, principal, quiet: body.quiet as boolean }, deps),
  ));
  app.post("/api/room/:code/close", hostControl(
    () => null,
    (code, principal, _body, deps) => closeRoom({ code, principal }, deps),
  ));

  // Save the chapter and close the room, to pick it up another day (#259).
  app.post("/api/room/:code/stop", hostControl(
    () => null,
    (code, principal, _body, deps) => stopForToday({ code, principal }, deps),
  ));

  // A signed-in owner opening the room to visitors (#249), as in lambda/http.ts.
  app.post("/api/room/:code/visitors", async (req: Request, res: Response) => {
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");
    if (typeof req.body?.open !== "boolean") return sendError(res, 400, "ILLEGAL", "expected { open: true | false }");
    const deps = await withRuntime(base, res);
    if (!deps) return;
    const code = String(req.params.code ?? "").toUpperCase();
    const lookup = await admitCodeLookup(clientOf(req), deps);
    if (!lookup) return slowDown(res, deps);
    const result = await setVisitors({ cognitoSub: account.cognitoSub, code, open: req.body?.open }, deps);
    const missed = !result.ok && result.error.code === "NOT_FOUND" && result.error.message.startsWith("no open room");
    if (!missed) await lookup.hit();
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
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
        ? { householdId: session.householdId, playerId: session.playerId }
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

  // A tap not yet confirmed — relayed to the room, never committed
  // (handlers/preview.ts). The seat comes from the session token alone.
  app.post("/api/preview", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;
    const session = await resolveSession(req, base);
    if (!session) return sendError(res, 401, "FORBIDDEN", "a preview needs a room session token");
    const result = await relayPreview(
      {
        runId: session.runId,
        playerId: session.playerId,
        householdId: session.householdId,
        preview: (req.body ?? {}).preview,
        context: (req.body ?? {}).context,
      },
      deps,
    );
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    res.json({ ok: true });
  });

  // "Still here", or "leaving" (handlers/presence.ts): production's only
  // presence, and alongside the stream's here, so both paths are exercised.
  app.post("/api/presence", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;
    const session = await resolveSession(req, base);
    if (!session) return sendError(res, 401, "FORBIDDEN", "presence needs a room session token");
    const result = await beatPresence(
      {
        runId: session.runId,
        playerId: session.playerId,
        householdId: session.householdId,
        leaving: (req.body ?? {}).leaving === true,
        ...(PRESENCE_AWAY_MS === undefined ? {} : { awayAfterMs: PRESENCE_AWAY_MS }),
      },
      deps,
    );
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    res.json({ ok: true, connected: result.connected });
  });

  // A seated phone taking the household's saved chapter into this room (#259).
  app.post("/api/resume", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;
    const session = await resolveSession(req, base);
    if (!session) return sendError(res, 401, "FORBIDDEN", "keeping going needs a room session token");
    const result = await resumeGame(
      { runId: session.runId, playerId: session.playerId, householdId: session.householdId },
      deps,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json({ ok: true, seq: result.value.seq });
  });

  // The host of a stopped game letting a hero go from it (#259), as in lambda/http.ts.
  app.post("/api/save/release", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;
    const { characterId, homeHouseholdId } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof characterId !== "string" || characterId === "") {
      return sendError(res, 400, "ILLEGAL", "expected { characterId }");
    }
    if (homeHouseholdId !== undefined && typeof homeHouseholdId !== "string") {
      return sendError(res, 400, "ILLEGAL", "homeHouseholdId must be a string");
    }
    const host = await resolvePrincipal(req, base);
    if (!host) return sendError(res, 401, "FORBIDDEN", "letting a hero go needs the device that stopped the game");
    const result = await releaseSavedHero(
      {
        deviceId: host.principal.deviceId,
        householdId: host.principal.householdId,
        characterId,
        ...(homeHouseholdId ? { homeHouseholdId } : {}),
      },
      deps,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json({ ok: true, left: result.value.left });
  });

  app.post("/api/progression/spend", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const session = await resolveSession(req, base);
    if (!session) {
      return sendError(res, 401, "FORBIDDEN", "spending a stat point needs a room session token");
    }
    if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "stat")) {
      return sendError(res, 400, "ILLEGAL", "expected { stat }");
    }

    const state = await deps.repo.getState(session.runId);
    const response = await applyAction(
      {
        runId: session.runId,
        playerId: session.playerId,
        seq: Number(req.body.seq ?? state?.seq ?? 0),
        intent: { type: "SPEND_STAT_POINT", stat: req.body.stat as never },
        principal: {
          householdId: session.householdId,
          playerId: session.playerId,
        },
      },
      deps,
    );
    res.json(response);
  });

  // This player's saved characters, to bring one back (see handlers/heroes.ts).
  app.get("/api/heroes", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const session = await resolveSession(req, base);
    if (!session) return sendError(res, 401, "FORBIDDEN", "listing heroes needs a room session token");
    const result = await listHeroes({ householdId: session.householdId, playerId: session.playerId }, deps);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // A crash on a phone or the TV: one scrubbed log line, nothing stored (#317).
  app.post("/api/client-error", async (req: Request, res: Response) => {
    const outcome = await reportClientError(req.body, clientOf(req), base);
    if (outcome === "malformed") return sendError(res, 400, "ILLEGAL", "not a crash report");
    if (outcome === "refused") return reportsSlowDown(res, base);
    res.status(204).end();
  });

  // What this phone can study between games (see handlers/journal.ts).
  app.get("/api/journal", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    // Her own device, or the room session she holds once seated (a family tablet's picked kid).
    const kid = await resolveKid(req, base);
    if (!kid) return sendError(res, 401, "FORBIDDEN", "the journal needs this device's token");
    const result = await getJournal({ householdId: kid.householdId, playerId: kid.playerId }, deps);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // What a kid picked for her own page (see handlers/profile.ts).
  app.post("/api/profile/flair", async (req: Request, res: Response) => {
    const deps = await withRuntime(base, res);
    if (!deps) return;

    const kid = await resolveKid(req, base);
    if (!kid) return sendError(res, 401, "FORBIDDEN", "your page needs this device's token");
    const result = await saveFlair({ householdId: kid.householdId, playerId: kid.playerId, body: req.body ?? {} }, deps);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // The "who's playing?" picker on a shared tablet (#250).
  app.get("/api/household/players", async (req: Request, res: Response) => {
    const shared = await resolveShared(req, base);
    if (!shared) return forgottenDevice(res);
    const result = await listSharedPlayers(shared, base);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
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
    // Only somebody in the room may read it — see lambda/http.ts.
    const reader = await roomReader(req, base);
    const named = code ? `no open room ${code}` : `no run ${runId}`;
    if (!reader) return sendError(res, 404, "NOT_FOUND", named);
    if ((code && reader.roomCode.toUpperCase() !== code) || (runId && reader.runId !== runId)) {
      return sendError(res, 404, "NOT_FOUND", named);
    }
    if (!runId) runId = reader.runId;

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

    const result = await getState(
      { runId, sinceSeq, playerId: reader.playerId, householdId: reader.householdId },
      deps,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // -------------------------------------------------------------------------
  // Realtime — the local stand-in for the AppSync Events channel `room/<code>`
  // -------------------------------------------------------------------------

  app.get("/events/:code", async (req: Request, res: Response) => {
    const code = String(req.params.code ?? "").toUpperCase();
    // The same rule as the AppSync authorizer (lambda/channel-authorizer.ts):
    // a session or viewer token for this room, and not a player the host took
    // out. A stream open to anyone with the code would be a laptop testing a
    // room that production does not have.
    const reader = await roomReader(req, base);
    if (!reader || reader.roomCode.toUpperCase() !== code) {
      return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);
    }
    const room = await base.repo.getRoom(code);
    if (!room) return sendError(res, 404, "NOT_FOUND", `no open room ${code}`);

    const state = await base.repo.getState(room.runId);
    if (!state) return sendError(res, 404, "NOT_FOUND", `run ${room.runId} has no state`);
    // Taken out by the host (#267), or retired by an organizer (#248).
    if (
      reader.playerId !== undefined &&
      (await isOut(state, reader.playerId, reader.householdId ?? null, base.repo))
    ) {
      return sendError(res, 403, "FORBIDDEN", "This phone was taken out of the game.");
    }

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
     *
     * `KAD_STREAM_PRESENCE=off` leaves presence to the phones' heartbeats
     * alone (`POST /api/presence`), which is how production runs: AppSync
     * Events reports no stream opening or closing (#258).
     */
    const viewer = await resolveSession(req, base);
    if (STREAM_PRESENCE && viewer && viewer.runId === room.runId) {
      const runId = room.runId;
      const playerId = viewer.playerId;
      // Counted, not toggled: a refresh overlaps two streams and the old one
      // often closes last, which would mark a player away while they are
      // sitting right there (see presence-tracker.ts).
      if (presence.open(runId, playerId)) {
        // The same .catch as the close path below — Node treats an unhandled
        // rejection as fatal, and a repo hiccup on stream-open must not take
        // the whole dev server down mid-session.
        void setPresence({ runId, playerId, connected: true }, base).catch(() => undefined);
      }
      res.on("close", () => {
        if (presence.close(runId, playerId)) {
          void setPresence({ runId, playerId, connected: false }, base).catch(() => undefined);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // Optional sign-in, local edition
  //
  // Same routes and response shapes as `lambda/http.ts`, verified by an unsigned
  // dev token instead of Cognito. `GET /api/auth/dev` is how the client learns
  // it may offer sign-in here; `/api/config` stays a 404 so realtime keeps
  // choosing SSE.
  // -------------------------------------------------------------------------

  app.get("/api/auth/dev", (_req: Request, res: Response) => {
    res.json({ dev: true });
  });

  const bearerToken = (req: Request): string =>
    /^Bearer\s+(.+)$/i.exec((req.get("authorization") ?? "").trim())?.[1] ?? "";

  app.post("/api/auth/link", async (req: Request, res: Response) => {
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");

    const existing = await resolvePrincipal(req, base);
    const result = await linkAccount(
      {
        cognitoSub: account.cognitoSub,
        email: account.email,
        principal: existing?.principal ?? null,
        preferExisting: req.body?.preferExisting === true,
        householdId: typeof req.body?.householdId === "string" ? req.body.householdId : undefined,
      },
      base,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  app.post("/api/auth/device", async (req: Request, res: Response) => {
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");

    const { householdId, playerId } = (req.body ?? {}) as { householdId?: unknown; playerId?: unknown };
    if (typeof householdId !== "string" || typeof playerId !== "string") {
      return sendError(res, 400, "ILLEGAL", "expected { householdId, playerId }");
    }
    const result = await adoptDevice(
      { cognitoSub: account.cognitoSub, householdId, playerId, userAgent: req.get("user-agent") },
      base,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // A signed-in owner makes this device the household's shared tablet (#250).
  app.post("/api/auth/shared-device", async (req: Request, res: Response) => {
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");

    const existing = await resolvePrincipal(req, base);
    const shared = await resolveShared(req, base);
    const result = await shareDevice(
      {
        cognitoSub: account.cognitoSub,
        principal: existing?.principal ?? null,
        shared: shared ?? null,
        userAgent: req.get("user-agent"),
        householdId: typeof req.body?.householdId === "string" ? req.body.householdId : undefined,
      },
      base,
    );
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // "Forget this device" (#250).
  app.post("/api/auth/forget-device", async (req: Request, res: Response) => {
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");

    const shared = await resolveShared(req, base);
    const deviceId = shared?.deviceId ?? req.body?.deviceId;
    if (typeof deviceId !== "string" || deviceId === "") {
      return sendError(res, 400, "ILLEGAL", "expected this tablet's x-kad-shared-token, or { deviceId }");
    }
    const result = await forgetDevice({ cognitoSub: account.cognitoSub, deviceId }, base);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // "Play as me on another device" (#281). Her own phone asks for a one-time code.
  app.post("/api/pair/code", async (req: Request, res: Response) => {
    const found = await resolvePrincipal(req, base);
    if (!found) {
      if (req.get("x-kad-shared-token")) {
        return sendError(res, 403, "FORBIDDEN", "A shared tablet isn't one kid. Ask a grown-up to make the code.");
      }
      return sendError(res, 401, "FORBIDDEN", "Only a device that is already her can make a code.");
    }
    const result = await pairFromDevice(found.principal, base);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // The new device redeems it. No sign-in: the code is the credential.
  app.post("/api/pair/redeem", async (req: Request, res: Response) => {
    const previous = await resolvePrincipal(req, base);
    const result = await redeemPairingCode(
      { code: req.body?.code, client: clientOf(req), userAgent: req.get("user-agent"), previous: previous?.principal },
      base,
    );
    if (isSlowDown(result)) return slowDown(res, base);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
  });

  // A grown-up running a household or a group (#248): the same table the
  // Lambda routes through, behind the dev token.
  app.use("/api/organizer", async (req: Request, res: Response, next: NextFunction) => {
    const route = organizerRoute({
      method: req.method,
      path: `/api/organizer${req.path === "/" ? "" : req.path}`,
      query: req.query as Record<string, unknown>,
      body: (req.body ?? {}) as Record<string, unknown>,
    });
    if (!route) return next();
    const account = verifyDevToken(bearerToken(req));
    if (!account) return sendError(res, 401, "FORBIDDEN", "a dev id token is required");
    const result = await route(account, base);
    if (!result.ok) return sendError(res, statusFor(result.error), result.error.code, result.error.message);
    res.json(result.value);
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
// Identity plumbing (§4.5)
// ---------------------------------------------------------------------------

interface ResolvedPrincipal {
  principal: DeviceIdentity;
  /** Present only when a new device was just bound, and never again after. */
  deviceToken?: string;
}

/** Header first, body second — a real client always sends the header. */
async function resolvePrincipal(
  req: Request,
  deps: BaseDeps,
): Promise<ResolvedPrincipal | null> {
  const token = req.get("x-kad-device-token") ?? req.body?.deviceToken;
  if (typeof token !== "string" || token === "") return null;
  const principal = await deps.identity.resolveDevice(token);
  return principal ? { principal } : null;
}

/** A shared tablet's token (#250): `undefined` when absent, `null` when it no longer resolves. */
async function resolveShared(req: Request, deps: BaseDeps): Promise<SharedDeviceIdentity | null | undefined> {
  const token = req.get("x-kad-shared-token");
  if (typeof token !== "string" || token === "") return undefined;
  return deps.identity.resolveSharedDevice(token);
}

function forgottenDevice(res: Response): void {
  sendError(res, 401, "FORBIDDEN", "This tablet was forgotten. Ask a grown-up to set it up again.");
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
/** Her own device, else the room session she holds (#299); the twin of `resolveKid` in lambda/http.ts. */
async function resolveKid(req: Request, deps: BaseDeps): Promise<{ householdId: string; playerId: string } | null> {
  const found = await resolvePrincipal(req, deps);
  if (found) return found.principal;
  const session = await resolveSession(req, deps);
  return session ? { householdId: session.householdId, playerId: session.playerId } : null;
}

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

/** The room a request's session or viewer token was issued for. Same as lambda/http.ts. */
async function roomReader(
  req: Request,
  deps: BaseDeps,
): Promise<{ runId: string; roomCode: string; playerId?: string; householdId?: string } | null> {
  const header = req.get("authorization") ?? "";
  const query = typeof req.query?.token === "string" ? req.query.token : "";
  const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? query;
  if (!token) return null;
  return (await deps.identity.resolveSession(token)) ?? (await deps.identity.resolveViewer(token));
}

/**
 * Who is asking, for the wrong-code budget: the socket. Prod believes
 * `x-kad-viewer` only alongside CloudFront's secret (lambda/http.ts,
 * `clientOf`), and a laptop has no CloudFront to vouch for it.
 */
function clientOf(req: Request): string {
  return clientKeyFor(req.socket.remoteAddress);
}

function reportsSlowDown(res: Response, deps: Pick<HandlerDeps, "now">): void {
  res.set("retry-after", String(retryAfterSeconds(deps.now())));
  sendError(res, SLOW_DOWN.status, SLOW_DOWN.code, "Too many reports. Try again later.");
}

function slowDown(res: Response, deps: Pick<HandlerDeps, "now">): void {
  res.set("retry-after", String(retryAfterSeconds(deps.now())));
  sendError(res, SLOW_DOWN.status, SLOW_DOWN.code, SLOW_DOWN.message);
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
    case "HERO_BUSY":
      return 409;
  }
}

function sendError(
  res: Response,
  status: number,
  code: ActionError["code"] | typeof SLOW_DOWN.code,
  message: string,
): void {
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
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-kad-device-token, x-kad-shared-token");
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
