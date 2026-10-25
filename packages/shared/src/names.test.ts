import { describe, expect, it } from "vitest";
import { checkLocationName, LOCATION_NAME_MAX, checkTypedName, isBlockedName, NAME_REFUSED_MESSAGE } from "./names.js";
import { randomNames } from "../../client/src/screens/creationContent.js";

describe("the typed-name filter (#253)", () => {
  it("refuses blocked words, however they are dressed up", () => {
    for (const name of ["poop", "P00P", "f u c k", "f.u.c.k", "SHIIIT", "Mr Butt", "$ex", "bi7ch", "FÜCK"]) {
      expect(isBlockedName(name), name).toBe(true);
    }
  });

  it("lets ordinary names through, including ones with a rude word hiding inside", () => {
    for (const name of ["Cassidy", "Dickens", "Shiloh", "Hancock", "Analise", "Sparklehoof", "Mia-Rose", "O'Neil", "Ada"]) {
      expect(isBlockedName(name), name).toBe(false);
    }
  });

  it("does not treat an identity word as profanity, and still blocks slurs", () => {
    expect(isBlockedName("gay")).toBe(false);
    expect(isBlockedName("fag")).toBe(true);
    expect(isBlockedName("f4ggot")).toBe(true);
  });

  it("says 'pick another one' without saying why", () => {
    const result = checkTypedName("poop");
    expect(result).toEqual({ ok: false, message: NAME_REFUSED_MESSAGE });
    expect(NAME_REFUSED_MESSAGE).toMatch(/pick another one/i);
    expect(NAME_REFUSED_MESSAGE).not.toContain("—");
  });

  it("never blocks a name we generate ourselves", () => {
    for (const name of randomNames(300)) expect(isBlockedName(name), name).toBe(false);
  });
});

describe("a screen's place name", () => {
  it("trims, collapses spaces, and allows none", () => {
    expect(checkLocationName("  Living   room TV ")).toEqual({ ok: true, name: "Living room TV" });
    expect(checkLocationName("")).toEqual({ ok: true, name: "" });
    expect(checkLocationName(undefined)).toEqual({ ok: true, name: "" });
  });

  it("is cut to one line a TV can show, and runs the word filter", () => {
    const long = checkLocationName("x".repeat(100));
    expect(long.ok && long.name.length).toBe(LOCATION_NAME_MAX);
    expect(checkLocationName("F U C K").ok).toBe(false);
  });
});
