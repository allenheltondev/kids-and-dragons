/**
 * The camp in the adventure book (#629; docs/camp.md §7, §12.6, §13.1): the
 * journal carries each crew's camp and her heroes' kits; the book's write path
 * is authorised by the phone's device binding, changes only the bound kid's own
 * heroes, by the table's rule and revision check, with a buddy only from the
 * crew's friends; a queued change merges field by field; and a book edit and a
 * table edit racing for one hero never lose a write.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, campKey, createRunState, readKit } from "@kad/shared";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { BookKitResponse, CampRecord, ClientIntent, RunState } from "@kad/shared";
import { CATALOG, harnessFor, racedCommits, seeded, table, type Table } from "./camp-table.testing.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { createRoom } from "./room.ts";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { mutateCamp, mutateKit } from "./camp.ts";
import { editKitFromBook, heroCrews, offerPlace } from "./camp-book.ts";
import { getJournal } from "./journal.ts";
import { applyAction } from "./action.ts";
import { respond, type HttpRuntime } from "../lambda/http.ts";
import type { HandlerDeps } from "./deps.ts";
import { loadContent } from "../content/loader.ts";

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

const AT = "2026-11-01T00:00:00.000Z";

async function seedCamp(householdId: string, harness: TestHarness, over: Partial<CampRecord>, crew: string | null = null): Promise<void> {
  const written = await mutateCamp(householdId, crew, (c) => seeded(c, over), harness.deps);
  expect(written.ok).toBe(true);
}

/** Two kids' heroes seated in the lobby, at a camp with a friend found at Ashspan Bridge and a bought awning. */
async function lobby(): Promise<{ harness: TestHarness; t: Table; p1: string; p2: string }> {
  const harness = harnessFor(CATALOG);
  const t = await table(harness);
  await seedCamp(t.householdId, harness, {
    owned: {
      shop_striped_awning: { from: "bought", at: AT },
      find_picnic_blanket: { from: "found", rewardId: "first-steps-01.picnic_blanket", at: AT },
    },
    friends: { duckling: { rewardId: "riftlight-ashspan-bridge.duckling", at: AT } },
  });
  await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
  await t.send("p_2", hero("Thistle", "bigfoot", "thornguard"));
  const party = (await t.state()).party;
  return { harness, t, p1: party[0]!.character.id, p2: party[1]!.character.id };
}

async function book(deps: HandlerDeps, householdId: string, playerId: string, body: Record<string, unknown>) {
  return editKitFromBook({ householdId, playerId, body }, deps);
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("the book's camp read (§7)", () => {
  it("carries the first crew's camp, its friends with their words and where everything came from, and her own heroes' kits", async () => {
    const { harness, t, p1, p2 } = await lobby();
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, style: "quilted", buddy: "duckling" });
    const journal = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    const camp = journal.camp!;
    expect(camp.crews).toHaveLength(1);
    const first = camp.crews[0]!;
    expect(first).toMatchObject({ crew: null, name: "The first crew" });
    expect(first.camp.owned).toEqual(["find_picnic_blanket", "shop_striped_awning"]);
    expect(first.sources).toMatchObject({ shop_striped_awning: "Bought with Dash Cash", kept_crew_banner: "Your crew's very own" });
    // A stage-1 camp has no cookfire yet, so nothing says where one came from.
    expect(first.sources["cookfire_pot"]).toBeUndefined();
    expect(first.sources["find_picnic_blanket"]).toMatch(/^Found in /);
    expect(first.friends).toEqual([
      expect.objectContaining({ id: "duckling", name: "Duckling", source: "Met on an adventure", reactions: expect.arrayContaining([expect.any(String)]) }),
    ]);
    // Only her own heroes, and her buddy kept for this crew ("" is the first crew).
    expect(Object.keys(camp.kits)).toEqual([p1]);
    expect(camp.kits[p1]).toMatchObject({ revision: 1, style: "quilted", buddies: { "": "duckling" } });
    expect(camp.kits[p2]).toBeUndefined();
  });

  it("says a failed camp read apart from no camp at all, so the phone keeps the camp it saved (#656)", async () => {
    const { harness, t, p1 } = await lobby();
    const broken = { ...harness.deps, repo: new Proxy(harness.repo, {
      get(target, prop) {
        if (prop === "getCamp") return () => Promise.reject(new Error("the camp table is not answering"));
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) };
    const failed = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, broken));
    expect(failed.camp).toBeUndefined();
    expect(failed.campError).toBe(true);
    // The rest of the book is whole.
    expect(failed.heroes.map((h) => h.id)).toEqual([p1]);

    // Content with no camp: no camp, and nothing to say about it.
    const none = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, { ...harness.deps, content: { ...harness.deps.content, campCatalog: () => null } }));
    expect(none.camp).toBeUndefined();
    expect(none.campError).toBeUndefined();
    // And a read that works carries the camp, with no marker.
    const fine = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    expect(fine.camp).toBeDefined();
    expect(fine.campError).toBeUndefined();
  });

  it("names a graph campaign's place, and a chapter told in order by its title", async () => {
    const content = await loadContent();
    const catalog = content.campCatalog()!;
    expect(offerPlace("riftlight-ashspan-bridge.duckling", catalog, content)).toBe("at the Ashspan Bridge");
    expect(offerPlace("riftlight-exchange-rift.noodle_awning", catalog, content)).toBe("at the Exchange Rift");
    expect(offerPlace("riftlight-glacier-survival.kid_goat", catalog, content)).toBe("at the Glacier of Origins");
    expect(offerPlace("first-steps-01.picnic_blanket", catalog, content)).toBe("in “The Practice Meadow”");
    expect(offerPlace("gemfall-02.otter", catalog, content)).toBe("in “Green Roads North”");
    expect(offerPlace("nobody.ever", catalog, content)).toBeNull();
  });

  it("lists the crew of every hero of hers: two heroes in different crews are both listed, and a crew none of them sat with is not", async () => {
    const { harness, t, p1 } = await lobby();
    const addCrew = async (id: string, name: string) => {
      const s = await t.state();
      await harness.repo.commit({
        runId: t.runId,
        expectedSeq: s.seq,
        state: { ...s, seq: s.seq + 1 },
        event: { seq: s.seq + 1, runId: t.runId, patch: [], at: AT },
        crew: { householdId: t.householdId, id, name, createdAt: AT },
      });
    };
    await addCrew("cw_1", "The Otter Crew");
    await addCrew("cw_2", "The Lantern Crew");
    // Her second hero is on the Otter Crew's adventure (her claim names the crew).
    const second = makeCharacter({ id: "c_second", ownerPlayerId: "p_1", name: "Bramble" });
    await harness.repo.putCharacter({ ...second, householdId: t.householdId, provisional: { ...second.committed, runId: "gemfall~cw_1" } });
    await seedCamp(t.householdId, harness, { friends: { kid_goat: { rewardId: "riftlight-glacier-survival.kid_goat", at: AT } } }, "cw_1");
    // Her brother's hero is on the Lantern Crew's; that is not one of hers.
    const his = makeCharacter({ id: "c_his", ownerPlayerId: "p_2", name: "Rumble" });
    await harness.repo.putCharacter({ ...his, householdId: t.householdId, provisional: { ...his.committed, runId: "gemfall~cw_2" } });

    let journal = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    // Sparklehoof is seated at the first crew's table (the run's party); Bramble is the Otter Crew's.
    expect(journal.camp!.crews.map((c) => [c.crew, c.name])).toEqual([[null, "The first crew"], ["cw_1", "The Otter Crew"]]);
    expect(Object.keys(journal.camp!.kits).sort()).toEqual(["c_second", p1].sort());
    // The fixture content has no Glacier chapter to name, so it says no more than that.
    expect(journal.camp!.crews[1]!.friends.map((f) => [f.id, f.source])).toEqual([["kid_goat", "Met on an adventure"]]);
    expect(journal.camp!.crews[0]!.friends.map((f) => f.id)).toEqual(["duckling"]);

    // A buddy picked in the Lantern Crew's camp makes it one of hers too.
    await mutateKit(t.householdId, "c_second", (kit) => ({ ...kit, buddies: { [campKey(t.householdId, "cw_2")]: "bun" } }), harness.deps);
    journal = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    expect(journal.camp!.crews.map((c) => c.crew)).toEqual([null, "cw_1", "cw_2"]);
    expect(journal.camp!.kits["c_second"]!.buddies).toEqual({ cw_2: "bun" });

    // Her brother's book lists his heroes' crews: the table's, and the Lantern Crew's.
    const histories = value(await getJournal({ householdId: t.householdId, playerId: "p_2" }, harness.deps));
    expect(histories.camp!.crews.map((c) => c.crew)).toEqual([null, "cw_2"]);
  });

  it("records the crew a hero is seated with on her kit, with the run commit that writes her row", async () => {
    const { harness, t, p1 } = await lobby();
    // Made at the first crew's table: her creation's own write carries it.
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!).crews).toEqual([t.householdId]);
    // A KIT_EDIT at that table writes her row again, and adds nothing twice.
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, color: "rose" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 1, crews: [t.householdId] });
  });

  it("still lists a crew she was seated with long ago, after 50 and more later runs elsewhere", async () => {
    const harness = harnessFor(CATALOG);
    const household = await seedHousehold(harness, 1);
    const { householdId } = household;
    const t = await table(harness, household);
    // Long ago she sat with the Otter Crew; that commit recorded it on her kit.
    const s = await t.state();
    await harness.repo.commit({
      runId: t.runId,
      expectedSeq: s.seq,
      state: { ...s, seq: s.seq + 1 },
      event: { seq: s.seq + 1, runId: t.runId, patch: [], at: AT },
      crew: { householdId, id: "cw_1", name: "The Otter Crew", createdAt: AT },
    });
    const pip = makeCharacter({ id: "c_pip", ownerPlayerId: "p_1", name: "Pip" });
    const kit = { ...readKit(pip), crews: [campKey(householdId, "cw_1"), householdId] };
    await harness.repo.putCharacter({ ...pip, householdId, kit });
    // Since then, 55 evenings with the first crew.
    for (let i = 0; i < 55; i++) {
      const room = await createRoom({ householdId, mode: "travel" }, harness.deps);
      if (!room.ok) throw new Error("room");
      const state = (await harness.repo.getState(room.value.runId))!;
      await harness.repo.putState({ ...state, party: [{ character: { id: "c_pip" } as never, playerId: "p_1", hp: 1, down: false, connected: true, ready: false }] });
      const run = (await harness.repo.getRun(room.value.runId))!;
      await harness.repo.putRun({ ...run, createdAt: new Date(Date.parse("2026-12-01T00:00:00.000Z") + i * 60_000).toISOString() });
    }
    const hero = (await harness.repo.getCharacter(householdId, "c_pip"))!;
    expect(await heroCrews(householdId, [hero], harness.deps)).toEqual([null, "cw_1"]);
    const journal = value(await getJournal({ householdId, playerId: "p_1" }, harness.deps));
    expect(journal.camp!.crews.map((c) => c.name)).toEqual(["The first crew", "The Otter Crew"]);
  });

  it("backfills a hero with no recorded crews (a kit from before v4) from the runs she sat in, and one who has sat with nobody gets the first crew", async () => {
    const harness = harnessFor(CATALOG);
    const household = await seedHousehold(harness, 1);
    const { householdId } = household;
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_new", ownerPlayerId: "p_1", name: "Pip" }), householdId });
    const pip = (await harness.repo.getCharacter(householdId, "c_new"))!;
    expect(await heroCrews(householdId, [pip], harness.deps)).toEqual([null]);

    const t = await table(harness, household);
    const s = await t.state();
    await harness.repo.commit({
      runId: t.runId,
      expectedSeq: s.seq,
      state: { ...s, seq: s.seq + 1, crew: "cw_1", visited: ["opening"], party: [{ character: { id: "c_new" } as never, playerId: "p_1", hp: 1, down: false, connected: true, ready: false }] },
      event: { seq: s.seq + 1, runId: t.runId, patch: [], at: AT },
      crew: { householdId, id: "cw_1", name: "The Otter Crew", createdAt: AT },
    });
    expect(await heroCrews(householdId, [pip], harness.deps)).toEqual(["cw_1"]);
  });

  it("does not backfill a crew whose lobby she only visited, or one she left before it played (#656)", async () => {
    const harness = harnessFor(CATALOG);
    const household = await seedHousehold(harness, 1);
    const { householdId } = household;
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_new", ownerPlayerId: "p_1", name: "Pip" }), householdId });
    const pip = (await harness.repo.getCharacter(householdId, "c_new"))!;
    const seat = { character: { id: "c_new" } as never, playerId: "p_1", hp: 1, down: false, connected: true, ready: false };
    const runs: [string, string, Partial<RunState>][] = [
      // Sat in the Otter Crew's lobby, and no chapter ever began.
      ["cw_1", "The Otter Crew", { phase: "lobby", chapterId: null, visited: [] }],
      // Sat in the Lantern Crew's, left, and they played on without her.
      ["cw_2", "The Lantern Crew", { phase: "scene", visited: ["opening"], removed: ["p_1"] }],
    ];
    for (const [id, name, played] of runs) {
      const room = await createRoom({ householdId, mode: "travel" }, harness.deps);
      if (!room.ok) throw new Error("room");
      const s = (await harness.repo.getState(room.value.runId))!;
      await harness.repo.commit({
        runId: room.value.runId,
        expectedSeq: s.seq,
        state: { ...s, ...played, seq: s.seq + 1, crew: id, party: [seat] },
        event: { seq: s.seq + 1, runId: room.value.runId, patch: [], at: AT },
        crew: { householdId, id, name, createdAt: AT },
      });
    }
    expect(await heroCrews(householdId, [pip], harness.deps)).toEqual([null]);
  });
});

describe("a hero from before kit v4: her first record keeps the backfill (#629, #656)", () => {
  /**
   * A household with the Otter Crew (cw_1) and the Lantern Crew (cw_2), and
   * her v3 hero Pip (no `crews` on her kit) who sat at a past run of each.
   */
  async function legacy() {
    const harness = harnessFor(CATALOG);
    const household = await seedHousehold(harness, 1);
    const { householdId } = household;
    const pip = makeCharacter({ id: "c_pip", ownerPlayerId: "p_1", name: "Pip" });
    const { crews: _none, ...v3 } = readKit(pip);
    await harness.repo.putCharacter({ ...pip, householdId, kit: v3 });
    for (const [i, [id, name]] of [["cw_1", "The Otter Crew"], ["cw_2", "The Lantern Crew"]].entries()) {
      const room = await createRoom({ householdId, mode: "travel" }, harness.deps);
      if (!room.ok) throw new Error("room");
      const s = (await harness.repo.getState(room.value.runId))!;
      await harness.repo.commit({
        runId: room.value.runId,
        expectedSeq: s.seq,
        state: { ...s, seq: s.seq + 1, crew: id!, visited: ["opening"], party: [{ character: { id: "c_pip" } as never, playerId: "p_1", hp: 1, down: false, connected: true, ready: false }] },
        event: { seq: s.seq + 1, runId: room.value.runId, patch: [], at: AT },
        crew: { householdId, id: id!, name: name!, createdAt: AT },
      });
      const run = (await harness.repo.getRun(room.value.runId))!;
      await harness.repo.putRun({ ...run, createdAt: new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 60_000).toISOString() });
    }
    const crewsOf = async () => readKit((await harness.repo.getCharacter(householdId, "c_pip"))!).crews;
    /** Her book's crews, read with the household's runs out of reach: only her kit's record can name them. */
    const listedWithoutScan = async () => {
      const noRuns = { ...harness.deps, repo: new Proxy(harness.repo, {
        get(target, prop) {
          if (prop === "listRuns") return () => Promise.reject(new Error("the backfill read runs"));
          const v: unknown = Reflect.get(target, prop, target);
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }) };
      return heroCrews(householdId, [(await harness.repo.getCharacter(householdId, "c_pip"))!], noRuns);
    };
    return { harness, household, householdId, crewsOf, listedWithoutScan };
  }

  /** A table of the household's playing as `crew`, Pip seated at it. */
  async function seatedAt(harness: TestHarness, household: Awaited<ReturnType<typeof seedHousehold>>, crew: string): Promise<Table> {
    const t = await table(harness, household);
    const s = await t.state();
    await harness.repo.putState({ ...s, crew });
    await t.send("p_1", { type: "SEAT_CHARACTER", characterId: "c_pip" });
    return t;
  }

  it("a seated KIT_EDIT in the Otter Crew keeps the Lantern Crew in her book", async () => {
    const { harness, household, householdId, crewsOf, listedWithoutScan } = await legacy();
    const before = value(await getJournal({ householdId, playerId: "p_1" }, harness.deps));
    expect(before.camp!.crews.map((c) => c.crew)).toEqual(["cw_1", "cw_2"]);

    const t = await seatedAt(harness, household, "cw_1");
    // A lobby seat writes no row, so the KIT_EDIT is her first v4 write.
    expect(await crewsOf()).toBeUndefined();
    await t.send("p_1", { type: "KIT_EDIT", characterId: "c_pip", revision: 0, color: "rose" });

    expect(new Set(await crewsOf())).toEqual(new Set([campKey(householdId, "cw_1"), campKey(householdId, "cw_2")]));
    const after = value(await getJournal({ householdId, playerId: "p_1" }, harness.deps));
    expect(after.camp!.crews.map((c) => c.crew)).toEqual(["cw_1", "cw_2"]);
    expect(await listedWithoutScan()).toEqual(["cw_1", "cw_2"]);
  });

  it("her chapter's start in the Otter Crew, the first write of her row, keeps the Lantern Crew too, and a new hero's creation reads no runs", async () => {
    const { harness, household, householdId, crewsOf, listedWithoutScan } = await legacy();
    const seated = await seatedAt(harness, household, "cw_1");
    // A lobby seat alone writes no row (§11), so nothing is recorded yet.
    expect(await crewsOf()).toBeUndefined();
    await seated.send("p_1", { type: "READY", ready: true });
    await seated.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    expect(new Set(await crewsOf())).toEqual(new Set([campKey(householdId, "cw_1"), campKey(householdId, "cw_2")]));
    expect(await listedWithoutScan()).toEqual(["cw_1", "cw_2"]);

    // A hero made at a table has no past: her record is that table's crew alone.
    const t = await table(harness, household);
    await harness.repo.putState({ ...(await t.state()), crew: "cw_2" });
    await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
    const made = (await t.state()).party.find((m) => m.character.name === "Sparklehoof")!.character.id;
    expect(readKit((await harness.repo.getCharacter(householdId, made))!).crews).toEqual([campKey(householdId, "cw_2")]);
  });
});

describe("the book's kit write (§7, §12.6)", () => {
  it("changes her own hero's kit, and the table reads it at its next downtime moment", async () => {
    const { harness, t, p1 } = await lobby();
    const done = value(
      await book(harness.deps, t.householdId, "p_1", {
        characterId: p1,
        changes: [
          { field: "tent", before: null, after: "patched" },
          { field: "color", before: null, after: "rose" },
          { field: "slot0", before: null, after: "deco_bunting" },
        ],
      }),
    );
    expect(done).toMatchObject({ applied: ["tent", "color", "slot0"], refused: [], kit: { revision: 1, tent: "patched", color: "rose", slots: ["deco_bunting", null] } });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 1, tent: "patched", color: "rose" });

    // Made over an older kit, it applies all the same: the device wins (§11).
    const older = value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "color", before: null, after: "tide" }] }));
    expect(older).toMatchObject({ applied: ["color"], refused: [], kit: { revision: 2, color: "tide", tent: "patched" } });

    // The live room keeps the kit it read for this moment, and reads it afresh at the next one.
    expect((await t.state()).kits?.[p1]?.color).toBeNull();
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    await t.goto("scene_camp");
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 2, tent: "patched", color: "tide" });
  });

  it("keeps a milestone tent picked in the book when the table's welcome card picks a style from the kit it read before", async () => {
    const { harness, t, p1 } = await lobby();
    const row = (await harness.repo.getCharacter(t.householdId, p1))!;
    await harness.repo.putCharacter({ ...row, committed: { ...row.committed, tier: "sworn" } });
    // The table read her kit as the lobby began: nothing picked, so her phone offers the welcome card.
    const shown = (await t.state()).kits?.[p1];
    expect(shown).toMatchObject({ style: null, tent: null });
    value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "tent", before: null, after: "sworn" }] }));

    // The card sends the style and color she tapped, from the kit it still shows (CampPanel.tsx `KitWelcome`).
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: shown!.revision, style: "rolled", color: "rose" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ tent: "sworn", style: "rolled", color: "rose" });
  });

  it("refuses another kid's hero, a hero she does not have, and a phone with no binding", async () => {
    const { harness, t, p2 } = await lobby();
    const theirs = await book(harness.deps, t.householdId, "p_1", { characterId: p2, changes: [{ field: "color", before: null, after: "rose" }] });
    expect(theirs).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const nobody = await book(harness.deps, t.householdId, "p_1", { characterId: "c_nobody", changes: [{ field: "color", before: null, after: "rose" }] });
    expect(nobody).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getCharacter(t.householdId, p2))?.kit).toMatchObject({ revision: 0, color: null });
  });

  it("refuses what the table refuses: a friend the crew lacks, a crew piece, a locked tent, a malformed change", async () => {
    const { harness, t, p1 } = await lobby();
    const lacking = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "buddy", before: null, after: "bun" }] });
    expect(lacking).toMatchObject({ ok: false, error: { code: "ILLEGAL", message: expect.stringContaining("not one of this crew's friends") } });
    const crewPiece = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "slot0", before: null, after: "shop_log_bench" }] });
    expect(crewPiece).toMatchObject({ ok: false, error: { message: expect.stringContaining("not hers to hang") } });
    const locked = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "tent", before: null, after: "mythic" }] });
    expect(locked).toMatchObject({ ok: false, error: { message: expect.stringContaining("not hers to pick") } });
    for (const body of [
      { changes: [{ field: "color", before: null, after: "rose" }] }, // no hero
      { characterId: p1, merge: "yes", changes: [{ field: "color", before: null, after: "rose" }] },
      { characterId: p1, changes: [] },
      { characterId: p1, changes: [{ field: "hat", before: null, after: "x" }] },
      { characterId: p1, changes: [{ field: "color", before: null, after: "rose" }, { field: "color", before: null, after: "tide" }] },
      { characterId: p1, crew: "cw_nope", changes: [{ field: "buddy", before: null, after: "duckling" }] },
    ]) {
      expect((await book(harness.deps, t.householdId, "p_1", body)).ok, JSON.stringify(body)).toBe(false);
    }
    // Her buddy, from the crew's own friends, is fine.
    expect(value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "buddy", before: null, after: "duckling" }] })).kit.buddies).toEqual({ "": "duckling" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!).buddies).toEqual({ [campKey(t.householdId)]: "duckling" });
  });

  it("applies a queued change over the newer values a table set meanwhile (the device wins), skipping a pick that is not hers", async () => {
    const { harness, t, p1 } = await lobby();
    // Meanwhile, at the table: her tent.
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, tent: "rolled" });
    const merged = value(
      await book(harness.deps, t.householdId, "p_1", {
        characterId: p1,
        merge: true,
        changes: [
          { field: "tent", before: null, after: "patched" },
          { field: "color", before: null, after: "rose" },
          { field: "slot1", before: null, after: "deco_pinwheel" },
          { field: "buddy", before: null, after: "bun" },
        ],
      }),
    );
    expect(merged).toMatchObject({ applied: ["tent", "color", "slot1"], refused: ["buddy"] });
    expect(merged.kit).toMatchObject({ revision: 2, tent: "patched", color: "rose", slots: [null, "deco_pinwheel"], buddies: {} });

    // A decoration moved from one spot to the other never meets itself.
    const moved = value(
      await book(harness.deps, t.householdId, "p_1", {
        characterId: p1,
        merge: true,
        changes: [
          { field: "slot0", before: null, after: "deco_pinwheel" },
          { field: "slot1", before: "deco_pinwheel", after: null },
        ],
      }),
    );
    expect(moved).toMatchObject({ applied: ["slot0", "slot1"], refused: [], kit: { slots: ["deco_pinwheel", null] } });

    // The same change again finds every field already so: nothing to write.
    const again = value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "color", before: null, after: "rose" }] }));
    expect(again).toMatchObject({ applied: ["color"], kit: { revision: 3 } });
  });
});

describe("a book edit racing a table edit (§12.6)", () => {
  it("a book edit landing between the table's read and its commit is not lost: the table's commit is the later edit of that field, and wins", async () => {
    const { harness, t, p1 } = await lobby();
    const s = await t.state();
    const raced = racedCommits(harness, async () => {
      value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "color", before: null, after: "rose" }] }));
    });
    const landed = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: { type: "KIT_EDIT", characterId: p1, revision: 0, color: "tide" } }, raced.deps);
    expect(landed.ok, JSON.stringify(landed.error)).toBe(true);
    // The book's write landed (revision 1); the table re-read it and wrote over it (revision 2).
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 2, color: "tide" });
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 2, color: "tide" });
  });

  it("a book edit mid-moment: the table's next KIT_EDIT, made over what the table showed, lands, and both changes stand", async () => {
    const { harness, t, p1 } = await lobby();
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 0, color: null });
    // In the book, between games for her phone, while her table sits in the lobby.
    value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "color", before: null, after: "rose" }, { field: "buddy", before: null, after: "duckling" }] }));
    // The table still shows revision 0; her phone sends what it shows.
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, tent: "patched" });
    const kit = readKit((await harness.repo.getCharacter(t.householdId, p1))!);
    expect(kit).toMatchObject({ revision: 2, color: "rose", tent: "patched", buddies: { [campKey(t.householdId)]: "duckling" } });
    const s = await t.state();
    expect(s.kits?.[p1]).toMatchObject({ revision: 2, color: "rose", tent: "patched", buddy: "duckling" });
    // And the next edit, over the refreshed view, is an ordinary one.
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 2, color: "tide" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 3, color: "tide", tent: "patched" });
    // A revision the table itself has left is stale, as ever.
    const stale = await t.attempt("p_1", { type: "KIT_EDIT", characterId: p1, revision: 2, style: "quilted" });
    expect(stale.error?.code).toBe("STALE_DECISION");
  });

  it("a table edit of a field the book changed mid-moment is the later one, and wins; the book's other fields stay", async () => {
    const { harness, t, p1 } = await lobby();
    value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "color", before: null, after: "rose" }, { field: "tent", before: null, after: "patched" }] }));
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, color: "tide", style: "quilted" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 2, color: "tide", style: "quilted", tent: "patched" });
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 2, color: "tide", style: "quilted", tent: "patched" });
  });

  it("a table edit landing between the book's read and its write is not lost, and the book's own fields win", async () => {
    const { harness, t, p1 } = await lobby();
    /** The store, with the table's edit landing just before the book's first write to her row. */
    const racing = (edit: ClientIntent): HandlerDeps => {
      let first = true;
      const repo = new Proxy(harness.repo, {
        get(target, prop) {
          if (prop === "writeCharacter") {
            return async (...args: Parameters<typeof target.writeCharacter>) => {
              if (first) {
                first = false;
                await t.send("p_1", edit);
              }
              return target.writeCharacter(...args);
            };
          }
          const v: unknown = Reflect.get(target, prop, target);
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
      return { ...harness.deps, repo };
    };

    const online = value(
      await book(racing({ type: "KIT_EDIT", characterId: p1, revision: 0, style: "quilted" }), t.householdId, "p_1", {
        characterId: p1,
        changes: [{ field: "color", before: null, after: "rose" }],
      }),
    );
    // Its write lost the race, read again, and wrote over the table's: both stand.
    expect(online).toMatchObject({ applied: ["color"], kit: { revision: 2, style: "quilted", color: "rose" } });

    const queued = value(
      await book(racing({ type: "KIT_EDIT", characterId: p1, revision: 1, tent: "rolled" }), t.householdId, "p_1", {
        characterId: p1,
        merge: true,
        changes: [
          { field: "color", before: null, after: "rose" },
          { field: "tent", before: null, after: "patched" },
        ],
      }),
    );
    // The table's tent landed first; the book's, written after it, wins.
    expect(queued).toMatchObject({ applied: ["tent", "color"], kit: { revision: 4, style: "quilted", tent: "patched", color: "rose" } });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 4, style: "quilted", tent: "patched", color: "rose" });
  });

  it("a kit written by something else between reads (a milestone) never loses either write", async () => {
    const { harness, t, p1 } = await lobby();
    let first = true;
    const repo = new Proxy(harness.repo, {
      get(target, prop) {
        if (prop === "writeCharacter") {
          return async (...args: Parameters<typeof target.writeCharacter>) => {
            if (first) {
              first = false;
              const w = await mutateKit(t.householdId, p1, (kit) => ({ ...kit, unlocked: { ...kit.unlocked, deco_lantern: { from: "found" as const, at: AT } } }), harness.deps);
              expect(w.ok).toBe(true);
            }
            return target.writeCharacter(...args);
          };
        }
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const merged = value(await book({ ...harness.deps, repo }, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "color", before: null, after: "ember" }] }));
    expect(merged.applied).toEqual(["color"]);
    const kit = readKit((await harness.repo.getCharacter(t.householdId, p1))!);
    expect(kit).toMatchObject({ color: "ember", revision: 2 });
    expect(Object.keys(kit.unlocked)).toContain("deco_lantern");
  });
});

describe("POST /api/journal/kit over HTTP", () => {
  const event = (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
    ({
      rawPath: path,
      requestContext: { http: { method, sourceIp: "10.0.0.1" } },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: init.headers ?? {},
    }) as unknown as APIGatewayProxyEventV2;
  const bodyOf = (r: APIGatewayProxyStructuredResultV2): BookKitResponse & { error?: { code: string } } => JSON.parse(r.body ?? "{}");

  async function family() {
    const harness = makeHarness({ engine: { applyIntent, createRunState } });
    const content = harnessFor(CATALOG).deps.content;
    harness.deps.content = content;
    const { householdId, players } = await seedHousehold(harness, 2);
    const [ada, ben] = players as [(typeof players)[number], (typeof players)[number]];
    for (const [id, who, name] of [["c_ada", ada, "Sparklehoof"], ["c_ben", ben, "Rumble"]] as const) {
      await harness.repo.putCharacter({ ...makeCharacter({ id, ownerPlayerId: who.principal.playerId, name }), householdId });
    }
    const rt: HttpRuntime = { deps: async () => harness.deps, verifyAccount: async () => null };
    return { harness, rt, householdId, ada, ben };
  }

  it("is authorised by the device binding alone, for the bound kid's own heroes", async () => {
    const { harness, rt, householdId, ada, ben } = await family();
    const change = { characterId: "c_ada", changes: [{ field: "color", before: null, after: "rose" }] };
    expect((await respond(event("POST", "/api/journal/kit", { body: change }), rt)).statusCode).toBe(401);

    const saved = await respond(event("POST", "/api/journal/kit", { body: change, headers: { "x-kad-device-token": ada.deviceToken } }), rt);
    expect(saved.statusCode).toBe(200);
    expect(bodyOf(saved)).toMatchObject({ applied: ["color"], kit: { color: "rose", revision: 1 } });

    // Her brother's phone cannot change her hero, whatever the body says.
    const his = await respond(
      event("POST", "/api/journal/kit", { body: { ...change, revision: 1, playerId: ada.principal.playerId, householdId }, headers: { "x-kad-device-token": ben.deviceToken } }),
      rt,
    );
    expect(his.statusCode).toBe(403);

    // And the journal read brings the kit back, as the book saves it.
    const journal = await respond(event("GET", "/api/journal", { headers: { "x-kad-device-token": ada.deviceToken } }), rt);
    expect(JSON.parse(journal.body ?? "{}").camp.kits["c_ada"]).toMatchObject({ color: "rose", revision: 1 });
    expect(readKit((await harness.repo.getCharacter(householdId, "c_ada"))!).color).toBe("rose");
  });

  it("applies a queued swap of two hung decorations, as the direct write does (#656)", async () => {
    const { harness, rt, householdId, ada } = await family();
    const post = (body: unknown) => respond(event("POST", "/api/journal/kit", { body, headers: { "x-kad-device-token": ada.deviceToken } }), rt);
    const hang = await post({ characterId: "c_ada", changes: [{ field: "slot0", before: null, after: "deco_bunting" }, { field: "slot1", before: null, after: "deco_lantern" }] });
    expect(bodyOf(hang)).toMatchObject({ kit: { slots: ["deco_bunting", "deco_lantern"] } });
    const swap = [{ field: "slot0", before: "deco_bunting", after: "deco_lantern" }, { field: "slot1", before: "deco_lantern", after: "deco_bunting" }];
    // From the queue, as from the book straight away: both slots land.
    const queued = await post({ characterId: "c_ada", merge: true, changes: swap });
    expect(queued.statusCode).toBe(200);
    expect(bodyOf(queued)).toMatchObject({ applied: ["slot0", "slot1"], refused: [], kit: { slots: ["deco_lantern", "deco_bunting"] } });
    const direct = await post({ characterId: "c_ada", changes: swap.map((c) => ({ field: c.field, before: c.after, after: c.before })) });
    expect(bodyOf(direct)).toMatchObject({ applied: ["slot0", "slot1"], kit: { slots: ["deco_bunting", "deco_lantern"] } });
    // A swap that also asks for a spot her kit has not grown: that one is skipped, the swap lands.
    const spot = await post({ characterId: "c_ada", merge: true, changes: [...swap, { field: "slot2", before: null, after: "deco_pinwheel" }] });
    expect(bodyOf(spot)).toMatchObject({ applied: ["slot0", "slot1"], refused: ["slot2"], kit: { slots: ["deco_lantern", "deco_bunting"] } });
    // And one that hangs a find she has not found in place of half the swap: neither half lands alone.
    const locked = await post({ characterId: "c_ada", merge: true, changes: [{ field: "slot0", before: "deco_lantern", after: "deco_bunting" }, { field: "slot1", before: "deco_bunting", after: "deco_gull_feather" }] });
    expect(bodyOf(locked)).toMatchObject({ applied: [], refused: ["slot0", "slot1"], kit: { slots: ["deco_lantern", "deco_bunting"] } });
    expect(readKit((await harness.repo.getCharacter(householdId, "c_ada"))!).slots).toEqual(["deco_lantern", "deco_bunting"]);
  });

  it("refuses a revoked binding", async () => {
    const { harness, rt, householdId, ada } = await family();
    await harness.repo.revokeDevice(householdId, ada.principal.deviceId);
    const res = await respond(
      event("POST", "/api/journal/kit", { body: { characterId: "c_ada", changes: [{ field: "color", before: null, after: "rose" }] }, headers: { "x-kad-device-token": ada.deviceToken } }),
      rt,
    );
    expect(res.statusCode).toBe(401);
    expect((await harness.repo.getCharacter(householdId, "c_ada"))?.kit).toBeUndefined();
  });
});
