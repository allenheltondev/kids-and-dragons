import { describe, expect, it } from "vitest";
import { makeChapter, makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { getJournal } from "./journal.ts";
import { createRoom } from "./room.ts";

describe("the journal (study between games)", () => {
  it("gives a player their own heroes, the household's book, and who found what", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const [ada, ben] = players.map((p) => p.principal.playerId);
    if (!ada || !ben) throw new Error("setup failed");

    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ada", ownerPlayerId: ada, name: "Sparklehoof" }), householdId });
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ada2", ownerPlayerId: ada, name: "Thistle", level: 3, xp: 700 }), householdId });
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ben", ownerPlayerId: ben, name: "Rumble" }), householdId });
    await harness.repo.recordDiscoveries(householdId, [{ canonId: "bramblewood", playerId: ben }]);

    const result = await getJournal({ householdId, playerId: ada }, harness.deps);
    if (!result.ok) throw new Error(result.error.message);

    // Only Ada's own, furthest-taken first — the same rule WelcomeBack uses.
    expect(result.value.heroes.map((h) => h.name)).toEqual(["Thistle", "Sparklehoof"]);
    expect(Object.keys(result.value.fieldGuide)).toEqual(["bramblewood"]);
    expect(result.value.fieldGuide["bramblewood"]?.firstFoundBy).toBe(ben);
    // Credited by the hero each player has taken furthest.
    expect(result.value.finders).toEqual({ [ada]: "Thistle", [ben]: "Rumble" });
    expect(result.value.whereabouts).toBeNull();
  });

  it("credits a player with no hero by their own name", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const id = players[0]!.principal.playerId;
    const result = await getJournal({ householdId, playerId: id }, harness.deps);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.finders[id]).toBe("Player 1");
    expect(result.value.heroes).toEqual([]);
  });

  it("stands the party where the household last adventured, skipping rooms that never left the lobby", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const chapter = makeChapter();

    // An older run that got into the story…
    const played = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!played.ok) throw new Error("setup failed");
    const state = await harness.repo.getState(played.value.runId);
    await harness.repo.putState({ ...state!, chapterId: chapter.id });
    const run = await harness.repo.getRun(played.value.runId);
    await harness.repo.putRun({ ...run!, createdAt: "2026-01-01T00:00:00.000Z" });

    // …and a newer one that never did.
    const idle = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!idle.ok) throw new Error("setup failed");
    const idleRun = await harness.repo.getRun(idle.value.runId);
    await harness.repo.putRun({ ...idleRun!, createdAt: "2026-02-01T00:00:00.000Z" });

    const result = await getJournal({ householdId, playerId }, harness.deps);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.whereabouts).toEqual({ chapterId: chapter.id, biome: chapter.biome });
  });
});
