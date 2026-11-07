/**
 * A hero's look (docs/hero-looks.md §3.2, §12; #664): `LOOK_EDIT` at the
 * table and the look half of a book edit (`POST /api/journal/kit`).
 *
 *   - At the table, a look she holds is accepted and shows on the run at
 *     once; a stale revision and a look not hers are refused.
 *   - From the book, a look not hers is skipped from the queue and said, and
 *     two queued edits to one field end on the later one.
 *   - A book edit then a table edit to the same field: the stale table editor
 *     is refused once, its view of her look refreshed, and its next tap lands.
 *   - A hero with no look is stored, read and resolved exactly as before.
 */

import { describe, expect, it } from "vitest";
import { lookView, readLook, resolveCharacter } from "@kad/shared";
import type { BookKitResponse, ClientIntent, HeroLook } from "@kad/shared";
import { CATALOG, harnessFor, table, type Table } from "./camp-table.testing.ts";
import type { TestHarness } from "../test-support.ts";
import type { HandlerDeps } from "./deps.ts";
import { editKitFromBook } from "./camp-book.ts";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

async function lobby(): Promise<{ harness: TestHarness; t: Table; p1: string; p2: string }> {
  const harness = harnessFor(CATALOG);
  const t = await table(harness);
  await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
  await t.send("p_2", hero("Thistle", "bigfoot", "thornguard"));
  const party = (await t.state()).party;
  return { harness, t, p1: party[0]!.character.id, p2: party[1]!.character.id };
}

/** A table that has started the chapter (its own two heroes, `Table.start`). */
async function started(): Promise<{ harness: TestHarness; t: Table; p1: string; p2: string }> {
  const harness = harnessFor(CATALOG);
  const t = await table(harness);
  await t.start();
  const party = (await t.state()).party;
  return { harness, t, p1: party[0]!.character.id, p2: party[1]!.character.id };
}

async function book(deps: HandlerDeps, householdId: string, playerId: string, body: Record<string, unknown>) {
  return editKitFromBook({ householdId, playerId, body }, deps);
}

const stored = async (harness: TestHarness, householdId: string, id: string): Promise<HeroLook> =>
  readLook((await harness.repo.getCharacter(householdId, id))!);

const partyLook = async (t: Table, id: string) => (await t.state()).party.find((m) => m.character.id === id)!.character.look;

describe("LOOK_EDIT at the table (§3.2, §8.2)", () => {
  it("accepts a look she holds, writes it to her row and shows it on the run at once", async () => {
    const { harness, t, p1 } = await lobby();
    expect(await partyLook(t, p1)).toBeUndefined();

    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 1, nameplate: "ribbon" });

    expect(await partyLook(t, p1)).toEqual({ revision: 2, coat: null, nameplate: "ribbon", title: "the_bold", unlocked: [] });
    expect(await stored(harness, t.householdId, p1)).toMatchObject({ revision: 2, nameplate: "ribbon", title: "the_bold" });
    // Unlimited, and back to no title is a pick too.
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 2, title: null });
    expect((await partyLook(t, p1))?.title).toBeNull();
  });

  it("refuses a stale revision", async () => {
    const { t, p1 } = await lobby();
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_kind" });
    const stale = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("STALE_DECISION");
    expect((await partyLook(t, p1))?.title).toBe("the_kind");
  });

  it("refuses a look she has not unlocked, and one the catalog does not have", async () => {
    const { harness, t, p1 } = await lobby();
    const locked = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, nameplate: "golden" });
    expect(locked.ok).toBe(false);
    expect(locked.error?.code).toBe("ILLEGAL");
    const earned = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "of_the_gemfall" });
    expect(earned.error?.code).toBe("ILLEGAL");
    const unknown = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_magnificent" });
    expect(unknown.error?.code).toBe("ILLEGAL");
    // No colours yet (#666): any coat is refused.
    const coat = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "midnight" });
    expect(coat.error?.code).toBe("ILLEGAL");
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
  });

  it("accepts an earned look once she holds its receipt", async () => {
    const { harness, t, p1 } = await lobby();
    const row = (await harness.repo.getCharacter(t.householdId, p1))!;
    const look: HeroLook = { ...readLook(row), unlocked: { golden: { from: "found", rewardId: "test.golden" } } };
    expect(await harness.repo.writeCharacter({ character: { ...row, look }, expectedVersion: row.version ?? 0, expectedClaim: row.provisional?.runId ?? null })).toBe(true);
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, nameplate: "golden" });
    expect((await stored(harness, t.householdId, p1)).nameplate).toBe("golden");
  });

  it("is her own player's alone", async () => {
    const { t, p1 } = await lobby();
    const other = await t.attempt("p_2", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    expect(other.error?.code).toBe("FORBIDDEN");
  });

  it("is a downtime choice: the lobby and rests, never mid-scene", async () => {
    const { t, p1 } = await started();
    expect((await t.state()).phase).toBe("scene");
    const mid = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    expect(mid.error?.code).toBe("ILLEGAL");
    await t.goto("scene_camp");
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    expect((await partyLook(t, p1))?.title).toBe("the_bold");
  });
});

describe("a look from the book (§3.2)", () => {
  it("applies a look she holds and answers with it", async () => {
    const { harness, t, p1 } = await lobby();
    const answer = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "title", before: null, after: "the_curious" }] });
    expect(answer.ok).toBe(true);
    const value = (answer as { value: BookKitResponse }).value;
    expect(value.applied).toEqual(["title"]);
    expect(value.look).toEqual({ revision: 1, coat: null, nameplate: null, title: "the_curious", unlocked: [] });
    expect((await stored(harness, t.householdId, p1)).title).toBe("the_curious");
  });

  it("skips a look not hers from the queue and says so, applying the rest", async () => {
    const { harness, t, p1 } = await lobby();
    const answer = await book(harness.deps, t.householdId, "p_1", {
      characterId: p1,
      merge: true,
      changes: [
        { field: "nameplate", before: null, after: "golden" },
        { field: "title", before: null, after: "the_bold" },
      ],
    });
    expect(answer.ok).toBe(true);
    const value = (answer as { value: BookKitResponse }).value;
    expect(value.refused).toEqual(["nameplate"]);
    expect(value.applied).toEqual(["title"]);
    expect(await stored(harness, t.householdId, p1)).toMatchObject({ nameplate: null, title: "the_bold" });
  });

  it("refuses the whole change sent straight away when one look is not hers", async () => {
    const { harness, t, p1 } = await lobby();
    const answer = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "nameplate", before: null, after: "golden" }] });
    expect(answer.ok).toBe(false);
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
  });

  it("refuses another kid's hero", async () => {
    const { harness, t, p1 } = await lobby();
    const answer = await book(harness.deps, t.householdId, "p_2", { characterId: p1, changes: [{ field: "title", before: null, after: "the_bold" }] });
    expect(answer.ok).toBe(false);
  });

  it("ends two queued edits to one field on the later one, made over whatever is stored", async () => {
    const { harness, t, p1 } = await lobby();
    // Both made offline: the first over nothing, the second over the first. Sent oldest first.
    await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "title", before: null, after: "the_bold" }] });
    await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "title", before: "the_bold", after: "the_kind" }] });
    expect((await stored(harness, t.householdId, p1)).title).toBe("the_kind");
  });

  it("then a stale table editor is refused once, refreshed, and its next tap lands", async () => {
    const { harness, t, p1 } = await lobby();
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, title: "the_bold" });
    // The book changes the same field while the table still shows revision 1.
    await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "title", before: "the_bold", after: "the_kind" }] });
    expect((await partyLook(t, p1))?.revision).toBe(1);

    const stale = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 1, title: "the_curious" });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("STALE_DECISION");
    // The book's pick stands, and the table now shows it.
    expect((await stored(harness, t.householdId, p1)).title).toBe("the_kind");
    expect(await partyLook(t, p1)).toMatchObject({ revision: 2, title: "the_kind" });

    // Refused once: the refreshed editor's next tap lands.
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 2, title: "the_curious" });
    expect((await stored(harness, t.householdId, p1)).title).toBe("the_curious");
  });

  it("keeps her kit as it is when only her look changes", async () => {
    const { harness, t, p1 } = await lobby();
    await t.send("p_1", { type: "KIT_EDIT", characterId: p1, revision: 0, style: "quilted" });
    const answer = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "title", before: null, after: "the_bold" }] });
    expect(answer.ok).toBe(true);
    expect((answer as { value: BookKitResponse }).value.kit.style).toBe("quilted");
  });
});

describe("a hero with no look (§3.1, §12)", () => {
  it("has none stored, and resolves with none, exactly as before looks", () => {
    const character = makeCharacter();
    expect(character.look).toBeUndefined();
    expect(readLook(character)).toEqual({ v: 1, revision: 0, coat: null, nameplate: null, title: null, unlocked: {} });
    const { rules, items } = { rules: harnessFor(CATALOG).deps.content.rules(), items: harnessFor(CATALOG).deps.content.items() };
    expect(resolveCharacter(character, rules, items)).not.toHaveProperty("look");
    expect(lookView(readLook(character)).unlocked).toEqual([]);
  });

  it("plays a whole chapter with nothing written to her look", async () => {
    const { harness, t, p1, p2 } = await started();
    await t.goto("scene_ending");
    for (const id of [p1, p2]) expect((await harness.repo.getCharacter(t.householdId, id))!.look).toBeUndefined();
    for (const m of (await t.state()).party) expect(m.character).not.toHaveProperty("look");
  });
});
