import { describe, expect, it } from "vitest";
import { codeComplete, codeSlots, formatRoute, isRoomCode, normalizeCode, normalizeCodeInput, parseRoute, routeCode } from "./router";

describe("parseRoute", () => {
  it("maps the three routes from architecture §4.6", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/tv/ABCD")).toEqual({ name: "tv", code: "ABCD" });
    expect(parseRoute("/p/ABCD")).toEqual({ name: "player", code: "ABCD" });
  });

  it("maps /journal, which needs no room code", () => {
    expect(parseRoute("/journal")).toEqual({ name: "journal" });
    expect(parseRoute("/journal/")).toEqual({ name: "journal" });
    expect(formatRoute({ name: "journal" })).toBe("/journal");
    expect(routeCode({ name: "journal" })).toBeNull();
  });

  it("maps /guide, which needs nothing at all (#257)", () => {
    expect(parseRoute("/guide")).toEqual({ name: "guide" });
    expect(parseRoute("/guide/")).toEqual({ name: "guide" });
    expect(formatRoute({ name: "guide" })).toBe("/guide");
    expect(routeCode({ name: "guide" })).toBeNull();
  });

  it("maps /account, the grown-up's errands kept off the join screen", () => {
    expect(parseRoute("/account")).toEqual({ name: "account" });
    expect(parseRoute("/account?pair=ABCDEFGH")).toEqual({ name: "account" });
    expect(formatRoute({ name: "account" })).toBe("/account");
    expect(routeCode({ name: "account" })).toBeNull();
  });

  it("treats an empty path as home", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("//")).toEqual({ name: "home" });
  });

  it("uppercases the code, so a hand-typed url still finds the room", () => {
    expect(parseRoute("/p/abcd")).toEqual({ name: "player", code: "ABCD" });
    expect(parseRoute("/tv/aBc4")).toEqual({ name: "tv", code: "ABC4" });
  });

  it("ignores query strings and hashes", () => {
    expect(parseRoute("/tv/ABCD?debug=1")).toEqual({ name: "tv", code: "ABCD" });
    expect(parseRoute("/p/ABCD#top")).toEqual({ name: "player", code: "ABCD" });
  });

  it("tolerates a trailing slash", () => {
    expect(parseRoute("/p/ABCD/")).toEqual({ name: "player", code: "ABCD" });
  });

  it("rejects anything that is not a four-character code", () => {
    expect(parseRoute("/p/ABC")).toEqual({ name: "notFound", path: "/p/ABC" });
    expect(parseRoute("/p/ABCDE")).toEqual({ name: "notFound", path: "/p/ABCDE" });
    expect(parseRoute("/p/AB-D")).toEqual({ name: "notFound", path: "/p/AB-D" });
  });

  it("rejects unknown prefixes and deeper paths", () => {
    expect(parseRoute("/x/ABCD")).toEqual({ name: "notFound", path: "/x/ABCD" });
    expect(parseRoute("/tv/ABCD/extra")).toEqual({ name: "notFound", path: "/tv/ABCD/extra" });
  });

  it("survives a malformed percent-escape rather than throwing", () => {
    expect(parseRoute("/p/%E0%A4%A")).toEqual({ name: "notFound", path: "/p/%E0%A4%A" });
  });
});

describe("formatRoute", () => {
  it("round-trips every route", () => {
    for (const route of [
      { name: "home" },
      { name: "tv", code: "ABCD" },
      { name: "player", code: "WXYZ" },
    ] as const) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it("normalizes on the way out too", () => {
    expect(formatRoute({ name: "player", code: "wxyz" })).toBe("/p/WXYZ");
  });
});

describe("routeCode", () => {
  it("is the code for surface routes and null elsewhere", () => {
    expect(routeCode({ name: "tv", code: "ABCD" })).toBe("ABCD");
    expect(routeCode({ name: "player", code: "ABCD" })).toBe("ABCD");
    expect(routeCode({ name: "home" })).toBeNull();
    expect(routeCode({ name: "notFound", path: "/nope" })).toBeNull();
  });
});

describe("room codes", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeCode("  abcd \n")).toBe("ABCD");
  });

  it("accepts four alphanumerics", () => {
    expect(isRoomCode("ABCD")).toBe(true);
    expect(isRoomCode("A2C9")).toBe(true);
    // Deliberately permissive: the generator avoids I/O/0/1, but a typo should
    // reach the server and get "no such room", not a blank page.
    expect(isRoomCode("IO01")).toBe(true);
    expect(isRoomCode("AB")).toBe(false);
  });

  it("accepts an open room's six-letter visitor code, and nothing in between (#249)", () => {
    expect(isRoomCode("ABCDXY")).toBe(true);
    expect(isRoomCode("ABCDE")).toBe(false);
    expect(isRoomCode("ABCDXYZ")).toBe(false);
    expect(parseRoute("/p/abcdxy")).toEqual({ name: "player", code: "ABCDXY" });
  });

  it("lets a typed code run to six letters, and calls four or six complete", () => {
    expect(normalizeCodeInput("ab-cd xy z")).toBe("ABCDXY");
    expect(codeComplete("ABCD")).toBe(true);
    expect(codeComplete("ABCDX")).toBe(false);
    expect(codeComplete("ABCDXY")).toBe(true);
    expect(codeSlots("ABCD")).toBe(4);
    expect(codeSlots("ABCDX")).toBe(6);
  });
});
