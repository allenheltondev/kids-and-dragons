import { describe, expect, it } from "vitest";
import { claimFor, claimOf, parseClaim } from "./claim.js";

const home = { householdId: "h_ada" };

describe("a hero's claim (#282)", () => {
  it("is the bare campaign id at home, as every row before the claim was stamped", () => {
    expect(claimFor("gemfall", "h_ada", home)).toBe("gemfall");
    expect(parseClaim("gemfall", home)).toEqual({ campaignId: "gemfall", table: "h_ada" });
  });

  it("names the table when she is visiting, so two tables on one campaign differ", () => {
    const atRues = claimFor("gemfall", "h_rue", home);
    expect(atRues).toBe("gemfall@h_rue");
    expect(atRues).not.toBe(claimFor("gemfall", "h_ada", home));
    expect(parseClaim(atRues, home)).toEqual({ campaignId: "gemfall", table: "h_rue" });
  });

  it("is read off provisional, and a hero with none is free", () => {
    expect(claimOf({ provisional: null })).toBeNull();
    expect(claimOf({})).toBeNull();
    expect(claimOf({ provisional: { runId: "gemfall@h_rue" } as never })).toBe("gemfall@h_rue");
  });
});
