/**
 * The Exchange's fitting stall (#312, docs/class-mastery.md §1), through the
 * handlers and the real engine. It is #311's class place with a different
 * gate: only a new hero answers, may put on any class but the one worn, and
 * only once. The swap rides the campaign's provisional half, so a finished
 * campaign keeps it spent and a failed one hands back the class and the swap.
 *
 * The first part plays a fixture campaign whose opening scene is the stall.
 * The second plays Gemfall's real opening, where `rules.json` stands it, and
 * shows a table that declines plays the chapter exactly as it did without it.
 */

import path from "node:path";
import {
  applyIntent,
  classPlaceWaitingOn,
  createRunState,
  effectiveProgress,
  isNewHero,
  keepClassIntent,
  makeRng,
  newCharacter,
  type Campaign,
  type Chapter,
  type ClientIntent,
  type RulesContent,
  type RunState,
} from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent, type ContentStore } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeContent, makeHarness, makeRules, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN = "stall-fixture";
const DAY = 24 * 60 * 60 * 1000;

const chapter: Chapter = {
  id: "stall-01",
  campaignId: CAMPAIGN,
  index: 1,
  title: "The Market",
  biome: "the_exchange",
  estimatedMinutes: 5,
  xpAward: 300,
  entry: "dock",
  scenes: {
    dock: {
      type: "story",
      narration: "A dock. A seagull is guarding one sardine.",
      choices: [{ id: "in", label: "Into the market", icon: "map", goto: "gate" }],
    },
    gate: {
      type: "story",
      narration: "The market gate.",
      choices: [{ id: "on", label: "Go on", icon: "map", goto: "market" }],
    },
    market: {
      type: "rest",
      narration: "A bench.",
      choices: [
        { id: "win", label: "Home", icon: "home", goto: "win_end" },
        { id: "lose", label: "Get lost", icon: "fog", goto: "lose_end" },
      ],
    },
    win_end: { type: "story", narration: "Home.", choices: [] },
    lose_end: { type: "story", narration: "Lost.", outcome: "setback", choices: [] },
  },
} as Chapter;

const campaign: Campaign = {
  id: CAMPAIGN,
  title: "The Market",
  blurb: "",
  chapters: [chapter.id],
  // One setback fails it, so the lose ending is a failed campaign.
  setbackLimit: 1,
};

const rules: RulesContent = {
  ...makeRules(),
  fittingStall: {
    stands: [{ chapterId: "stall-01", sceneId: "gate" }],
    keeper: "Madame Tuck",
    narration: "A frogfolk named Madame Tuck.",
  },
};

type Seat = { name: string; class: "songkeeper" | "thornguard" | "starweaver"; xp?: number };

/**
 * A household at the fixture campaign. `evening()` opens a room, sits every
 * seat (making the heroes on the first evening), and continues the campaign.
 */
async function household(seats: Seat[], content: ContentStore = makeContent({ rules, chapters: [chapter], campaigns: [campaign] })) {
  const harness = makeHarness({ engine: realEngine, content });
  const { householdId, players } = await seedHousehold(harness, seats.length);
  const evening = () => openEvening(harness, householdId, players, seats);
  return { harness, householdId, evening };
}

async function openEvening(
  harness: TestHarness,
  householdId: string,
  players: Awaited<ReturnType<typeof seedHousehold>>["players"],
  seats: Seat[],
  campaignId = CAMPAIGN,
) {
  harness.clock.advance(DAY);
  const created = await createRoom({ householdId, mode: "party", campaignId }, harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  for (const player of players) {
    const joined = await joinRoom({ code, principal: player.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
  }
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (playerId: string, intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, harness.deps);
  const must = async (playerId: string, intent: ClientIntent) => {
    const response = await send(playerId, intent);
    if (!response.ok) throw new Error(`${playerId} ${intent.type}: ${JSON.stringify(response.error)}`);
    return response;
  };
  const stored = async (playerId: string) => {
    const member = (await state()).party.find((m) => m.playerId === playerId)!;
    return (await harness.repo.getCharacter(householdId, member.character.id))!;
  };
  const choose = async (choiceId: string) => {
    const prompt = (await state()).prompt;
    if (prompt?.kind !== "choice") throw new Error(`no choice prompt: ${JSON.stringify(prompt)}`);
    const voters = prompt.vote ? (await state()).party.map((m) => m.playerId) : [prompt.forPlayerIds[0] ?? "p_1"];
    let last;
    for (const playerId of voters) last = await send(playerId, { type: "CHOOSE", choiceId });
    return last!;
  };

  const saved = await harness.repo.listCharacters(householdId);
  for (const [i, seat] of seats.entries()) {
    const playerId = `p_${i + 1}`;
    const mine = saved.find((c) => c.ownerPlayerId === playerId);
    if (mine) {
      await must(playerId, { type: "SEAT_CHARACTER", characterId: mine.id });
      continue;
    }
    await must(playerId, {
      type: "CREATE_CHARACTER",
      name: seat.name,
      species: "unicorn",
      class: seat.class,
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
    });
    // A hero who has finished a chapter before tonight: XP on her row
    // before the campaign seeds its provisional half from it.
    if (seat.xp) {
      const row = await stored(playerId);
      row.committed.xp = seat.xp;
      await harness.repo.putCharacter(row);
    }
  }
  for (const [i] of seats.entries()) await must(`p_${i + 1}`, { type: "READY", ready: true });
  await must("p_1", { type: "CONTINUE_CAMPAIGN", campaignId });
  return { state, send, must, stored, choose };
}

describe("the fitting stall (#312)", () => {
  it("offers a new hero one swap, to any class, and the way on waits for her", async () => {
    const t = await (await household([{ name: "Pip", class: "songkeeper" }])).evening();

    // Not at the dock: the stall stands at the gate.
    expect((await t.state()).classPlace).toBeUndefined();
    const early = await t.send("p_1", { type: "SWITCH_CLASS", classId: "duskrunner", stall: true });
    expect(early.error).toEqual({ code: "ILLEGAL", message: "there is no class place here" });

    await t.choose("in");
    expect((await t.state()).classPlace).toEqual({ stall: true, answers: {} });
    expect((await t.choose("on")).error?.message).toBe("still waiting for Pip to decide about their class");

    // A room's tap is refused at the stall, and the class she wears is no swap.
    const asRoom = await t.send("p_1", { type: "SWITCH_CLASS", classId: "duskrunner" });
    expect(asRoom.error?.message).toBe("this is the fitting stall, not a class place");
    const same = await t.send("p_1", { type: "SWITCH_CLASS", classId: "songkeeper", stall: true });
    expect(same.error?.message).toBe("Pip is already a songkeeper");

    // Any class: Duskrunner, which has no room in this campaign.
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "duskrunner", stall: true });
    const pip = (await t.state()).party[0]!.character;
    expect(pip.class).toBe("duskrunner");
    expect(pip.fitted).toBe(true);
    expect((await t.state()).classPlace?.answers).toEqual({ p_1: { switched: true, from: "songkeeper" } });
    const row = await t.stored("p_1");
    expect(row.provisional).toMatchObject({ class: "duskrunner", fitted: true });
    expect(row.committed.class).toBe("songkeeper");
    expect(row.committed).not.toHaveProperty("fitted");

    // Once.
    const twice = await t.send("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    expect(twice.error?.message).toBe("Pip has had a fitting already, or is not new");

    expect((await t.choose("on")).ok).toBe(true);
    expect((await t.state()).classPlace).toBeUndefined();
  });

  it("is never offered to a hero who is not new", async () => {
    const t = await (await household([{ name: "Bram", class: "thornguard", xp: 300 }])).evening();
    await t.choose("in");
    // A table with nobody new walks through the gate as if there were no stall.
    expect((await t.state()).classPlace).toBeUndefined();
    const tap = await t.send("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    expect(tap.error?.message).toBe("there is no class place here");
    expect((await t.choose("on")).ok).toBe(true);
  });

  it("at a mixed table, waits on the new heroes only, and a kid may change their mind", async () => {
    const t = await (
      await household([
        { name: "Pip", class: "songkeeper" },
        { name: "Moss", class: "songkeeper" },
        { name: "Bram", class: "thornguard", xp: 300 },
      ])
    ).evening();
    await t.choose("in");

    // Bram is not new: nothing to decide, and no swap.
    expect((await t.send("p_3", { type: "SWITCH_CLASS", classId: "starweaver", stall: true })).error?.message).toBe(
      "Bram has had a fitting already, or is not new",
    );
    expect((await t.send("p_3", { type: "KEEP_CLASS", classId: "thornguard", stall: true })).error?.message).toBe(
      "Bram has had a fitting already, or is not new",
    );
    expect(classPlaceWaitingOn(await t.state()).map((m) => m.character.name)).toEqual(["Pip", "Moss"]);

    await t.must("p_1", { type: "KEEP_CLASS", classId: "songkeeper", stall: true });
    expect((await t.choose("on")).error?.message).toBe("still waiting for Moss to decide about their class");
    // Both may put on the same class.
    await t.must("p_2", { type: "SWITCH_CLASS", classId: "thornguard", stall: true });
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard", stall: true });

    const here = await t.state();
    expect(here.party.map((m) => m.character.class)).toEqual(["thornguard", "thornguard", "thornguard"]);
    expect(here.classPlace?.answers).toEqual({
      p_1: { switched: true, from: "songkeeper" },
      p_2: { switched: true, from: "songkeeper" },
    });
    expect((await t.choose("on")).ok).toBe(true);
  });

  it("a finished campaign keeps the class and the spent swap, and she is not new any more", async () => {
    const t = await (await household([{ name: "Pip", class: "songkeeper" }])).evening();
    await t.choose("in");
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    await t.choose("on");
    await t.choose("win");
    const row = await t.stored("p_1");
    expect(row.provisional).toBeNull();
    expect(row.committed).toMatchObject({ class: "starweaver", fitted: true });
    expect(isNewHero(effectiveProgress(row))).toBe(false);
  });

  it("a failed campaign gives back the class and the swap, so the stall offers it again", async () => {
    const h = await household([{ name: "Pip", class: "songkeeper" }]);
    const first = await h.evening();
    await first.choose("in");
    await first.must("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    await first.choose("on");
    await first.choose("lose");
    expect((await first.state()).campaign?.ended).toBe("failed");
    const row = await first.stored("p_1");
    expect(row.provisional).toBeNull();
    expect(row.committed.class).toBe("songkeeper");
    expect(row.committed).not.toHaveProperty("fitted");

    // The next evening starts the campaign again, at the stall, and she is new.
    const second = await h.evening();
    await second.choose("in");
    expect((await second.state()).classPlace).toEqual({ stall: true, answers: {} });
    await second.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard", stall: true });
    expect((await second.state()).party[0]!.character.class).toBe("thornguard");
  });

  it("refuses a stall the rules do not stand in this scene, whatever the run says", async () => {
    const h = await household([{ name: "Pip", class: "songkeeper" }]);
    const t = await h.evening();
    // A forged or stale run: the stall's state on the dock, where none stands.
    const run = await t.state();
    expect(run.sceneId).toBe("dock");
    await h.harness.repo.putState({ ...run, classPlace: { stall: true, answers: {} } });
    const tap = await t.send("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    expect(tap.error?.message).toBe("there is no fitting stall here");
    expect((await t.stored("p_1")).provisional?.class).toBe("songkeeper");
  });
});

// ---------------------------------------------------------------------------
// Gemfall, which opens at the Exchange
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const shipped = await loadContent(path.join(ROOT, "content"));
/** The shipped content with the stall taken out of the rules: Gemfall as it played before #312. */
const { fittingStall: _stall, ...rulesWithoutStall } = shipped.rules();
const withoutStall: ContentStore = Object.assign(Object.create(Object.getPrototypeOf(shipped)) as ContentStore, shipped, {
  rules: () => rulesWithoutStall as RulesContent,
});

/**
 * Plays gemfall-01 from its entry to its ending: the first choice offered,
 * every roll rolled, every new hero keeping their class at the stall. Dice
 * are drawn in order from one stream rather than keyed to the seq, because a
 * decline is a tap and every tap moves the seq; with them keyed to the seq a
 * stall-free run and a declining one would roll different dice.
 */
async function playOpening(content: ContentStore, seats: Seat[]) {
  const harness = makeHarness({ engine: realEngine, content });
  const dice = makeRng("fitting-stall:opening");
  harness.deps.rng = () => dice;
  const { householdId, players } = await seedHousehold(harness, seats.length);
  // Saved heroes with fixed ids and colors: a hero made at the table takes
  // both from the run id, which is random.
  for (const [i, seat] of seats.entries()) {
    const hero = newCharacter({
      id: `c_${i + 1}`,
      householdId,
      ownerPlayerId: `p_${i + 1}`,
      name: seat.name,
      species: "unicorn",
      class: seat.class,
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
      rules: content.rules(),
      now: new Date(harness.clock.now()).toISOString(),
    });
    if (seat.xp) hero.committed.xp = seat.xp;
    await harness.repo.putCharacter(hero);
  }
  const t = await openEvening(harness, householdId, players, seats, "gemfall");
  let declined = 0;
  for (let step = 0; step < 400; step++) {
    const s = await t.state();
    if (s.phase === "chapter_complete") break;
    const deciding = classPlaceWaitingOn(s);
    if (deciding.length > 0 && s.classPlace) {
      for (const member of deciding) await t.must(member.playerId, keepClassIntent(s.classPlace, member));
      declined += deciding.length;
      continue;
    }
    const prompt = s.prompt;
    if (prompt?.kind === "roll") {
      await t.must(s.party.find((m) => m.character.id === prompt.characterId)!.playerId, { type: "ROLL" });
    } else if (prompt?.kind === "item_swap") {
      await t.must(s.party.find((m) => m.character.id === prompt.characterId)!.playerId, { type: "RESOLVE_ITEM_SWAP", dropItemId: null });
    } else if (prompt?.kind === "choice") {
      await t.choose(prompt.options[0]!.id);
    } else {
      throw new Error(`stuck at ${s.sceneId}: ${JSON.stringify(prompt)}`);
    }
  }
  const end = await t.state();
  // The run's id and room code are random; everything else must match.
  const same = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value).replaceAll(end.runId, "<run>").replaceAll(end.roomCode, "<room>")) as T;
  const { seq: _seq, updatedAt: _at, ...game } = end;
  const shown = (await harness.repo.listEvents(end.runId, 0)).map((e) => e.presentation).filter((p) => p !== undefined);
  const rows = (await harness.repo.listCharacters(householdId)).map(({ version: _v, ...row }) => row);
  const { version: _av, updatedAt: _au, ...attempt } = (await harness.repo.getCampaignProgress(householdId, "gemfall"))!;
  return { game: same(game), shown: same(shown), rows: same(rows), attempt: same(attempt), declined, seq: end.seq };
}

describe("the stall in Gemfall (#312)", () => {
  it("stands where the Exchange is introduced, and opens for a new hero", async () => {
    const harness = makeHarness({ engine: realEngine, content: shipped });
    const { householdId, players } = await seedHousehold(harness, 1);
    const t = await openEvening(harness, householdId, players, [{ name: "Pip", class: "songkeeper" }], "gemfall");
    expect((await t.state()).sceneId).toBe("scene_prologue_realm");
    expect((await t.state()).classPlace).toBeUndefined();
    await t.choose("prologue_to_city");
    expect((await t.state()).sceneId).toBe("scene_prologue_city");
    expect((await t.state()).classPlace).toEqual({ stall: true, answers: {} });
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "starweaver", stall: true });
    await t.choose("prologue_to_party");
    expect((await t.state()).classPlace).toBeUndefined();
    expect((await t.state()).party[0]!.character.class).toBe("starweaver");
  });

  it("a table that declines plays the chapter exactly as Gemfall played without the stall", { timeout: 30_000 }, async () => {
    for (const seats of [
      [{ name: "Pip", class: "songkeeper" }],
      [
        { name: "Pip", class: "songkeeper" },
        { name: "Moss", class: "thornguard" },
        { name: "Bram", class: "starweaver", xp: 300 },
      ],
    ] as Seat[][]) {
      const before = await playOpening(withoutStall, seats);
      const after = await playOpening(shipped, seats);
      const newHeroes = seats.filter((s) => !s.xp).length;
      expect(before.declined).toBe(0);
      expect(after.declined).toBe(newHeroes);
      // One tap per new hero is the whole difference.
      expect(after.seq).toBe(before.seq + newHeroes);
      expect(after.game).toEqual(before.game);
      expect(after.shown).toEqual(before.shown);
      expect(after.rows).toEqual(before.rows);
      expect(after.attempt).toEqual(before.attempt);
      expect(after.game.phase).toBe("chapter_complete");
    }
  });
});
