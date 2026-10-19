import { describe, expect, it } from "vitest";
import { browserFamily, diagnose, ourFrames, routeShape, safeMessage, scrubReport } from "./error-report.js";

const LONG = "x".repeat(300);

describe("diagnose: the message is replaced by a kind, never kept", () => {
  it("names the failure kind and nothing the exception said", () => {
    expect(diagnose("TypeError", "Cannot read properties of undefined (reading 'Maya')")).toBe(
      "TypeError: read a property of nothing",
    );
    expect(diagnose("TypeError", "foo.bar is not a function")).toBe("TypeError: not a function");
    expect(diagnose("TypeError", "Failed to fetch dynamically imported module: https://x/bundle/a.js")).toBe(
      "TypeError: a chunk failed to load",
    );
  });

  it("keeps nothing of a message that matches no kind", () => {
    for (const message of [
      "Validation failed for my best friend Nora",
      `The answer was "${LONG}" and that is wrong`,
      "maya.k@example.com typed ABCD",
    ]) {
      expect(diagnose("Error", message)).toBe("Error: other");
    }
  });

  it("does not let typed text ride along beside a matched kind", () => {
    const out = diagnose("TypeError", "Nora typed 'my secret' then x is not a function for ABCD");
    expect(out).toBe("TypeError: not a function");
  });

  it("names only known exception types", () => {
    expect(diagnose("NoraError", "x is not a function")).toBe("Error: not a function");
    expect(diagnose("", "x is not defined")).toBe("Error: not defined");
  });
});

describe("safeMessage: the server accepts only what diagnose can produce", () => {
  it("passes an exact diagnosis", () => {
    expect(safeMessage("TypeError: not a function")).toBe("TypeError: not a function");
    expect(safeMessage("Error: other")).toBe("Error: other");
  });

  it.each([
    "Validation failed for my best friend Nora",
    `Error: ${LONG}`,
    "Error: not a function and Nora",
    "Nora: not a function",
    "TypeError: other kid",
    "TypeError: not a function\nNora",
    "kaddev.eyJzdWIiOiJtYXlhIn0",
    "",
  ])("turns %j into Error: other", (message) => {
    expect(safeMessage(message)).toBe("Error: other");
  });

  it("turns a non-string into Error: other", () => {
    expect(safeMessage(42)).toBe("Error: other");
    expect(safeMessage(null)).toBe("Error: other");
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
      message: "Nora's login failed",
      stack: ["/bundle/a.js:1:2", "nonsense maya@example.com"],
      version: "maya@example.com",
      route: "/p/ABCD",
      layout: "my-kid's-phone",
      browser: "Maya's Browser",
      id: "ABCD",
      displayName: "Maya",
      extra: { token: "kaddev.eyJzdWIiOiJtYXlhIn0" },
    });
    expect(report).toEqual({
      message: "Error: other",
      stack: ["/bundle/a.js:1:2"],
      version: "unknown",
      route: "other",
      layout: "other",
      browser: "other",
      id: "unknown",
    });
  });

  it("takes a short sha or dev as the version, and nothing else", () => {
    for (const version of ["dev", "4bf77c2d1315"]) {
      expect(scrubReport({ message: "x", version })?.version).toBe(version);
    }
    expect(scrubReport({ message: "x", version: "Nora-the-Brave" })?.version).toBe("unknown");
  });
});
