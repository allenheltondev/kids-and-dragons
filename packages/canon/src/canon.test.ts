/**
 * The schemas are only worth what they reject.
 *
 * These run against the **real** `canon/` corpus rather than fixtures, because
 * the thing being asserted is a property of the corpus — that it satisfies a
 * schema strict enough to be worth deriving from. A fixture would pass forever
 * while the files rotted.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanon } from "./index.js";
import { buildRegistry } from "./registry.js";
import { parseCanon } from "./parse.js";
import { Creature, Biome } from "./taxonomies.js";
import type { Creature as CreatureEntity } from "./taxonomies.js";
import { BANDS, BANDS_BY_DANGER, ENCOUNTER_HP_WINDOW, resolveStats } from "./encounter.js";
import { canonRef, edge, prefixOf, refTargets, slugOf, TAXONOMIES, TAXONOMY_PREFIX } from "./ids.js";
import { checkAssets, errors, related } from "./registry.js";

const CANON_DIR = path.join(process.cwd(), "canon");
const registry = loadCanon(CANON_DIR);

describe("canon corpus", () => {
  it("parses and validates every entity, with every reference resolving", () => {
    const real = errors(registry);
    expect(real.map((issue) => `${issue.file} ${issue.id ?? ""} ${issue.message}`)).toEqual([]);
  });

  it("has every taxonomy populated", () => {
    for (const taxonomy of TAXONOMIES) {
      expect(registry.byTaxonomy.get(taxonomy)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("indexes edges in both directions", () => {
    // Declared forward: the biome names its own wildlife.
    const outbound = related(registry, "biome.enchanted_woods", { direction: "out" });
    expect(outbound.some((edge) => edge.to === "creature.mosshorn")).toBe(true);

    // Declared backwards: the creature names the biome. Both directions have to
    // answer "what lives here", or half the corpus is invisible to a generator.
    const inbound = related(registry, "biome.enchanted_woods", { direction: "in" });
    expect(inbound.some((edge) => edge.from === "creature.mosshorn")).toBe(true);
  });

  it("exposes agent_instructions per taxonomy", () => {
    // §8: these ride along with every fetch, because they are the guardrails.
    expect(registry.instructions.creature?.length).toBeGreaterThan(0);
  });
});

describe("ids", () => {
  it("derives taxonomy from an id alone — the point of D2", () => {
    expect(prefixOf("creature.glassback_crab")).toBe("creature");
    expect(slugOf("creature.glassback_crab")).toBe("glassback_crab");
    expect(prefixOf("glassback_crab")).toBeNull();
    expect(prefixOf("nonsense.thing")).toBeNull();
  });

  it("every taxonomy prefix is one the id regex accepts", () => {
    for (const taxonomy of TAXONOMIES) {
      expect(prefixOf(`${TAXONOMY_PREFIX[taxonomy]}.a_thing`)).toBe(TAXONOMY_PREFIX[taxonomy]);
    }
  });

  it("tags a ref with the taxonomies it may point at", () => {
    expect(refTargets(canonRef("biome", "location").description)).toEqual(["biome", "location"]);
    expect(refTargets(edge("creature").unwrap().element.description)).toEqual(["creature"]);
    expect(refTargets("not a ref")).toBeNull();
  });
});

describe("schema strictness", () => {
  const valid = {
    id: "creature.test_beast",
    title: "Test Beast",
    canon_status: "confirmed",
    classification: "ambient_creature",
    sapience: "animal",
    scale: "small",
    danger_level: "low",
    short_description: "A beast, for testing.",
    relationships: { primary_locations: [], creatures: [], items: [] },
  };

  it("accepts a well-formed entity and defaults the optional lists", () => {
    const parsed = Creature.parse(valid);
    expect(parsed.tags).toEqual([]);
    expect(parsed.featured).toBe(false);
  });

  it("rejects an unrecognised field", () => {
    // The bug this prevents: a typo'd `visual_identtiy` silently vanishing
    // from the art brief with nothing to notice it.
    const result = Creature.safeParse({ ...valid, visual_identtiy: "oops" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects a kebab-case tag — D12", () => {
    expect(Creature.safeParse({ ...valid, tags: ["ancient-forest"] }).success).toBe(false);
    expect(Creature.safeParse({ ...valid, tags: ["ancient_forest"] }).success).toBe(true);
  });

  it("rejects a bare id", () => {
    expect(Creature.safeParse({ ...valid, id: "test_beast" }).success).toBe(false);
  });

  it("rejects a canon_status outside the shared vocabulary — D1", () => {
    expect(Creature.safeParse({ ...valid, canon_status: "map_canonical" }).success).toBe(false);
  });

  it("no longer accepts the alias fields D3 deleted", () => {
    expect(Creature.safeParse({ ...valid, canonical_creature_id: "test_beast" }).success).toBe(false);
  });
});

describe("registry integrity", () => {
  const testWood = {
    id: "biome.test_wood",
    title: "Test Wood",
    asset_id: "test_wood",
    map_label: "Test Wood",
    map_provenance: "map_implied",
    relative_position: "nowhere",
    canon_status: "confirmed",
    environment_type: "biome_region",
    climate: "mild",
    danger_level: "low",
    short_description: "A wood, for testing.",
    parent_biome: "biome.nowhere",
    inhabitants: {
      primary_peoples: [],
      supporting_peoples: [],
      cultural_orders: [],
      ambient_creatures: [],
      dangerous_creatures: [],
      legendary_beings: [],
      supernatural_manifestations: [],
    },
    relationships: { locations: [], factions: [], items: [] },
  };

  it("reports a dangling reference once, not once per referrer", () => {
    const parsed = Biome.parse(testWood);
    const built = buildRegistry({
      entities: [{ taxonomy: "biome", file: "test.yaml", entity: parsed }],
      issues: [],
      instructions: {},
    });
    const dangling = errors(built).filter((issue) => issue.message.includes("does not exist"));
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.field).toBe("parent_biome");
  });

  it("rejects a reference to a real entity of the wrong taxonomy", () => {
    // `ambient_creatures` pointing at a real *item*. A prefix check cannot
    // catch this — `item.crimson_shard` is a perfectly well-formed id — but
    // checking against the built registry can.
    const offender = Biome.parse({
      ...testWood,
      inhabitants: { ...testWood.inhabitants, ambient_creatures: ["item.crimson_shard"] },
    });
    const built = buildRegistry({
      entities: [
        { taxonomy: "biome", file: "test.yaml", entity: offender },
        ...parseCanon(CANON_DIR).entities,
      ],
      issues: [],
      instructions: {},
    });
    expect(
      errors(built).some(
        (issue) =>
          issue.id === "biome.test_wood" && issue.message.includes("references a item"),
      ),
    ).toBe(true);
  });
});

describe("encounter blocks — D9/D10", () => {
  const creatures = [...registry.byTaxonomy.get("creature")!] as CreatureEntity[];
  const dangerous = creatures.filter((c) => c.classification !== "ambient_creature");

  it("gives every dangerous creature a stat block and every ambient one none", () => {
    expect(dangerous.every((c) => c.encounter)).toBe(true);
    expect(
      creatures.filter((c) => c.classification === "ambient_creature").every((c) => !c.encounter),
    ).toBe(true);
  });

  it("offers a way past every dangerous creature that is not a fight", () => {
    // creatures.yaml agent_instructions: "Encounters should usually permit more
    // than combat." This is that instruction, enforced.
    for (const c of dangerous) {
      expect(c.encounter?.resolutions.length, c.id).toBeGreaterThan(0);
    }
  });

  it("resolves stats from the band, so no creature carries loose integers", () => {
    for (const c of dangerous) {
      const stats = resolveStats(c.encounter!);
      expect(stats, c.id).not.toBeNull();
      expect(stats!.hp).toBeGreaterThan(0);
    }
  });

  it("keeps band and danger_level from disagreeing", () => {
    for (const c of dangerous) {
      expect(BANDS_BY_DANGER[c.danger_level], c.id).toContain(c.encounter!.band);
    }
  });

  it("lands a usual-count encounter inside the four-round HP window", () => {
    // The invariant that matters is the *encounter* total, not any one creature:
    // one brute and three skirmishers are both fine, and only the sum says so.
    for (const band of ["skirmisher", "lurker", "brute", "sentinel"] as const) {
      const row = BANDS[band];
      const total = row.stats!.hp * row.usualCount;
      expect(total, band).toBeGreaterThanOrEqual(ENCOUNTER_HP_WINDOW.min);
      expect(total, band).toBeLessThanOrEqual(ENCOUNTER_HP_WINDOW.max);
    }
  });

  it("reproduces the stat block the shipped chapter has always used", () => {
    // The skirmisher row was derived from bramblewood-01.json's Bramblewisp.
    // If this fails, either the band table moved or the chapter did.
    const wisp = resolveStats(
      creatures.find((c) => c.id === "creature.will_o_wisp")!.encounter!,
    );
    expect(wisp).toEqual({ hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 });
  });

  it("rejects an ambient creature that grows a stat block", () => {
    const ambient = creatures.find((c) => c.classification === "ambient_creature")!;
    const result = Creature.safeParse({
      ...ambient,
      encounter: { band: "brute", resolutions: [{ kind: "escape", stat: "quick", difficulty: "easy" }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a legend with no authored stats — the band has none to give", () => {
    const dragon = creatures.find((c) => c.id === "creature.legend_dragon")!;
    const { stats: _dropped, ...rest } = dragon.encounter!;
    expect(Creature.safeParse({ ...dragon, encounter: rest }).success).toBe(false);
  });
});

describe("asset_id is a real join", () => {
  it("points every creature and people at art that exists", () => {
    // D3 left asset_id as the single join to assets/, content/ and the
    // bestiary, and nothing checked it. The corpus is exactly 1:1 with
    // assets/entities/ today; this keeps that true rather than rediscovered.
    const missing = checkAssets(registry, path.join(process.cwd(), "assets"), (p) =>
      fs.existsSync(p),
    );
    expect(missing.map((issue) => `${issue.id} → ${issue.file}`)).toEqual([]);
  });
});
