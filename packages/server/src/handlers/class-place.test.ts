/**
 * Class places (#311, docs/class-mastery.md §3), through the handlers and the
 * real engine: a hero switches class in its room, each kid alone, the way on
 * waits for every kid's answer, and the switch rides the campaign's
 * provisional half, so finishing keeps it and failing puts it back.
 *
 * The fixture is the smallest campaign with two rooms in it: a Dojo
 * (Thornguard) and a Conservatory (Songkeeper), a rest, and a success and a
 * setback ending. Writing the real four rooms is #315.
 */

import { applyIntent, createRunState, type Campaign, type Chapter, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import type { Engine } from "../engine/port.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN = "class-place-fixture";

const chapter: Chapter = {
  id: "class-place-01",
  campaignId: CAMPAIGN,
  index: 1,
  title: "Two Rooms",
  biome: "enchanted_woods",
  estimatedMinutes: 5,
  xpAward: 300,
  entry: "square",
  scenes: {
    square: {
      type: "story",
      narration: "A square with two doors. One has a pillow nailed to it.",
      choices: [{ id: "to_dojo", label: "Go in", icon: "door", goto: "dojo" }],
    },
    dojo: {
      type: "story",
      narration: "The Dojo. The teacher has held the same door shut for forty years.",
      classPlace: "thornguard",
      choices: [
        { id: "on", label: "Next door", icon: "door", goto: "conservatory" },
        { id: "skip", label: "Rest", icon: "campfire", goto: "camp" },
      ],
    },
    conservatory: {
      type: "choice_point",
      narration: "The Conservatory. The plants lean toward whoever sings best.",
      classPlace: "songkeeper",
      choices: [
        { id: "stay", label: "Listen", icon: "music", goto: "camp" },
        { id: "leave", label: "Leave", icon: "door", goto: "camp" },
      ],
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
} as Chapter;

const campaign: Campaign = {
  id: CAMPAIGN,
  title: "Two Rooms",
  blurb: "",
  chapters: [chapter.id],
  // One setback fails it, so the lose ending is a failed campaign.
  setbackLimit: 1,
};

type Seat = { name: string; class: "songkeeper" | "thornguard" | "starweaver" };

/** A room for the fixture campaign, every seat joined, heroes made, ranks seeded, chapter started. */
async function table(seats: Seat[], ranks: Record<string, Partial<Record<string, "apprentice" | "expert">>> = {}) {
  const harness = makeHarness({
    engine: realEngine,
    content: makeContent({ chapters: [chapter], campaigns: [campaign] }),
  });
  const { householdId, players } = await seedHousehold(harness, seats.length);
  const created = await createRoom({ householdId, mode: "party", campaignId: CAMPAIGN }, harness.deps);
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
  /** Whoever may take the way on: the story turn holder, or everyone on a vote. */
  const choose = async (choiceId: string) => {
    const prompt = (await state()).prompt;
    if (prompt?.kind !== "choice") throw new Error(`no choice prompt: ${JSON.stringify(prompt)}`);
    const voters = prompt.vote ? (await state()).party.map((m) => m.playerId) : [prompt.forPlayerIds[0] ?? "p_1"];
    let last;
    for (const playerId of voters) last = await send(playerId, { type: "CHOOSE", choiceId });
    return last!;
  };

  for (const [i, seat] of seats.entries()) {
    await must(`p_${i + 1}`, {
      type: "CREATE_CHARACTER",
      name: seat.name,
      species: "unicorn",
      class: seat.class,
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
    });
  }
  // Ranks a hero earned before tonight, written to her row before the
  // campaign seeds its provisional half from it.
  for (const [playerId, byClass] of Object.entries(ranks)) {
    const row = await stored(playerId);
    for (const [cls, rank] of Object.entries(byClass)) {
      row.committed.mastery[cls as Seat["class"]] = { rank: rank!, deeds: { practice: 2 } };
    }
    await harness.repo.putCharacter(row);
  }
  for (const [i] of seats.entries()) await must(`p_${i + 1}`, { type: "READY", ready: true });
  await must("p_1", { type: "CONTINUE_CAMPAIGN", campaignId: CAMPAIGN });
  expect((await state()).sceneId).toBe("square");
  return { harness, householdId, state, send, must, stored, choose };
}

describe("switching class at a class place (#311)", () => {
  it("a hero switches in one room and back in the other, with both ranks intact", async () => {
    const t = await table([{ name: "Pip", class: "songkeeper" }], {
      p_1: { songkeeper: "apprentice", thornguard: "expert" },
    });
    const before = await t.stored("p_1");

    // Never offered outside the room: the square is not the Dojo.
    expect((await t.state()).classPlace).toBeUndefined();
    const outside = await t.send("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    expect(outside.error).toEqual({ code: "ILLEGAL", message: "there is no class place here" });

    await t.choose("to_dojo");
    expect((await t.state()).classPlace).toEqual({ class: "thornguard", answers: {} });

    // The Dojo teaches only Thornguard.
    const wrongRoom = await t.send("p_1", { type: "SWITCH_CLASS", classId: "starweaver" });
    expect(wrongRoom.error?.message).toBe("this is not the starweaver place");

    // The way on waits for her answer.
    const early = await t.choose("on");
    expect(early.error?.message).toBe("still waiting for Pip to decide about their class");

    await t.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    let pip = (await t.state()).party[0]!.character;
    expect(pip.class).toBe("thornguard");
    expect(pip.rank).toBe("expert");
    expect((await t.state()).classPlace?.answers).toEqual({ p_1: { switched: true, from: "songkeeper" } });
    // Written to the provisional half, with every rank kept and stats untouched.
    let row = await t.stored("p_1");
    expect(row.provisional?.class).toBe("thornguard");
    expect(row.committed.class).toBe("songkeeper");
    expect(row.provisional?.mastery).toEqual(before.committed.mastery);
    expect(row.provisional?.stats).toEqual(before.committed.stats);

    // Already a Thornguard: there is nothing more to switch to here.
    const again = await t.send("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    expect(again.error?.message).toBe("Pip is already a thornguard");

    await t.must("p_1", { type: "CHOOSE", choiceId: "on" });
    expect((await t.state()).classPlace).toEqual({ class: "songkeeper", answers: {} });
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "songkeeper" });
    pip = (await t.state()).party[0]!.character;
    expect(pip.class).toBe("songkeeper");
    expect(pip.rank).toBe("apprentice");
    row = await t.stored("p_1");
    expect(row.provisional?.mastery).toEqual(before.committed.mastery);

    // Leaving the room closes it.
    await t.choose("stay");
    expect((await t.state()).classPlace).toBeUndefined();
  });

  it("a finished campaign keeps the switch", async () => {
    const t = await table([{ name: "Pip", class: "songkeeper" }]);
    await t.choose("to_dojo");
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    await t.choose("skip");
    await t.choose("win");
    const row = await t.stored("p_1");
    expect(row.provisional).toBeNull();
    expect(row.committed.class).toBe("thornguard");
  });

  it("a failed campaign restores the class worn at its start, and its ranks", async () => {
    const t = await table([{ name: "Pip", class: "songkeeper" }], {
      p_1: { songkeeper: "apprentice", thornguard: "expert" },
    });
    const before = await t.stored("p_1");
    await t.choose("to_dojo");
    await t.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    await t.choose("skip");
    await t.choose("lose");
    expect((await t.state()).campaign?.ended).toBe("failed");
    const row = await t.stored("p_1");
    expect(row.provisional).toBeNull();
    expect(row.committed.class).toBe("songkeeper");
    expect(row.committed.mastery).toEqual(before.committed.mastery);
  });

  it("at a table of four, each kid decides alone and two may switch to the same class", async () => {
    const t = await table([
      { name: "Pip", class: "songkeeper" },
      { name: "Moss", class: "songkeeper" },
      { name: "Wren", class: "starweaver" },
      { name: "Bram", class: "thornguard" },
    ]);
    await t.choose("to_dojo");

    // Bram already wears the bracer: nothing to decide, nothing to switch to.
    expect((await t.send("p_4", { type: "SWITCH_CLASS", classId: "thornguard" })).error?.message).toBe(
      "Bram is already a thornguard",
    );
    expect((await t.send("p_4", { type: "KEEP_CLASS", classId: "thornguard" })).error?.message).toBe(
      "Bram has nothing to decide here",
    );

    await t.must("p_1", { type: "SWITCH_CLASS", classId: "thornguard" });
    expect((await t.choose("on")).error?.message).toBe("still waiting for Moss, Wren to decide about their class");
    await t.must("p_2", { type: "SWITCH_CLASS", classId: "thornguard" });
    await t.must("p_3", { type: "KEEP_CLASS", classId: "thornguard" });

    const here = await t.state();
    expect(here.party.map((m) => m.character.class)).toEqual(["thornguard", "thornguard", "starweaver", "thornguard"]);
    expect(here.classPlace?.answers).toEqual({
      p_1: { switched: true, from: "songkeeper" },
      p_2: { switched: true, from: "songkeeper" },
      p_3: { switched: false },
    });

    // A kid who said no may still change their mind while the room is open.
    await t.must("p_3", { type: "SWITCH_CLASS", classId: "thornguard" });
    expect((await t.state()).classPlace?.answers.p_3).toEqual({ switched: true, from: "starweaver" });

    expect((await t.choose("skip")).ok).toBe(true);
    expect((await t.state()).sceneId).toBe("camp");
  });

  it("does not wait on a phone that has dropped", async () => {
    const t = await table([
      { name: "Pip", class: "songkeeper" },
      { name: "Moss", class: "songkeeper" },
    ]);
    await t.choose("to_dojo");
    await t.must("p_1", { type: "KEEP_CLASS", classId: "thornguard" });
    // Moss's phone drops: the room stops waiting for her.
    const run = await t.state();
    await t.harness.repo.putState({ ...run, party: run.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)) });
    expect((await t.choose("skip")).ok).toBe(true);
  });
});
