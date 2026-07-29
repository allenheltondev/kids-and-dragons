import { describe, expect, it } from "vitest";
import { newCharacter, resolveCharacter, type Character, type RunState } from "@kad/shared";
import { makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { foldChapterXp, persistNewCharacters } from "./progression.ts";

/**
 * A run holding one resolved character, exactly as the engine would leave it
 * after CREATE_CHARACTER.
 *
 * The numbers below are the **harness fixture** curve, not `content/rules.json`.
 * That is deliberate and worth not "fixing": these tests are about the
 * mechanism — provisional versus committed, the re-resolve, the uniform award —
 * and pinning them to the shipped curve would turn them red every time the
 * pacing is retuned, which is a content change. `rules.test.ts` owns the curve.
 */
function setup(harness: TestHarness, householdId: string, playerId: string) {
  const rules = harness.deps.content.rules();
  const items = harness.deps.content.items();

  const character = newCharacter({
    id: `c_${playerId}`,
    householdId,
    ownerPlayerId: playerId,
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 1, clever: 0, heart: 2 },
    appearance: { palette: "dawn", accent: "gold" },
    rules,
    now: new Date(T0).toISOString(),
  });

  const state = {
    runId: "r_1",
    xpEarned: 0,
    party: [
      {
        character: resolveCharacter(character, rules, items),
        playerId,
        hp: 10,
        down: false,
        connected: true,
        ready: false,
      },
    ],
  } as unknown as RunState;

  return { state, character, rules, items };
}

describe("persistNewCharacters", () => {
  it("writes a character built at the table into the household", async () => {
    // The gap this closes: putCharacter had no caller at all, so a character
    // created in a run lived in RunState and was gone when the run ended —
    // which is the opposite of "characters hang off the household".
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state } = setup(harness, householdId, playerId);

    await persistNewCharacters(state, harness.deps, householdId);

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe("Pip");
    expect(stored?.committed.level).toBe(1);
    expect(stored?.provisional).toBeNull();
  });

  it("does not overwrite a character the household already has", async () => {
    /*
     * Create-if-absent, not an unconditional write. A re-sent CREATE_CHARACTER
     * — or a returning character from a previous campaign — would otherwise
     * have its level flattened to whatever the run snapshot happens to hold,
     * which is level 1 for anything the engine just built.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state, character } = setup(harness, householdId, playerId);

    const veteran: Character = {
      ...character,
      committed: { ...character.committed, level: 7, xp: 2600 },
    };
    await harness.repo.putCharacter(veteran);

    await persistNewCharacters(state, harness.deps, householdId);

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.committed.level).toBe(7);
    expect(stored?.committed.xp).toBe(2600);
  });
});

describe("foldChapterXp", () => {
  it("folds the award into provisional and leaves committed alone", async () => {
    /*
     * The commitment rule (spec §8.3) in one assertion. `startCampaign()` runs
     * before `awardXp()` unconditionally, so there is no path here that writes
     * a level nothing can revert. If this ever asserts on `committed`, a failed
     * campaign has quietly stopped giving the levels back.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state } = setup(harness, householdId, playerId);
    await persistNewCharacters(state, harness.deps, householdId);

    state.xpEarned = 300;
    await foldChapterXp(state, harness.deps, householdId);

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.committed.level).toBe(1);
    expect(stored?.committed.xp).toBe(0);
    expect(stored?.provisional?.xp).toBe(300);
    expect(stored?.provisional?.level).toBe(2);
    expect(stored?.provisional?.runId).toBe("r_1");
  });

  it("banks the stat point the level owes", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state } = setup(harness, householdId, playerId);
    await persistNewCharacters(state, harness.deps, householdId);

    state.xpEarned = 300;
    await foldChapterXp(state, harness.deps, householdId);

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.provisional?.unspentPoints).toBe(1);
  });

  it("re-resolves the party so the new level reaches the phones", async () => {
    /*
     * The engine resolves a character once, at creation, and never again. Skip
     * the re-resolve and everything persists correctly while every phone keeps
     * showing the level she sat down with — a bug that looks like "the game
     * didn't give me my level" and is invisible in the store.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state } = setup(harness, householdId, playerId);
    await persistNewCharacters(state, harness.deps, householdId);
    expect(state.party[0]?.character.level).toBe(1);

    state.xpEarned = 300;
    await foldChapterXp(state, harness.deps, householdId);

    expect(state.party[0]?.character.level).toBe(2);
    expect(state.party[0]?.character.xp).toBe(300);
    expect(state.party[0]?.character.unspentPoints).toBe(1);
  });

  it("gives every character the same award", async () => {
    // XP is uniform by design (spec §8.2): the reward for a level is a visible
    // new body, so a per-player award would leave one child smaller than the
    // rest of the party on the television.
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 3);
    const rules = harness.deps.content.rules();
    const items = harness.deps.content.items();

    const party = players.map((p) => {
      const playerId = p.principal.playerId;
      const character = newCharacter({
        id: `c_${playerId}`,
        householdId,
        ownerPlayerId: playerId,
        name: playerId,
        species: "griffin",
        class: "duskrunner",
        stats: { might: 0, quick: 3, clever: 0, heart: 0 },
        appearance: { palette: "dawn", accent: "gold" },
        rules,
        now: new Date(T0).toISOString(),
      });
      return {
        character: resolveCharacter(character, rules, items),
        playerId,
        hp: 10,
        down: false,
        connected: true,
        ready: false,
      };
    });
    const state = { runId: "r_1", xpEarned: 0, party } as unknown as RunState;
    await persistNewCharacters(state, harness.deps, householdId);

    state.xpEarned = 700;
    await foldChapterXp(state, harness.deps, householdId);

    for (const member of state.party) {
      const stored = await harness.repo.getCharacter(householdId, member.character.id);
      expect(stored?.provisional?.xp).toBe(700);
      expect(member.character.level).toBe(3);
    }
  });

  it("does nothing when the chapter awarded nothing", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state } = setup(harness, householdId, playerId);
    await persistNewCharacters(state, harness.deps, householdId);

    await foldChapterXp(state, harness.deps, householdId);

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.provisional).toBeNull();
  });

  it("skips a character the household has no record of, without throwing", async () => {
    // A swept household, or a party member created before any of this existed.
    // The character on screen keeps playing; it just does not accrue. Throwing
    // here would end the session at the table.
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state } = setup(harness, householdId, players[0]!.principal.playerId);

    state.xpEarned = 300;
    await expect(foldChapterXp(state, harness.deps, householdId)).resolves.toBeUndefined();
    expect(state.party[0]?.character.level).toBe(1);
  });
});
