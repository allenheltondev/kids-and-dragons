/**
 * Camp looks in the adventure book (docs/hero-looks.md §6; #669, #682 review):
 * the book has no room's camp, so a hero's camp milestones (a first friend, a
 * friend by name) are read off the camps of the crews she has sat with, on the
 * read (`listHeroes`, which the journal carries) and on the write (the book's
 * look edit), for a crew that earned them before her look was ever written.
 */

import { describe, expect, it } from "vitest";
import { readKit, type CampRecord, type Character, type LookCatalog } from "@kad/shared";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { LOOKS_FIXTURE, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { CATALOG, seeded } from "./camp-table.testing.ts";
import { mutateCamp } from "./camp.ts";
import { editKitFromBook } from "./camp-book.ts";
import { listHeroes } from "./heroes.ts";

const AT = "2026-11-01T00:00:00.000Z";

const LOOKS: LookCatalog = {
  ...LOOKS_FIXTURE,
  titles: [
    ...LOOKS_FIXTURE.titles,
    { id: "the_friendly", text: "the Friendly", unlock: { from: "milestone", camp: "firstFriend" } },
    { id: "friend_of_duckling", text: "Friend of Duckling", unlock: { from: "milestone", friend: "duckling" } },
  ],
};

/** A household whose first crew made a friend long ago, and two of p_1's heroes with no look. */
async function household(): Promise<{ harness: TestHarness; householdId: string; pip: Character; newcomer: Character }> {
  const harness = makeHarness({ content: makeContent({ campCatalog: CATALOG, looksCatalog: LOOKS }) });
  const { householdId } = await seedHousehold(harness, 1);
  const written = await mutateCamp(
    householdId,
    null,
    (c: CampRecord) => seeded(c, { friends: { duckling: { rewardId: "riftlight-ashspan-bridge.duckling", at: AT } } }),
    harness.deps,
  );
  expect(written.ok).toBe(true);
  const row = (id: string, name: string, crews: string[]): Character => {
    const base = makeCharacter({ id, ownerPlayerId: "p_1", name });
    const { look: _none, ...noLook } = { ...base, householdId, kit: { ...readKit(base), crews } };
    return noLook as Character;
  };
  // Pip has sat with the first crew; the newcomer has sat with nobody yet.
  const pip = row("c_pip", "Pip", [householdId]);
  const newcomer = row("c_new", "Nell", []);
  await harness.repo.putCharacter(pip);
  await harness.repo.putCharacter(newcomer);
  return { harness, householdId, pip, newcomer };
}

describe("camp looks in the book (§6)", () => {
  it("the book's heroes read her crew's camp milestones before anything is written for her", async () => {
    const { harness, householdId, pip, newcomer } = await household();
    const listed = await listHeroes({ householdId, playerId: "p_1" }, harness.deps);
    if (!listed.ok) throw new Error(listed.error.message);
    const byId = new Map(listed.value.heroes.map((h) => [h.id, h]));
    expect(byId.get(pip.id)!.look!.unlocked).toEqual(expect.arrayContaining(["the_friendly", "friend_of_duckling"]));
    expect(byId.get(pip.id)!.look!.sources).toMatchObject({ the_friendly: "Her crew's first friend" });
    // A hero who has played with no crew earns no crew's milestone.
    expect(byId.get(newcomer.id)!.look?.unlocked ?? []).not.toContain("the_friendly");
    // Read, not written: her row still has no look.
    expect((await harness.repo.getCharacter(householdId, pip.id))!.look).toBeUndefined();
  });

  it("the book can pick a camp title she earned, and the write keeps its receipt", async () => {
    const { harness, householdId, pip } = await household();
    const answer = await editKitFromBook(
      { householdId, playerId: "p_1", body: { characterId: pip.id, changes: [{ field: "title", before: null, after: "the_friendly" }] } },
      harness.deps,
    );
    if (!answer.ok) throw new Error(answer.error.message);
    expect(answer.value.applied).toEqual(["title"]);
    const stored = (await harness.repo.getCharacter(householdId, pip.id))!.look!;
    expect(stored.title).toBe("the_friendly");
    expect(stored.unlocked["the_friendly"]).toMatchObject({ from: "milestone", source: "Her crew's first friend" });
    expect(stored.unlocked["friend_of_duckling"]).toMatchObject({ from: "milestone" });
  });

  it("refuses a camp title to a hero whose crews never earned it", async () => {
    const { harness, householdId, newcomer } = await household();
    const answer = await editKitFromBook(
      { householdId, playerId: "p_1", body: { characterId: newcomer.id, changes: [{ field: "title", before: null, after: "the_friendly" }] } },
      harness.deps,
    );
    expect(answer.ok).toBe(false);
    expect((await harness.repo.getCharacter(householdId, newcomer.id))!.look).toBeUndefined();
  });
});
