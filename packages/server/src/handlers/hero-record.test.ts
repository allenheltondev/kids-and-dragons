/**
 * A hero's own record (#283, architecture §4.5, "Who owns what"): the
 * campaigns she has finished and her own Field Guide finds live with her, at
 * her home, whichever table she played at.
 *
 * Driven through the handlers with the real engine: Wren, from household
 * h_visit, plays a one-chapter campaign at h_test's open table. Her start
 * reveals the gate, the host's tap reveals the camp. When the chapter (and so
 * the campaign) settles, both heroes carry the campaign on their own rows,
 * and Wren's home book has her find and not the host's. Then Wren goes home
 * and starts the campaign that requires it, which her household never played.
 */

import { describe, expect, it, vi } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { ActionResponse, Campaign, Chapter, ClientIntent, RunState, WorldMap } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import type { DeviceIdentity } from "../identity.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { getJournal } from "./journal.ts";
import { removePlayer } from "./remove.ts";
import { createRoom, joinRoom } from "./room.ts";
import { setVisitors } from "./visitors.ts";

const realEngine: Engine = { applyIntent, createRunState };
const OWNER = { cognitoSub: "sub-test", email: "owner@example.com" };
const GATE = "location.visitor_gate";
const CAMP = "location.warm_hollow";
const BIOME = "biome.enchanted_woods";

/** A gate (the start reveals it), a camp (whoever taps in reveals it), and out. Rest scenes, so anyone may tap. */
function gemsChapter(): Chapter {
  return {
    ...makeChapter(),
    id: "gems-01",
    campaignId: "gems",
    index: 1,
    title: "Falling Stones",
    xpAward: 300,
    entry: "scene_gate",
    scenes: {
      scene_gate: {
        type: "rest",
        narration: "A gate in the hedge.",
        discovers: [GATE],
        choices: [{ id: "in", label: "Go in", icon: "arrow", goto: "scene_camp" }],
      },
      scene_camp: {
        type: "rest",
        narration: "A warm hollow.",
        discovers: [CAMP],
        choices: [{ id: "on", label: "Onward", icon: "arrow", goto: "scene_end" }],
      },
      scene_end: { type: "story", narration: "Home again.", choices: [] },
    },
  };
}

const GEMS: Campaign = { id: "gems", title: "Gems", blurb: "Stones fall.", chapters: ["gems-01"] };
const RIFT: Campaign = {
  id: "rift",
  title: "Rift",
  blurb: "The ground opens.",
  chapters: ["rift-01"],
  requires: ["gems"],
};
const world = { places: { enchanted_woods: { id: BIOME } } } as unknown as WorldMap;

function hero(name: string): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name,
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  };
}

async function household(harness: TestHarness, id: string, players: string[]): Promise<DeviceIdentity[]> {
  await harness.repo.putHousehold({
    id,
    displayName: id,
    ownerSub: null,
    guest: true,
    expiresAt: new Date(harness.clock.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(harness.clock.now()).toISOString(),
  } as never);
  const out: DeviceIdentity[] = [];
  for (const playerId of players) {
    await harness.repo.putPlayer({ id: playerId, householdId: id, displayName: playerId, color: "#E8A33D" });
    const { deviceId } = await harness.identity.issueDeviceToken({ householdId: id, playerId });
    out.push({ deviceId, householdId: id, playerId });
  }
  return out;
}

/** A room in `householdId` for `campaignId`, and a way to act in it. */
async function table(harness: TestHarness, householdId: string, campaignId: string, host: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "travel", campaignId, hostDeviceId: host.deviceId }, harness.deps);
  if (!created.ok) throw new Error(created.error.message);
  const { code, runId } = created.value;
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const act = async (who: DeviceIdentity, intent: ClientIntent): Promise<ActionResponse> =>
    applyAction({ runId, playerId: who.playerId, seq: (await state()).seq, intent, principal: who }, harness.deps);
  const must = async (who: DeviceIdentity, intent: ClientIntent) => {
    const response = await act(who, intent);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
  };
  return { code, runId, state, act, must };
}

/** Wren visits h_test's table and finishes Gems there; Wren's start reveals the gate, the host's tap the camp. */
async function wrenFinishesGemsAway() {
  const harness = makeHarness({
    engine: realEngine,
    content: makeContent({
      chapters: [gemsChapter(), { ...gemsChapter(), id: "rift-01", campaignId: "rift", title: "The Crack" }],
      campaigns: [GEMS, RIFT],
      world,
    }),
  });
  const { householdId, players } = await seedHousehold(harness, 1);
  const host = players[0]!.principal;
  await harness.repo.putAccountPointer(OWNER.cognitoSub, householdId);
  const [wren] = await household(harness, "h_visit", ["p_wren"]);

  const away = await table(harness, householdId, "gems", host);
  expect(await joinRoom({ code: away.code, principal: host }, harness.deps)).toMatchObject({ ok: true });
  const opened = await setVisitors({ ...OWNER, code: away.code, open: true }, harness.deps);
  if (!opened.ok || !opened.value.visitorCode) throw new Error("open");
  const joined = await joinRoom({ code: away.code, principal: wren!, visitorCode: opened.value.visitorCode }, harness.deps);
  expect(joined).toMatchObject({ ok: true });

  await away.must(host, hero("Pip"));
  await away.must(wren!, hero("Moonpetal"));
  await away.must(host, { type: "READY", ready: true });
  await away.must(wren!, { type: "READY", ready: true });
  await away.must(wren!, { type: "CONTINUE_CAMPAIGN" });
  expect((await away.state()).chapterId).toBe("gems-01");
  await away.must(host, { type: "CHOOSE", choiceId: "in" });
  harness.clock.advance(60_000);
  await away.must(wren!, { type: "CHOOSE", choiceId: "on" });
  expect((await away.state()).phase).toBe("chapter_complete");

  const party = (await away.state()).party;
  const wrenHero = party.find((m) => m.playerId === wren!.playerId)!.character.id;
  const pipHero = party.find((m) => m.playerId === host.playerId)!.character.id;
  return { harness, householdId, host, wren: wren!, wrenHero, pipHero };
}

describe("a visiting hero finishes a campaign at another household's table (#283)", () => {
  it("puts the campaign on her own row at home, and the table keeps its save", async () => {
    const { harness, householdId, wrenHero, pipHero } = await wrenFinishesGemsAway();

    const wren = await harness.repo.getCharacter("h_visit", wrenHero);
    expect(wren?.provisional ?? null).toBeNull();
    expect(wren?.finished).toEqual([
      { campaignId: "gems", outcome: "success", at: expect.any(String), table: householdId },
    ]);
    // Nothing of hers in the host's household, and the save is the table's.
    expect(await harness.repo.getCharacter(householdId, wrenHero)).toBeNull();
    expect((await harness.repo.getCampaignProgress(householdId, "gems"))?.status).toBe("complete");
    expect(await harness.repo.getCampaignProgress("h_visit", "gems")).toBeNull();

    // The host's own hero, at home, gets the same line, naming its own table.
    expect((await harness.repo.getCharacter(householdId, pipHero))?.finished).toEqual([
      { campaignId: "gems", outcome: "success", at: expect.any(String), table: householdId },
    ]);
  });

  it("puts her own finds in her home book, credited to her, and nobody else's", async () => {
    const { harness, householdId, host, wren } = await wrenFinishesGemsAway();

    const table = (await harness.repo.getFieldGuide(householdId)).entries;
    expect(table[GATE]).toMatchObject({ firstFoundBy: wren.playerId });
    expect(table[CAMP]).toMatchObject({ firstFoundBy: host.playerId });

    // Her start revealed the woods and the gate: hers. The camp was the host's tap: not hers.
    const home = (await harness.repo.getFieldGuide("h_visit")).entries;
    expect(Object.keys(home).sort()).toEqual([BIOME, GATE].sort());
    expect(home[GATE]).toMatchObject({ firstFoundBy: wren.playerId });
    expect(home[BIOME]).toMatchObject({ firstFoundBy: wren.playerId });
  });

  it("shows on her adventure book at home", async () => {
    const { harness, wren, wrenHero } = await wrenFinishesGemsAway();
    const journal = await getJournal({ householdId: "h_visit", playerId: wren.playerId }, harness.deps);
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value.finished).toEqual({
      [wrenHero]: [{ campaignId: "gems", title: "Gems", outcome: "success", at: expect.any(String) }],
    });
    expect(Object.keys(journal.value.fieldGuide)).toContain(GATE);
  });

  it("any hero in a mixed party meets the prerequisite: her home never played it, her sister never did, and with Wren seated it opens", async () => {
    const { harness, wren, wrenHero } = await wrenFinishesGemsAway();
    const [sis] = await (async () => {
      await harness.repo.putPlayer({ id: "p_sis", householdId: "h_visit", displayName: "Sis", color: "#7FD4C1" });
      const { deviceId } = await harness.identity.issueDeviceToken({ householdId: "h_visit", playerId: "p_sis" });
      return [{ deviceId, householdId: "h_visit", playerId: "p_sis" }];
    })();

    // Her sister alone, with a new hero: h_visit has never finished Gems.
    const alone = await table(harness, "h_visit", "rift", sis!);
    await joinRoom({ code: alone.code, principal: sis! }, harness.deps);
    await alone.must(sis!, hero("Bramble"));
    await alone.must(sis!, { type: "READY", ready: true });
    expect((await alone.state()).campaignOptions?.[0]?.locked?.reason).toBe("Finish Gems first");
    expect(await alone.act(sis!, { type: "CONTINUE_CAMPAIGN" })).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });

    // Wren sits down with the hero who finished it away: the lobby unlocks, and Begin starts Rift.
    await joinRoom({ code: alone.code, principal: wren }, harness.deps);
    await alone.must(wren, { type: "SEAT_CHARACTER", characterId: wrenHero });
    expect((await alone.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
    expect((await alone.state()).campaign?.locked).toBeUndefined();
    await alone.must(wren, { type: "READY", ready: true });
    await alone.must(sis!, { type: "CONTINUE_CAMPAIGN" });
    expect((await alone.state()).chapterId).toBe("rift-01");
    expect((await harness.repo.getCampaignProgress("h_visit", "rift"))?.status).toBe("active");
  });
});

describe("a hero who is taken out does not carry the table (#283)", () => {
  /** Wren home again, seated beside her sister, with Rift open because of her. */
  async function wrenAtHome() {
    const run = await wrenFinishesGemsAway();
    const { harness, wren, wrenHero } = run;
    await harness.repo.putPlayer({ id: "p_sis", householdId: "h_visit", displayName: "Sis", color: "#7FD4C1" });
    const { deviceId } = await harness.identity.issueDeviceToken({ householdId: "h_visit", playerId: "p_sis" });
    const sis: DeviceIdentity = { deviceId, householdId: "h_visit", playerId: "p_sis" };
    const home = await table(harness, "h_visit", "rift", sis);
    await joinRoom({ code: home.code, principal: sis }, harness.deps);
    await home.must(sis, hero("Bramble"));
    await joinRoom({ code: home.code, principal: wren }, harness.deps);
    await home.must(wren, { type: "SEAT_CHARACTER", characterId: wrenHero });
    await home.must(sis, { type: "READY", ready: true });
    await home.must(wren, { type: "READY", ready: true });
    expect((await home.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
    return { ...run, sis, home };
  }

  it("locks again when the host removes the only hero who finished it, and Begin is refused", async () => {
    const { harness, wren, sis, home } = await wrenAtHome();
    expect(await removePlayer({ code: home.code, principal: sis, playerId: wren.playerId }, harness.deps)).toMatchObject({ ok: true });

    // She is still in `party`, disconnected and on `removed`: the lobby says locked again.
    const s = await home.state();
    expect(s.party.some((m) => m.playerId === wren.playerId)).toBe(true);
    expect(s.campaignOptions?.[0]?.locked?.reason).toBe("Finish Gems first");
    expect(s.campaign?.locked?.reason).toBe("Finish Gems first");
    expect(await home.act(sis, { type: "CONTINUE_CAMPAIGN" })).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await home.act(sis, { type: "START_CHAPTER", chapterId: "rift-01" })).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await harness.repo.getCampaignProgress("h_visit", "rift")).toBeNull();
  });

  it("is refused by the server even on a lobby that still shows it open", async () => {
    // The authority is the start's own read, not the lobby: a lobby that
    // missed the relock (a stale screen, a write that lost) still cannot Begin.
    const { harness, wren, sis, home } = await wrenAtHome();
    const open = await home.state();
    await harness.repo.putState({
      ...open,
      removed: [wren.playerId],
      party: open.party.map((m) => (m.playerId === wren.playerId ? { ...m, connected: false, ready: false } : m)),
    });
    expect((await home.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
    const begin = await home.act(sis, { type: "CONTINUE_CAMPAIGN" });
    expect(begin).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(begin.ok ? "" : begin.error?.message).toContain("Finish Gems first");
  });

  it("still counts her while she is only disconnected: a dropped phone is not leaving", async () => {
    const { harness, wren, sis, home } = await wrenAtHome();
    const open = await home.state();
    await harness.repo.putState({
      ...open,
      party: open.party.map((m) => (m.playerId === wren.playerId ? { ...m, connected: false } : m)),
    });
    await home.must(sis, { type: "CONTINUE_CAMPAIGN" });
    expect((await home.state()).chapterId).toBe("rift-01");
  });
});

describe("what is not hers, and what does not change (#283)", () => {
  it("records nothing for a campaign that failed: that leaves a souvenir, not a finish", async () => {
    const { harness, householdId, players } = await (async () => {
      // The same chapter, ending in a setback (the Last Ring's kind of ending).
      const lost = gemsChapter();
      lost.scenes["scene_end"] = { type: "story", narration: "The stones roll away.", outcome: "setback", choices: [] };
      const harness = makeHarness({ engine: realEngine, content: makeContent({ chapters: [lost], campaigns: [GEMS], world }) });
      return { harness, ...(await seedHousehold(harness, 1)) };
    })();
    const me = players[0]!.principal;
    const t = await table(harness, householdId, "gems", me);
    await joinRoom({ code: t.code, principal: me }, harness.deps);
    await t.must(me, hero("Pip"));
    const heroId = (await t.state()).party[0]!.character.id;
    // Two setbacks behind it already: a setback ending now reaches the limit.
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "gems",
      status: "active",
      setbacks: 2,
      lastIndex: 0,
      updatedAt: new Date(harness.clock.now()).toISOString(),
    });
    await t.must(me, { type: "READY", ready: true });
    await t.must(me, { type: "CONTINUE_CAMPAIGN" });
    await t.must(me, { type: "CHOOSE", choiceId: "in" });
    await t.must(me, { type: "CHOOSE", choiceId: "on" });
    expect((await harness.repo.getCampaignProgress(householdId, "gems"))?.status).toBe("failed");
    const row = await harness.repo.getCharacter(householdId, heroId);
    expect(row?.souvenirs.length).toBeGreaterThan(0);
    expect(row).not.toHaveProperty("finished");
  });

  it("reads no hero when no campaign on offer has a prerequisite, as at a Gemfall table", async () => {
    const harness = makeHarness({ engine: realEngine, content: makeContent({ chapters: [gemsChapter()], campaigns: [GEMS], world }) });
    const { householdId, players } = await seedHousehold(harness, 1);
    const me = players[0]!.principal;
    const t = await table(harness, householdId, "gems", me);
    await joinRoom({ code: t.code, principal: me }, harness.deps);
    // The relock's reads: the household's attempts and the party's heroes. The
    // create's own check for an existing row is the only hero read.
    const attempts = vi.spyOn(harness.repo, "listCampaignProgress");
    const heroes = vi.spyOn(harness.repo, "getCharacter");
    await t.must(me, hero("Pip"));
    expect(attempts).not.toHaveBeenCalled();
    expect(heroes).toHaveBeenCalledTimes(1);
    expect((await t.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
  });
});
