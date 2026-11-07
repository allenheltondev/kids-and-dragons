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
    expect(CATALOG.nameplates.map((n) => n.id)).toEqual(["plain", "ribbon", "leafy", "starry"]);
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

  it("refuses a delivered frame the catalog does not paint", () => {
    expect(problems(CATALOG, { ids: ["plain"] }).some((p) => p.includes('"plain" is not a frame with art'))).toBe(true);
    expect(problems(CATALOG, { ids: ["ribbon"] })).toEqual([]);
  });
});
