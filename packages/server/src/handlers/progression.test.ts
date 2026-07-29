import { describe, expect, it } from "vitest";
import { newCharacter, resolveCharacter, type Character, type RunState } from "@kad/shared";
import { makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { foldChapterXp, newCharacterWrite } from "./progression.ts";

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

describe("newCharacterWrite", () => {
  it("returns the engine's unresolved character, not the resolved view", async () => {
    /*
     * The bug this pins, found in review: a `ResolvedCharacter` already has the
     * species passive folded into its stats, so rebuilding a `Character` from a
     * party member saved the passive as part of the base — and the next
     * `resolveCharacter()` applied it again, leaving a unicorn permanently a
     * point of Heart up with nothing on screen to say so. The engine hands over
     * the real character; this must pass it through untouched.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { character } = setup(harness, householdId, playerId);

    const writes = await newCharacterWrite(character, harness.deps, householdId);

    expect(writes).toEqual([character]);
    // 2 assigned + 1 base, with the unicorn's +1 Heart *not* baked in.
    expect(writes[0]?.committed.stats.heart).toBe(3);
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
    const { character } = setup(harness, householdId, playerId);

    const veteran: Character = {
      ...character,
      committed: { ...character.committed, level: 7, xp: 2600 },
    };
    await harness.repo.putCharacter(veteran);

    expect(await newCharacterWrite(character, harness.deps, householdId)).toEqual([]);
  });
});

describe("when a chapter counts as finished", () => {
  it("folds on the phase transition, not on a CHAPTER_COMPLETE presentation", async () => {
    /*
     * The bug this pins, found in review: when a check's branch lands on an
     * ending scene, `doRoll` keeps the ROLL presentation on purpose — the dice
     * are the centrepiece of the screen — so a chapter that ends straight off a
     * roll never produced a CHAPTER_COMPLETE presentation at all. Watching for
     * it lost the whole award, and the ADVANCE that follows leaves
     * `chapter_complete` with no second chance.
     *
     * `applyAction` keys off the before/after phase instead, which no path in
     * can dodge. This test asserts the property that fix depends on: the fold
     * is driven by the state, and the presentation is not consulted.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    // A run sitting in chapter_complete with an award on it, and no
    // presentation anywhere in sight.
    state.xpEarned = 300;
    const writes = await foldChapterXp(state, harness.deps, householdId);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.provisional?.xp).toBe(300);
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
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    state.xpEarned = 300;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

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
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    state.xpEarned = 300;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

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
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);
    expect(state.party[0]?.character.level).toBe(1);

    state.xpEarned = 300;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

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

    const built: Character[] = [];
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
      built.push(character);
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
    for (const c of built) await harness.repo.putCharacter(c);

    state.xpEarned = 700;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

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
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

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
    // Nothing to write, nothing thrown, and the party snapshot untouched.
    await expect(foldChapterXp(state, harness.deps, householdId)).resolves.toEqual([]);
    expect(state.party[0]?.character.level).toBe(1);
  });
});
