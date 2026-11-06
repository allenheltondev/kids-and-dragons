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
import type { BookKitResponse, CampRecord, ClientIntent } from "@kad/shared";
import { CATALOG, harnessFor, racedCommits, seeded, table, type Table } from "./camp-table.testing.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { mutateCamp, mutateKit } from "./camp.ts";
import { editKitFromBook, offerPlace } from "./camp-book.ts";
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

  it("lists another crew once it has played, with its own camp, and leaves out a crew never played", async () => {
    const { harness, t } = await lobby();
    await harness.repo.commit({
      runId: t.runId,
      expectedSeq: (await t.state()).seq,
      state: { ...(await t.state()), seq: (await t.state()).seq + 1 },
      event: { seq: (await t.state()).seq + 1, runId: t.runId, patch: [], at: AT },
      crew: { householdId: t.householdId, id: "cw_1", name: "The Otter Crew", createdAt: AT },
    });
    let journal = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    expect(journal.camp!.crews.map((c) => c.name)).toEqual(["The first crew"]);
    await seedCamp(t.householdId, harness, { friends: { kid_goat: { rewardId: "riftlight-glacier-survival.kid_goat", at: AT } } }, "cw_1");
    journal = value(await getJournal({ householdId: t.householdId, playerId: "p_1" }, harness.deps));
    expect(journal.camp!.crews.map((c) => [c.crew, c.name])).toEqual([[null, "The first crew"], ["cw_1", "The Otter Crew"]]);
    // The fixture content has no Glacier chapter to name, so it says no more than that.
    expect(journal.camp!.crews[1]!.friends.map((f) => [f.id, f.source])).toEqual([["kid_goat", "Met on an adventure"]]);
    expect(journal.camp!.crews[0]!.friends.map((f) => f.id)).toEqual(["duckling"]);
  });
});

describe("the book's kit write (§7, §12.6)", () => {
  it("changes her own hero's kit online with the table's revision check, and the table reads it at its next downtime moment", async () => {
    const { harness, t, p1 } = await lobby();
    const done = value(
      await book(harness.deps, t.householdId, "p_1", {
        characterId: p1,
        revision: 0,
        changes: [
          { field: "tent", before: null, after: "patched" },
          { field: "color", before: null, after: "rose" },
          { field: "slot0", before: null, after: "deco_bunting" },
        ],
      }),
    );
    expect(done).toMatchObject({ applied: ["tent", "color", "slot0"], kept: [], refused: [], kit: { revision: 1, tent: "patched", color: "rose", slots: ["deco_bunting", null] } });
    expect(done.stale).toBeUndefined();
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 1, tent: "patched", color: "rose" });

    // A revision the kit has left applies nothing and answers with the kit as it is.
    const stale = value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "color", before: null, after: "tide" }] }));
    expect(stale).toMatchObject({ stale: true, applied: [], kept: ["color"], kit: { revision: 1, color: "rose" } });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!).color).toBe("rose");

    // The live room keeps the kit it read for this moment, and reads it afresh at the next one.
    expect((await t.state()).kits?.[p1]?.color).toBeNull();
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    await t.goto("scene_camp");
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 1, tent: "patched", color: "rose" });
  });

  it("refuses another kid's hero, a hero she does not have, and a phone with no binding", async () => {
    const { harness, t, p2 } = await lobby();
    const theirs = await book(harness.deps, t.householdId, "p_1", { characterId: p2, revision: 0, changes: [{ field: "color", before: null, after: "rose" }] });
    expect(theirs).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const nobody = await book(harness.deps, t.householdId, "p_1", { characterId: "c_nobody", revision: 0, changes: [{ field: "color", before: null, after: "rose" }] });
    expect(nobody).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getCharacter(t.householdId, p2))?.kit).toBeUndefined();
  });

  it("refuses what the table refuses: a friend the crew lacks, a crew piece, a locked tent, a malformed change", async () => {
    const { harness, t, p1 } = await lobby();
    const lacking = await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "buddy", before: null, after: "bun" }] });
    expect(lacking).toMatchObject({ ok: false, error: { code: "ILLEGAL", message: expect.stringContaining("not one of this crew's friends") } });
    const crewPiece = await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "slot0", before: null, after: "shop_log_bench" }] });
    expect(crewPiece).toMatchObject({ ok: false, error: { message: expect.stringContaining("not hers to hang") } });
    const locked = await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "tent", before: null, after: "mythic" }] });
    expect(locked).toMatchObject({ ok: false, error: { message: expect.stringContaining("not hers to pick") } });
    for (const body of [
      { characterId: p1, changes: [{ field: "color", before: null, after: "rose" }] }, // no revision, not merged
      { characterId: p1, revision: 0, changes: [] },
      { characterId: p1, revision: 0, changes: [{ field: "hat", before: null, after: "x" }] },
      { characterId: p1, revision: 0, changes: [{ field: "color", before: null, after: "rose" }, { field: "color", before: null, after: "tide" }] },
      { characterId: p1, revision: 0, crew: "cw_nope", changes: [{ field: "buddy", before: null, after: "duckling" }] },
    ]) {
      expect((await book(harness.deps, t.householdId, "p_1", body)).ok, JSON.stringify(body)).toBe(false);
    }
    // Her buddy, from the crew's own friends, is fine.
    expect(value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "buddy", before: null, after: "duckling" }] })).kit.buddies).toEqual({ "": "duckling" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!).buddies).toEqual({ [campKey(t.householdId)]: "duckling" });
  });

  it("merges a queued change field by field: a field changed elsewhere keeps the newer value, the rest apply, a pick no longer hers is skipped", async () => {
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
    expect(merged).toMatchObject({ applied: ["color", "slot1"], kept: ["tent"], refused: ["buddy"] });
    expect(merged.kit).toMatchObject({ revision: 2, tent: "rolled", color: "rose", slots: [null, "deco_pinwheel"], buddies: {} });

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
    expect(moved).toMatchObject({ applied: ["slot0", "slot1"], kept: [], refused: [], kit: { slots: ["deco_pinwheel", null] } });

    // The same change again finds every field already so: nothing to write.
    const again = value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "color", before: null, after: "rose" }] }));
    expect(again).toMatchObject({ applied: ["color"], kit: { revision: 3 } });
  });
});

describe("a book edit racing a table edit (§12.6)", () => {
  it("a book edit landing between the table's read and its commit never lets the table undo it: the same field keeps the book's value, and the table shows it", async () => {
    const { harness, t, p1 } = await lobby();
    const s = await t.state();
    const raced = racedCommits(harness, async () => {
      value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "color", before: null, after: "rose" }] }));
    });
    const landed = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: { type: "KIT_EDIT", characterId: p1, revision: 0, color: "tide" } }, raced.deps);
    expect(landed.ok, JSON.stringify(landed.error)).toBe(true);
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 1, color: "rose" });
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 1, color: "rose" });
  });

  it("a book edit mid-moment: the table's next KIT_EDIT, made over what the table showed, lands, and both changes stand", async () => {
    const { harness, t, p1 } = await lobby();
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 0, color: null });
    // In the book, between games for her phone, while her table sits in the lobby.
    value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "color", before: null, after: "rose" }, { field: "buddy", before: null, after: "duckling" }] }));
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

  it("a table edit of a field the book changed mid-moment keeps the book's value, and the table shows it", async () => {
    const { harness, t, p1 } = await lobby();
    value(await book(harness.deps, t.householdId, "p_1", { characterId: p1, revision: 0, changes: [{ field: "color", before: null, after: "rose" }] }));
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, color: "tide", style: "quilted" });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 2, color: "rose", style: "quilted" });
    expect((await t.state()).kits?.[p1]).toMatchObject({ revision: 2, color: "rose", style: "quilted" });
  });

  it("a table edit landing between the book's read and its write: online the book's is stale; queued, both fields stand", async () => {
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
        revision: 0,
        changes: [{ field: "color", before: null, after: "rose" }],
      }),
    );
    expect(online).toMatchObject({ stale: true, applied: [], kit: { revision: 1, style: "quilted", color: null } });

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
    // The table's tent landed first, so the book's tent is the older pick and stays out; its color lands.
    expect(queued).toMatchObject({ applied: ["color"], kept: ["tent"], kit: { revision: 3, style: "quilted", tent: "rolled", color: "rose" } });
    expect(readKit((await harness.repo.getCharacter(t.householdId, p1))!)).toMatchObject({ revision: 3, style: "quilted", tent: "rolled", color: "rose" });
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
    const change = { characterId: "c_ada", revision: 0, changes: [{ field: "color", before: null, after: "rose" }] };
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

  it("refuses a revoked binding", async () => {
    const { harness, rt, householdId, ada } = await family();
    await harness.repo.revokeDevice(householdId, ada.principal.deviceId);
    const res = await respond(
      event("POST", "/api/journal/kit", { body: { characterId: "c_ada", revision: 0, changes: [{ field: "color", before: null, after: "rose" }] }, headers: { "x-kad-device-token": ada.deviceToken } }),
      rt,
    );
    expect(res.statusCode).toBe(401);
    expect((await harness.repo.getCharacter(householdId, "c_ada"))?.kit).toBeUndefined();
  });
});
