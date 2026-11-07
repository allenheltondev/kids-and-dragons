/**
 * Hero looks' pure rules (docs/hero-looks.md §3, §6; #664): what is hers to
 * wear, the book's field-by-field merge, the stored shape, and a hero with no
 * look reading back exactly as stored.
 */

import { describe, expect, it } from "vitest";
import {
  emptyLook,
  holdsLook,
  lookEditProblem,
  lookIntentProblem,
  lookView,
  mergeBookLook,
  migrateLook,
  withBookLookChanges,
  withLookEdit,
} from "./hero-look.js";
import { CHARACTER_VERSION, migrateCharacter } from "./migrate.js";
import { makeCharacter } from "./test-fixtures.js";
import type { LookCatalog } from "./types/look.js";

const CATALOG: LookCatalog = {
  coats: [{ id: "midnight", name: "Midnight", unlock: { from: "starter" }, species: ["unicorn"], color: "#223355" }],
  nameplates: [
    { id: "plain", name: "Plain", unlock: { from: "starter" } },
    { id: "ribbon", name: "Ribbon", unlock: { from: "starter" }, art: "nameplates/ribbon.webp" },
    { id: "golden", name: "Golden", unlock: { from: "found" }, art: "nameplates/golden.webp" },
  ],
  titles: [
    { id: "the_bold", text: "the Bold", unlock: { from: "starter" } },
    { id: "of_the_gemfall", text: "of the Gemfall", unlock: { from: "milestone", campaign: "gemfall" } },
  ],
};

describe("what is hers to wear (§6)", () => {
  it("is every starter, and an earned look only with its receipt", () => {
    expect(holdsLook(CATALOG, [], "ribbon")).toBe(true);
    expect(holdsLook(CATALOG, [], "golden")).toBe(false);
    expect(holdsLook(CATALOG, ["golden"], "golden")).toBe(true);
  });

  it("refuses what is not hers, not in the catalog, or another species' colour", () => {
    expect(lookEditProblem(CATALOG, [], { nameplate: "ribbon", title: "the_bold" }, "unicorn")).toBeNull();
    expect(lookEditProblem(CATALOG, [], { nameplate: null, title: null, coat: null }, "unicorn")).toBeNull();
    expect(lookEditProblem(CATALOG, [], { nameplate: "golden" }, "unicorn")).toMatch(/not hers/);
    expect(lookEditProblem(CATALOG, [], { title: "of_the_gemfall" }, "unicorn")).toMatch(/not hers/);
    expect(lookEditProblem(CATALOG, [], { title: "the_grand" }, "unicorn")).toMatch(/no such/);
    expect(lookEditProblem(CATALOG, [], { coat: "midnight" }, "bigfoot")).toMatch(/not one of her colors/);
  });

  it("checks a LOOK_EDIT's shape", () => {
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, title: "the_bold" })).toBeNull();
    expect(lookIntentProblem({ characterId: "c_1", revision: -1, title: "the_bold" })).toBe("revision");
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, title: 4 })).toBe("title");
    expect(lookIntentProblem({ characterId: "c_1", revision: 0 })).toBe("nothing to change");
  });
});

describe("the book's merge (§3.2)", () => {
  const check = (unlocked: string[]) => (edit: Parameters<typeof withLookEdit>[1]) => lookEditProblem(CATALOG, unlocked, edit, "unicorn");

  it("applies each field over what is stored, the device winning, and skips one not hers", () => {
    const stored = withLookEdit(emptyLook(), { title: "the_bold" });
    const merged = mergeBookLook(stored, [
      { field: "nameplate", before: null, after: "golden" },
      { field: "title", before: "something else", after: null },
    ], check([]));
    expect(merged.applied).toEqual(["title"]);
    expect(merged.refused).toEqual(["nameplate"]);
    expect(merged.look).toMatchObject({ nameplate: null, title: null });
  });

  it("ends two queued picks of one field on the later", () => {
    const first = mergeBookLook(emptyLook(), [{ field: "title", before: null, after: "the_bold" }], check([])).look;
    const second = mergeBookLook(first, [{ field: "title", before: "the_bold", after: null }], check([])).look;
    expect(second.title).toBeNull();
    expect(withBookLookChanges(lookView(emptyLook()), [{ field: "title", before: null, after: "the_bold" }, { field: "title", before: "the_bold", after: null }]).title).toBeNull();
  });
});

describe("the stored look (§3.1)", () => {
  it("reads back as written, and refuses a look from a newer build", () => {
    const look = { ...withLookEdit(emptyLook(), { nameplate: "ribbon" }), revision: 4, unlocked: { golden: { from: "found" as const, rewardId: "x.golden", at: "2026-11-07T00:00:00.000Z" } } };
    expect(migrateLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
    expect(() => migrateLook({ ...look, v: 99 })).toThrow(/v99/);
    expect(() => migrateLook({ ...look, title: 7 })).toThrow(/title/);
  });

  it("is absent on a hero nobody has chosen for, and stays absent through the ladder", () => {
    const character = makeCharacter();
    const read = migrateCharacter(JSON.parse(JSON.stringify(character)), 9);
    expect(read).not.toHaveProperty("look");
    expect(read).toEqual(migrateCharacter(JSON.parse(JSON.stringify(character)), CHARACTER_VERSION));
  });

  it("rides the character row once chosen", () => {
    const look = withLookEdit(emptyLook(), { title: "the_bold" });
    const character = { ...makeCharacter(), look };
    expect(migrateCharacter(JSON.parse(JSON.stringify(character)), CHARACTER_VERSION).look).toEqual(look);
  });
});
