import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { AppSyncEventsChannel, channelFor } from "./appsync-events-channel.ts";

const patch: ChannelMessage = {
  kind: "patch",
  seq: 42,
  runId: "r_1",
  patch: [{ op: "replace", path: "/seq", value: 42 }],
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function makeChannel(respond: () => Response) {
  const calls: Call[] = [];
  const channel = new AppSyncEventsChannel({
    httpDomain: "abc123.appsync-api.us-east-1.amazonaws.com",
    region: "us-east-1",
    credentials: async () => ({ accessKeyId: "AKIATEST", secretAccessKey: "secret" }),
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return respond();
    }) as unknown as typeof globalThis.fetch,
  });
  return { channel, calls };
}

function ok(body: unknown = { failed: [], successful: [{ identifier: "e_1" }] }): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("channelFor", () => {
  it("namespaces and upper-cases the room code", () => {
    // Codes are read aloud and typed in either case; the channel name is not.
    expect(channelFor("abcd")).toBe("/room/ABCD");
  });
});

describe("AppSyncEventsChannel", () => {
  it("signs the request and sends the event as a serialised string", async () => {
    const { channel, calls } = makeChannel(ok);
    await channel.publish("abcd", patch);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("no call recorded");

    expect(call.url).toBe("https://abc123.appsync-api.us-east-1.amazonaws.com/event");
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST/);
    expect(call.headers.authorization).toContain("/appsync/aws4_request");
    // `host` has to be signed or the service computes a different signature.
    expect(call.headers.authorization).toContain("host");

    const body = JSON.parse(call.body) as { channel: string; events: string[] };
    expect(body.channel).toBe("/room/ABCD");
    // Strings, not objects — objects arrive as "[object Object]".
    expect(body.events).toHaveLength(1);
    expect(typeof body.events[0]).toBe("string");
    expect(JSON.parse(body.events[0] ?? "")).toEqual(patch);
  });

  it("throws on a transport failure", async () => {
    const { channel } = makeChannel(() => new Response("nope", { status: 403 }));
    await expect(channel.publish("ABCD", patch)).rejects.toThrow(/403/);
  });

  it("throws when a 200 carries a rejected event", async () => {
    // The failure this exists to catch: the publish reached AppSync, AppSync
    // refused it, and the TV silently stops updating mid-encounter.
    const { channel } = makeChannel(() =>
      ok({ failed: [{ identifier: "e_1", code: "TooLarge", message: "event too large" }] }),
    );
    await expect(channel.publish("ABCD", patch)).rejects.toThrow(/event too large/);
  });

  it("refuses to pretend it can subscribe", () => {
    const { channel } = makeChannel(ok);
    expect(() => channel.subscribe("ABCD", () => undefined)).toThrow(/browsers subscribe/);
  });
});
