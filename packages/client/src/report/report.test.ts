// @vitest-environment jsdom
/**
 * The client half of crash reporting (#317): what the page sends, once per
 * distinct error, with the exception's own words left out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  it("sends the kind of failure, never what the exception said", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'Nora') in room WXYZ for a@b.org");
    error.stack = "TypeError: x\n    at f (https://kids.test/bundle/index-a1.js:3:4)\n    at g (https://other.test/x.js:1:1)";
    report(error);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/client-error");
    const body = sentBody();
    expect(JSON.stringify(body)).not.toMatch(/nora|WXYZ|a@b\.org/i);
    expect(body).toMatchObject({
      message: "TypeError: read a property of nothing",
      stack: ["/bundle/index-a1.js:3:4"],
      route: "/",
      layout: "phone",
      browser: "other",
    });
    expect(body.id).toMatch(/^[a-f0-9]{12}$/);
  });

  it("reports a message it cannot place as just 'other'", () => {
    report(new Error("Nora typed her password"));
    expect(sentBody().message).toBe("Error: other");
  });

  it("sends a thrown string, and a thrown nothing, without throwing", () => {
    expect(() => report("just a string")).not.toThrow();
    expect(() => report(undefined)).not.toThrow();
  });

  it("does not report the same error twice, and stops after a few distinct ones", () => {
    const same = new Error("x is not a function");
    report(same);
    report(same);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const kinds = ["x is not defined", "x is not iterable", "Maximum call stack size exceeded", "Failed to fetch", "JSON parse", "WebGL lost", "AudioContext"];
    for (const kind of kinds) report(new Error(kind));
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
