/**
 * Where a character's people live on the map, and the accents that might suit it (docs/voice-cast.md). The accent
 * ideas are a table in code; the places are canon's. Reading both together here keeps the table honest: a biome
 * canon renames or removes shows up as a failing test rather than as suggestions that quietly stop appearing.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_LABELS, ACCENTS, REGION_IDEAS, accentIdeas } from "./accents.ts";
import fs from "node:fs";
import { homelandOf, loadProfiles, readPlaces, type PlaceBook } from "./profile.ts";
import type { CastSheet } from "./sheet.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const real = readPlaces(ROOT);

const small = (): PlaceBook => ({
  biomes: new Map([
    ["biome.fields", { title: "The Fields", x: 470, y: 690 }],
    ["biome.marsh", { title: "The Marsh", x: 225, y: 620 }],
    ["biome.sea", { title: "The Open Sea", x: null, y: null }],
  ]),
  locations: new Map([["location.crossing", { title: "Stone Crossing", x: 710, y: 655, biome: "biome.fields" }]]),
  homes: new Map([
    ["npc.faun", ["biome.fields"]],
    ["npc.troll", ["location.crossing", "biome.sea"]],
    ["npc.ghost", ["biome.nowhere"]],
  ]),
});

describe("where a character's people live", () => {
  it("is the places canon gives their people, biomes and named locations alike, with the biome each is in", () => {
    expect(homelandOf(small(), "npc.faun", undefined)).toEqual({ people: "faun", source: "people", places: [{ id: "biome.fields", title: "The Fields", x: 470, y: 690, biome: "biome.fields" }] });
    const troll = homelandOf(small(), "npc.troll", undefined)!;
    expect(troll.places.map((place) => [place.id, place.biome])).toEqual([["location.crossing", "biome.fields"], ["biome.sea", "biome.sea"]]);
    // A place with no spot on the map (the sea) is still a place, just one with nothing to mark.
    expect(troll.places[1]).toMatchObject({ x: null, y: null });
  });

  it("falls back to where the character calls home, and to nothing when canon has neither", () => {
    expect(homelandOf(small(), "npc.ghost", "location.crossing")).toMatchObject({ source: "home", places: [{ id: "location.crossing" }] });
    expect(homelandOf(small(), undefined, "biome.marsh")).toMatchObject({ people: null, source: "home" });
    expect(homelandOf(small(), "npc.ghost", undefined)).toBeNull();
    expect(homelandOf(small(), undefined, undefined)).toBeNull();
    expect(homelandOf(small(), "npc.faun", "location.nowhere")!.source).toBe("people");
  });

  it("reads a species' homeland from the biomes it is the primary people of, and a people's from its own entry", () => {
    expect(homelandOf(real, "character.unicorn", undefined)!.places.map((place) => place.title)).toEqual(["Enchanted Woods"]);
    expect(homelandOf(real, "npc.skupper", undefined)!.places.map((place) => place.title)).toEqual(["The Sallow Wastelands"]);
    // The map itself prints "The Bone Yard" there, and the place keeps both.
    expect(homelandOf(real, "npc.skupper", undefined)!.places[0]).toMatchObject({ title: "The Sallow Wastelands", label: "The Bone Yard" });
    expect(homelandOf(real, "npc.faun", undefined)!.places[0]!.label).toBeUndefined();
    expect(homelandOf(real, "npc.faun", undefined)!.places[0]).toMatchObject({ title: "The Sunward Fields", biome: "biome.sunward_fields" });
    expect(homelandOf(real, "npc.stone_troll", undefined)!.places.map((place) => place.title)).toEqual(["Stone Crossing", "Skullwater Cave"]);
    // Stone Crossing is in the Eastern Plains, which is the biome its accent ideas come from.
    expect(homelandOf(real, "npc.stone_troll", undefined)!.places[0]!.biome).toBe("biome.eastern_plains");
  });

  it("gives every place on the map a spot to mark, except the open sea", () => {
    const places = [...real.biomes].map(([id, biome]) => ({ id, ...biome }));
    expect(places.filter((place) => place.x === null).map((place) => place.id)).toEqual(["biome.open_sea"]);
    for (const place of places.filter((p) => p.x !== null)) {
      expect(place.x!, place.id).toBeGreaterThanOrEqual(0);
      expect(place.x!, place.id).toBeLessThanOrEqual(1000);
      expect(place.y!, place.id).toBeLessThanOrEqual(1000);
    }
  });
});

describe("the accents to suggest", () => {
  it("names each accent once, and says how it sounds", () => {
    expect(new Set(ACCENT_LABELS).size).toBe(ACCENTS.length);
    for (const accent of ACCENTS) expect(accent.note.length, accent.label).toBeGreaterThan(10);
    // The sheet's own default is on the list, so choosing it again is one click.
    expect(ACCENT_LABELS).toContain("General American");
  });

  it("keeps to regional accents of English, not another language's English", () => {
    expect(ACCENT_LABELS.some((label) => /accent|foreign|asian|african|indian|chinese|japanese|russian|german|french|italian|spanish|mexican|arab/i.test(label))).toBe(false);
  });

  it("only has ideas for real places on the map, naming accents that are on the list", () => {
    for (const [biome, idea] of Object.entries(REGION_IDEAS)) {
      expect(real.biomes.has(biome), `${biome} is a biome in canon`).toBe(true);
      expect(idea.accents.length, biome).toBeGreaterThan(0);
      for (const accent of idea.accents) expect(ACCENT_LABELS, `${biome}: ${accent}`).toContain(accent);
    }
  });

  it("has an idea for every place anyone lives, but the places where nobody does", () => {
    const lived = new Set([...real.homes.values()].flat().map((id) => real.locations.get(id)?.biome ?? id));
    const missing = [...lived].filter((biome) => !REGION_IDEAS[biome]);
    expect(missing).toEqual([]);
    // The Expanse is a waste where nobody confirmed lives.
    expect(REGION_IDEAS["biome.expanse"]).toBeUndefined();
  });

  it("offers the accents that suit most of a character's places first, each with why", () => {
    const ideas = accentIdeas(["biome.sky_islands", "biome.glacier_of_origins", "biome.expanse"], (id) => real.biomes.get(id)?.title ?? id);
    expect(ideas[0]!.accent.label).toBe("Scottish (Highland)");
    expect(ideas[0]!.because).toEqual(["Sky Islands: windswept islands far from the mainland", "Glacier of Origins: a cold, remote and ancient glacier"]);
    expect(ideas.map((idea) => idea.accent.label)).toEqual(["Scottish (Highland)", "Pacific Northwest American", "Canadian"]);
    expect(accentIdeas(["biome.expanse"])).toEqual([]);
    expect(accentIdeas([])).toEqual([]);
    // The same place twice counts once.
    expect(accentIdeas(["biome.plains", "biome.plains"])[0]!.because).toHaveLength(1);
  });
});

describe("a character's profile, from the real canon", () => {
  const sheet = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "voice", "cast.json"), "utf8")) as CastSheet;
  const profiles = loadProfiles(ROOT, sheet);

  it("says where their people live, and what accents that suggests", () => {
    // Pib is a harvest sprite, whose homeland is the Sunward Fields; the Enchanted Woods lists harvest sprites too.
    const pib = profiles.pib!;
    expect(pib.homeland).toMatchObject({ people: "harvest sprite", source: "people" });
    expect(pib.homeland!.places.map((place) => place.title)).toEqual(["Enchanted Woods", "The Sunward Fields"]);
    // West Country English suits both places, so it comes first.
    expect(pib.accentIdeas[0]).toMatchObject({ label: "West Country English" });
    expect(pib.accentIdeas[0]!.because).toHaveLength(2);
    expect(pib.accentIdeas.map((idea) => idea.label)).toEqual(["West Country English", "Midwestern American", "Irish", "New Zealand"]);
  });

  it("has nothing to say for someone with no people on the map", () => {
    expect(profiles.narrator!.homeland).toBeNull();
    expect(profiles.narrator!.accentIdeas).toEqual([]);
  });

  it("can be sent to the page as it is, with the map's pins inside the map", () => {
    const sent = JSON.parse(JSON.stringify(profiles.pib)) as typeof profiles.pib;
    for (const place of sent!.homeland!.places) {
      expect(place.x, place.id).toBeGreaterThan(0);
      expect(place.x!, place.id).toBeLessThan(1000);
      expect(place.y!, place.id).toBeLessThan(1000);
    }
  });
});
