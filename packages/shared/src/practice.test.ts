import { describe, expect, it } from "vitest";
import { PRACTICE_CAMPAIGN_ID, isNewcomer, isPracticeCampaign } from "./practice.js";
import { newCharacter, resolveCharacter, startCampaign } from "./character.js";
import { claimFor } from "./claim.js";
import { makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

function fresh() {
  return newCharacter({
    id: "c_1",
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Rue",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    rules,
    now: "2026-10-18T12:00:00.000Z",
  });
}

describe("the practice (#255)", () => {
  it("is the first-steps campaign and nothing else", () => {
    expect(isPracticeCampaign(PRACTICE_CAMPAIGN_ID)).toBe(true);
    for (const id of ["gemfall", "the-hollow-crown", null, undefined, ""]) expect(isPracticeCampaign(id)).toBe(false);
  });

  it("calls a hero who has never played anything a newcomer, and nobody else", () => {
    const hero = fresh();
    expect(isNewcomer(resolveCharacter(hero, rules, items))).toBe(true);
    // Played it: never again.
    const practiced = resolveCharacter({ ...hero, practiced: true }, rules, items);
    expect(practiced.practiced).toBe(true);
    expect(isNewcomer(practiced)).toBe(false);
    // Skipped it and started an adventure: from then on a veteran.
    expect(isNewcomer(resolveCharacter(startCampaign(hero, claimFor("gemfall", "h_1", hero)), rules, items))).toBe(false);
    // Earned XP, or kept a souvenir from a campaign that failed.
    expect(isNewcomer({ ...resolveCharacter(hero, rules, items), xp: 100 })).toBe(false);
    expect(
      isNewcomer({ ...resolveCharacter(hero, rules, items), souvenirs: [{ id: "cracked_pendant", fromRun: "gemfall", earnedAt: "2026-07-14" }] }),
    ).toBe(false);
  });

  it("resolves a hero who never practiced exactly as before it existed", () => {
    expect(resolveCharacter(fresh(), rules, items)).not.toHaveProperty("practiced");
  });
});
