import { describe, expect, it } from "vitest";
import { DevIdentity } from "../identity.ts";
import { MemoryRepository } from "../store/memory-repository.ts";
import { makeClock, T0 } from "../test-support.ts";
import { viewerStillShows } from "../handlers/viewer.ts";
import { authorize, type ChannelAuthorizerEvent } from "./channel-authorizer.ts";

const ROOM_TTL = 6 * 3600_000;

function setup() {
  const clock = makeClock(T0);
  const repo = new MemoryRepository({ now: clock.now });
  const identity = new DevIdentity(repo, clock.now);
  return { clock, identity, repo };
}

function event(
  overrides: Partial<ChannelAuthorizerEvent["requestContext"]> & { token?: string } = {},
): ChannelAuthorizerEvent {
  const { token, ...context } = overrides;
  return {
    ...(token === undefined ? {} : { authorizationToken: token }),
    requestContext: {
      channelNamespace: "room",
      // The shape AppSync Events documents: EVENT_* operations, and the channel as a string.
      operation: "EVENT_SUBSCRIBE",
      channel: "/room/ABCD/r-1",
      ...context,
    },
  };
}

describe("channel authorizer", () => {
  it("lets a player subscribe to the room their token names", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });

    const result = await authorize(event({ token }), identity, clock.now);
    expect(result.isAuthorized).toBe(true);
    expect(result.handlerContext).toMatchObject({ runId: "r_1", playerId: "p_1" });
  });

  it("refuses a session whose device has left, though the token is hours from expiring", async () => {
    const { identity, clock, repo } = setup();
    const { deviceId } = await identity.issueDeviceToken({ householdId: "h_1", playerId: "p_1" });
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
      deviceId,
    });
    expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(true);

    await repo.revokeDevice("h_1", deviceId);
    expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(false);
    expect((await authorize(event({ token, operation: "EVENT_CONNECT", channel: null }), identity, clock.now)).isAuthorized).toBe(false);
  });

  it("refuses a valid token pointed at somebody else's room", async () => {
    /*
     * The one that matters. Four letters is a small space, and the room code is
     * the only thing separating one family's session from the next — a valid
     * session token must not be a licence to watch every game on the stack.
     */
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });

    const other = event({ token, channel: "/room/WXYZ/r-1" });
    expect((await authorize(other, identity, clock.now)).isAuthorized).toBe(false);
  });

  it("refuses a valid token that subscribes to another room, by the real AppSync event, whoever holds it", async () => {
    const { identity, clock } = setup();
    const viewer = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    const session = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    for (const token of [viewer, session]) {
      for (const channel of ["/room/WXYZ/r-1", "/room/WXYZ/r-9", "/room/ABCD/r-9", "/room/ABCD", "/room/ABCD/r-1/extra", "/other/ABCD/r-1"]) {
        const result = await authorize(event({ token, channel }), identity, clock.now);
        expect(result.isAuthorized, channel).toBe(false);
      }
      expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(true);
    }
  });

  it("refuses a wildcard subscribe, which AppSync allows on EVENT_SUBSCRIBE", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    for (const channel of ["/room/*", "/room/ABCD/*", "/room/*/r-1", "/*", "/room/ABCD/r-1*"]) {
      expect((await authorize(event({ token, channel }), identity, clock.now)).isAuthorized, channel).toBe(false);
    }
  });

  it("refuses an old game's channel once the letters belong to a new game", async () => {
    const { identity, clock } = setup();
    // The old follower's token names r_old; a new family now has ABCD with r_new.
    const old = await identity.issueViewerToken({ runId: "r_old", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    expect((await authorize(event({ token: old, channel: "/room/ABCD/r-new" }), identity, clock.now)).isAuthorized).toBe(false);
    expect((await authorize(event({ token: old, channel: "/room/ABCD/r-old" }), identity, clock.now)).isAuthorized).toBe(true);
  });

  it("denies any operation it does not know, and any publish in either spelling", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    for (const operation of ["EVENT_PUBLISH", "PUBLISH", "event_publish", "EVENT_UNSUBSCRIBE", "SOMETHING", ""]) {
      expect((await authorize(event({ token, operation }), identity, clock.now)).isAuthorized, operation).toBe(false);
    }
    const none = { authorizationToken: token, requestContext: { channel: "/room/ABCD/r-1" } };
    expect((await authorize(none, identity, clock.now)).isAuthorized).toBe(false);
  });

  it("accepts the documented connect, with no channel, and the older spellings of a subscribe", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    const connect = { authorizationToken: token, requestContext: { operation: "EVENT_CONNECT", channel: null } };
    expect((await authorize(connect, identity, clock.now)).isAuthorized).toBe(true);
    expect((await authorize(event({ token, operation: "SUBSCRIBE" }), identity, clock.now)).isAuthorized).toBe(true);
    const asObject = event({ token, channel: { path: "/room/ABCD/r-1", segments: ["room", "ABCD", "r-1"] } });
    expect((await authorize(asObject, identity, clock.now)).isAuthorized).toBe(true);
    const wrongObject = event({ token, channel: { path: "/room/WXYZ/r-1", segments: ["room", "WXYZ", "r_1"] } });
    expect((await authorize(wrongObject, identity, clock.now)).isAuthorized).toBe(false);
  });

  it("refuses a subscribe that names no channel at all", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    // "Cannot prove which room this is for" is a deny, not a default-allow.
    const result = await authorize(event({ token, channel: {} }), identity, clock.now);
    expect(result.isAuthorized).toBe(false);
  });

  it("lets the TV on with a viewer token, and marks it as a viewer", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueViewerToken({
      runId: "r_1",
      roomCode: "ABCD",
      expiresAt: clock.now() + ROOM_TTL,
    });

    const result = await authorize(event({ token }), identity, clock.now);
    expect(result.isAuthorized).toBe(true);
    expect(result.handlerContext).toMatchObject({ runId: "r_1", viewer: "true" });
    expect(result.handlerContext).not.toHaveProperty("playerId");
  });

  it("turns a viewer away once its game is over, and never asks the question of a player", async () => {
    const { identity, clock } = setup();
    const viewer = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    const session = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    const closed = async () => false;
    const none = async () => false;

    expect((await authorize(event({ token: viewer }), identity, clock.now, none, closed)).isAuthorized).toBe(false);
    // A connect has no channel yet, and a dead viewer is refused there too.
    const connect = { authorizationToken: viewer, requestContext: { operation: "EVENT_CONNECT" } };
    expect((await authorize(connect, identity, clock.now, none, closed)).isAuthorized).toBe(false);
    // Players have their own rule (`removed`); the viewer's does not touch them.
    expect((await authorize(event({ token: session }), identity, clock.now, none, closed)).isAuthorized).toBe(true);
  });

  it("refuses a follower's old token once another game has taken the same four letters", async () => {
    const { identity, clock, repo } = setup();
    const token = await identity.issueViewerToken({ runId: "r_old", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    const open = (runId: string, roomCode: string) => viewerStillShows(repo, runId, roomCode);
    const room = (runId: string) => ({
      code: "ABCD",
      runId,
      householdId: "h_x",
      mode: "party" as const,
      createdAt: new Date(clock.now()).toISOString(),
      expiresAt: new Date(clock.now() + ROOM_TTL).toISOString(),
      ttl: Math.floor((clock.now() + ROOM_TTL) / 1000),
    });
    const run = (runId: string, closed: boolean) => ({ runId, seq: 1, closed, party: [] }) as never;
    const none = async () => false;

    await repo.putState(run("r_old", false));
    await repo.putRoomIfAbsent(room("r_old") as never);
    expect((await authorize(event({ token, channel: "/room/ABCD/r-old" }), identity, clock.now, none, open)).isAuthorized).toBe(true);

    // The leader closes: the room goes, the run is closed, and the letters are free.
    await repo.putState(run("r_old", true));
    await repo.deleteRoom("ABCD");
    expect((await authorize(event({ token, channel: "/room/ABCD/r-old" }), identity, clock.now, none, open)).isAuthorized).toBe(false);

    // Another family's game takes ABCD. The old token still names r_old.
    await repo.putState(run("r_new", false));
    await repo.putRoomIfAbsent(room("r_new") as never);
    expect((await authorize(event({ token, channel: "/room/ABCD/r-old" }), identity, clock.now, none, open)).isAuthorized).toBe(false);
  });

  it("holds a viewer's yes for no longer than a minute", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueViewerToken({ runId: "r_1", roomCode: "ABCD", expiresAt: clock.now() + ROOM_TTL });
    expect((await authorize(event({ token }), identity, clock.now)).ttlOverride).toBe(60);
  });

  it("never authorizes a publish, whatever the token", async () => {
    // Publishing is IAM-only: the server is authoritative for everything that
    // matters, and a client that could publish could forge a dice roll.
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    const result = await authorize(event({ token, operation: "EVENT_PUBLISH" }), identity, clock.now);
    expect(result.isAuthorized).toBe(false);
  });

  it("allows a connect without a channel, since there is not one yet", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    const result = await authorize(
      { authorizationToken: token, requestContext: { operation: "EVENT_CONNECT" } },
      identity,
      clock.now,
    );
    expect(result.isAuthorized).toBe(true);
  });

  it("refuses a missing, malformed, or expired token", async () => {
    const { identity, clock } = setup();
    expect((await authorize(event(), identity, clock.now)).isAuthorized).toBe(false);
    expect((await authorize(event({ token: "garbage" }), identity, clock.now)).isAuthorized).toBe(
      false,
    );

    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    clock.advance(ROOM_TTL + 1000);
    expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(false);
  });

  it("caps its cache lifetime at what is left of the room", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + 30_000,
    });

    // 30s left, so AppSync must not hold a "yes" for the usual 5 minutes —
    // otherwise an expired room keeps its subscriptions alive on a stale answer.
    const result = await authorize(event({ token }), identity, clock.now);
    expect(result.ttlOverride).toBe(30);
  });

  it("refuses a player the host took out of the run, though the token is valid", async () => {
    // #267. The session token stays well-formed until the room ends; only the
    // run knows the host removed them, and a reconnect must not get back on.
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + 3600_000,
    });
    const removed = async (runId: string, playerId: string) => runId === "r_1" && playerId === "p_1";
    expect((await authorize(event({ token }), identity, clock.now, removed)).isAuthorized).toBe(false);
    const kept = async () => false;
    expect((await authorize(event({ token }), identity, clock.now, kept)).isAuthorized).toBe(true);
  });

  it("holds a player's yes for a minute, so a removal reaches a reconnect soon", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + 3600_000,
    });
    expect((await authorize(event({ token }), identity, clock.now)).ttlOverride).toBe(60);
  });

  it("matches the room code case-insensitively", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "abcd",
      householdId: "h_1",
      playerId: "p_1",
      expiresAt: clock.now() + ROOM_TTL,
    });
    expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(true);
  });
});
