/**
 * A kid's own page (#299): badges derived from what the game keeps, and the
 * presets she may pick. Who may reach it is the route's half (lambda/http.test.ts).
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { loadContent } from "../content/loader.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { deleteProfile } from "./organizer.ts";
import { getJournal } from "./journal.ts";
import { saveFlair } from "./profile.ts";
import type { HandlerResult } from "./deps.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function family() {
  const harness = makeHarness({ content });
  const { householdId, players } = await seedHousehold(harness, 2);
  const [ada, ben] = players.map((p) => p.principal.playerId) as [string, string];
  await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ada", ownerPlayerId: ada, name: "Sparklehoof" }), householdId });
  await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ben", ownerPlayerId: ben, name: "Rumble" }), householdId });
  return { harness, householdId, ada, ben };
}

const pageOf = async (h: TestHarness, householdId: string, playerId: string) =>
  value(await getJournal({ householdId, playerId }, h.deps)).profile!;

describe("her page, derived from what the game keeps", () => {
  it("starts with no badges, no finds and nothing chosen", async () => {
    const { harness, householdId, ada } = await family();
    expect(await pageOf(harness, householdId, ada)).toEqual({
      displayName: "Player 1",
      badges: [],
      finds: { count: 0, recent: [] },
      flair: { v: 1 },
    });
  });

  it("counts the finds credited to her, newest first, and none that are her sister's", async () => {
    const { harness, householdId, ada, ben } = await family();
    await harness.repo.recordDiscoveries(householdId, [
      { canonId: "owl", playerId: ada, foundAt: "2026-01-01T00:00:00.000Z" },
      { canonId: "moth", playerId: ada, foundAt: "2026-03-01T00:00:00.000Z" },
      { canonId: "newt", playerId: ben, foundAt: "2026-04-01T00:00:00.000Z" },
      { canonId: "fox", playerId: ada, foundAt: "2026-02-01T00:00:00.000Z" },
      { canonId: "wren", playerId: ada, foundAt: "2026-05-01T00:00:00.000Z" },
    ]);
    const page = await pageOf(harness, householdId, ada);
    expect(page.finds).toEqual({ count: 4, recent: ["wren", "moth", "fox"] });
    expect(page.badges.map((b) => b.id)).toEqual(["finds-1"]);
    expect((await pageOf(harness, householdId, ben)).finds).toEqual({ count: 1, recent: ["newt"] });
  });

  it("includes a badge earned at another household's table, and names it for the campaign", async () => {
    const { harness, householdId, ada } = await family();
    const hero = (await harness.repo.getCharacter(householdId, "c_ada"))!;
    await harness.repo.putCharacter({
      ...hero,
      finished: [{ campaignId: "gemfall", outcome: "setback", at: "2026-06-01T00:00:00.000Z", table: "h_rue" }],
    });
    const ids = (await pageOf(harness, householdId, ada)).badges.map((b) => b);
    expect(ids).toEqual([
      expect.objectContaining({ id: "finished:gemfall", name: `${content.campaign("gemfall")!.title} Finisher` }),
      expect.objectContaining({ id: "guest-star" }),
    ]);
  });

  it("counts a level only once a campaign has banked it", async () => {
    const { harness, householdId, ada } = await family();
    const hero = (await harness.repo.getCharacter(householdId, "c_ada"))!;
    await harness.repo.putCharacter({
      ...hero,
      committed: { ...hero.committed, level: 2 },
      provisional: { ...hero.committed, level: 5, runId: "r_1" },
    });
    expect((await pageOf(harness, householdId, ada)).badges).toEqual([]);
  });
});

describe("what she picks", () => {
  async function earned() {
    const f = await family();
    await f.harness.repo.recordDiscoveries(f.householdId, [{ canonId: "owl", playerId: f.ada }]);
    return f;
  }
  const save = (f: Awaited<ReturnType<typeof family>>, playerId: string, body: unknown) =>
    saveFlair({ householdId: f.householdId, playerId, body }, f.harness.deps);

  it("saves a color, a frame for her hero and an earned title, and the journal reads them back", async () => {
    const f = await earned();
    const view = value(await save(f, f.ada, { color: "berry", frames: { c_ada: "stars" }, title: "finds-1" }));
    const chosen = { v: 1, color: "berry", frames: { c_ada: "stars" }, title: "finds-1" };
    expect(view.flair).toEqual(chosen);
    expect((await f.harness.repo.getPlayer(f.householdId, f.ada))?.flair).toEqual(chosen);
    expect((await pageOf(f.harness, f.householdId, f.ada)).flair).toEqual(chosen);
  });

  it("replaces what she had, and clears it when she picks nothing", async () => {
    const f = await earned();
    value(await save(f, f.ada, { color: "berry", title: "finds-1" }));
    expect(value(await save(f, f.ada, { color: "sky" })).flair).toEqual({ v: 1, color: "sky" });
    expect(value(await save(f, f.ada, {})).flair).toEqual({ v: 1 });
    expect((await f.harness.repo.getPlayer(f.householdId, f.ada))).not.toHaveProperty("flair");
  });

  it("changes nothing else about her, and nothing about her sister", async () => {
    const f = await earned();
    const before = await f.harness.repo.getPlayer(f.householdId, f.ada);
    value(await save(f, f.ada, { color: "plum" }));
    const after = await f.harness.repo.getPlayer(f.householdId, f.ada);
    expect({ ...after, flair: undefined }).toEqual({ ...before, flair: undefined });
    expect(await f.harness.repo.getPlayer(f.householdId, f.ben)).not.toHaveProperty("flair");
  });

  it("refuses anything that is not a preset, her own hero or a badge she has earned", async () => {
    const f = await earned();
    const refusals: unknown[] = [
      { color: "#ff0000" },
      { frames: { c_ada: "dragonfire" } },
      { frames: { c_ben: "ivy" } },
      { frames: { c_nobody: "ivy" } },
      { title: "finished:gemfall" },
      { title: "Dragon Queen" },
      "berry",
    ];
    for (const body of refusals) {
      const result = await save(f, f.ada, body);
      expect(result.ok, JSON.stringify(body)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ILLEGAL");
    }
    expect(await f.harness.repo.getPlayer(f.householdId, f.ada)).not.toHaveProperty("flair");
  });

  it("will not save for a kid who is not there", async () => {
    const f = await earned();
    const result = await save(f, "p_ghost", { color: "sky" });
    expect(result.ok ? null : result.error.code).toBe("NOT_FOUND");
  });

  it("reads a stored choice as it stands today: what is gone or unknown is simply not chosen", async () => {
    const f = await earned();
    const ada = (await f.harness.repo.getPlayer(f.householdId, f.ada))!;
    await f.harness.repo.updatePlayer({
      ...ada,
      flair: { v: 1, color: "neon" as never, frames: { c_ada: "ivy", c_deleted: "stars" }, title: "finished:gemfall" },
    });
    expect((await pageOf(f.harness, f.householdId, f.ada)).flair).toEqual({ v: 1, frames: { c_ada: "ivy" } });
    await f.harness.repo.updatePlayer({ ...ada, flair: { v: 99 } });
    expect((await pageOf(f.harness, f.householdId, f.ada)).flair).toEqual({ v: 1 });
  });

  it("is deleted with her", async () => {
    const f = await earned();
    value(await save(f, f.ada, { color: "berry" }));
    await f.harness.repo.putAccountPointer("sub-test", f.householdId);
    value(await deleteProfile({ cognitoSub: "sub-test", householdId: f.householdId, playerId: f.ada }, f.harness.deps));

    expect(await f.harness.repo.getPlayer(f.householdId, f.ada)).toBeNull();
    const result = await save(f, f.ada, { color: "sky" });
    expect(result.ok).toBe(false);
    // Her sister's page is untouched by it.
    expect(await f.harness.repo.getPlayer(f.householdId, f.ben)).not.toBeNull();
  });
});
