import { describe, expect, it } from "vitest";
import {
  newCharacter,
  resolveCharacter,
  type Character,
  type Chapter,
  type RunState,
} from "@kad/shared";
import { makeChapter, makeContent, makeHarness, seedHousehold, stubEngine, T0 } from "../test-support.ts";
import type { CommitInput } from "../store/repository.ts";
import { applyAction } from "../handlers/action.ts";
import { createRoom } from "../handlers/room.ts";
import {
  awardChapterXp,
  awardChapterXpDetails,
  computeChapterXp,
  loadSharedRuntime,
} from "./shared-engine.ts";

function makeCharacter(householdId: string, playerId: string, harness: ReturnType<typeof makeHarness>) {
  const rules = harness.deps.content.rules();
  return newCharacter({
    id: `c_${playerId}`,
    householdId,
    ownerPlayerId: playerId,
    name: playerId,
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 1, clever: 0, heart: 2 },
    appearance: { palette: "dawn", accent: "gold" },
    rules,
    now: new Date(T0).toISOString(),
  });
}

function completionState(
  characters: Character[],
  harness: ReturnType<typeof makeHarness>,
  patch: Partial<RunState> = {},
): RunState {
  const rules = harness.deps.content.rules();
  const items = harness.deps.content.items();
  return {
    runId: "run-1",
    campaignId: "campaign-1",
    chapterId: "bramblewood-01",
    chapterOutcome: "success",
    bonuses: [],
    xpEarned: makeChapter().xpAward,
    party: characters.map((character) => ({
      character: resolveCharacter(character, rules, items),
      playerId: character.ownerPlayerId,
      hp: 10,
      down: false,
      connected: true,
      ready: true,
    })),
    ...patch,
  } as RunState;
}


describe("computeChapterXp", () => {
  it("uses the engine-settled total so authored grantXp effects are preserved", () => {
    const chapter = { ...makeChapter(), xpAward: 101 } as Chapter;
    const state = completionState([], makeHarness(), {
      chapterOutcome: "setback",
      xpEarned: 60,
      bonuses: [
        { id: "shrine", label: "Found the shrine", xp: 7 },
        { id: "safe", label: "Everyone stayed standing", xp: 3 },
      ],
    });

    expect(computeChapterXp(state, chapter)).toBe(60);
    expect(computeChapterXp({ ...state, xpEarned: 161 }, chapter)).toBe(161);
  });
});

describe("awardChapterXp", () => {
  it("awards the full amount independently, starts campaign progress, and skips missing rows", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 3);
    const characters = players.map((player) =>
      makeCharacter(householdId, player.principal.playerId, harness),
    );
    await harness.repo.putCharacter(characters[0]!);
    await harness.repo.putCharacter(characters[2]!);

    const chapter = { ...makeChapter(), xpAward: 101 } as Chapter;
    const state = completionState(characters, harness, {
      chapterOutcome: "setback",
      bonuses: [{ id: "bonus", label: "Bonus", xp: 10 }],
      xpEarned: 60,
    });
    const writes = await awardChapterXp({
      state,
      chapter,
      householdId,
      repo: harness.repo,
      rules: harness.deps.content.rules(),
      items: harness.deps.content.items(),
    });

    expect(writes.map((character) => character.id)).toEqual([characters[0]!.id, characters[2]!.id]);
    for (const character of writes) {
      expect(character.committed.xp).toBe(0);
      expect(character.provisional?.xp).toBe(60);
      expect(character.provisional?.runId).toBe("campaign-1");
    }
    expect(state.party[0]?.character.xp).toBe(60);
    expect(state.party[1]?.character.xp).toBe(0);
    expect(state.party[2]?.character.xp).toBe(60);
  });

  it("retains per-character level and tier metadata beside refreshed snapshots", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const character = makeCharacter(householdId, players[0]!.principal.playerId, harness);
    await harness.repo.putCharacter(character);
    const state = completionState([character], harness, { xpEarned: 1200 });

    const result = await awardChapterXpDetails({
      state,
      chapter: { ...makeChapter(), xpAward: 1200 },
      householdId,
      repo: harness.repo,
      rules: harness.deps.content.rules(),
      items: harness.deps.content.items(),
    });

    expect(result.awards).toEqual([
      { characterId: character.id, leveledTo: 4, newTier: "sworn" },
    ]);
    expect(state.party[0]?.character).toMatchObject({
      id: character.id,
      xp: 1200,
      level: 4,
      tier: "sworn",
      isProvisional: true,
      committedLevel: 1,
    });
  });

  it("skips XP mutation while still carrying inventory for a non-positive total", async () => {
    const harness = makeHarness({
      content: makeContent({ chapters: [{ ...makeChapter(), xpAward: 0 }] }),
    });
    const { householdId, players } = await seedHousehold(harness, 1);
    const character = makeCharacter(householdId, players[0]!.principal.playerId, harness);
    await harness.repo.putCharacter(character);
    const state = completionState([character], harness, { bonuses: [], xpEarned: 0 });
    state.party[0]!.character.inventory = [
      { itemId: "sunbloom_draught", kind: "consumable" },
    ];
    let loads = 0;

    const result = await awardChapterXpDetails({
      state,
      chapter: { ...makeChapter(), xpAward: 0 },
      householdId,
      repo: {
        getCharacter: async (...args) => {
          loads += 1;
          return harness.repo.getCharacter(...args);
        },
      },
      rules: harness.deps.content.rules(),
      items: harness.deps.content.items(),
    });

    expect(loads).toBe(1);
    expect(result.awards).toEqual([]);
    expect(result.characters[0]?.provisional?.xp).toBe(0);
    expect(result.characters[0]?.provisional?.inventory).toEqual([
      { itemId: "sunbloom_draught", kind: "consumable" },
    ]);
  });

  it("does not create provisional state when no campaign is present", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const character = makeCharacter(householdId, players[0]!.principal.playerId, harness);
    await harness.repo.putCharacter(character);
    const state = completionState([character], harness, { campaignId: null });

    const [awarded] = await awardChapterXp({
      state,
      chapter: makeChapter(),
      householdId,
      repo: harness.repo,
      rules: harness.deps.content.rules(),
      items: harness.deps.content.items(),
    });

    expect(awarded?.committed.xp).toBe(makeChapter().xpAward);
    expect(awarded?.provisional).toBeNull();
  });
});


describe("campaign state-transition transactions", () => {
  it("starts and re-resolves campaign characters in the START_CHAPTER transaction", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("room setup failed");

    const character = makeCharacter(householdId, players[0]!.principal.playerId, harness);
    await harness.repo.putCharacter(character);
    const state = completionState([character], harness, {
      runId: created.value.runId,
      roomCode: created.value.code,
      campaignId: "campaign-1",
      chapterId: null,
      phase: "lobby",
      seq: 0,
    });
    await harness.repo.putState(state);
    harness.deps.engine = stubEngine((current) => {
      const next = structuredClone(current);
      return {
        state: {
          ...next,
          phase: "scene",
          chapterId: "bramblewood-01",
          flags: { ...next.flags, started: true },
        },
      };
    });

    const originalCommit = harness.repo.commit.bind(harness.repo);
    let transaction: CommitInput | undefined;
    harness.repo.commit = async (input) => {
      transaction = input;
      return originalCommit(input);
    };

    const response = await applyAction(
      {
        runId: created.value.runId,
        playerId: players[0]!.principal.playerId,
        seq: 0,
        intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" },
      },
      harness.deps,
    );

    expect(response.ok).toBe(true);
    expect(transaction?.characters?.[0]?.provisional?.runId).toBe("campaign-1");
    expect(transaction?.state.party[0]?.character).toMatchObject({
      isProvisional: true,
      committedLevel: 1,
    });
    expect(transaction?.event.patch).toContainEqual({
      op: "replace",
      path: "/party/0/character/isProvisional",
      value: true,
    });
    expect(transaction?.event.progression).toMatchObject({
      characters: [{ id: character.id, isProvisional: true, committedLevel: 1 }],
    });
    expect(transaction?.event.progression?.awards).toBeUndefined();
  });

  it("passes every awarded character to the same commit as run state and event", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("room setup failed");

    const character = makeCharacter(householdId, players[0]!.principal.playerId, harness);
    await harness.repo.putCharacter(character);
    const state = completionState([character], harness, {
      runId: created.value.runId,
      roomCode: created.value.code,
      campaignId: "campaign-1",
      phase: "scene",
      seq: 0,
    });
    await harness.repo.putState(state);
    harness.deps.engine = stubEngine((current) => ({
      state: {
        ...current,
        phase: "chapter_complete",
        chapterOutcome: "success",
        bonuses: [],
        xpEarned: makeChapter().xpAward,
      },
    }));

    const originalCommit = harness.repo.commit.bind(harness.repo);
    let transaction: CommitInput | undefined;
    harness.repo.commit = async (input) => {
      transaction = input;
      return originalCommit(input);
    };

    const response = await applyAction(
      {
        runId: created.value.runId,
        playerId: players[0]!.principal.playerId,
        seq: 0,
        intent: { type: "CHOOSE", choiceId: "finish" },
      },
      harness.deps,
    );

    expect(response.ok).toBe(true);
    expect(transaction?.state.phase).toBe("chapter_complete");
    expect(transaction?.event.runId).toBe(created.value.runId);
    expect(transaction?.event.progression).toMatchObject({
      characters: [
        {
          id: character.id,
          xp: makeChapter().xpAward,
          level: 2,
          isProvisional: true,
          committedLevel: 1,
        },
      ],
      awards: [{ characterId: character.id, leveledTo: 2 }],
    });
    expect(transaction?.characters).toHaveLength(1);
    expect(transaction?.characters?.[0]?.provisional?.xp).toBe(makeChapter().xpAward);
    const [broadcast] = harness.channel.replay(created.value.code, 0) ?? [];
    expect(broadcast?.kind).toBe("patch");
    if (broadcast?.kind === "patch") {
      expect(broadcast.progression).toEqual(transaction?.event.progression);
    }
    expect(
      (await harness.repo.getCharacter(householdId, character.id))?.provisional?.xp,
    ).toBe(makeChapter().xpAward);
  });

  it("settles an authored grantXp branch consistently across every durable and UI surface", async () => {
    const chapter = {
      ...makeChapter(),
      entry: "scene_start",
      scenes: {
        scene_start: {
          type: "story" as const,
          narration: "A hidden cache waits beside the road.",
          choices: [
            {
              id: "finish",
              label: "Carry it home",
              icon: "arrow",
              goto: "scene_ending",
              effects: [{ type: "grantXp" as const, amount: 50 }],
            },
          ],
        },
        scene_ending: {
          type: "story" as const,
          narration: "Home, with one more story to tell.",
          choices: [],
        },
      },
    } as Chapter;
    const harness = makeHarness({ content: makeContent({ chapters: [chapter] }) });
    const runtime = await loadSharedRuntime();
    harness.deps.engine = runtime.engine;
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("room setup failed");

    const playerId = players[0]!.principal.playerId;
    const character = makeCharacter(householdId, playerId, harness);
    await harness.repo.putCharacter(character);
    const lobby = await harness.repo.getState(created.value.runId);
    if (!lobby) throw new Error("missing run state");
    lobby.party = [
      {
        character: resolveCharacter(
          character,
          harness.deps.content.rules(),
          harness.deps.content.items(),
        ),
        playerId,
        hp: 10,
        down: false,
        connected: true,
        ready: true,
      },
    ];
    await harness.repo.putState(lobby);

    expect(
      await applyAction(
        {
          runId: created.value.runId,
          playerId,
          seq: 0,
          intent: { type: "START_CHAPTER", chapterId: chapter.id },
        },
        harness.deps,
      ),
    ).toEqual({ ok: true, seq: 1 });
    expect(
      await applyAction(
        {
          runId: created.value.runId,
          playerId,
          seq: 1,
          intent: { type: "CHOOSE", choiceId: "finish" },
        },
        harness.deps,
      ),
    ).toEqual({ ok: true, seq: 2 });

    const settled = await harness.repo.getState(created.value.runId);
    const stored = await harness.repo.getCharacter(householdId, character.id);
    const records = await harness.repo.listChapterProgress(created.value.runId);
    const events = await harness.repo.listEvents(created.value.runId, 1);
    const completion = events.find((event) => event.seq === 2);

    expect(settled?.xpEarned).toBe(350);
    expect(settled?.party[0]?.character.xp).toBe(350);
    expect(stored?.provisional?.xp ?? stored?.committed.xp).toBe(350);
    expect(records).toContainEqual(expect.objectContaining({ xpEarned: 350 }));
    expect(completion?.presentation).toMatchObject({ kind: "CHAPTER_COMPLETE", xp: 350 });
    expect(completion?.progression?.characters[0]?.xp).toBe(350);
  });
});
