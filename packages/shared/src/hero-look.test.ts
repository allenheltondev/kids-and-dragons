/**
 * Hero looks' pure rules (docs/hero-looks.md §3, §6; #664): what is hers to
 * wear, the book's field-by-field merge, the stored shape, and a hero with no
 * look reading back exactly as stored.
 */

import { describe, expect, it } from "vitest";
import {
  coatPaintKey,
  coatPaintOf,
  lookSparkles,
  speciesCoat,
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
  coats: [
    { id: "midnight", name: "Midnight", unlock: { from: "starter" }, species: ["unicorn"], part: "main", color: "#223355" },
    { id: "rose", name: "Rose", unlock: { from: "starter" }, species: ["unicorn"], part: "accent", color: "#E0508F" },
    { id: "bluebell", name: "Bluebell", unlock: { from: "milestone", tier: "sworn" }, species: ["unicorn"], part: "accent", color: "#4F6BED" },
    { id: "tan", name: "Tan", unlock: { from: "starter" }, species: ["bigfoot"], part: "accent", color: "#D9A066" },
  ],
  specials: [
    { id: "aurora", name: "Aurora", unlock: { from: "found" }, effect: { kind: "sparkle" } },
    { id: "gold", name: "Gold", unlock: { from: "milestone", tier: "radiant" }, effect: { kind: "gilded", color: "#E2B13C" } },
  ],
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

describe("her colours (#666, §7.1; two parts, owner 2026-11-07)", () => {
  it("are drawn only when each is her species' own for its part", () => {
    expect(speciesCoat(CATALOG, "unicorn", "midnight")?.id).toBe("midnight");
    expect(speciesCoat(CATALOG, "bigfoot", "midnight")).toBeNull();
    expect(speciesCoat(CATALOG, "unicorn", "nonesuch")).toBeNull();
    expect(speciesCoat(CATALOG, "unicorn", null)).toBeNull();
    expect(speciesCoat(CATALOG, "unicorn", "rose")).toBeNull();
    expect(speciesCoat(CATALOG, "unicorn", "rose", "accent")?.id).toBe("rose");
    expect(speciesCoat(CATALOG, "unicorn", "midnight", "accent")).toBeNull();
  });

  it("paint both parts independently, or one alone, and nothing for none", () => {
    expect(coatPaintOf(CATALOG, "unicorn", { coat: "midnight", accent: "rose" })).toEqual({ kind: "parts", main: "#223355", accent: "#E0508F" });
    expect(coatPaintOf(CATALOG, "unicorn", { accent: "rose" })).toEqual({ kind: "parts", main: null, accent: "#E0508F" });
    expect(coatPaintOf(CATALOG, "unicorn", { coat: "midnight" })).toEqual({ kind: "parts", main: "#223355", accent: null });
    // A colour of the wrong part, or another species', is not drawn.
    expect(coatPaintOf(CATALOG, "unicorn", { coat: "rose", accent: "tan" })).toBeNull();
    expect(coatPaintOf(CATALOG, "unicorn", {})).toBeNull();
    expect(coatPaintOf(CATALOG, "unicorn", null)).toBeNull();
  });

  it("an old look with only `coat` still paints her main part", () => {
    const old = migrateLook({ v: 1, revision: 2, coat: "midnight", nameplate: null, title: null, unlocked: {} });
    expect(old).toMatchObject({ coat: "midnight", accent: null, special: null });
    expect(coatPaintOf(CATALOG, "unicorn", old)).toEqual({ kind: "parts", main: "#223355", accent: null });
  });

  it("gold ignores her colours and covers her whole figure; sparkles are not paint", () => {
    expect(coatPaintOf(CATALOG, "unicorn", { coat: "midnight", accent: "rose", special: "gold" })).toEqual({ kind: "gilded", color: "#E2B13C" });
    expect(coatPaintOf(CATALOG, "unicorn", { coat: "midnight", special: "aurora" })).toEqual({ kind: "parts", main: "#223355", accent: null });
    expect(coatPaintOf(CATALOG, "unicorn", { special: "aurora" })).toBeNull();
    expect(lookSparkles(CATALOG, { special: "aurora" })).toBe(true);
    expect(lookSparkles(CATALOG, { special: "gold" })).toBe(false);
    expect(lookSparkles(CATALOG, { special: "nonesuch" })).toBe(false);
  });

  it("key each paint apart: both colours, either alone, or the gold", () => {
    const keys = [
      coatPaintKey({ kind: "parts", main: "#aabbcc", accent: null }),
      coatPaintKey({ kind: "parts", main: null, accent: "#aabbcc" }),
      coatPaintKey({ kind: "parts", main: "#aabbcc", accent: "#112233" }),
      coatPaintKey({ kind: "gilded", color: "#aabbcc" }),
    ];
    expect(keys[0]).toBe("parts:#AABBCC:-");
    expect(new Set(keys).size).toBe(4);
  });
});

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

  it("checks each colour against its part, and a special against her receipts", () => {
    expect(lookEditProblem(CATALOG, [], { coat: "midnight", accent: "rose" }, "unicorn")).toBeNull();
    // A main colour as her accent, and an accent colour as her main: refused.
    expect(lookEditProblem(CATALOG, [], { accent: "midnight" }, "unicorn")).toMatch(/main color, not an accent/);
    expect(lookEditProblem(CATALOG, [], { coat: "rose" }, "unicorn")).toMatch(/accent color, not a main/);
    // Another species' accent.
    expect(lookEditProblem(CATALOG, [], { accent: "tan" }, "unicorn")).toMatch(/not one of her colors/);
    // An earned accent, before and after.
    expect(lookEditProblem(CATALOG, [], { accent: "bluebell" }, "unicorn")).toMatch(/not hers/);
    expect(lookEditProblem(CATALOG, ["bluebell"], { accent: "bluebell" }, "unicorn")).toBeNull();
    // A special not earned, earned, unknown; none is always fine.
    expect(lookEditProblem(CATALOG, [], { special: "gold" }, "unicorn")).toMatch(/not hers/);
    expect(lookEditProblem(CATALOG, ["gold"], { special: "gold" }, "bigfoot")).toBeNull();
    expect(lookEditProblem(CATALOG, [], { special: "nonesuch" }, "unicorn")).toMatch(/no such special/);
    expect(lookEditProblem(CATALOG, [], { special: null, accent: null }, "unicorn")).toBeNull();
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, accent: "rose" })).toBeNull();
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, special: 4 })).toBe("special");
  });

  it("checks a LOOK_EDIT's shape", () => {
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, title: "the_bold" })).toBeNull();
    expect(lookIntentProblem({ characterId: "c_1", revision: -1, title: "the_bold" })).toBe("revision");
    expect(lookIntentProblem({ characterId: "c_1", revision: 0, title: 4 })).toBe("title");
    expect(lookIntentProblem({ characterId: "c_1", revision: 0 })).toBe("nothing to change");
  });
});

describe("the book's merge (§3.2)", () => {
  it("merges her accent and special per field, as her other fields", () => {
    const stored = withLookEdit(emptyLook(), { coat: "midnight", title: "the_bold" });
    const merged = mergeBookLook(
      stored,
      [
        { field: "accent", before: null, after: "rose" },
        { field: "special", before: null, after: "gold" },
      ],
      (edit) => lookEditProblem(CATALOG, [], edit, "unicorn"),
    );
    // The accent is hers and lands; gold is not earned and is skipped; the rest stays.
    expect(merged.applied).toEqual(["accent"]);
    expect(merged.refused).toEqual(["special"]);
    expect(merged.look).toMatchObject({ coat: "midnight", accent: "rose", special: null, title: "the_bold" });
    const later = mergeBookLook(merged.look, [{ field: "special", before: null, after: "gold" }], (edit) => lookEditProblem(CATALOG, ["gold"], edit, "unicorn"));
    expect(later.look).toMatchObject({ coat: "midnight", accent: "rose", special: "gold" });
    expect(withBookLookChanges(lookView(merged.look), [{ field: "accent", before: "rose", after: null }])).toMatchObject({ accent: null, coat: "midnight" });
  });

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
