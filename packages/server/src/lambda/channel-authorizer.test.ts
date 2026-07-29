import { describe, expect, it } from "vitest";
import { DevIdentity } from "../identity.ts";
import { MemoryRepository } from "../store/memory-repository.ts";
import { makeClock, T0 } from "../test-support.ts";
import { authorize, type ChannelAuthorizerEvent } from "./channel-authorizer.ts";

const ROOM_TTL = 6 * 3600_000;

function setup() {
  const clock = makeClock(T0);
  const repo = new MemoryRepository({ now: clock.now });
  const identity = new DevIdentity(repo, clock.now);
  return { clock, identity };
}

function event(
  overrides: Partial<ChannelAuthorizerEvent["requestContext"]> & { token?: string } = {},
): ChannelAuthorizerEvent {
  const { token, ...context } = overrides;
  return {
    ...(token === undefined ? {} : { authorizationToken: token }),
    requestContext: {
      channelNamespace: "room",
      operation: "SUBSCRIBE",
      channel: { path: "/room/ABCD", segments: ["room", "ABCD"] },
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
      role: "child",
      expiresAt: clock.now() + ROOM_TTL,
    });

    const result = await authorize(event({ token }), identity, clock.now);
    expect(result.isAuthorized).toBe(true);
    expect(result.handlerContext).toMatchObject({ runId: "r_1", playerId: "p_1" });
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
      role: "adult",
      expiresAt: clock.now() + ROOM_TTL,
    });

    const other = event({
      token,
      channel: { path: "/room/WXYZ", segments: ["room", "WXYZ"] },
    });
    expect((await authorize(other, identity, clock.now)).isAuthorized).toBe(false);
  });

  it("refuses a subscribe that names no channel at all", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
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

  it("never authorizes a publish, whatever the token", async () => {
    // Publishing is IAM-only: the server is authoritative for everything that
    // matters, and a client that could publish could forge a dice roll.
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt: clock.now() + ROOM_TTL,
    });
    const result = await authorize(event({ token, operation: "PUBLISH" }), identity, clock.now);
    expect(result.isAuthorized).toBe(false);
  });

  it("allows a connect without a channel, since there is not one yet", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt: clock.now() + ROOM_TTL,
    });
    const result = await authorize(
      { authorizationToken: token, requestContext: { operation: "CONNECT" } },
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
      role: "adult",
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
      role: "adult",
      expiresAt: clock.now() + 30_000,
    });

    // 30s left, so AppSync must not hold a "yes" for the usual 5 minutes —
    // otherwise an expired room keeps its subscriptions alive on a stale answer.
    const result = await authorize(event({ token }), identity, clock.now);
    expect(result.ttlOverride).toBe(30);
  });

  it("matches the room code case-insensitively", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "abcd",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt: clock.now() + ROOM_TTL,
    });
    expect((await authorize(event({ token }), identity, clock.now)).isAuthorized).toBe(true);
  });
});
