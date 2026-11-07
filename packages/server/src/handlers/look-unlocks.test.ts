/**
 * Earned looks during play (docs/hero-looks.md §6, §12; #669): each source
 * writes its receipt to the hero's look once, and it survives a lost fight, a
 * setback ending that fails the campaign, and a replayed chapter. An unlock
 * earned in a campaign already under way is told once, on the live broadcast,
 * and changes nothing in play.
 *
 * Through the handlers and the real engine, as camp-milestones.test.ts is.
 */

import {
  applyIntent,
  createRunState,
  lookView,
  readEarnedLook,
  type Campaign,
  type Chapter,
  type ChannelMessage,
  type ClientIntent,
  type LookCatalog,
  type LookUnlockNews,
  type RunState,
  type ServerMessage,
} from "@kad/shared";
import { describe, expect, it } from "vitest";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import type { Engine } from "../engine/port.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { claimLookUnlocks, heroLookOf } from "./look-unlocks.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN = "looks-fixture";

const LOOKS: LookCatalog = {
  coats: [
    { id: "unicorn_sky", name: "Sky", unlock: { from: "starter" }, species: ["unicorn"], part: "main", color: "#3EC3FD" },
    { id: "unicorn_mint", name: "Mint", unlock: { from: "found" }, species: ["unicorn"], part: "accent", color: "#0FD18B" },
    { id: "bigfoot_mint", name: "Mint", unlock: { from: "found" }, species: ["bigfoot"], part: "accent", color: "#0FD18B" },
  ],
  specials: [{ id: "aurora", name: "Aurora", unlock: { from: "found" }, effect: { kind: "sparkle" } }],
  nameplates: [{ id: "plain", name: "Plain", unlock: { from: "starter" } }],
  titles: [
    { id: "the_bold", text: "the Bold", unlock: { from: "starter" } },
    { id: "the_tracker", text: "the Tracker", unlock: { from: "found" } },
    { id: "the_sworn", text: "the Sworn", unlock: { from: "milestone", tier: "sworn" } },
    { id: "of_the_fixture", text: "of the Fixture", unlock: { from: "milestone", campaign: CAMPAIGN } },
    { id: "the_friendly", text: "the Friendly", unlock: { from: "milestone", camp: "firstFriend" } },
  ],
};

const bear = { id: "bear", name: "Bear", count: 1, hp: 99, guard: 30, quick: 9, steps: 5, attack: 40 };

/** 2400 XP: a new hero finishes it Sworn (the fixture's `tierLevels`). */
const chapter = {
  id: "looks-01",
  campaignId: CAMPAIGN,
  index: 1,
  title: "The Tracks",
  biome: "enchanted_woods",
  estimatedMinutes: 5,
  xpAward: 2400,
  entry: "square",
  scenes: {
    square: {
      type: "story",
      narration: "Tracks in the snow.",
      choices: [
        { id: "track", label: "Follow them", icon: "boot", goto: "found" },
        { id: "walk", label: "Walk on", icon: "door", goto: "yard" },
      ],
    },
    found: {
      type: "story",
      narration: "A gull says: good tracking. Green sparkles settle on you.",
      onEnter: [{ type: "findLook", looks: ["the_tracker", "unicorn_mint", "bigfoot_mint", "aurora"], rewardId: "looks-01.tracks" }],
      choices: [{ id: "on", label: "On to the yard", icon: "door", goto: "yard" }],
    },
    yard: {
      type: "encounter",
      map: "thicket",
      narration: "A bear in the yard.",
      enemies: [bear],
      onVictory: { goto: "camp" },
      onDefeat: { goto: "camp" },
    },
    camp: {
      type: "rest",
      narration: "A fire.",
      choices: [
        { id: "win", label: "Home", icon: "home", goto: "win_end" },
        { id: "lose", label: "Get lost", icon: "fog", goto: "lose_end" },
      ],
    },
    win_end: { type: "story", narration: "Home.", choices: [] },
    lose_end: { type: "story", narration: "Lost.", outcome: "setback", choices: [] },
  },
} as unknown as Chapter;

const campaign: Campaign = { id: CAMPAIGN, title: "The Fixture", blurb: "", chapters: [chapter.id], setbackLimit: 1 };

/** Pip, a new unicorn, at the start of the chapter, with every live message kept. */
async function table(options: { looks?: LookCatalog | null } = {}) {
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: [chapter], campaigns: [campaign], looksCatalog: options.looks === undefined ? LOOKS : options.looks }),
  });
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party", campaignId: CAMPAIGN }, harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const received: (ChannelMessage & ServerMessage)[] = [];
  harness.channel.subscribe(code, (m) => received.push(m as ChannelMessage & ServerMessage));
  const joined = await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  /** Sends one intent and returns the `lookUnlocks` its broadcast carried. */
  const must = async (intent: ClientIntent): Promise<LookUnlockNews[]> => {
    const before = received.length;
    const response = await applyAction({ runId, playerId: "p_1", seq: (await state()).seq, intent }, harness.deps);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return received.slice(before).flatMap((m) => m.lookUnlocks ?? []);
  };
  const pipId = async () => (await state()).party[0]!.character.id;
  const row = async () => (await harness.repo.getCharacter(householdId, await pipId()))!;

  await must({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  });
  const begin = async () => {
    await must({ type: "READY", ready: true });
    await must({ type: "CONTINUE_CAMPAIGN", campaignId: CAMPAIGN });
    expect((await state()).sceneId).toBe("square");
  };
  await begin();

  /** Ends turns until the bear has won: a lost fight. */
  const loseFight = async () => {
    const news: LookUnlockNews[] = [];
    if ((await state()).prompt?.kind === "ready") news.push(...(await must({ type: "READY", ready: true })));
    for (let guard = 0; guard < 80; guard++) {
      const now = await state();
      if (!now.encounter) return news;
      news.push(...(await must({ type: "END_TURN" })));
    }
    throw new Error("the fight did not end");
  };

  return { harness, householdId, state, must, pipId, row, loseFight, begin, received };
}

describe("a look find (§6)", () => {
  it("writes her receipts once, for her species, says so once, and a revisit gives nothing", async () => {
    const t = await table();
    const id = await t.pipId();
    expect((await t.row()).look).toBeUndefined();

    const news = await t.must({ type: "CHOOSE", choiceId: "track" });
    expect(news).toEqual([
      { characterId: id, lookId: "the_tracker", kind: "title", cause: "found" },
      { characterId: id, lookId: "unicorn_mint", kind: "coat", cause: "found" },
      { characterId: id, lookId: "aurora", kind: "special", cause: "found" },
    ]);
    const look = (await t.row()).look!;
    expect(look.unlocked["the_tracker"]).toEqual({ from: "found", rewardId: "looks-01.tracks", at: expect.any(String), source: "Found in The Tracks" });
    expect(look.unlocked["unicorn_mint"]).toMatchObject({ from: "found", rewardId: "looks-01.tracks" });
    // A special is every species'; a colour never another species'.
    expect(look.unlocked["aurora"]).toMatchObject({ from: "found", rewardId: "looks-01.tracks" });
    expect(look.unlocked).not.toHaveProperty("bigfoot_mint");
    // Nothing chosen for her: a receipt is not a choice.
    expect([look.coat, look.accent, look.special, look.nameplate, look.title]).toEqual([null, null, null, null, null]);
    const revision = look.revision;

    // Back the same way: the engine records nothing new, and nothing is written or said.
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "square" });
    expect(await t.must({ type: "CHOOSE", choiceId: "track" })).toEqual([]);
    expect((await t.row()).look!.revision).toBe(revision);
  });
});

describe("receipts are kept, whatever happens to the run (§6, camp.md §12.2)", () => {
  it("through a lost fight and a setback ending that fails the campaign; the tier's title stays though the tier goes back", async () => {
    const t = await table();
    await t.must({ type: "CHOOSE", choiceId: "track" });
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.loseFight();
    expect((await t.state()).sceneId).toBe("camp");
    expect(Object.keys((await t.row()).look!.unlocked).sort()).toEqual(["aurora", "the_tracker", "unicorn_mint"]);

    // The setback that fails the campaign is also the completion that reaches Sworn.
    const news = await t.must({ type: "CHOOSE", choiceId: "lose" });
    expect((await t.state()).campaign?.ended).toBe("failed");
    expect(news.map((n) => [n.lookId, n.cause])).toEqual([["the_sworn", "tier"]]);
    const row = await t.row();
    expect(row.committed.tier).toBe("fledgling");
    expect(row.provisional).toBeNull();
    // A failed campaign is not finished: no campaign title.
    expect(Object.keys(row.look!.unlocked).sort()).toEqual(["aurora", "the_sworn", "the_tracker", "unicorn_mint"]);
    // And every read of her (what the book and the table show) keeps them all.
    expect(lookView(readEarnedLook(LOOKS, row)).unlocked).toEqual(["aurora", "the_sworn", "the_tracker", "unicorn_mint"]);
  });
});

describe("milestones (§6)", () => {
  it("a tier and a finished campaign write their receipts at the chapter's end, once; a replayed chapter writes and says nothing", async () => {
    const t = await table();
    const id = await t.pipId();
    await t.must({ type: "CHOOSE", choiceId: "walk" });
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    const news = await t.must({ type: "CHOOSE", choiceId: "win" });
    expect((await t.state()).campaign?.ended).toBe("complete");
    expect(news).toEqual(
      expect.arrayContaining([
        { characterId: id, lookId: "the_sworn", kind: "title", cause: "tier" },
        { characterId: id, lookId: "of_the_fixture", kind: "title", cause: "campaign" },
      ]),
    );
    expect(news).toHaveLength(2);
    let row = await t.row();
    expect(row.look!.unlocked["of_the_fixture"]).toEqual({ from: "milestone", at: expect.any(String), source: "Finished The Fixture" });
    expect(row.look!.unlocked["the_sworn"]).toMatchObject({ from: "milestone", source: "Reached Sworn" });
    const revision = row.look!.revision;

    // The chapter again, in a new attempt: the find is new, the milestones are not.
    await t.must({ type: "ADVANCE" });
    await t.begin();
    const again = await t.must({ type: "CHOOSE", choiceId: "track" });
    expect(again.map((n) => n.lookId).sort()).toEqual(["aurora", "the_tracker", "unicorn_mint"]);
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    expect(await t.must({ type: "CHOOSE", choiceId: "win" })).toEqual([]);
    row = await t.row();
    expect(row.look!.revision).toBe(revision + 1);
    // And a second replay of the find gives nothing.
    await t.must({ type: "ADVANCE" });
    await t.begin();
    expect(await t.must({ type: "CHOOSE", choiceId: "track" })).toEqual([]);
    expect((await t.row()).look!.revision).toBe(revision + 1);
  });
});

describe("an unlock in a campaign already under way (§12)", () => {
  it("is told once and changes nothing in play: the same intents play out the same with looks or without", async () => {
    const play = async (looks: LookCatalog | null) => {
      const t = await table({ looks });
      const told: LookUnlockNews[] = [];
      told.push(...(await t.must({ type: "CHOOSE", choiceId: "track" })));
      told.push(...(await t.must({ type: "CHOOSE", choiceId: "on" })));
      told.push(...(await t.loseFight()));
      told.push(...(await t.must({ type: "CHOOSE", choiceId: "win" })));
      const s = await t.state();
      return {
        told,
        play: {
          sceneId: s.sceneId,
          flags: s.flags,
          coins: s.coins,
          xpEarned: s.xpEarned,
          campaign: s.campaign?.ended,
          party: s.party.map((m) => ({ hp: m.hp, down: m.down, level: m.character.level, xp: m.character.xp, tier: m.character.tier, inventory: m.character.inventory })),
        },
      };
    };
    const withLooks = await play(LOOKS);
    const without = await play(null);
    expect(withLooks.play).toEqual(without.play);
    expect(without.told).toEqual([]);
    // Each look told once, however many steps followed.
    const ids = withLooks.told.map((n) => n.lookId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["aurora", "of_the_fixture", "the_sworn", "the_tracker", "unicorn_mint"]);
  });
});

describe("the camp (§6)", () => {
  it("a first friend writes her title for every seated hero once, from the camp the downtime moment shows", async () => {
    const harness = makeHarness({ content: makeContent({ looksCatalog: LOOKS }) });
    const { householdId } = await seedHousehold(harness, 1);
    const hero = { ...makeCharacter({ id: "c_ada" }), householdId };
    await harness.repo.putCharacter(hero);
    const member = { playerId: "p_1", character: { id: hero.id, tier: "fledgling", class: "songkeeper" }, hp: 10, down: false, connected: true, ready: false };
    const before = { party: [member] } as unknown as RunState;
    const after = { party: [member], camp: { revision: 1, frameStage: 1, grownBy: [], dashCash: 0, owned: [], placed: {}, friends: ["bun"], shopOpen: false } } as unknown as RunState;
    const step = { milestones: [], finishedCampaign: null, finds: [], friendJoined: false };
    const run = { id: "r_1", householdId };

    expect(await claimLookUnlocks(step, { run, before, state: after }, harness.deps)).toEqual([
      { characterId: hero.id, lookId: "the_friendly", kind: "title", cause: "camp" },
    ]);
    const stored = (await harness.repo.getCharacter(householdId, hero.id))!;
    expect(stored.look!.unlocked["the_friendly"]).toMatchObject({ from: "milestone", source: "Her crew's first friend" });
    // The same moment again: written already, nothing said.
    expect(await claimLookUnlocks(step, { run, before, state: after }, harness.deps)).toEqual([]);
    // A step that shows the same camp it began with reads nothing.
    expect(await claimLookUnlocks(step, { run, before: after, state: after }, harness.deps)).toEqual([]);
  });

  it("a hero who already holds a milestone reads with it before anything is written (backfill on read)", () => {
    const harness = makeHarness({ content: makeContent({ looksCatalog: LOOKS }) });
    const hero = makeCharacter({ id: "c_old" });
    expect(heroLookOf(hero, harness.deps)).toBeNull();
    hero.committed.tier = "radiant";
    const look = heroLookOf(hero, harness.deps)!;
    expect(lookView(look).unlocked).toEqual(["the_sworn"]);
    expect(look.unlocked["the_sworn"]).not.toHaveProperty("at");
    expect(hero.look).toBeUndefined();
  });
});
