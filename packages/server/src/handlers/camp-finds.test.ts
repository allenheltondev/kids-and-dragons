/**
 * The camp's finds during play (#618, docs/camp.md §5.1, §5.4, §12.2): a
 * `findForCamp` or `findForKit` effect is saved the moment the step that
 * applied it commits, once per reward id, whatever route, replay or second
 * room reaches it again.
 */

import { describe, expect, it, vi } from "vitest";
import { applyIntent, createRunState, readKit } from "@kad/shared";
import type { Chapter, ChannelMessage, ClientIntent, Effect, RunState, ServerMessage, StoryScene } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { applyOps } from "../json-patch.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { mutateCamp, mutateKit, readCamp } from "./camp.ts";
import { stepCampFinds } from "./camp-finds.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

const AWNING = { pieceId: "find_noodle_awning", rewardId: "bramblewood-01.awning" };
const FEATHER = { pieceId: "deco_gull_feather", rewardId: "bramblewood-01.feather" };
const findForCamp: Effect = { type: "findForCamp", ...AWNING };
const findForKit: Effect = { type: "findForKit", ...FEATHER };

/**
 * The fixture chapter with finds on the shrine, and the awning offered again
 * on the scratched road to it under the same reward id: two ways into one
 * place, as a graph campaign offers it.
 */
function findingChapter(): Chapter {
  const chapter = makeChapter();
  const shrine = chapter.scenes["scene_shrine"] as StoryScene;
  shrine.onEnter = [...(shrine.onEnter ?? []), findForCamp, findForKit];
  const scratched = chapter.scenes["scene_scratched"] as StoryScene;
  scratched.onEnter = [findForCamp];
  return chapter;
}

const harnessFor = () => makeHarness({ engine: realEngine, content: makeContent({ chapters: [findingChapter()] }) });

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

/** A room of the household with two heroes, ready, the chapter started. */
async function table(harness: TestHarness, again?: Table) {
  const { householdId, players } = again ?? (await seedHousehold(harness, 2));
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const initial = (await harness.repo.getState(runId))!;
  const received: ChannelMessage[] = [];
  harness.channel.subscribe(code, (m) => received.push(m));
  for (const p of players) {
    const joined = await joinRoom({ code, principal: p.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
  }
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (playerId: string, intent: ClientIntent) => {
    const response = await applyAction({ runId, playerId, seq: (await state()).seq, intent }, harness.deps);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    return received.at(-1) as ChannelMessage & ServerMessage;
  };
  return { householdId, players, runId, initial, received, state, send };
}

type Table = { householdId: string; players: Awaited<ReturnType<typeof seedHousehold>>["players"] } & {
  runId: string;
  initial: RunState;
  received: ChannelMessage[];
  state: () => Promise<RunState>;
  send: (playerId: string, intent: ClientIntent) => Promise<ChannelMessage & ServerMessage>;
};

/** Seat two heroes (new ones, or the household's own `heroes` again), ready up and start. */
async function seatAndStart(t: Table, heroes?: string[]) {
  if (heroes) {
    await t.send("p_1", { type: "SEAT_CHARACTER", characterId: heroes[0]! });
    await t.send("p_2", { type: "SEAT_CHARACTER", characterId: heroes[1]! });
  } else {
    await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
    await t.send("p_2", hero("Thistle", "bigfoot", "thornguard"));
  }
  await t.send("p_1", { type: "READY", ready: true });
  await t.send("p_2", { type: "READY", ready: true });
  await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
}

/** Walk to the shrine, the squeeze rolled with a die that succeeds (16) or fails (1). */
async function walkToShrine(t: Table, harness: TestHarness, die: 1 | 16): Promise<ServerMessage[]> {
  const honest = harness.deps.rng;
  harness.deps.rng = () => ({ next: () => (die - 1) / 20 + 0.001 });
  const messages: ServerMessage[] = [];
  for (let i = 0; i < 20; i++) {
    const s = await t.state();
    if (s.sceneId === "scene_shrine") break;
    const prompt = s.prompt;
    if (prompt?.kind === "roll") {
      messages.push(await t.send(s.party.find((m) => m.character.id === prompt.characterId)!.playerId, { type: "ROLL" }));
    } else if (prompt?.kind === "choice") {
      const option = prompt.options.find((o) => o.id === "squeeze") ?? prompt.options[0]!;
      messages.push(await t.send(prompt.forPlayerIds[0] ?? "p_1", { type: "CHOOSE", choiceId: option.id }));
    } else {
      messages.push(await t.send("p_1", { type: "ADVANCE" }));
    }
  }
  harness.deps.rng = honest;
  if ((await t.state()).sceneId !== "scene_shrine") throw new Error("never reached the shrine");
  return messages;
}

const claimsOf = (messages: readonly ServerMessage[]) => messages.flatMap((m) => m.campClaims ?? []);

describe("findForCamp (§5.1)", () => {
  it("gives the crew the piece the first time, saved when found, long before the chapter's end", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await seatAndStart(t);
    const messages = await walkToShrine(t, harness, 16);

    // Nowhere near the ending, and the room could close now: it is already the crew's.
    expect((await t.state()).phase).not.toBe("chapter_complete");
    const stored = await harness.repo.getCamp(t.householdId);
    expect(stored?.owned["find_noodle_awning"]).toMatchObject({ from: "found", rewardId: AWNING.rewardId });
    expect(stored?.receipts.rewards[AWNING.rewardId]).toMatchObject({ runId: t.runId });
    expect(stored?.dashCash).toBe(0);
    // The phones hear what it did on the step that found it, and the run says what was found.
    expect(claimsOf(messages).find((c) => c.kind === "camp")).toEqual({ ...AWNING, kind: "camp", result: "piece" });
    expect((await t.state()).campFinds?.map((f) => f.rewardId)).toEqual([AWNING.rewardId, FEATHER.rewardId]);
  });

  it("pays 1 Dash Cash for a piece the crew already owns from another reward", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await mutateCamp(t.householdId, null, (camp) => ({ ...camp, owned: { find_noodle_awning: { from: "bought", at: "2026-07-01T00:00:00.000Z" } } }), harness.deps);
    await seatAndStart(t);
    const messages = await walkToShrine(t, harness, 16);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(1);
    expect(camp.owned["find_noodle_awning"]?.from).toBe("bought");
    expect(claimsOf(messages).find((c) => c.kind === "camp")?.result).toBe("dashCash");
  });

  it("gives nothing for a reward id the crew has claimed: a replay, another route, another room", async () => {
    const harness = harnessFor();
    const first = await table(harness);
    await seatAndStart(first);
    await walkToShrine(first, harness, 16); // the squeeze: straight to the shrine
    const once = await readCamp(first.householdId, null, harness.deps);

    // Another evening, the other road: the scratched one offers the same find, and so does the shrine.
    const second = await table(harness, first);
    await seatAndStart(second);
    const messages = await walkToShrine(second, harness, 1);
    expect((await second.state()).visited).toContain("scene_scratched");
    const camp = await readCamp(first.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(0);
    expect(camp.owned).toEqual(once.owned);
    expect(camp.receipts.rewards).toEqual(once.receipts.rewards);
    expect(claimsOf(messages).find((c) => c.kind === "camp")?.result).toBe("none");
  });

  it("gives once when two routes in one chapter share the reward id", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await seatAndStart(t);
    const claim = vi.spyOn(harness.repo, "putCamp");
    const messages = await walkToShrine(t, harness, 1); // scratched road, then the shrine: both offer it
    expect((await t.state()).visited).toEqual(expect.arrayContaining(["scene_scratched", "scene_shrine"]));
    expect(claimsOf(messages).filter((c) => c.kind === "camp")).toEqual([{ ...AWNING, kind: "camp", result: "piece" }]);
    expect(claim).toHaveBeenCalledTimes(1);
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(0);
  });
});

describe("findForKit (§5.4)", () => {
  it("gives every seated hero her own copy, a hero who has it nothing, and never Dash Cash", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await seatAndStart(t);
    const [ada, pip] = (await t.state()).party.map((m) => m.character.id);
    // Thistle already has the feather, from somewhere else.
    await mutateKit(t.householdId, pip!, (kit) => ({ ...kit, unlocked: { ...kit.unlocked, [FEATHER.pieceId]: { from: "found", rewardId: "elsewhere.feather", at: "t" } } }), harness.deps);
    const messages = await walkToShrine(t, harness, 16);

    const kitOf = async (id: string) => readKit((await harness.repo.getCharacter(t.householdId, id))!);
    expect((await kitOf(ada!)).unlocked[FEATHER.pieceId]).toMatchObject({ from: "found", rewardId: FEATHER.rewardId });
    expect((await kitOf(pip!)).unlocked[FEATHER.pieceId]).toEqual({ from: "found", rewardId: "elsewhere.feather", at: "t" });
    expect(claimsOf(messages).find((c) => c.kind === "kit")).toEqual({ ...FEATHER, kind: "kit", result: "kit", heroes: [ada] });
    // The kit is the hero's: nothing lands on the crew's camp, not even Dash Cash.
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(0);
    expect(camp.owned).not.toHaveProperty(FEATHER.pieceId);
    expect(camp.receipts.rewards).not.toHaveProperty(FEATHER.rewardId);
  });

  it("a second claim of the same kit find gives every hero who has it nothing more", async () => {
    const harness = harnessFor();
    const first = await table(harness);
    await seatAndStart(first);
    await walkToShrine(first, harness, 16);
    const heroes = (await first.state()).party.map((m) => m.character.id);
    const before = await Promise.all(heroes.map(async (id) => readKit((await harness.repo.getCharacter(first.householdId, id))!)));

    const second = await table(harness, first);
    await seatAndStart(second, heroes);
    const messages = await walkToShrine(second, harness, 16);
    expect(claimsOf(messages).find((c) => c.kind === "kit")?.heroes).toEqual([]);
    const after = await Promise.all(heroes.map(async (id) => readKit((await harness.repo.getCharacter(first.householdId, id))!)));
    expect(after).toEqual(before);
    expect((await readCamp(first.householdId, null, harness.deps)).dashCash).toBe(0);
  });
});

describe("the engine stays pure", () => {
  it("a replay of the event log rebuilds the run, finds and all, and claims nothing again", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await seatAndStart(t);
    await walkToShrine(t, harness, 1);
    const final = await t.state();
    const camp = await harness.repo.getCamp(t.householdId);

    const putCamp = vi.spyOn(harness.repo, "putCamp");
    const writeCharacter = vi.spyOn(harness.repo, "writeCharacter");
    let mirror: RunState = t.initial;
    for (const event of await harness.repo.listEvents(t.runId, t.initial.seq)) mirror = applyOps(mirror, event.patch);
    expect(mirror).toEqual(final);
    expect(mirror.campFinds).toHaveLength(2);
    // The log carries the finds, never the claims: nothing in it is live-only.
    for (const event of await harness.repo.listEvents(t.runId, t.initial.seq)) expect(event).not.toHaveProperty("campClaims");
    expect(putCamp).not.toHaveBeenCalled();
    expect(writeCharacter).not.toHaveBeenCalled();
    expect(await harness.repo.getCamp(t.householdId)).toEqual(camp);
  });

  it("reads off the step only what is new: a start's finds, a step's additions, nothing on the way out", () => {
    const find = (rewardId: string) => ({ kind: "camp" as const, pieceId: "p", rewardId, sceneId: "s" });
    const base = { chapterId: "c", campFinds: [find("a")] } as unknown as RunState;
    expect(stepCampFinds(base, { ...base, campFinds: [find("a"), find("b")] }, false)).toEqual([find("b")]);
    expect(stepCampFinds(base, base, true)).toEqual([find("a")]);
    expect(stepCampFinds(base, { ...base, chapterId: null } as unknown as RunState, false)).toEqual([]);
    expect(stepCampFinds(base, base, false)).toEqual([]);
  });
});
