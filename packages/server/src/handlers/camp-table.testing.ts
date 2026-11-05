/**
 * A table for the Dash Cash tests (#619; camp-pay.test.ts, camp-shop.test.ts):
 * the fixture chapter with an optional objective, a goal, a won-or-lost bell
 * game and a setback ending, played by two heroes of one household through
 * the real engine and the real action handler.
 */

import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { ActionResponse, CampCatalog, Chapter, ChannelMessage, ClientIntent, InteractionScene, RunState, ServerMessage } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

export const CHAPTER = "bramblewood-01";

/** The shipped catalog, so the shop's lists and prices are the real ones. */
export const CATALOG = JSON.parse(readFileSync(new URL("../../../../content/camp.json", import.meta.url), "utf8")) as CampCatalog;

/**
 * The fixture chapter, with: an optional objective on the shrine's flag and
 * one on the high road's; a goal whose one step is the shrine too (it pays
 * nothing); a bell game off the clearing; and a setback ending.
 */
export function payingChapter(): Chapter {
  const chapter = makeChapter();
  chapter.objectives = [
    { id: "shrine", label: "Find the shrine", flag: "found_shrine", xp: 10 },
    { id: "high", label: "Take the high road", flag: "took_high", xp: 10 },
  ];
  chapter.goal = { text: "Find the way home.", steps: [{ id: "shrine", label: "Find the shrine", flag: "found_shrine" }, { id: "home", label: "Get home", flag: "took_low" }] };
  const bell: InteractionScene = {
    type: "interaction",
    narration: "A bell hangs from a branch.",
    interaction: { kind: "precision", cue: "Ring the bell", actionLabel: "Throw", target: 0.5, width: 0.3, periodMs: 4000 },
    onSuccess: { goto: "scene_ending" },
    onFailure: { goto: "scene_ending" },
  };
  chapter.scenes["scene_bell"] = bell;
  chapter.scenes["scene_setback"] = { type: "story", narration: "Not the way you hoped.", outcome: "setback", choices: [] };
  return chapter;
}

const realEngine: Engine = { applyIntent, createRunState };

export const harnessFor = (catalog: CampCatalog | null = CATALOG): TestHarness =>
  makeHarness({ engine: realEngine, content: makeContent({ chapters: [payingChapter()], campCatalog: catalog }), playtest: true });

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

export interface Table {
  householdId: string;
  runId: string;
  received: ChannelMessage[];
  state: () => Promise<RunState>;
  /** Send and expect it to land; the broadcast it made. */
  send: (playerId: string, intent: ClientIntent) => Promise<ChannelMessage & ServerMessage>;
  /** Send and return the response, landed or not. */
  attempt: (playerId: string, intent: ClientIntent) => Promise<ActionResponse>;
  /** Two heroes, ready, the chapter started. */
  start: () => Promise<void>;
  /** Warp to `sceneId` (playtest), which may end the chapter. */
  goto: (sceneId: string) => Promise<ChannelMessage & ServerMessage>;
  /** Everyone says they're done, and the table is back in the lobby. */
  leave: () => Promise<void>;
}

/** A room of the household with two players joined; nobody seated yet. */
export async function table(harness: TestHarness, household?: Awaited<ReturnType<typeof seedHousehold>>): Promise<Table> {
  const { householdId, players } = household ?? (await seedHousehold(harness, 2));
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
  const attempt = async (playerId: string, intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, harness.deps);
  const send = async (playerId: string, intent: ClientIntent) => {
    const response = await attempt(playerId, intent);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    return received.at(-1) as ChannelMessage & ServerMessage;
  };
  let heroes: string[] = [];
  const start = async () => {
    if (heroes.length === 0) {
      await send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
      await send("p_2", hero("Thistle", "bigfoot", "thornguard"));
      heroes = (await state()).party.map((m) => m.character.id);
    }
    await send("p_1", { type: "READY", ready: true });
    await send("p_2", { type: "READY", ready: true });
    await send("p_1", { type: "START_CHAPTER", chapterId: CHAPTER });
  };
  const goto = (sceneId: string) => send("p_1", { type: "PLAYTEST_GOTO", sceneId });
  const leave = async () => {
    await send("p_1", { type: "ENDING_READ" });
    await send("p_1", { type: "READY", ready: true });
    await send("p_2", { type: "READY", ready: true });
    expect((await state()).phase).toBe("lobby");
  };
  return { householdId, runId, received, state, send, attempt, start, goto, leave };
}
