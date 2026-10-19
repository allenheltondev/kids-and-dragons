// @vitest-environment jsdom
/**
 * The client half of crash reporting (#317): what the page sends, with the
 * names of the room it is in scrubbed out, once per distinct error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const names = vi.hoisted(() => ({ hero: "Zephyrine", seat: "Maya", room: "WXYZ", token: "sess-token-0123456789" }));

vi.mock("../store", () => ({
  useGameStore: {
    getState: () => ({
      state: {
        party: [{ character: { name: names.hero } }],
        seats: { p1: { name: names.seat } },
      },
      session: { roomCode: names.room, sessionToken: names.token },
    }),
  },
}));
vi.mock("../store/persistence", () => ({
  loadIdentity: () => ({ displayName: "Kiddo Quinn", deviceToken: "dev-token-abcdef" }),
}));

import { report } from "./report";

const fetchSpy = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse(String(fetchSpy.mock.calls[call]?.[1].body)) as Record<string, unknown>;
}

describe("report", () => {
  it("sends one scrubbed report to our own endpoint", () => {
    const error = new TypeError("Zephyrine tripped on 'Maya' in room WXYZ for kiddo quinn: a@b.org");
    error.stack = "TypeError: x\n    at f (https://kids.test/bundle/index-a1.js:3:4)\n    at g (https://other.test/x.js:1:1)";
    report(error);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/client-error");
    const body = sentBody();
    const text = JSON.stringify(body);
    for (const leak of [/zephyrine/i, /maya/i, /WXYZ/, /kiddo/i, /quinn/i, /a@b\.org/]) {
      expect(text, String(leak)).not.toMatch(leak);
    }
    expect(body).toMatchObject({
      stack: ["/bundle/index-a1.js:3:4"],
      route: "/",
      layout: "phone",
      browser: "other",
    });
    expect(body.id).toMatch(/^[a-f0-9]{12}$/);
  });

  it("scrubs the tokens the page holds, wherever they appear", () => {
    report(new Error(`bad ${names.token} and dev-token-abcdef`));
    expect(JSON.stringify(sentBody())).not.toMatch(/sess-token|dev-token/);
  });

  it("sends a thrown string, and a thrown nothing, without throwing", () => {
    expect(() => report("just a string")).not.toThrow();
    expect(() => report(undefined)).not.toThrow();
  });

  it("does not report the same error twice, and stops after a few distinct ones", () => {
    report(new Error("same"));
    report(new Error("same"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) report(new Error(`distinct ${"abcdefghijklmnopqrstuvwxyz"[i]}`));
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
