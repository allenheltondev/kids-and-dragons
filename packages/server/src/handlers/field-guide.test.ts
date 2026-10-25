/**
 * The Field Guide during play (#106): what a step discovers, who found it,
 * whose book it lands in, and how the room hears about it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type {
  Bestiary,
  Chapter,
  ChannelMessage,
  ClientIntent,
  RunState,
  ServerMessage,
  WorldMap,
} from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { applyOps, deepClone } from "../json-patch.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { enteredScenes, firstFinder, discoveryHousehold, stepDiscoveries } from "./field-guide.ts";
import { createRoom, joinRoom, watchRoom } from "./room.ts";
import { getState } from "./state.ts";

const realEngine: Engine = { applyIntent, createRunState };

const BIOME = "biome.enchanted_woods";
const SHRINE = "location.old_shrine";
const WISP = "creature.wisp";
const CLEARING = "location.bramble_clearing";
/** The two heroes at the table wear these (see `table`), and wearing a class finds its entry. */
const WORN = ["class.songkeeper", "class.thornguard"];

const world = { places: { enchanted_woods: { id: BIOME } } } as unknown as WorldMap;
const bestiary = { creatures: { wisp: { canon_id: WISP } } } as unknown as Bestiary;

/** The fixture chapter, tagged: the shrine is a place, the wisps are canon creatures. */
function taggedChapter(): Chapter {
  const chapter = makeChapter();
  chapter.scenes[chapter.entry]!.discovers = [CLEARING];
  const shrine = chapter.scenes["scene_shrine"]!;
  shrine.discovers = [SHRINE];
  const fight = chapter.scenes["encounter_wisps"]!;
  if (fight.type !== "encounter") throw new Error("fixture changed: encounter_wisps is not a fight");
  fight.enemies = fight.enemies.map((e) => ({ ...e, creature: "wisp" }));
  return chapter;
}

function guideHarness(): TestHarness {
  return makeHarness({
    engine: realEngine,
    content: makeContent({ chapters: [taggedChapter()], world, bestiary }),
  });
}

const APPEARANCE = { palette: "meadow", accent: "#7FD4C1" };
function hero(name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name,
    species,
    class: cls,
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: APPEARANCE,
  };
}

async function table(harness: TestHarness) {
  const { householdId, players } = await seedHousehold(harness, 2);
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
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
  await send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
  await send("p_2", hero("Thistle", "bigfoot", "thornguard"));
  await send("p_1", { type: "READY", ready: true });
  await send("p_2", { type: "READY", ready: true });
  return { householdId, code, runId, received, state, send };
}

/** Walks the opening until the party stands in `target`; returns who took the last step. */
async function walkTo(
  t: Awaited<ReturnType<typeof table>>,
  target: string,
): Promise<{ by: string; message: ServerMessage }> {
  for (let i = 0; i < 20; i++) {
    const s = await t.state();
    const prompt = s.prompt;
    let by: string;
    let intent: ClientIntent;
    if (prompt?.kind === "roll") {
      by = s.party.find((m) => m.character.id === prompt.characterId)!.playerId;
      intent = { type: "ROLL" };
    } else if (prompt?.kind === "choice") {
      by = prompt.forPlayerIds[0] ?? "p_2";
      const wanted = prompt.options.find((o) => o.id === "east") ?? prompt.options[0]!;
      intent = { type: "CHOOSE", choiceId: wanted.id };
    } else {
      by = "p_1";
      intent = { type: "ADVANCE" };
    }
    const message = await t.send(by, intent);
    if ((await t.state()).sceneId === target) return { by, message };
  }
  throw new Error(`never reached ${target}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recording discoveries during play", () => {
  it("a chapter start records the biome and the entry scene, credited to whoever began it", async () => {
    const harness = guideHarness();
    const t = await table(harness);
    const record = vi.spyOn(harness.repo, "recordDiscoveries");

    const message = await t.send("p_2", { type: "START_CHAPTER", chapterId: "bramblewood-01" });

    expect(record).toHaveBeenCalledTimes(1);
    const book = await harness.repo.getFieldGuide(t.householdId);
    expect(Object.keys(book.entries)).toEqual([BIOME, CLEARING, ...WORN]);
    expect(book.entries[BIOME]).toMatchObject({ firstFoundBy: "p_2", runId: t.runId });
    // The room hears it on the same patch as the scene, and is told it is new.
    expect(message.discovered).toEqual([BIOME, CLEARING, ...WORN]);
    expect(book.entries[CLEARING]?.firstFoundBy).toBe("p_2");
    expect((await t.state()).fieldGuide).toEqual(book.entries);
  });

  it("entering a tagged scene and starting a fight each record their ids exactly once", async () => {
    const harness = guideHarness();
    const t = await table(harness);
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    const record = vi.spyOn(harness.repo, "recordDiscoveries");

    const shrine = await walkTo(t, "scene_shrine");
    expect(shrine.message.discovered).toEqual([SHRINE]);

    const fight = await walkTo(t, "encounter_wisps");
    expect(fight.message.discovered).toEqual([WISP]);

    const book = (await harness.repo.getFieldGuide(t.householdId)).entries;
    expect(Object.keys(book).sort()).toEqual([BIOME, CLEARING, SHRINE, WISP, ...WORN].sort());
    expect(book[SHRINE]?.firstFoundBy).toBe(shrine.by);
    expect(book[WISP]?.firstFoundBy).toBe(fight.by);

    // One write per find, and no announcement anywhere else on the way.
    expect(record.mock.calls.map(([, finds]) => finds.map((f) => f.canonId))).toEqual([[SHRINE], [WISP]]);
    const announced = t.received.flatMap((m) => (m.kind === "patch" ? (m.discovered ?? []) : []));
    expect(announced).toEqual([BIOME, CLEARING, ...WORN, SHRINE, WISP]);
  });

  it("walking into a class place finds the room and the class it teaches, whatever the party wears", async () => {
    const chapter = taggedChapter();
    const shrine = chapter.scenes["scene_shrine"]!;
    if (shrine.type !== "story" && shrine.type !== "choice_point") throw new Error("fixture changed: the shrine is not a story scene");
    shrine.classPlace = "starweaver"; // nobody at this table wears one
    shrine.discovers = undefined;
    const harness = makeHarness({ engine: realEngine, content: makeContent({ chapters: [chapter], world, bestiary }) });
    const t = await table(harness);
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    const book = () => harness.repo.getFieldGuide(t.householdId).then((b) => Object.keys(b.entries));
    expect(await book()).not.toContain("class.starweaver");

    const room = await walkTo(t, "scene_shrine");

    expect(room.message.discovered).toEqual(["location.academy", "class.starweaver"]);
    expect(await book()).toEqual(expect.arrayContaining(["location.academy", "class.starweaver"]));
    expect((await harness.repo.getFieldGuide(t.householdId)).entries["class.starweaver"]?.firstFoundBy).toBe(room.by);
  });

  it("an ordinary step reads the household's book no more than it did before classes had entries", async () => {
    const chapter = taggedChapter();
    const harness = makeHarness({ engine: realEngine, content: makeContent({ chapters: [chapter], world, bestiary }) });
    const t = await table(harness);
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    const read = vi.spyOn(harness.repo, "getFieldGuide");
    const record = vi.spyOn(harness.repo, "recordDiscoveries");
    await walkTo(t, "scene_shrine");
    expect(read).not.toHaveBeenCalled(); // only a chapter start re-reads the whole book
    expect(record.mock.calls.map(([, finds]) => finds.map((f) => f.canonId))).toEqual([[SHRINE]]);
  });

  it("finding something again records and announces nothing, and the first finder stands", async () => {
    const harness = guideHarness();
    const first = await table(harness);
    await first.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });

    // Another evening, another room: the same chapter, started by somebody else.
    const created = await createRoom({ householdId: first.householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("room");
    const again = await joinRoom(
      { code: created.value.code, principal: { deviceId: "d", householdId: first.householdId, playerId: "p_2" } },
      harness.deps,
    );
    if (!again.ok) throw new Error("join");
    // The new room opens with the household's book already in it.
    expect(again.value.state.fieldGuide?.[BIOME]?.firstFoundBy).toBe("p_1");

    const runId = created.value.runId;
    const received: ChannelMessage[] = [];
    harness.channel.subscribe(created.value.code, (m) => received.push(m));
    const send = async (playerId: string, intent: ClientIntent) => {
      const seq = (await harness.repo.getState(runId))!.seq;
      const response = await applyAction({ runId, playerId, seq, intent }, harness.deps);
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
    };
    await send("p_2", hero("Thistle", "bigfoot", "thornguard"));
    await send("p_2", { type: "READY", ready: true });
    const record = vi.spyOn(harness.repo, "recordDiscoveries");
    await send("p_2", { type: "START_CHAPTER", chapterId: "bramblewood-01" });

    expect(record).not.toHaveBeenCalled();
    expect(received.some((m) => m.kind === "patch" && m.discovered)).toBe(false);
    expect((await harness.repo.getFieldGuide(first.householdId)).entries[BIOME]?.firstFoundBy).toBe("p_1");
  });

  it("a refresh mid-chapter shows the same book and replays no news", async () => {
    const harness = guideHarness();
    const t = await table(harness);
    const beforeStart = deepClone(await t.state());
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    await walkTo(t, "scene_shrine");
    const book = (await harness.repo.getFieldGuide(t.householdId)).entries;

    // A cold reload: the snapshot carries the whole book.
    const snapshot = await getState({ runId: t.runId }, harness.deps);
    if (!snapshot.ok || !snapshot.value.state) throw new Error("snapshot");
    expect(snapshot.value.state.fieldGuide).toEqual(book);

    // A reconnect that replays the gap: the patches rebuild the book, and not
    // one replayed event carries the live-only "new" signal.
    const replay = await getState({ runId: t.runId, sinceSeq: beforeStart.seq }, harness.deps);
    if (!replay.ok || !replay.value.events) throw new Error("replay");
    expect(replay.value.events.some((e) => "discovered" in e)).toBe(false);
    let mirror = beforeStart;
    for (const event of replay.value.events) mirror = applyOps(mirror, event.patch);
    expect(mirror.fieldGuide).toEqual(book);

    // A rejoining phone and a re-attaching TV see the same book too.
    const rejoin = await joinRoom(
      { code: t.code, principal: { deviceId: "d", householdId: t.householdId, playerId: "p_1" } },
      harness.deps,
    );
    if (!rejoin.ok) throw new Error("rejoin");
    expect(rejoin.value.state.fieldGuide).toEqual(book);
    const tv = await watchRoom({ code: t.code }, harness.deps);
    if (!tv.ok) throw new Error("watch");
    expect(tv.value.state.fieldGuide).toEqual(book);
  });

  it("a failed record does not fail the step that found it", async () => {
    const harness = guideHarness();
    const t = await table(harness);
    vi.spyOn(harness.repo, "recordDiscoveries").mockRejectedValue(new Error("throttled"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const message = await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });

    expect((await t.state()).sceneId).toBe("scene_clearing");
    expect(message.discovered).toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("whose book", () => {
  it("a TV's room carries no book until a phone settles it, then gets the household's", async () => {
    const harness = guideHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    await harness.repo.recordDiscoveries(householdId, [{ canonId: BIOME, playerId: "p_1" }]);

    const created = await createRoom({ householdId, mode: "party", claimable: true }, harness.deps);
    if (!created.ok) throw new Error("room");
    const tv = await watchRoom({ code: created.value.code }, harness.deps);
    if (!tv.ok) throw new Error("watch");
    expect(tv.value.state.fieldGuide).toBeUndefined();

    const received: ChannelMessage[] = [];
    harness.channel.subscribe(created.value.code, (m) => received.push(m));
    const joined = await joinRoom({ code: created.value.code, principal: players[0]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    expect(Object.keys(joined.value.state.fieldGuide ?? {})).toEqual([BIOME]);
    // ...and the TV got it on the broadcast, as a patch like any other.
    let mirror = tv.value.state;
    for (const m of received) if (m.kind === "patch") mirror = applyOps(mirror, m.patch);
    expect(mirror.fieldGuide).toEqual(joined.value.state.fieldGuide);
  });

  it("refuses to record into an unsettled room's household, without throwing", async () => {
    const harness = guideHarness();
    const { householdId } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party", claimable: true }, harness.deps);
    if (!created.ok) throw new Error("room");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = { id: created.value.runId, householdId };
    expect(await discoveryHousehold(run, { roomCode: created.value.code }, harness.deps)).toBeNull();
    expect(warn).toHaveBeenCalled();

    // Settled, it is the run's household; expired or reused codes fall back to the run.
    await harness.repo.claimRoom({ code: created.value.code, run: (await harness.repo.getRun(run.id))!, householdId });
    expect(await discoveryHousehold(run, { roomCode: created.value.code }, harness.deps)).toBe(householdId);
    expect(await discoveryHousehold(run, { roomCode: "ZZZZ" }, harness.deps)).toBe(householdId);
  });
});

describe("the rules, without a server", () => {
  const base = { chapterId: "c", sceneId: "a", visited: ["a"] } as unknown as RunState;

  it("entered scenes are the trail's new end, or the whole trail at a chapter start", () => {
    const after = { ...base, sceneId: "c", visited: ["a", "b", "c"] } as RunState;
    expect(enteredScenes(base, after, false)).toEqual(["b", "c"]);
    expect(enteredScenes(base, base, false)).toEqual([]);
    expect(enteredScenes(after, { ...base, visited: ["a"] } as RunState, true)).toEqual(["a"]);
    // Back to the lobby enters nothing.
    expect(enteredScenes(base, { ...base, chapterId: null, sceneId: null } as RunState, false)).toEqual([]);
  });

  it("an encounter's creatures and a scene's tags, via the content's bestiary and world", () => {
    const chapter = taggedChapter();
    const deps = { content: makeContent({ chapters: [chapter], world, bestiary }) };
    const before = { ...base, chapterId: chapter.id, sceneId: "scene_camp", visited: ["scene_shrine"] } as RunState;
    const after = { ...before, sceneId: "encounter_wisps", visited: ["scene_shrine", "encounter_wisps"] } as RunState;
    expect(stepDiscoveries(before, after, chapter, false, deps)).toEqual([WISP]);
    const started = { ...after, sceneId: chapter.entry, visited: [chapter.entry] } as RunState;
    expect(stepDiscoveries(base, started, chapter, true, deps)).toEqual([BIOME, CLEARING]);
  });

  describe("classes (docs/class-mastery.md §2)", () => {
    const hero = (cls: string) => ({ character: { class: cls } });
    const classChapter = (): Chapter => {
      const chapter = taggedChapter();
      chapter.scenes["scene_shrine"] = { ...chapter.scenes["scene_shrine"]!, classPlace: "thornguard" } as never;
      return chapter;
    };

    it("a chapter start finds every class at the table, once each, in seat order", () => {
      const chapter = classChapter();
      const deps = { content: makeContent({ chapters: [chapter], world, bestiary }) };
      const party = [hero("songkeeper"), hero("thornguard"), hero("songkeeper")] as never;
      const started = { ...base, party, chapterId: chapter.id, sceneId: chapter.entry, visited: [chapter.entry] } as RunState;
      expect(stepDiscoveries(base, started, chapter, true, deps)).toEqual([BIOME, CLEARING, "class.songkeeper", "class.thornguard"]);
    });

    it("a step finds a class only when it is new to the party since the step before", () => {
      const chapter = classChapter();
      const deps = { content: makeContent({ chapters: [chapter], world, bestiary }) };
      const before = { ...base, chapterId: chapter.id, party: [hero("thornguard")] } as unknown as RunState;
      const same = { ...before, sceneId: "scene_camp", visited: ["a", "scene_camp"] } as RunState;
      expect(stepDiscoveries(before, same, chapter, false, deps)).toEqual([]);
      const switched = { ...same, party: [hero("starweaver")] } as unknown as RunState;
      expect(stepDiscoveries(same, switched, chapter, false, deps)).toEqual(["class.starweaver"]);
    });

    it("entering a class place finds the room and its class, for a party that wears something else", () => {
      const chapter = classChapter();
      const deps = { content: makeContent({ chapters: [chapter], world, bestiary }) };
      const before = { ...base, chapterId: chapter.id, party: [hero("songkeeper")] } as unknown as RunState;
      const after = { ...before, sceneId: "scene_shrine", visited: ["a", "scene_shrine"] } as RunState;
      expect(stepDiscoveries(before, after, chapter, false, deps)).toEqual([SHRINE, "location.dojo", "class.thornguard"]);
    });
  });

  it("credit goes to the actor at the table, else the story-turn holder, else the first seat", () => {
    const party = [{ playerId: "p_1" }, { playerId: "p_2" }] as RunState["party"];
    const state = { ...base, party, storyTurn: 1 } as RunState;
    expect(firstFinder(state, "p_1")).toBe("p_1");
    expect(firstFinder(state, "p_9")).toBe("p_2");
    expect(firstFinder(state, null)).toBe("p_2");
    expect(firstFinder({ ...state, storyTurn: 7 }, null)).toBe("p_1");
    expect(firstFinder({ ...state, party: [] }, null)).toBeNull();
  });
});
