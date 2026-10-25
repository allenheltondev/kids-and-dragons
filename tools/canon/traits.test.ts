/**
 * Monster traits and species opinions (docs/matchups.md): canon's `encounter.traits`
 * and `lore.likes` / `lore.dislikes` reach `content/bestiary.json` and agree with
 * the trait table in `content/rules.json`.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanon } from "@kad/canon";
import type { Creature } from "@kad/canon";
import { PLAYABLE_SPECIES, speciesOpinions } from "./opinions.ts";
import { checkBands } from "./bands.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(path.join(REPO, rel), "utf8"));
const rules = read("content/rules.json");
const traitTable: Record<string, unknown> = rules.matchups.traits;
const creatures = (loadCanon(path.join(REPO, "canon")).byTaxonomy.get("creature") ?? []) as Creature[];
const banded = creatures.filter((c) => c.encounter?.band);

describe("creature traits", () => {
  it("gives every banded creature one or two traits from the table", () => {
    expect(Object.keys(traitTable).length).toBeGreaterThan(0);
    for (const c of banded) {
      const traits = c.encounter!.traits ?? [];
      expect(traits.length, c.id).toBeGreaterThanOrEqual(1);
      expect(traits.length, c.id).toBeLessThanOrEqual(2);
      expect(new Set(traits).size, c.id).toBe(traits.length);
      for (const t of traits) expect(traitTable, `${c.id} ${t}`).toHaveProperty(t);
    }
  });

  it("checkBands objects to an unknown trait", () => {
    const bad = structuredClone(banded[0]!) as Creature;
    bad.encounter!.traits = ["no_such_trait"];
    const issues = checkBands([bad], rules);
    expect(issues.some((i) => i.field === "encounter.traits" && i.level === "error")).toBe(true);
  });

  it("stays quiet about traits while the table is empty", () => {
    const empty = { ...rules, matchups: { ...rules.matchups, traits: {} } };
    expect(checkBands(banded, empty).filter((i) => i.field === "encounter.traits")).toEqual([]);
  });
});

describe("species opinions", () => {
  const byAsset = (id: string) => creatures.find((c) => (c.asset_id ?? c.id) === id)!;

  it("keeps only playable species", () => {
    expect(speciesOpinions([{ of: "npc.yeti" }, { of: "character.bigfoot" }, { of: "creature.cinder_wolf" }])).toEqual(["bigfoot"]);
    expect(speciesOpinions(undefined)).toEqual([]);
    expect(PLAYABLE_SPECIES).toHaveLength(6);
  });

  it("reads mosshorn as liking bigfoot and unicorn", () => {
    expect(speciesOpinions(byAsset("mosshorn").lore?.likes)).toEqual(["bigfoot", "unicorn"]);
  });

  it("reads kitsune as disliked by the jackalope-style creature in canon", () => {
    const disliked = creatures.filter((c) => speciesOpinions(c.lore?.dislikes).length);
    expect(disliked.length).toBeGreaterThan(0);
  });
});

describe("bestiary projection", () => {
  it("matches canon for traits, likes and dislikes", () => {
    const { creatures: projected } = read("content/bestiary.json");
    for (const c of banded) {
      const entry = projected[c.asset_id ?? c.id.replace(/^creature\./, "")];
      expect(entry, c.id).toBeDefined();
      expect(entry.traits, c.id).toEqual(c.encounter!.traits);
      const likes = speciesOpinions(c.lore?.likes);
      const dislikes = speciesOpinions(c.lore?.dislikes);
      expect(entry.likes, c.id).toEqual(likes.length ? likes : undefined);
      expect(entry.dislikes, c.id).toEqual(dislikes.length ? dislikes : undefined);
    }
    expect(projected.glassback_crab.likes).toEqual(["dragonling"]);
    expect(projected.frost_wyrm.dislikes).toEqual(["griffin"]);
  });

  it("regenerates byte for byte", () => {
    const before = readFileSync(path.join(REPO, "content/bestiary.json"), "utf8");
    execFileSync("npx", ["tsx", "tools/canon/bestiary.ts"], { cwd: REPO, stdio: "pipe" });
    expect(readFileSync(path.join(REPO, "content/bestiary.json"), "utf8")).toBe(before);
  });
});
