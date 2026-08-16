// @vitest-environment jsdom
/**
 * CharacterSheet — the facts the game has always tracked and never shown.
 *
 * Souvenirs, `isProvisional` and `committedLevel` are all on
 * `ResolvedCharacter`, all survive every revert, and none of them had a reader
 * anywhere in the client. spec §8.3 calls the souvenir "the point" and says it
 * "displays on their sheet"; this is that sheet.
 *
 * The interesting logic is the tier history, and it is interesting because it
 * is *derived*. Nothing records which tiers a character has been — and nothing
 * needs to: tier follows level, so everything at or below the current one was
 * climbed, and the only way to have reached a tier you no longer hold is a
 * failed campaign, which is exactly what a tier-flavoured souvenir records.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ItemCatalog, PartyMember, ResolvedCharacter, Souvenir } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { CharacterSheet, prettyCampaign, readSouvenir, tierHistory } from "./CharacterSheet";

const ITEMS: ItemCatalog = makeItems();

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function member(overrides: Partial<ResolvedCharacter> = {}): PartyMember {
  const char = character(overrides);
  return { character: char, playerId: char.ownerPlayerId, hp: 8, down: false, connected: true, ready: true };
}

const souvenir = (id: string): Souvenir => ({ id, fromRun: "r_1", earnedAt: "2026-07-01" });

function show(overrides: Partial<ResolvedCharacter> = {}, isMe = true) {
  return render(
    <CharacterSheet
      member={member(overrides)}
      isMe={isMe}
      items={ITEMS}
      onClose={() => undefined}
    />,
  );
}

afterEach(cleanup);

describe("reading a souvenir id", () => {
  it("splits the campaign from the tier it records", () => {
    // `failCampaign` is handed `campaignId` or `campaignId#tier` — the second
    // when the attempt reached a tier before losing it (spec §8.3).
    expect(readSouvenir("the-hollow-crown")).toEqual({
      campaignId: "the-hollow-crown",
      tier: null,
    });
    expect(readSouvenir("the-hollow-crown#sworn")).toEqual({
      campaignId: "the-hollow-crown",
      tier: "sworn",
    });
  });

  it("treats an unknown tier fragment as no tier rather than showing it raw", () => {
    // Souvenir ids are written by a server that may be newer than this bundle,
    // and "was ??? once" is worse than saying nothing.
    expect(readSouvenir("some-campaign#ascendant").tier).toBeNull();
    expect(readSouvenir("some-campaign#ascendant").campaignId).toBe("some-campaign");
  });

  it("names a campaign from its id, which is all a souvenir carries", () => {
    expect(prettyCampaign("the-hollow-crown")).toBe("The Hollow Crown");
  });
});

describe("tier history", () => {
  it("counts every tier at or below the current level as reached", () => {
    const ladder = tierHistory(member({ level: 7, tier: "radiant" }));
    expect(ladder.map((rung) => rung.standing)).toEqual(["reached", "reached", "reached", "ahead"]);
  });

  it("marks a tier a failed campaign took back", () => {
    /*
     * spec §8.3's worst case, and the reason the souvenir exists: "she goes
     * back to Fledgling and keeps something visible that says she was Sworn
     * once." Level says Fledgling; the souvenir says otherwise, and both are
     * true.
     */
    const reverted = member({
      level: 1,
      tier: "fledgling",
      souvenirs: [souvenir("the-hollow-crown#sworn")],
    });
    const ladder = tierHistory(reverted);

    expect(ladder[0]).toEqual({ tier: "fledgling", standing: "reached" });
    expect(ladder[1]).toEqual({ tier: "sworn", standing: "lost" });
    expect(ladder[2]?.standing).toBe("ahead");
  });

  it("prefers reached over lost when they have climbed back", () => {
    // Failed at Sworn, earned it again. She holds it now, and that is the
    // sentence that matters.
    const again = member({
      level: 4,
      tier: "sworn",
      souvenirs: [souvenir("the-hollow-crown#sworn")],
    });
    expect(tierHistory(again)[1]).toEqual({ tier: "sworn", standing: "reached" });
  });

  it("needs no content loaded, because the resolved tier is already the answer", () => {
    /*
     * The version this replaces recomputed the ladder from level and
     * `rules.tierLevels`, and content is fetched separately from the bundle —
     * so a sheet opened before the rules landed spent that moment claiming the
     * tier she is *standing in* was "still to come". Known-false, not unknown.
     *
     * `resolveCharacter` already ran `tierForLevel` server-side and stamped the
     * result, so the same derivation is available without the dependency.
     */
    const ladder = tierHistory(member({ level: 7, tier: "radiant" }));
    expect(ladder.map((rung) => rung.standing)).toEqual(["reached", "reached", "reached", "ahead"]);
  });

  it("claims nothing for a tier id this bundle does not know", () => {
    const future = member({ tier: "ascendant" as never });
    expect(tierHistory(future).every((rung) => rung.standing === "ahead")).toBe(true);
  });
});

describe("the sheet", () => {
  it("shows who they are and how far they have come", () => {
    show({ level: 4, tier: "sworn" });
    expect(screen.getByText("Sparklehoof")).toBeTruthy();
    expect(screen.getByText("Level 4")).toBeTruthy();
    expect(screen.getAllByText("reached").length).toBe(2);
    expect(screen.getAllByText("still to come").length).toBe(2);
  });

  it("says which half of a level is still on loan", () => {
    /*
     * spec §8.3's commitment rule, made visible before it bites rather than
     * after. A child who levelled to 5 this evening should be able to find out
     * that 4 is the number she keeps if the campaign goes wrong.
     */
    show({ level: 5, committedLevel: 4, isProvisional: true });
    expect(screen.getByText(/Level 4 is what you keep/)).toBeTruthy();
  });

  it("says nothing about loans when there is nothing provisional", () => {
    show({ level: 4, committedLevel: 4, isProvisional: true });
    expect(screen.queryByText(/is what you keep/)).toBeNull();
  });

  it("shows a souvenir, and what it was for", () => {
    // "The souvenir is the point. A failed campaign still leaves a visible
    // mark, so the time spent produced something."
    show({ souvenirs: [souvenir("the-hollow-crown#sworn")] });
    expect(screen.getByText(/The Hollow Crown/)).toBeTruthy();
    expect(screen.getByText(/was Sworn once/)).toBeTruthy();
  });

  it("shows a souvenir that names no tier without inventing one", () => {
    show({ souvenirs: [souvenir("the-hollow-crown")] });
    expect(screen.getByText(/The Hollow Crown/)).toBeTruthy();
    expect(screen.queryByText(/once/)).toBeNull();
  });

  it("keeps the souvenir block off the screen when there are none", () => {
    show();
    expect(screen.queryByText(/Things you have kept/)).toBeNull();
  });

  it("speaks about somebody else in the third person", () => {
    // The same sheet, opened from the party strip, is about *them*.
    show({ level: 5, committedLevel: 4, isProvisional: true, name: "Thistle" }, false);
    expect(screen.getByText(/Level 4 is what they keep/)).toBeTruthy();
    expect(screen.getByText(/How far they have come/)).toBeTruthy();
  });

  it("shows their bag, including the empty slots", () => {
    show({ inventory: [{ itemId: "sunbloom_draught", kind: "consumable" }] });
    expect(screen.getByText("Sunbloom Draught")).toBeTruthy();
    // Six slots, one filled (§9.1).
    expect(screen.getAllByText("Empty")).toHaveLength(5);
  });

  it("lists quest items outside the slot budget", () => {
    show({ questItems: ["rusted_key"] });
    // Named from the catalog, or by id when content has not loaded.
    expect(screen.getByText(/rusted_key|Rusted Key/)).toBeTruthy();
  });
});
