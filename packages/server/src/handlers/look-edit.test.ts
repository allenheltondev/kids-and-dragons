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

    expect(await partyLook(t, p1)).toEqual({ revision: 2, coat: null, accent: null, special: null, nameplate: "ribbon", title: "the_bold", unlocked: [] });
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
    const coat = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "midnight" });
    expect(coat.error?.code).toBe("ILLEGAL");
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
  });
});

describe("her colour at the table (#666, §3.2, §7.1)", () => {
  it("accepts one of her species' starter colours, back to as painted too, and shows it on the run", async () => {
    const { harness, t, p1, p2 } = await lobby();
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "unicorn_sky" });
    expect(await partyLook(t, p1)).toMatchObject({ revision: 1, coat: "unicorn_sky" });
    expect((await stored(harness, t.householdId, p1)).coat).toBe("unicorn_sky");
    await t.send("p_2", { type: "LOOK_EDIT", characterId: p2, revision: 0, coat: "bigfoot_ginger" });
    expect((await partyLook(t, p2))?.coat).toBe("bigfoot_ginger");
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 1, coat: null });
    expect((await partyLook(t, p1))?.coat).toBeNull();
  });

  it("refuses another species' colour", async () => {
    const { harness, t, p1, p2 } = await lobby();
    const bigfoots = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "bigfoot_ginger" });
    expect(bigfoots.ok).toBe(false);
    expect(bigfoots.error?.code).toBe("ILLEGAL");
    expect(bigfoots.error?.message).toMatch(/not one of her colors/);
    const unicorns = await t.attempt("p_2", { type: "LOOK_EDIT", characterId: p2, revision: 0, coat: "unicorn_sky" });
    expect(unicorns.error?.code).toBe("ILLEGAL");
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
    expect((await harness.repo.getCharacter(t.householdId, p2))!.look).toBeUndefined();
  });

  it("refuses a colour she has not unlocked, and takes it once she holds its receipt", async () => {
    const { harness, t, p1 } = await lobby();
    const locked = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "unicorn_starlight" });
    expect(locked.error?.code).toBe("ILLEGAL");
    expect(locked.error?.message).toMatch(/not hers yet/);
    const row = (await harness.repo.getCharacter(t.householdId, p1))!;
    const look: HeroLook = { ...readLook(row), unlocked: { unicorn_starlight: { from: "found", rewardId: "test.starlight" } } };
    expect(await harness.repo.writeCharacter({ character: { ...row, look }, expectedVersion: row.version ?? 0, expectedClaim: row.provisional?.runId ?? null })).toBe(true);
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "unicorn_starlight" });
    expect((await stored(harness, t.householdId, p1)).coat).toBe("unicorn_starlight");
  });
});

describe("her two colours and her special at the table (owner, 2026-11-07)", () => {
  it("takes a main and an accent colour of hers, each on its own field", async () => {
    const { harness, t, p1 } = await lobby();
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "unicorn_sky", accent: "unicorn_accent_rose" });
    expect(await partyLook(t, p1)).toMatchObject({ coat: "unicorn_sky", accent: "unicorn_accent_rose", special: null });
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 1, accent: "unicorn_accent_teal" });
    expect(await stored(harness, t.householdId, p1)).toMatchObject({ coat: "unicorn_sky", accent: "unicorn_accent_teal" });
  });

  it("refuses a main colour as her accent and an accent colour as her main", async () => {
    const { harness, t, p1 } = await lobby();
    const asAccent = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, accent: "unicorn_sky" });
    expect(asAccent.error?.code).toBe("ILLEGAL");
    expect(asAccent.error?.message).toMatch(/main color, not an accent/);
    const asMain = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, coat: "unicorn_accent_rose" });
    expect(asMain.error?.code).toBe("ILLEGAL");
    expect(asMain.error?.message).toMatch(/accent color, not a main/);
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
  });

  it("refuses another species' accent", async () => {
    const { t, p1 } = await lobby();
    const answer = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, accent: "bigfoot_accent_tan" });
    expect(answer.error?.code).toBe("ILLEGAL");
    expect(answer.error?.message).toMatch(/not one of her colors/);
  });

  it("refuses an earned accent or a special she has not earned, and takes both once she holds them", async () => {
    const { harness, t, p1 } = await lobby();
    for (const edit of [{ accent: "unicorn_accent_bluebell" }, { special: "gold" }, { special: "aurora" }]) {
      const answer = await t.attempt("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, ...edit });
      expect(answer.error?.code).toBe("ILLEGAL");
      expect(answer.error?.message).toMatch(/not hers yet/);
    }
    const row = (await harness.repo.getCharacter(t.householdId, p1))!;
    const look: HeroLook = {
      ...readLook(row),
      unlocked: { aurora: { from: "found", rewardId: "test.aurora" }, unicorn_accent_bluebell: { from: "milestone" } },
    };
    expect(await harness.repo.writeCharacter({ character: { ...row, look }, expectedVersion: row.version ?? 0, expectedClaim: row.provisional?.runId ?? null })).toBe(true);
    await t.send("p_1", { type: "LOOK_EDIT", characterId: p1, revision: 0, accent: "unicorn_accent_bluebell", special: "aurora" });
    expect(await stored(harness, t.householdId, p1)).toMatchObject({ accent: "unicorn_accent_bluebell", special: "aurora" });
  });
});

describe("her colour from the book (#666, §3.2)", () => {
  it("merges her accent and her special per field, the last choice for each standing", async () => {
    const { harness, t, p1 } = await lobby();
    const merge = (changes: Record<string, unknown>[]) => book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes });
    await merge([{ field: "coat", before: null, after: "unicorn_sky" }]);
    await merge([{ field: "accent", before: null, after: "unicorn_accent_rose" }]);
    await merge([{ field: "accent", before: "unicorn_accent_rose", after: "unicorn_accent_teal" }]);
    expect(await stored(harness, t.householdId, p1)).toMatchObject({ coat: "unicorn_sky", accent: "unicorn_accent_teal", special: null });
    // A special not earned and a main colour as her accent are skipped and said; her other fields stay.
    const answer = await merge([
      { field: "accent", before: "unicorn_accent_teal", after: "unicorn_midnight" },
      { field: "special", before: null, after: "gold" },
      { field: "title", before: null, after: "the_kind" },
    ]);
    const value = (answer as { value: BookKitResponse }).value;
    expect(value.refused).toEqual(["accent", "special"]);
    expect(value.applied).toEqual(["title"]);
    expect(value.look).toMatchObject({ coat: "unicorn_sky", accent: "unicorn_accent_teal", special: null, title: "the_kind" });
  });

  it("applies one of her colours, and ends two queued colour edits on the later one", async () => {
    const { harness, t, p1 } = await lobby();
    await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "coat", before: null, after: "unicorn_sky" }] });
    await book(harness.deps, t.householdId, "p_1", { characterId: p1, merge: true, changes: [{ field: "coat", before: "unicorn_sky", after: "unicorn_midnight" }] });
    expect((await stored(harness, t.householdId, p1)).coat).toBe("unicorn_midnight");
  });

  it("skips another species' colour, or one not hers yet, from the queue and says so", async () => {
    const { harness, t, p1 } = await lobby();
    for (const after of ["bigfoot_ginger", "unicorn_starlight"]) {
      const answer = await book(harness.deps, t.householdId, "p_1", {
        characterId: p1,
        merge: true,
        changes: [
          { field: "coat", before: null, after },
          { field: "title", before: null, after: "the_bold" },
        ],
      });
      expect(answer.ok).toBe(true);
      const value = (answer as { value: BookKitResponse }).value;
      expect(value.refused).toEqual(["coat"]);
      expect(value.applied).toEqual(["title"]);
    }
    expect((await stored(harness, t.householdId, p1)).coat).toBeNull();
  });

  it("refuses a colour not hers sent straight away", async () => {
    const { harness, t, p1 } = await lobby();
    const answer = await book(harness.deps, t.householdId, "p_1", { characterId: p1, changes: [{ field: "coat", before: null, after: "bigfoot_frost" }] });
    expect(answer.ok).toBe(false);
    expect((await harness.repo.getCharacter(t.householdId, p1))!.look).toBeUndefined();
  });
});

describe("LOOK_EDIT at the table, continued", () => {

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
    expect(value.look).toEqual({ revision: 1, coat: null, accent: null, special: null, nameplate: null, title: "the_curious", unlocked: [] });
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
    expect(readLook(character)).toEqual({ v: 2, revision: 0, coat: null, accent: null, special: null, nameplate: null, title: null, unlocked: {} });
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
