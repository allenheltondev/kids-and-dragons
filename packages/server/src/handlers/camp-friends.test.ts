/**
 * The camp's friends at the table (#624, docs/camp.md §4.4, §8.5, §12.2,
 * §12.5, §13.1): a friend joins through a "Come along" choice, saved when
 * befriended and given once by its reward id, while "Say goodbye" writes
 * nothing; at most four friends are out, each seated hero's buddy first and
 * the rest by how often they have been out, counted once a moment; a buddy
 * is picked on the hero's own kit, for this crew's camp only; and a tap on a
 * phone is relayed to the TV, never committed, a few times a window.
 */

import { describe, expect, it } from "vitest";
import { FRIEND_TAP_LIMIT, FRIEND_TAP_WINDOW_MS, FRIENDS_OUT, applyIntent, campKey, createRunState, readKit } from "@kad/shared";
import type { CampCatalog, CampFriend, Chapter, ChannelMessage, ClientIntent, Effect, RunState, ServerMessage, StoryScene } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { mutateCamp, readCamp } from "./camp.ts";
import { CATALOG } from "./camp-table.testing.ts";
import { withFriendsOut } from "./camp-edit.ts";
import { relayFriendTap } from "./friend-tap.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const AT = "2026-11-01T00:00:00.000Z";
const BUN = { friendId: "bun", rewardId: "bramblewood-01.bun" };
const befriend: Effect = { type: "befriend", ...BUN };

/** The fixture chapter with Bun at the shrine: "Come along" beside "Say goodbye", both on to the thicket. */
function befriendingChapter(): Chapter {
  const chapter = makeChapter();
  const shrine = chapter.scenes["scene_shrine"] as StoryScene;
  shrine.cast = [{ figure: "cast/bun", name: "Bun" }];
  shrine.choices = [
    { id: "come", label: "Come along, Bun", icon: "heart", goto: "encounter_wisps", effects: [befriend] },
    { id: "goodbye", label: "Say goodbye", icon: "arrow", goto: "encounter_wisps" },
  ];
  return chapter;
}

/** The shipped catalog, with two more friends so more than four can rotate. */
const BIG_CATALOG: CampCatalog = {
  ...CATALOG,
  friends: [
    ...CATALOG.friends,
    { id: "lamb", figure: "entities/goat", name: "Lamb", offers: [], reactions: ["Baa!"] },
    { id: "newt", figure: "entities/jackalope", name: "Newt", offers: [], reactions: ["Newt blinks."] },
  ],
};

const harnessFor = (catalog: CampCatalog = CATALOG) =>
  makeHarness({ engine: realEngine, content: makeContent({ chapters: [befriendingChapter()], campCatalog: catalog }), playtest: true });

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

type Household = Awaited<ReturnType<typeof seedHousehold>>;

/** A room of the household, every player joined; heroes for `seat` of them. */
async function table(harness: TestHarness, household?: Household, seat = 2) {
  const home = household ?? (await seedHousehold(harness, 3));
  const created = await createRoom({ householdId: home.householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const received: ChannelMessage[] = [];
  harness.channel.subscribe(code, (m) => received.push(m));
  for (const p of home.players) {
    const joined = await joinRoom({ code, principal: p.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
  }
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const attempt = async (playerId: string, intent: ClientIntent) => applyAction({ runId, playerId, seq: (await state()).seq, intent }, harness.deps);
  const send = async (playerId: string, intent: ClientIntent) => {
    const response = await attempt(playerId, intent);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    return received.at(-1) as ChannelMessage & ServerMessage;
  };
  const kinds: [string, "unicorn" | "bigfoot", "songkeeper" | "thornguard"][] = [["Sparklehoof", "unicorn", "songkeeper"], ["Thistle", "bigfoot", "thornguard"], ["Pip", "unicorn", "songkeeper"]];
  if (!household) for (let i = 0; i < seat; i++) await send(`p_${String(i + 1)}`, hero(...kinds[i]!));
  else for (const [i, id] of (household as Household & { heroes?: string[] }).heroes?.entries() ?? []) await send(`p_${String(i + 1)}`, { type: "SEAT_CHARACTER", characterId: id });
  return { home, householdId: home.householdId, runId, code, received, state, attempt, send };
}

/** To the shrine (playtest), then everybody picks `choice`. */
async function atTheShrine(t: Awaited<ReturnType<typeof table>>, choice: "come" | "goodbye"): Promise<ServerMessage[]> {
  await t.send("p_1", { type: "READY", ready: true });
  await t.send("p_2", { type: "READY", ready: true });
  await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
  await t.send("p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_shrine" });
  const messages: ServerMessage[] = [];
  for (let guard = 0; guard < 4; guard++) {
    const prompt = (await t.state()).prompt;
    if (prompt?.kind !== "choice") break;
    for (const playerId of prompt.forPlayerIds) if ((await t.state()).prompt?.kind === "choice") messages.push(await t.send(playerId, { type: "CHOOSE", choiceId: choice }));
  }
  expect((await t.state()).sceneId).toBe("encounter_wisps");
  return messages;
}

const claimsOf = (messages: readonly ServerMessage[]) => messages.flatMap((m) => m.campClaims ?? []);

describe("befriending (§4.4, §12.2)", () => {
  it("'Come along' gives the crew the friend, saved when befriended, once by its reward id", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    const messages = await atTheShrine(t, "come");
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.friends["bun"]).toMatchObject({ rewardId: BUN.rewardId });
    expect(camp.receipts.rewards[BUN.rewardId]).toMatchObject({ runId: t.runId });
    expect(claimsOf(messages)).toEqual([{ rewardId: BUN.rewardId, kind: "friend", pieceId: "bun", result: "friend" }]);
    expect((await t.state()).campFinds).toEqual([{ kind: "friend", pieceId: "bun", rewardId: BUN.rewardId, sceneId: "scene_shrine" }]);

    // Another visit to the same place gives nothing more.
    const again = await table(harness, { ...t.home, heroes: (await t.state()).party.map((m) => m.character.id) } as Household);
    const second = await atTheShrine(again, "come");
    expect(claimsOf(second)).toEqual([{ rewardId: BUN.rewardId, kind: "friend", pieceId: "bun", result: "none" }]);
    const after = await readCamp(t.householdId, null, harness.deps);
    expect(after.receipts).toEqual(camp.receipts);
    expect(after.dashCash).toBe(camp.dashCash);
    expect(Object.keys(after.friends)).toEqual(["bun"]);
  });

  it("'Say goodbye' writes nothing, and the friend may be offered again on a later visit", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    const before = await harness.repo.getCamp(t.householdId);
    const messages = await atTheShrine(t, "goodbye");
    expect(claimsOf(messages)).toEqual([]);
    expect((await t.state()).campFinds).toBeUndefined();
    expect(await harness.repo.getCamp(t.householdId)).toEqual(before);

    const again = await table(harness, { ...t.home, heroes: (await t.state()).party.map((m) => m.character.id) } as Household);
    await atTheShrine(again, "come");
    expect((await readCamp(t.householdId, null, harness.deps)).friends).toHaveProperty("bun");
  });

  it("a friend the crew already has from another offer pays 1 Dash Cash once, as a piece does", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await mutateCamp(t.householdId, null, (c) => ({ ...c, friends: { bun: { rewardId: "first-steps-01.bun", at: AT } } }), harness.deps);
    const messages = await atTheShrine(t, "come");
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(claimsOf(messages).map((c) => c.result)).toEqual(["dashCash"]);
    expect(camp.dashCash).toBe(1);
    expect(camp.friends["bun"]).toEqual({ rewardId: "first-steps-01.bun", at: AT });
  });
});

/** Six friends: two never out, the rest out once or more. */
const SIX: Record<string, CampFriend> = {
  bun: { rewardId: "r.bun", at: "2026-10-01T00:00:00.000Z", outs: 4 },
  mosshorn: { rewardId: "r.mosshorn", at: "2026-10-02T00:00:00.000Z", outs: 2 },
  duckling: { rewardId: "r.duckling", at: "2026-10-03T00:00:00.000Z", outs: 2 },
  kid_goat: { rewardId: "r.kid_goat", at: "2026-10-04T00:00:00.000Z", outs: 1 },
  lamb: { rewardId: "r.lamb", at: "2026-10-05T00:00:00.000Z" },
  newt: { rewardId: "r.newt", at: "2026-10-06T00:00:00.000Z" },
};

async function friendlyLobby(friends = SIX) {
  const harness = harnessFor(BIG_CATALOG);
  const home = await seedHousehold(harness, 3);
  await mutateCamp(home.householdId, null, (c) => ({ ...c, friends }), harness.deps);
  const t = await table(harness, home as Household);
  for (const [i, k] of [["Sparklehoof", "unicorn", "songkeeper"], ["Thistle", "bigfoot", "thornguard"]].entries()) {
    await t.send(`p_${String(i + 1)}`, hero(k[0]!, k[1] as "unicorn", k[2] as "songkeeper"));
  }
  const party = (await t.state()).party;
  return { harness, t, ada: party[0]!.character.id, thistle: party[1]!.character.id };
}

const kitEdit = (s: RunState, characterId: string, buddy: string | null): ClientIntent => ({
  type: "KIT_EDIT",
  characterId,
  revision: s.kits?.[characterId]?.revision ?? 0,
  buddy,
});

describe("the friends out (§4.4, §12.5, §13.1)", () => {
  it("puts out at most four, those out least first, then the newest; the rest stay in the collection", async () => {
    const { t } = await friendlyLobby();
    const friends = (await t.state()).campMoment?.friends;
    expect(friends?.rotation).toEqual(["newt", "lamb", "kid_goat", "duckling", "mosshorn", "bun"]);
    expect(friends?.out).toEqual(["newt", "lamb", "kid_goat", "duckling"]);
    expect(friends?.out).toHaveLength(FRIENDS_OUT);
    // Everybody is still the crew's, out or not.
    expect(friends?.cards.map((c) => c.id).sort()).toEqual(Object.keys(SIX).sort());
    expect(friends?.cards.find((c) => c.id === "bun")).toEqual({ id: "bun", name: "Bun", figure: "cast/bun" });
  });

  it("a buddy is always out while its hero is seated, and the other seats rotate", async () => {
    const { t, ada, thistle } = await friendlyLobby();
    // Ada picks Bun, last in the rotation: Bun is out at once, and three rotate.
    await t.send("p_1", kitEdit(await t.state(), ada, "bun"));
    let s = await t.state();
    expect(s.kits?.[ada]?.buddy).toBe("bun");
    expect(s.campMoment?.friends?.out).toEqual(["bun", "newt", "lamb", "kid_goat"]);
    // Thistle picks the same buddy: shared, and the spare seat rotates as before.
    await t.send("p_2", kitEdit(s, thistle, "bun"));
    expect((await t.state()).campMoment?.friends?.out).toEqual(["bun", "newt", "lamb", "kid_goat"]);
    // Thistle picks another: both buddies out, two seats rotate.
    await t.send("p_2", kitEdit(await t.state(), thistle, "mosshorn"));
    expect((await t.state()).campMoment?.friends?.out).toEqual(["bun", "mosshorn", "newt", "lamb"]);
    // Ada is taken out of the table (#267): her buddy goes back into the rotation.
    s = await t.state();
    expect(withFriendsOut({ ...s, removed: ["p_1"] }).campMoment?.friends?.out).toEqual(["mosshorn", "newt", "lamb", "kid_goat"]);
    // Without a buddy, every seat rotates.
    await t.send("p_2", kitEdit(await t.state(), thistle, null));
    const out = (await t.state()).campMoment?.friends?.out;
    expect(out?.slice(-2)).toEqual(["lamb", "kid_goat"]);
  });

  it("keeps the buddy on the hero's kit, for this crew's camp only, and refuses a friend the crew does not have", async () => {
    const { harness, t, ada, thistle } = await friendlyLobby();
    await t.send("p_1", kitEdit(await t.state(), ada, "lamb"));
    const kit = readKit((await harness.repo.getCharacter(t.householdId, ada))!);
    expect(kit.buddies).toEqual({ [campKey(t.householdId)]: "lamb" });
    // Somebody else's hero, a friend this crew does not have, a piece: refused, and nothing written.
    expect(await t.attempt("p_2", kitEdit(await t.state(), ada, "bun"))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await t.attempt("p_2", kitEdit(await t.state(), thistle, "pepper"))).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await t.attempt("p_2", kitEdit(await t.state(), thistle, "shop_log_bench"))).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(readKit((await harness.repo.getCharacter(t.householdId, thistle))!).buddies).toEqual({});
    // At another crew's camp her buddy here does not apply.
    const elsewhere = { ...kit, buddies: { ...kit.buddies } };
    expect(elsewhere.buddies[campKey(t.householdId, "cw_2")]).toBeUndefined();
  });

  it("counts each moment's friends out once, so the rotation survives reconnects and new rooms", async () => {
    const { harness, t, ada } = await friendlyLobby();
    const moment = (await t.state()).campMoment!;
    let camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.outing).toBe(moment.id);
    expect(camp.friends["newt"]?.outs).toBe(1);
    expect(camp.friends["bun"]?.outs).toBe(4);
    // More steps in the same moment count nothing again.
    await t.send("p_1", kitEdit(await t.state(), ada, "bun"));
    await t.send("p_1", { type: "READY", ready: true });
    camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.friends["newt"]?.outs).toBe(1);
    expect(camp.friends["bun"]?.outs).toBe(4);

    // A new room, another evening: the counts carried over (newt 1, lamb 1, kid goat 2, mosshorn 2,
    // duckling 3, Bun 4), those out least come out first, and Ada's buddy with her.
    const next = await table(harness, { ...t.home, heroes: [ada] } as Household);
    const friends = (await next.state()).campMoment?.friends;
    expect(friends?.rotation).toEqual(["newt", "lamb", "kid_goat", "mosshorn", "duckling", "bun"]);
    expect(friends?.out).toEqual(["bun", "newt", "lamb", "kid_goat"]);
  });

  it("has no friends at a camp with none", async () => {
    const { t } = await friendlyLobby({});
    expect((await t.state()).campMoment?.friends).toBeUndefined();
  });
});

describe("tapping a friend (§8.5)", () => {
  it("relays the friend's words and the tapper's hero to the room, never committed", async () => {
    const { harness, t, ada } = await friendlyLobby();
    const before = await t.state();
    const heard: ChannelMessage[] = [];
    harness.channel.subscribe(t.code, (m) => heard.push(m));
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_1", friendId: "newt" }, harness.deps)).toEqual({ ok: true });
    expect(heard).toEqual([{ kind: "friendTap", seq: before.seq, runId: t.runId, friendId: "newt", heroId: ada, words: "Newt blinks." }]);
    expect(await t.state()).toEqual(before);
    expect(await harness.repo.listEvents(t.runId, before.seq)).toEqual([]);
  });

  it("refuses a friend who is not out, a kid with no hero seated, and anything that is not a friend", async () => {
    const { harness, t } = await friendlyLobby();
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_1", friendId: "bun" }, harness.deps)).toMatchObject({ code: "ILLEGAL" });
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_3", friendId: "newt" }, harness.deps)).toMatchObject({ code: "FORBIDDEN" });
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_1", friendId: { evil: true } }, harness.deps)).toMatchObject({ code: "ILLEGAL" });
  });

  it("lets a phone tap a few times a window, then asks it to wait: a hammered button is no flood", async () => {
    const { harness, t } = await friendlyLobby();
    const heard: ChannelMessage[] = [];
    harness.channel.subscribe(t.code, (m) => heard.push(m));
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await relayFriendTap({ runId: t.runId, playerId: "p_1", friendId: "lamb" }, harness.deps));
    expect(results.filter((r) => r.ok)).toHaveLength(FRIEND_TAP_LIMIT);
    expect(results.at(-1)).toMatchObject({ ok: false, status: 429, code: "SLOW_DOWN" });
    expect(heard).toHaveLength(FRIEND_TAP_LIMIT);
    // Another phone has its own count.
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_2", friendId: "lamb" }, harness.deps)).toEqual({ ok: true });
    harness.clock.advance(FRIEND_TAP_WINDOW_MS);
    expect(await relayFriendTap({ runId: t.runId, playerId: "p_1", friendId: "lamb" }, harness.deps)).toEqual({ ok: true });
  });
});
