import { describe, expect, it, vi } from "vitest";
import { makeHarness } from "../test-support.ts";
import { respond, type HttpRuntime } from "../lambda/http.ts";
import { CODE_MISS_LIMIT, CODE_MISS_WINDOW_MS, admitCodeLookup } from "./code-guard.ts";
import { reportClientError } from "./client-error.ts";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const DEV_TOKEN = "kaddev.eyJzdWIiOiJtYXlhIn0";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.c2lnbmF0dXJlYmxvYg";
const DEVICE_TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

/** A report with each kind of thing that must never be logged. */
function leakyReport() {
  return {
    message: [
      "Cannot read properties of undefined (reading 'Maya the Brave')",
      `typed "Zephyrine" into the box`,
      "mail maya.k@example.com",
      "room WXYZ and visitor room WXYZQR at /p/WXYZ?code=WXYZ",
      `tokens ${DEV_TOKEN} ${JWT} ${DEVICE_TOKEN}`,
    ].join("; "),
    stack: ["/bundle/index-abc.js:10:20"],
    version: "abc1234",
    route: "/p/:code",
    layout: "phone",
    browser: "safari",
    id: "0123456789ab",
    displayName: "Maya",
    heroName: "Zephyrine",
    deviceToken: DEVICE_TOKEN,
  };
}

const LEAKS = [
  /maya/i, /zephyrine/i, /example\.com/, /WXYZ/, /kaddev/, /eyJ/, /a1b2c3d4e5f6/, /brave/i,
];

describe("reportClientError: nothing a kid typed or owns reaches the log", () => {
  it("logs one structured line with none of the seven kinds in it", async () => {
    const harness = makeHarness();
    const lines: string[] = [];
    const outcome = await reportClientError(leakyReport(), "192.0.2.1", harness.deps, (l) => lines.push(l));

    expect(outcome).toBe("logged");
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    for (const leak of LEAKS) expect(line, String(leak)).not.toMatch(leak);
    expect(JSON.parse(line)).toMatchObject({
      event: "client_error",
      stack: ["/bundle/index-abc.js:10:20"],
      version: "abc1234",
      route: "/p/:code",
      layout: "phone",
      browser: "safari",
      id: "0123456789ab",
    });
    // Fields it was not asked to log stay out, whatever they held.
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(
      ["browser", "event", "id", "layout", "message", "route", "stack", "version"],
    );
  });

  it.each([
    ["a display name", { message: "failed for 'Maya'" }, /maya/i],
    ["a hero name", { message: 'hero "Zephyrine" fell' }, /zephyrine/i],
    ["an email", { message: "x@y.org rejected" }, /y\.org/],
    ["a room code", { message: "no open room ABCD" }, /ABCD/],
    ["a visitor code", { message: "no open room ABCDEF" }, /ABCDEF/],
    ["a dev token", { message: `bad ${DEV_TOKEN}` }, /kaddev/],
    ["a JWT", { message: `bad ${JWT}` }, /eyJ/],
    ["typed text", { message: "input was `hello there my name is Maya`" }, /hello|maya/i],
  ])("scrubs %s", async (_kind, extra, leak) => {
    const lines: string[] = [];
    await reportClientError(
      { ...leakyReport(), ...extra },
      "192.0.2.1",
      makeHarness().deps,
      (l) => lines.push(l),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(leak);
  });

  it("logs nothing for a body that is not a report", async () => {
    const lines: string[] = [];
    expect(await reportClientError("boom", "192.0.2.1", makeHarness().deps, (l) => lines.push(l))).toBe("malformed");
    expect(lines).toEqual([]);
  });
});

describe("the report budget", () => {
  it("refuses a client past the code guard's limit, one window at a time, and logs nothing more", async () => {
    const harness = makeHarness();
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      expect(await reportClientError(leakyReport(), "192.0.2.1", harness.deps, log)).toBe("logged");
    }
    expect(await reportClientError(leakyReport(), "192.0.2.1", harness.deps, log)).toBe("refused");
    expect(lines).toHaveLength(CODE_MISS_LIMIT);

    // Another client is not affected; the next window starts fresh.
    expect(await reportClientError(leakyReport(), "192.0.2.2", harness.deps, log)).toBe("logged");
    harness.clock.advance(CODE_MISS_WINDOW_MS);
    expect(await reportClientError(leakyReport(), "192.0.2.1", harness.deps, log)).toBe("logged");
  });

  it("does not spend the same client's wrong-code budget, so a crash loop cannot block joins", async () => {
    const harness = makeHarness();
    for (let i = 0; i < CODE_MISS_LIMIT + 5; i++) {
      await reportClientError(leakyReport(), "192.0.2.1", harness.deps, () => {});
    }
    expect(await admitCodeLookup("192.0.2.1", harness.deps)).not.toBeNull();
  });
});

describe("POST /api/client-error", () => {
  function post(body: unknown): APIGatewayProxyEventV2 {
    return {
      rawPath: "/api/client-error",
      requestContext: { http: { method: "POST", sourceIp: "192.0.2.7" } },
      body: JSON.stringify(body),
      headers: {},
    } as unknown as APIGatewayProxyEventV2;
  }
  function runtime(harness = makeHarness()): HttpRuntime {
    return { deps: async () => harness.deps, verifyAccount: async () => null };
  }

  it("answers 204, writes one scrubbed line and returns 429 with a retry-after once spent", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const rt = runtime();
      const first = await respond(post(leakyReport()), rt);
      expect(first.statusCode).toBe(204);
      expect(spy).toHaveBeenCalledTimes(1);
      for (const leak of LEAKS) expect(String(spy.mock.calls[0]?.[0]), String(leak)).not.toMatch(leak);

      for (let i = 1; i < CODE_MISS_LIMIT; i++) await respond(post(leakyReport()), rt);
      const refused = await respond(post(leakyReport()), rt);
      expect(refused.statusCode).toBe(429);
      expect(refused.headers?.["retry-after"]).toBeDefined();
      expect(spy).toHaveBeenCalledTimes(CODE_MISS_LIMIT);
    } finally {
      spy.mockRestore();
    }
  });

  it("answers 400 to something that is not a report", async () => {
    const result = await respond(post(["nope"]), runtime());
    expect(result.statusCode).toBe(400);
  });
});
