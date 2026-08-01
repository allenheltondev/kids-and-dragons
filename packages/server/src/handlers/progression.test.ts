import { describe, expect, it } from "vitest";
import {
  newCharacter,
  resolveCharacter,
  type Campaign,
  type Character,
  type RunState,
} from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { foldChapterXp, newCharacterWrite, settleChapterCompletion } from "./progression.ts";

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

  it("keeps provisional gains across rooms in the same campaign", async () => {
    /*
     * The bug this pins, found in review: provisional was scoped to `runId`,
     * and a run is a *room* — one evening. `startCampaign()` re-seeds from
     * `committed` whenever the identity changes, so Saturday's fresh room
     * silently threw away Tuesday's provisional levels, and with
     * `commitCampaign()` not yet wired, `committed` never advances — every
     * character was permanently level 1 plus one sitting's XP. The scope is the
     * campaign: a new room continuing the same campaign accrues on top.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    // Tuesday: room r_1, chapter one of the campaign.
    (state as { campaignId?: string | null }).campaignId = "the-hollow-crown";
    state.xpEarned = 300;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

    // Saturday: a brand-new room, same campaign, next chapter.
    state.runId = "r_2";
    state.xpEarned = 400;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.provisional?.xp).toBe(700);
    expect(stored?.committed.xp).toBe(0);

    // A one-off chapter has no campaign; there the run really is the scope,
    // and a different run correctly starts over from committed.
    (state as { campaignId?: string | null }).campaignId = null;
    state.runId = "r_3";
    state.xpEarned = 100;
    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }
    const oneOff = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(oneOff?.provisional?.xp).toBe(100);
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

  it("still folds the bag when the chapter awarded nothing", async () => {
    /*
     * This used to early-return on zero XP, and that return was the bug: a
     * chapter can pay nothing and still have handed somebody a potion, and
     * skipping the fold dropped it on the floor. Every completion folds now —
     * the award just happens to be zero.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state, character } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    state.party[0]!.character.inventory = [{ itemId: "sunbloom_draught", kind: "consumable" }];

    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.provisional?.xp).toBe(0);
    expect(stored?.provisional?.inventory).toEqual([
      { itemId: "sunbloom_draught", kind: "consumable" },
    ]);
  });

  it("carries the run's inventory and quest items into stored progress", async () => {
    /*
     * The seam this chapter closes: the engine's grants and swaps land on the
     * run's *resolved* characters, and until this fold existed nothing copied
     * them back — so the next `resolveCharacter()` rebuilt the bag from stored
     * progress and the potion she picked up two sessions ago was quietly gone.
     * The roadmap's "still in her bag" sentence is this assertion.
     */
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const playerId = players[0]!.principal.playerId;
    const { state, character, rules, items } = setup(harness, householdId, playerId);
    await harness.repo.putCharacter(character);

    state.xpEarned = 100;
    state.party[0]!.character.inventory = [
      { itemId: "sunbloom_draught", kind: "consumable" },
      { itemId: "oak_token", kind: "trinket" },
    ];
    state.party[0]!.character.questItems = ["rusted_key"];
    const maxHpBefore = state.party[0]!.character.maxHp;

    for (const c of await foldChapterXp(state, harness.deps, householdId)) {
      await harness.repo.putCharacter(c);
    }

    const stored = await harness.repo.getCharacter(householdId, `c_${playerId}`);
    expect(stored?.provisional?.inventory?.map((e) => e.itemId)).toEqual([
      "sunbloom_draught",
      "oak_token",
    ]);
    expect(stored?.questItems).toEqual(["rusted_key"]);
    // Provisional, not committed: a failed campaign takes the bag back with
    // the levels (spec §8.3) — the pair reverts together or not at all.
    expect(stored?.committed.inventory).toEqual([]);

    // And the re-resolved snapshot the phones mirror carries the trinket's
    // passive: the oak token's +2 max HP is on the sheet from this patch on —
    // the fold swapped the party member's snapshot too, and both views agree.
    const resolved = resolveCharacter(stored!, rules, items);
    expect(resolved.maxHp).toBe(maxHpBefore + 2);
    expect(state.party[0]!.character.maxHp).toBe(maxHpBefore + 2);
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

describe("settleChapterCompletion — the campaign boundary", () => {
  /**
   * A harness whose content knows the fixture campaign. `chapters` controls
   * where the boundary is: with two entries, "bramblewood-01" (the fixture
   * chapter) is NOT the last chapter; with one, it is.
   */
  function campaignHarness(campaign: Partial<Campaign> = {}) {
    return makeHarness({
      content: makeContent({
        campaigns: [
          {
            id: "the-hollow-crown",
            title: "The Hollow Crown",
            blurb: "",
            chapters: ["bramblewood-01", "bramblewood-02"],
            ...campaign,
          },
        ],
      }),
    });
  }

  /** The setup() run, dressed as a mid-campaign chapter completion. */
  function completing(
    state: RunState,
    overrides: Partial<RunState> = {},
  ): RunState {
    Object.assign(state as object, {
      campaignId: "the-hollow-crown",
      chapterId: makeChapter().id,
      chapterOutcome: "success",
      ...overrides,
    });
    return state;
  }

  it("records the chapter and the attempt on an ordinary completion", async () => {
    const harness = campaignHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    completing(state);
    state.xpEarned = 300;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.chapterProgress).toMatchObject({
      runId: "r_1",
      chapterId: "bramblewood-01",
      status: "complete",
      outcome: "success",
      xpEarned: 300,
    });
    expect(settlement.campaignProgress).toMatchObject({ status: "active", setbacks: 0 });
    // Mid-campaign: the gains stay provisional. Committing early is the bug
    // the whole commitment rule exists to prevent.
    expect(settlement.characters[0]?.provisional?.xp).toBe(300);
    expect(settlement.characters[0]?.committed.xp).toBe(0);
  });

  it("counts a setback, and half-XP still folds provisionally", async () => {
    const harness = campaignHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    completing(state, { chapterOutcome: "setback" });
    state.xpEarned = 150;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.chapterProgress?.outcome).toBe("setback");
    expect(settlement.campaignProgress).toMatchObject({ status: "active", setbacks: 1 });
    expect(settlement.characters[0]?.provisional?.xp).toBe(150);
  });

  it("fails the campaign at the third setback: revert to committed, keep a souvenir", async () => {
    const harness = campaignHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    // Two setbacks already on the books, from earlier evenings.
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "the-hollow-crown",
      status: "active",
      setbacks: 2,
      updatedAt: new Date(T0).toISOString(),
    });
    completing(state, { chapterOutcome: "setback" });
    state.xpEarned = 150;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toMatchObject({ status: "failed", setbacks: 3 });
    const [failed] = settlement.characters;
    // The revert: provisional gone, committed exactly what it was, and the
    // attempt leaves a visible mark (spec §8.3).
    expect(failed?.provisional).toBeNull();
    expect(failed?.committed.xp).toBe(0);
    expect(failed?.souvenirs).toHaveLength(1);
    expect(failed?.souvenirs[0]?.id).toBe("the-hollow-crown");
    // The phones see the revert on this same patch, not next chapter.
    expect(state.party[0]?.character.xp).toBe(0);
    expect(state.party[0]?.character.level).toBe(1);
  });

  it("flavors the souvenir with the tier the attempt reached (spec §8.3)", async () => {
    const harness = campaignHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    // She was Sworn, provisionally — the fixture curve's tier 2 starts at
    // level 4, so seed a provisional that got there this campaign.
    const rules = harness.deps.content.rules();
    const level4Xp = rules.levelXp[3]!;
    await harness.repo.putCharacter(character);
    const seeded = await harness.repo.getCharacter(householdId, character.id);
    await harness.repo.putCharacter({
      ...seeded!,
      provisional: {
        ...seeded!.committed,
        xp: level4Xp,
        level: 4,
        tier: "sworn",
        runId: "the-hollow-crown",
      },
    });
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "the-hollow-crown",
      status: "active",
      setbacks: 2,
      updatedAt: new Date(T0).toISOString(),
    });
    completing(state, { chapterOutcome: "setback" });
    state.xpEarned = 10;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    const [failed] = settlement.characters;
    expect(failed?.souvenirs[0]?.id).toBe("the-hollow-crown#sworn");
    expect(failed?.committed.tier).toBe("fledgling");
  });

  it("commits the campaign at its final chapter: the gains become who you are", async () => {
    // One chapter long, so the fixture chapter IS the boundary.
    const harness = campaignHarness({ chapters: ["bramblewood-01"] });
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    completing(state);
    state.xpEarned = 300;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toMatchObject({ status: "complete", setbacks: 0 });
    const [committed] = settlement.characters;
    expect(committed?.provisional).toBeNull();
    expect(committed?.committed.xp).toBe(300);
    expect(committed?.committed.level).toBe(2);
    // Quest items are campaign-scoped either way (§9.2).
    expect(committed?.questItems).toEqual([]);
  });

  it("a zero-XP final chapter still commits the campaign", async () => {
    // The boundary cannot be "whoever happened to earn something": a final
    // chapter that awards nothing still ends the campaign, and the provisional
    // gains from every chapter before it still have to become permanent.
    const harness = campaignHarness({ chapters: ["bramblewood-01"] });
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    const seeded = await harness.repo.getCharacter(householdId, character.id);
    await harness.repo.putCharacter({
      ...seeded!,
      provisional: { ...seeded!.committed, xp: 300, level: 2, runId: "the-hollow-crown" },
    });
    completing(state);
    state.xpEarned = 0;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress?.status).toBe("complete");
    expect(settlement.characters[0]?.committed.xp).toBe(300);
    expect(settlement.characters[0]?.provisional).toBeNull();
  });

  it("a finished attempt does not haunt the next one", async () => {
    // The failed attempt's setbacks belong to the failed attempt. Counting
    // them again would make a replayed campaign insta-fail on its first
    // stumble, which is not a story anybody authored.
    const harness = campaignHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "the-hollow-crown",
      status: "failed",
      setbacks: 3,
      updatedAt: new Date(T0).toISOString(),
    });
    completing(state, { chapterOutcome: "setback" });
    state.xpEarned = 150;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toMatchObject({ status: "active", setbacks: 1 });
    expect(settlement.characters[0]?.provisional?.xp).toBe(150);
  });

  it("an unknown campaign settles XP and the chapter record only", async () => {
    // Committing on a guess would make gains permanent that a failed campaign
    // was supposed to take back — the safe failure keeps them provisional.
    const harness = makeHarness(); // content with no campaigns at all
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    completing(state);
    state.xpEarned = 300;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toBeUndefined();
    expect(settlement.chapterProgress?.outcome).toBe("success");
    expect(settlement.characters[0]?.provisional?.xp).toBe(300);
    expect(settlement.characters[0]?.committed.xp).toBe(0);
  });

  it("respects a campaign's own setback limit", async () => {
    const harness = campaignHarness({ setbackLimit: 1 });
    const { householdId, players } = await seedHousehold(harness, 1);
    const { state, character } = setup(harness, householdId, players[0]!.principal.playerId);
    await harness.repo.putCharacter(character);
    completing(state, { chapterOutcome: "setback" });
    state.xpEarned = 150;

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toMatchObject({ status: "failed", setbacks: 1 });
    expect(settlement.characters[0]?.provisional).toBeNull();
  });
});
