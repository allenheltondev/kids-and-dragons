/**
 * A table for the Dash Cash tests (#619; camp-pay.test.ts, camp-shop.test.ts):
 * the fixture chapter with an optional objective, a goal, a won-or-lost bell
 * game and a setback ending, played by two heroes of one household through
 * the real engine and the real action handler.
 */

import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { ActionResponse, CampCatalog, CampRecord, Campaign, Chapter, ChannelMessage, ClientIntent, InteractionScene, RunState, ServerMessage } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

export const CHAPTER = "bramblewood-01";

/** The Practice Meadow's chapter, whose campaign marks itself a tutorial (docs/camp.md §5.3). */
export const PRACTICE_CHAPTER = "first-steps-01";

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

/**
 * A camp as a test seeds it: `over` spread on, with a `paidChapterCount` of n
 * written as n paid-chapter receipts for chapters the fixture content does not
 * have (they count, camp.ts `withShopCount`), since the count is read off the
 * receipts.
 */
export function seeded(camp: CampRecord, over: Partial<CampRecord>): CampRecord {
  const { paidChapterCount, ...rest } = over;
  const next = { ...camp, ...rest };
  if (paidChapterCount === undefined) return next;
  const chapters = { ...next.receipts.chapters };
  for (let i = 1; i <= paidChapterCount; i++) chapters[`earlier-chapter-${String(i)}`] = { at: "2026-11-01T00:00:00.000Z" };
  return { ...next, paidChapterCount, receipts: { ...next.receipts, chapters } };
}

const realEngine: Engine = { applyIntent, createRunState };

/** The Practice Meadow as the shop's count reads it: a campaign that marks itself a tutorial. */
const PRACTICE: Campaign = { id: "first-steps", title: "First Steps", blurb: "", chapters: [PRACTICE_CHAPTER], tutorial: true };

/**
 * The fixture content: the paying chapter, and the Practice Meadow beside it
 * (its campaign is the only one the content has, so the fixture chapter's own
 * campaign boundary never fires). With `practice`, the paying chapter is the
 * meadow's own, played the way the server plays the practice.
 */
export const harnessFor = (catalog: CampCatalog | null = CATALOG, options: { practice?: boolean } = {}): TestHarness => {
  const meadow = { ...payingChapter(), id: PRACTICE_CHAPTER, campaignId: PRACTICE.id };
  const chapters = options.practice ? [meadow] : [payingChapter(), meadow];
  return makeHarness({ engine: realEngine, content: makeContent({ chapters, campaigns: [PRACTICE], campCatalog: catalog }), playtest: true });
};

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
export async function table(
  harness: TestHarness,
  household?: Awaited<ReturnType<typeof seedHousehold>>,
  chapterId: string = CHAPTER,
): Promise<Table> {
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
    await send("p_1", { type: "START_CHAPTER", chapterId });
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
