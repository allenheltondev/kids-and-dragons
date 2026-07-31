/**
 * The schemas are only worth what they reject.
 *
 * These run against the **real** `canon/` corpus rather than fixtures, because
 * the thing being asserted is a property of the corpus — that it satisfies a
 * schema strict enough to be worth deriving from. A fixture would pass forever
 * while the files rotted.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanon } from "./index.js";
import { buildRegistry } from "./registry.js";
import { parseCanon } from "./parse.js";
import { Creature, Biome } from "./taxonomies.js";
import { canonRef, edge, prefixOf, refTargets, slugOf, TAXONOMIES, TAXONOMY_PREFIX } from "./ids.js";
import { errors, related } from "./registry.js";

const CANON_DIR = path.join(process.cwd(), "canon");
const registry = loadCanon(CANON_DIR);

/** D11 — references to places canon names but has never defined. Mirrors the
 *  allowlist in tools/canon/check.ts; both may only shrink. */
const KNOWN_GAPS = ["open_sea", "the_whirlpool", "bramblewood"];
const isKnownGap = (message: string) => KNOWN_GAPS.some((gap) => message.includes(`"${gap}"`));

describe("canon corpus", () => {
  it("parses and validates every entity", () => {
    const real = errors(registry).filter((issue) => !isKnownGap(issue.message));
    expect(real.map((issue) => `${issue.file} ${issue.id ?? ""} ${issue.message}`)).toEqual([]);
  });

  it("has every taxonomy populated", () => {
    for (const taxonomy of TAXONOMIES) {
      expect(registry.byTaxonomy.get(taxonomy)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("keeps the known-gap list from growing", () => {
    const gaps = errors(registry).filter((issue) => isKnownGap(issue.message));
    expect(gaps).toHaveLength(8);
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
    expect(refTargets(canonRef("biome", "region").description)).toEqual(["biome", "region"]);
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
    geography_id: "geography.nowhere",
    map_label: "Test Wood",
    canon_status: "confirmed",
    environment_type: "biome_region",
    climate: "mild",
    danger_level: "low",
    short_description: "A wood, for testing.",
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
    expect(dangling[0]?.field).toBe("geography_id");
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
