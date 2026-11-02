import { describe, expect, it } from "vitest";
import { APPSYNC_CHANNEL_PATTERN, roomChannelPath, runChannelSegment } from "@kad/shared";
import { DevIdentity } from "../identity.ts";
import { newId } from "../ids.ts";
import { authorize } from "../lambda/channel-authorizer.ts";
import { MemoryRepository } from "../store/memory-repository.ts";
import { makeClock, T0 } from "../test-support.ts";
import { channelFor } from "./appsync-events-channel.ts";

/**
 * AppSync Events allows 1 to 5 segments of letters, digits and hyphens only.
 * These run against ids the server really generates, not strings chosen to agree
 * with each other: `newId("r")` has an underscore, which the format forbids.
 */
describe("a game's channel name is one AppSync accepts", () => {
  it("is valid for every id the server generates", () => {
    for (let i = 0; i < 500; i++) {
      const runId = newId("r");
      expect(runId).toContain("_"); // the case the format forbids, so this test means something
      const path = channelFor("abcd", runId);
      expect(path, runId).toMatch(APPSYNC_CHANNEL_PATTERN);
      expect(path.includes("_")).toBe(false);
    }
  });

  it("is the shared definition, which the browser uses too", () => {
    const runId = newId("r");
    expect(channelFor("abcd", runId)).toBe(roomChannelPath("room", "ABCD", runId));
  });

  it("keeps two runs apart, and has no channel for an id it could confuse", () => {
    const a = runChannelSegment(newId("r"));
    const b = runChannelSegment(newId("r"));
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    // A hyphen already in an id would collide with a rewritten underscore, so it has no channel.
    expect(runChannelSegment("r-1")).toBeNull();
    expect(runChannelSegment("")).toBeNull();
    expect(runChannelSegment("r_" + "x".repeat(60))).toBeNull();
    expect(() => channelFor("ABCD", "r-1")).toThrow();
  });

  it("is what the authorizer admits, for a real run id, and nothing else", async () => {
    const clock = makeClock(T0);
    const identity = new DevIdentity(new MemoryRepository({ now: clock.now }), clock.now);
    const runId = newId("r");
    const token = await identity.issueViewerToken({ runId, roomCode: "ABCD", expiresAt: clock.now() + 3600_000 });
    const subscribe = (channel: string) => ({
      authorizationToken: token,
      requestContext: { operation: "EVENT_SUBSCRIBE", channelNamespace: "room", channel },
    });

    expect((await authorize(subscribe(channelFor("ABCD", runId)), identity, clock.now)).isAuthorized).toBe(true);
    // The canonical id, with its underscore, is not a channel and is not admitted.
    expect((await authorize(subscribe(`/room/ABCD/${runId}`), identity, clock.now)).isAuthorized).toBe(false);
    expect((await authorize(subscribe(channelFor("ABCD", newId("r"))), identity, clock.now)).isAuthorized).toBe(false);
  });
});
