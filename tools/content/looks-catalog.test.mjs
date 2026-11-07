/**
 * The hero looks catalog (#664, docs/hero-looks.md §3.1): the shipped one is
 * clean, and the checker catches what the schema cannot see.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksCatalogProblems } from "./looks-catalog.mjs";

const read = (...p) => JSON.parse(readFileSync(new URL(`../../${p.join("/")}`, import.meta.url), "utf8"));
const CATALOG = read("content", "looks.json");
const RULES = read("content", "rules.json");
const CAMP = read("content", "camp.json");
const MANIFEST = read("assets", "manifest.json");

const input = (catalog, manifest = MANIFEST.nameplateFrames) => ({
  catalog,
  manifest,
  tiers: new Set(Object.keys(RULES.tierLevels)),
  classes: new Set(Object.keys(RULES.classes)),
  campaigns: new Set(["gemfall", "riftlight", "the-hollow-crown", "first-steps"]),
  friends: new Set(CAMP.friends.map((f) => f.id)),
  species: new Set(Object.keys(RULES.species)),
});
const problems = (catalog, manifest) => looksCatalogProblems(input(catalog, manifest)).map((p) => `${p.at}: ${p.problem}`);

describe("content/looks.json", () => {
  it("is clean as shipped, with the four starter frames and three starter titles", () => {
    expect(problems(CATALOG)).toEqual([]);
    expect(CATALOG.nameplates.filter((n) => n.unlock.from === "starter").map((n) => n.id)).toEqual(["plain", "ribbon", "leafy", "starry"]);
    expect(CATALOG.titles.filter((t) => t.unlock.from === "starter").map((t) => t.text)).toEqual(["the Bold", "the Kind", "the Curious"]);
  });

  it("catches a duplicate id, a rule naming nothing, and a frame's art out of place", () => {
    const broken = structuredClone(CATALOG);
    broken.titles.push({ id: "ribbon", text: "the Ribbon", unlock: { from: "starter" } });
    broken.titles.push({ id: "of_nowhere", text: "of Nowhere", unlock: { from: "milestone", campaign: "nowhere" } });
    broken.nameplates[1].art = "nameplates/wrong.webp";
    const found = problems(broken);
    expect(found.some((p) => p.includes('"ribbon" is already'))).toBe(true);
    expect(found.some((p) => p.includes('no campaign "nowhere"'))).toBe(true);
    expect(found.some((p) => p.includes("nameplates/ribbon.webp"))).toBe(true);
  });

  it("insists on the plain plate, free and with no art", () => {
    const broken = structuredClone(CATALOG);
    broken.nameplates[0].art = "nameplates/plain.webp";
    expect(problems(broken).some((p) => p.includes("the plain plate has no art"))).toBe(true);
    broken.nameplates.shift();
    expect(problems(broken).some((p) => p.includes('no "plain" nameplate'))).toBe(true);
  });

  it("gives every species about six starter colors of its own (#666, §7.1)", () => {
    for (const species of Object.keys(RULES.species)) {
      const starters = CATALOG.coats.filter((c) => c.species.includes(species) && c.unlock.from === "starter");
      expect(starters.length, species).toBe(6);
      for (const coat of starters) expect(coat.species, coat.id).toEqual([species]);
    }
  });

  it("catches a species short of colors, and two colors with one name or one color", () => {
    const broken = structuredClone(CATALOG);
    broken.coats = broken.coats.filter((c) => !c.species.includes("griffin") || c.id === "griffin_snowy");
    const unicorn = broken.coats.find((c) => c.id === "unicorn_sky");
    broken.coats.push({ ...unicorn, id: "unicorn_sky_again" });
    const found = problems(broken);
    expect(found.some((p) => p.includes("griffin has 1 starter colors"))).toBe(true);
    expect(found.some((p) => p.includes('already has a color called "Sky"'))).toBe(true);
    expect(found.some((p) => p.includes("is already unicorn_sky"))).toBe(true);
  });

  it("refuses a delivered frame the catalog does not paint", () => {
    expect(problems(CATALOG, { ids: ["plain"] }).some((p) => p.includes('"plain" is not a frame with art'))).toBe(true);
    expect(problems(CATALOG, { ids: ["ribbon"] })).toEqual([]);
  });

  it("keeps special coats earned, and a two-tone's halves apart (#669, §5.5)", () => {
    const broken = structuredClone(CATALOG);
    const sky = broken.coats.find((c) => c.id === "unicorn_sky");
    sky.effect = { kind: "two-tone", dark: sky.color };
    const found = problems(broken);
    expect(found.some((p) => p.includes("is a special coat and a starter"))).toBe(true);
    expect(found.some((p) => p.includes("dark half is its light half"))).toBe(true);
  });
});

describe("look finds in chapters (#669, §6)", () => {
  const all = ["unicorn", "bigfoot", "dragonling", "griffin", "kitsune", "manticore"].map((s) => `${s}_aurora`);
  const chapter = (effects) => ({ id: "ch-1", scenes: { a: { type: "story", onEnter: effects, choices: [] } } });
  const findProblems = (chapters) =>
    looksCatalogProblems({ ...input(CATALOG), chapters: new Map(chapters.map((c) => [c.id, c])) }).map((p) => `${p.at}: ${p.problem}${p.warning ? " (warning)" : ""}`);
  const placed = [
    chapter([{ type: "findLook", looks: ["the_tracker", "songbird", ...all], rewardId: "ch-1.gift" }]),
  ];

  it("passes a find of found looks with one coat per species, under the chapter's reward", () => {
    expect(findProblems(placed)).toEqual([]);
  });

  it("catches a look that is no find, a coat find missing a species, a reward not the chapter's, and one reward naming two sets", () => {
    const found = findProblems([
      chapter([
        { type: "findLook", looks: ["the_bold", "unicorn_aurora"], rewardId: "elsewhere.gift" },
        { type: "findLook", looks: ["the_tracker"], rewardId: "elsewhere.gift" },
        { type: "findLook", looks: ["no_such_look"], rewardId: "ch-1.x" },
      ]),
    ]);
    expect(found.some((p) => p.includes('"the_bold" is not a found look'))).toBe(true);
    expect(found.some((p) => p.includes("a coat find with no coat for bigfoot"))).toBe(true);
    expect(found.some((p) => p.includes('"elsewhere.gift" is not "ch-1.<name>"'))).toBe(true);
    expect(found.some((p) => p.includes("names other looks elsewhere"))).toBe(true);
    expect(found.some((p) => p.includes('no look "no_such_look"'))).toBe(true);
  });

  it("warns of a found look no chapter hands over, without failing a trimmed set of chapters", () => {
    const found = findProblems([chapter([])]);
    expect(found.some((p) => p.includes('"the_tracker" is found, but no chapter hands it over (warning)'))).toBe(true);
  });
});
