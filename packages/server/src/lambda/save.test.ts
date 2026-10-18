/**
 * Stop anytime, pick up where you left off (#259), end to end through
 * `respond()`: the host stops a chapter midway, and a new room, days later,
 * on a different phone, offers it and puts the party back.
 */

import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { applyIntent, createRunState, makeRng, type ClientIntent, type RunState } from "@kad/shared";
import path from "node:path";
import { loadContent } from "../content/loader.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { respond, type HttpRuntime } from "./http.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const DAY = 24 * 60 * 60 * 1000;

function runtime(harness: TestHarness): HttpRuntime {
  return { deps: async () => harness.deps, verifyAccount: async () => null };
}

function event(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method, sourceIp: "10.0.0.1" } },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: init.headers ?? {},
  } as unknown as APIGatewayProxyEventV2;
}

function bodyOf(result: APIGatewayProxyStructuredResultV2): Record<string, unknown> {
  return JSON.parse(result.body ?? "{}") as Record<string, unknown>;
}

async function setup() {
  const harness = makeHarness({ engine: { applyIntent, createRunState }, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`http-save:${String(key).split(":").pop()}`);
  const { householdId, players } = await seedHousehold(harness, 2);
  return { harness, rt: runtime(harness), householdId, players };
}

type World = Awaited<ReturnType<typeof setup>>;

interface Phone {
  deviceToken: string;
  session: string;
  playerId: string;
  runId: string;
  code: string;
}

/** Opens (`open`) or joins a room on player `seat`'s own phone. */
async function phone(w: World, seat: number, how: { open: true } | { code: string }): Promise<Phone> {
  const deviceToken = w.players[seat]!.deviceToken;
  const result =
    "open" in how
      ? await respond(
          event("POST", "/api/room", {
            body: { mode: "party", campaignId: "gemfall", playerId: w.players[seat]!.principal.playerId },
            headers: { "x-kad-device-token": deviceToken },
          }),
          w.rt,
        )
      : await respond(
          event("POST", `/api/room/${how.code}/join`, { body: {}, headers: { "x-kad-device-token": deviceToken } }),
          w.rt,
        );
  expect(result.statusCode).toBe(200);
  const body = bodyOf(result);
  const code = "open" in how ? String(body.code) : how.code;
  let session = String(body.sessionToken ?? "");
  let runId = String(body.runId);
  if (session === "" || "open" in how) {
    // Opening a room answers with the room; the host joins it like anyone.
    const joined = bodyOf(
      await respond(
        event("POST", `/api/room/${code}/join`, { body: {}, headers: { "x-kad-device-token": deviceToken } }),
        w.rt,
      ),
    );
    session = String(joined.sessionToken);
    runId = String(joined.runId);
  }
  return { deviceToken, session, playerId: w.players[seat]!.principal.playerId, runId, code };
}

const bearer = (p: Phone) => ({ authorization: `Bearer ${p.session}` });

async function stateOf(w: World, p: Phone): Promise<RunState> {
  return (await w.harness.repo.getState(p.runId))!;
}

async function act(w: World, p: Phone, intent: ClientIntent) {
  const state = await stateOf(w, p);
  const result = await respond(
    event("POST", "/api/action", {
      body: { runId: p.runId, playerId: p.playerId, seq: state.seq, intent },
      headers: bearer(p),
    }),
    w.rt,
  );
  const body = bodyOf(result);
  if (body.ok !== true) throw new Error(`${intent.type}: ${JSON.stringify(body)}`);
}

/** Both phones make a hero and begin Gemfall's first chapter. */
async function beginChapter(w: World) {
  const host = await phone(w, 0, { open: true });
  const guest = await phone(w, 1, { code: host.code });
  await act(w, host, { type: "CREATE_CHARACTER", name: "Pip", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } });
  await act(w, guest, { type: "CREATE_CHARACTER", name: "Bo", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 0, clever: 1, heart: 1 } });
  await act(w, host, { type: "READY", ready: true });
  await act(w, guest, { type: "READY", ready: true });
  await act(w, host, { type: "CONTINUE_CAMPAIGN", campaignId: "gemfall" });
  return { host, guest };
}

describe("POST /api/room/:code/stop", () => {
  it("is the host's, and only the host's", async () => {
    const w = await setup();
    const { host, guest } = await beginChapter(w);

    const nobody = await respond(event("POST", `/api/room/${host.code}/stop`), w.rt);
    expect(nobody.statusCode).toBe(401);
    const player = await respond(
      event("POST", `/api/room/${host.code}/stop`, { headers: { "x-kad-device-token": guest.deviceToken } }),
      w.rt,
    );
    expect(player.statusCode).toBe(403);
    expect((await stateOf(w, host)).closed).toBeUndefined();

    const stopped = await respond(
      event("POST", `/api/room/${host.code}/stop`, { headers: { "x-kad-device-token": host.deviceToken } }),
      w.rt,
    );
    expect(stopped.statusCode).toBe(200);
    expect(bodyOf(stopped).ok).toBe(true);
    expect((await stateOf(w, host)).closed).toBe(true);
    // The code is gone.
    const joined = await respond(
      event("POST", `/api/room/${host.code}/join`, { body: {}, headers: { "x-kad-device-token": guest.deviceToken } }),
      w.rt,
    );
    expect(joined.statusCode).toBe(404);
  });

  it("says plainly when there is nothing to save yet", async () => {
    const w = await setup();
    const host = await phone(w, 0, { open: true });
    const early = await respond(
      event("POST", `/api/room/${host.code}/stop`, { headers: { "x-kad-device-token": host.deviceToken } }),
      w.rt,
    );
    expect(early.statusCode).toBe(409);
    expect(bodyOf(early).error).toMatchObject({ code: "ILLEGAL", message: expect.stringMatching(/nothing to save/i) });
  });
});

describe("POST /api/resume", () => {
  it("puts a stopped chapter back, days later, on different phones", async () => {
    const w = await setup();
    const { host } = await beginChapter(w);
    const stoppedState = await stateOf(w, host);
    await respond(
      event("POST", `/api/room/${host.code}/stop`, { headers: { "x-kad-device-token": host.deviceToken } }),
      w.rt,
    );

    w.harness.clock.advance(3 * DAY);
    // Different devices: player 2 opens this time and player 1 joins late,
    // each on a phone that has never been in the old room.
    const opener = await phone(w, 1, { open: true });
    const lobby = await stateOf(w, opener);
    expect(lobby.saved).toMatchObject({ campaignId: "gemfall", heroes: ["Pip", "Bo"], chapter: stoppedState.chapterInfo });

    const nobody = await respond(event("POST", "/api/resume", { body: {} }), w.rt);
    expect(nobody.statusCode).toBe(401);

    const resumed = await respond(event("POST", "/api/resume", { body: {}, headers: bearer(opener) }), w.rt);
    expect(resumed.statusCode).toBe(200);
    expect(bodyOf(resumed).ok).toBe(true);

    const now = await stateOf(w, opener);
    expect(now.sceneId).toBe(stoppedState.sceneId);
    expect(now.narration).toBe(stoppedState.narration);
    expect(now.chapterInfo).toEqual(stoppedState.chapterInfo);
    expect(now.saved).toBeUndefined();
    expect(now.party.map((m) => [m.playerId, m.character.name])).toEqual([
      ["p_1", "Pip"],
      ["p_2", "Bo"],
    ]);

    // The first phone arrives after, and is back in its hero's seat.
    const late = await phone(w, 0, { code: opener.code });
    expect((await stateOf(w, late)).party.every((m) => m.connected)).toBe(true);
    // Taking it up twice is a quiet refusal, not a second rewind.
    const again = await respond(event("POST", "/api/resume", { body: {}, headers: bearer(late) }), w.rt);
    expect(again.statusCode).toBe(409);
  });

  it("answers with nothing to resume when nothing was stopped", async () => {
    const w = await setup();
    const opener = await phone(w, 0, { open: true });
    const result = await respond(event("POST", "/api/resume", { body: {}, headers: bearer(opener) }), w.rt);
    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({ message: expect.stringMatching(/no saved game/i) });
  });
});
