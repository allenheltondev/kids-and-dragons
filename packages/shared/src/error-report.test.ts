import { describe, expect, it } from "vitest";
import { browserFamily, ourFrames, routeShape, scrubReport, scrubText } from "./error-report.js";

const JWT = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.c2lnbmF0dXJlYmxvYg";
const DEV_TOKEN = "kaddev.eyJzdWIiOiJtYXlhIn0";
const DEVICE_TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

describe("scrubText: each kind of thing that must never reach a log", () => {
  it("removes an email", () => {
    const out = scrubText("sign-in failed for maya.k@example.com today");
    expect(out).not.toMatch(/maya|example/i);
    expect(out).toContain("[email]");
  });

  it("removes a four-letter room code, and a visitor's six", () => {
    expect(scrubText("no open room WXYZ")).toBe("no open room [code]");
    expect(scrubText("no open room WXYZQR")).toBe("no open room [code]");
  });

  it("removes a room code from a path and from a query, in any case", () => {
    const out = scrubText("GET /api/room/wxyz/join and /p/WXYZ?code=WXYZ&token=abc failed");
    expect(out).not.toMatch(/wxyz/i);
    expect(out).not.toContain("token=");
    expect(scrubText("at /tv/abcdef")).toBe("at /tv/:code");
  });

  it("removes a dev token, a JWT and a long opaque token", () => {
    for (const secret of [DEV_TOKEN, JWT, DEVICE_TOKEN]) {
      const out = scrubText(`bad credential ${secret} refused`);
      expect(out, secret).not.toContain(secret.slice(4, 20));
      expect(out, secret).toContain("[token]");
    }
    expect(scrubText(`Authorization: Bearer ${DEVICE_TOKEN}`)).not.toContain(DEVICE_TOKEN);
  });

  it("removes typed text an engine quotes back", () => {
    const out = scrubText(`Cannot read properties of undefined (reading 'Maya the Brave') in "my secret nickname"`);
    expect(out).not.toMatch(/maya|secret|nickname/i);
  });

  it("keeps an apostrophe inside a word from swallowing the sentence", () => {
    expect(scrubText("can't read 'x' of undefined")).toBe("can't read [text] of undefined");
  });

  it("removes every name the page knows, whatever the case, and only as a word", () => {
    const out = scrubText("hero Zephyrine and kid Maya fell; MAYA again; Mayakovsky is fine", ["Maya", "Zephyrine"]);
    expect(out).not.toMatch(/zephyrine/i);
    expect(out).not.toMatch(/\bmaya\b/i);
    expect(out).toContain("Mayakovsky");
  });

  it("escapes a name that is not safe in a pattern", () => {
    expect(scrubText("hello (Sir) Lancelot [III]", ["(Sir) Lancelot [III]"])).toBe("hello [name]");
  });

  it("is idempotent, so the server can scrub what the client already did", () => {
    const once = scrubText(`${DEV_TOKEN} maya@example.com /p/ABCD 'x'`, ["Maya"]);
    expect(scrubText(once, ["Maya"])).toBe(once);
  });

  it("caps the message", () => {
    expect(scrubText("a ".repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});

describe("stacks, routes and browsers", () => {
  it("keeps only frames in our own files, with no function names and no origin", () => {
    const stack = [
      "TypeError: boom",
      "    at render (https://kids.example/bundle/index-abc123.js:1:2345)",
      "    at https://cdn.thirdparty.test/ads.js:9:9",
      "mount@https://kids.example/bundle/Party-xyz.js?v=1:7:8",
    ].join("\n");
    expect(ourFrames(stack)).toEqual(["/bundle/index-abc123.js:1:2345"]);
  });

  it("reduces a path to its shape", () => {
    expect(routeShape("/")).toBe("/");
    expect(routeShape("/tv/ABCD")).toBe("/tv/:code");
    expect(routeShape("/p/ABCDEF?x=1")).toBe("/p/:code");
    expect(routeShape("/journal")).toBe("/journal");
    expect(routeShape("/maya-kaddev-token")).toBe("other");
  });

  it("names a browser family", () => {
    expect(browserFamily("Mozilla/5.0 (iPhone) AppleWebKit Version/17 Mobile Safari/604.1")).toBe("safari");
    expect(browserFamily("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36")).toBe("chrome");
    expect(browserFamily("Mozilla/5.0 Chrome/120 Safari/537.36 Edg/120")).toBe("edge");
    expect(browserFamily("Mozilla/5.0 (X11) Gecko/20100101 Firefox/121.0")).toBe("firefox");
    expect(browserFamily("curl/8")).toBe("other");
  });
});

describe("scrubReport", () => {
  it("rejects what is not a report", () => {
    expect(scrubReport(null)).toBeNull();
    expect(scrubReport("boom")).toBeNull();
    expect(scrubReport({ stack: [] })).toBeNull();
  });

  it("checks every field and drops everything it does not list", () => {
    const report = scrubReport({
      message: "x",
      stack: ["/bundle/a.js:1:2", "nonsense maya@example.com"],
      version: "maya@example.com",
      route: "/p/ABCD",
      layout: "my-kid's-phone",
      browser: "Maya's Browser",
      id: "ABCD",
      displayName: "Maya",
      extra: { token: DEV_TOKEN },
    });
    expect(report).toEqual({
      message: "x",
      stack: ["/bundle/a.js:1:2"],
      version: "unknown",
      route: "other",
      layout: "other",
      browser: "other",
      id: "unknown",
    });
  });
});
