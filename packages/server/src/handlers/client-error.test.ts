import { describe, expect, it, vi } from "vitest";
import { makeHarness } from "../test-support.ts";
import { respond, type HttpRuntime } from "../lambda/http.ts";
import { CODE_MISS_LIMIT, CODE_MISS_WINDOW_MS, admitCodeLookup } from "./code-guard.ts";
import { reportClientError } from "./client-error.ts";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const DEV_TOKEN = "kaddev.eyJzdWIiOiJtYXlhIn0";
const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.c2lnbmF0dXJlYmxvYg";
const DEVICE_TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

/** A report with each kind of thing that must never be logged, in every field a sender controls. */
function leakyReport() {
  return {
    message: [
      "Cannot read properties of undefined (reading 'Maya the Brave')",
      `typed "Zephyrine" into the box`,
      "mail maya.k@example.com",
      "room WXYZ and visitor room WXYZQR at /p/WXYZ?code=WXYZ",
      `tokens ${DEV_TOKEN} ${JWT} ${DEVICE_TOKEN}`,
    ].join("; "),
    stack: ["/bundle/index-abc.js:10:20", `Zephyrine at /p/WXYZ ${DEV_TOKEN}`],
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

async function logged(body: unknown): Promise<string[]> {
  const lines: string[] = [];
  await reportClientError(body, "192.0.2.1", makeHarness().deps, (l) => lines.push(l));
  return lines;
}

describe("reportClientError: nothing a kid typed or owns reaches the log", () => {
  it("logs one structured line with none of the seven kinds in it", async () => {
    const lines = await logged({ ...leakyReport(), id: "0123456789ab" });

    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    for (const leak of LEAKS) expect(line, String(leak)).not.toMatch(leak);
    expect(JSON.parse(line)).toMatchObject({
      event: "client_error",
      message: "Error: other",
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

  // The server has no list of names. These must hold without one.
  it.each([
    ["an unquoted name", "Validation failed for my best friend Nora", /nora/i],
    ["an unquoted hero name", "Zephyrine the Brave could not be loaded", /zephyrine|brave/i],
    ["a quoted answer over 200 characters", `The answer was "${"Nora ".repeat(60)}" and was wrong`, /nora/i],
    ["an unterminated quote", `She typed "Nora and then it broke`, /nora/i],
    ["an email", "x@y.org rejected", /y\.org/],
    ["a room code", "no open room ABCD", /ABCD/],
    ["a visitor code", "no open room ABCDEF", /ABCDEF/],
    ["a lowercase code", "no open room abcd", /abcd/],
    ["a dev token", `bad ${DEV_TOKEN}`, /kaddev/],
    ["a JWT", `bad ${JWT}`, /eyJ/],
    ["typed text", "input was `hello there my name is Maya`", /hello|maya/i],
  ])("logs %s as Error: other", async (_kind, message, leak) => {
    const lines = await logged({ ...leakyReport(), message });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(leak);
    expect(JSON.parse(lines[0]!).message).toBe("Error: other");
  });

  it("keeps the kind of failure when the client sent only that", async () => {
    const lines = await logged({ ...leakyReport(), message: "TypeError: not a function" });
    expect(JSON.parse(lines[0]!).message).toBe("TypeError: not a function");
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
