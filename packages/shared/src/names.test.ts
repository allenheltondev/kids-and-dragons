import { describe, expect, it } from "vitest";
import { checkTypedName, isBlockedName, NAME_REFUSED_MESSAGE } from "./names.js";
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
