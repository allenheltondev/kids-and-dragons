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
import { Creature, Biome, Individual, Item } from "./taxonomies.js";
import type {
  Creature as CreatureEntity,
  Individual as IndividualEntity,
  Item as ItemEntity,
} from "./taxonomies.js";
import { bandTable, ENCOUNTER_HP_WINDOW, resolveStats } from "./encounter.js";
import { canonRef, edge, prefixOf, refTargets, slugOf, TAXONOMIES, TAXONOMY_PREFIX } from "./ids.js";
import { checkAssets, errors, related } from "./registry.js";

/**
 * Reads an authored catalog, dropping its `$`-prefixed annotations — the same
 * rule as `itemCatalog()` in @kad/shared, restated rather than imported so
 * this package keeps depending on nothing but yaml and zod (see index.ts).
 */
function realEntries<T>(raw: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(raw).filter(([id]) => !id.startsWith("$")));
}

const CANON_DIR = path.join(process.cwd(), "canon");
const registry = loadCanon(CANON_DIR);
/** The numbers live in content/rules.json now — canon only names the band. */
const BANDS = bandTable(
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "rules.json"), "utf8")),
);

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

  it("checks refs nested inside object arrays — place lore and separated_from", () => {
    // The single-cursor walk used to dead-end at an array of objects, which
    // silently exempted `separated_from.region` and every lore ref from
    // integrity checking. `readAll` fans out; this is the regression pin.
    const storied = Biome.parse({
      ...testWood,
      parent_biome: undefined,
      lore: {
        origin: "Grown, for testing.",
        regional_relationships: [
          { place: "biome.nowhere_home", relationship: "testing" },
        ],
      },
    });
    const built = buildRegistry({
      entities: [{ taxonomy: "biome", file: "test.yaml", entity: storied }],
      issues: [],
      instructions: {},
    });
    const dangling = errors(built).filter((issue) => issue.message.includes("does not exist"));
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.field).toBe("lore.regional_relationships.place");
  });

  it("indexes a regional relationship as a reverse edge — who has history with *them*", () => {
    // "The test wood depends on the marsh" should be answerable from the
    // marsh's side without anyone authoring the reverse sentence.
    const neighbourly = Biome.parse({
      ...testWood,
      parent_biome: undefined,
      lore: {
        origin: "Grown next to a marsh, for testing.",
        regional_relationships: [
          { place: "biome.whispering_marsh", relationship: "downstream of it" },
        ],
      },
    });
    const built = buildRegistry({
      entities: [
        { taxonomy: "biome", file: "test.yaml", entity: neighbourly },
        ...parseCanon(CANON_DIR).entities,
      ],
      issues: [],
      instructions: {},
    });
    const inbound = related(built, "biome.whispering_marsh", { direction: "in" });
    expect(
      inbound.some(
        (edge) =>
          edge.from === "biome.test_wood" && edge.field === "lore.regional_relationships.place",
      ),
    ).toBe(true);
  });

  it("gives a place the place lore shape, not a personality", () => {
    // A biome does not have pastimes; a creature does not have an origin myth.
    // The envelope's `lore` is overridden on Place, and strictness keeps the
    // two shapes from bleeding into each other.
    expect(
      Biome.safeParse({
        ...testWood,
        parent_biome: undefined,
        lore: { story: "A wood with opinions." },
      }).success,
    ).toBe(false);
    expect(
      Biome.safeParse({
        ...testWood,
        parent_biome: undefined,
        lore: { origin: "Grown, for testing.", hidden_truths: ["it is a test"] },
      }).success,
    ).toBe(true);
    // `origin` is the required field: place lore with no origin is a mood
    // board, and the envelope already has one of those.
    expect(
      Biome.safeParse({
        ...testWood,
        parent_biome: undefined,
        lore: { common_beliefs: ["unfounded"] },
      }).success,
    ).toBe(false);
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
      const stats = resolveStats(c.encounter!, BANDS);
      expect(stats, c.id).not.toBeNull();
      expect(stats!.hp).toBeGreaterThan(0);
    }
  });

  it("keeps band and danger_level from disagreeing", () => {
    for (const c of dangerous) {
      expect(BANDS[c.encounter!.band]?.dangerLevels, c.id).toContain(c.danger_level);
    }
  });

  it("lands a usual-count encounter inside the four-round HP window", () => {
    // The invariant that matters is the *encounter* total, not any one creature:
    // one brute and three skirmishers are both fine, and only the sum says so.
    for (const [band, row] of Object.entries(BANDS)) {
      if (!row.stats) continue; // `legend` has no default, by design
      const total = row.stats.hp * row.usualCount;
      expect(total, band).toBeGreaterThanOrEqual(ENCOUNTER_HP_WINDOW.min);
      expect(total, band).toBeLessThanOrEqual(ENCOUNTER_HP_WINDOW.max);
    }
  });

  it("reproduces the stat block the shipped chapter has always used", () => {
    // The skirmisher row was derived from bramblewood-01.json's Bramblewisp.
    // If this fails, either the band table moved or the chapter did.
    const wisp = resolveStats(
      creatures.find((c) => c.id === "creature.will_o_wisp")!.encounter!,
      BANDS,
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

  it("resolves nothing for a legend with no authored stats", () => {
    // The band has none to give, so this is the case tools/canon/check.ts
    // fails the build on — the schema alone cannot see it.
    const dragon = creatures.find((c) => c.id === "creature.legend_dragon")!;
    const { stats: _dropped, ...rest } = dragon.encounter!;
    expect(resolveStats(rest, BANDS)).toBeNull();
  });

  it("reads its numbers from content/rules.json, not from code", () => {
    // The whole point of the split: canon says will_o_wisp is a skirmisher,
    // rules.json says what a skirmisher is worth. Retuning is a content edit.
    expect(BANDS["skirmisher"]?.stats?.hp).toBe(6);
    expect(Object.keys(BANDS).length).toBeGreaterThanOrEqual(5);
  });
});

describe("item mechanics — D7", () => {
  const items = [...(registry.byTaxonomy.get("item") ?? [])] as ItemEntity[];
  const playable = items.filter((item) => item.mechanics);
  /** The projection every consumer actually reads. */
  const catalog = realEntries<{ kind: string; name: string; text: string; effect?: unknown }>(
    JSON.parse(fs.readFileSync(path.join(process.cwd(), "content", "items.json"), "utf8")),
  );

  it("projects exactly the items that carry mechanics", () => {
    // The Crystal Heart is canon and is not in anybody's bag. `mechanics`
    // absent is a claim about the world, not an unfinished entry.
    for (const item of playable) expect(catalog[slugOf(item.id)], item.id).toBeDefined();
    for (const item of items) {
      if (!item.mechanics) expect(catalog[slugOf(item.id)], item.id).toBeUndefined();
    }
  });

  it("keeps the catalog and canon saying the same thing", () => {
    // The failure this catches is a hand-edit of the generated file.
    for (const item of playable) {
      const shipped = catalog[slugOf(item.id)]!;
      expect(shipped.name, item.id).toBe(item.title);
      expect(shipped.text, item.id).toBe(item.mechanics!.text);
      expect(shipped.effect, item.id).toEqual(item.mechanics!.effect);
    }
  });

  it("refuses a consumable with nothing to do and a trinket that is used", () => {
    const base = {
      id: "item.test_thing",
      title: "Test Thing",
      canon_status: "confirmed",
      category: "provision",
      rarity: "common",
      acquisition: "Made up, for testing.",
      relationships: { found_in: [], dropped_by: [], factions: [], quests: [] },
    };
    const mechanics = { kind: "consumable", icon: "potion", text: "Does a thing." };
    expect(Item.safeParse({ ...base, mechanics }).success).toBe(false);
    expect(
      Item.safeParse({
        ...base,
        mechanics: { ...mechanics, effect: { type: "heal", amount: 2 } },
      }).success,
    ).toBe(true);
    expect(
      Item.safeParse({
        ...base,
        mechanics: { ...mechanics, kind: "trinket", effect: { type: "heal", amount: 2 } },
      }).success,
    ).toBe(false);
  });

  it("holds chapter props out of canon but inside the catalog", () => {
    // D7's split, stated as one assertion: the rusted key opens one door in
    // one chapter, so it is not a fact about the Realm — but a quest item
    // outlives its chapter, so the catalog still has to be able to name it.
    expect(catalog["rusted_key"]?.kind).toBe("quest");
    expect(registry.byId.has("item.rusted_key")).toBe(false);
  });

  it("keeps the catalog one namespace", () => {
    // What `tools/canon/items.ts` refuses to project. A prop shadowing a canon
    // item would make `grantItem` mean two different things by chapter.
    const props = Object.keys(
      realEntries(
        (
          JSON.parse(
            fs.readFileSync(
              path.join(process.cwd(), "content", "chapters", "bramblewood-01.json"),
              "utf8",
            ),
          ) as { props?: Record<string, unknown> }
        ).props ?? {},
      ),
    );
    expect(props.length).toBeGreaterThan(0);
    for (const id of props) expect(registry.byId.has(`item.${id}`), id).toBe(false);
  });
});

describe("named individuals — D8", () => {
  const individuals = [...(registry.byTaxonomy.get("individual") ?? [])] as IndividualEntity[];

  it("gives every individual a home that is a real location", () => {
    // The defining rule, and the reason `home` is required rather than
    // optional: an individual is canon because a place owns them.
    expect(individuals.length).toBeGreaterThan(0);
    for (const person of individuals) {
      expect(registry.taxonomyOf.get(person.home), person.id).toBe("location");
    }
  });

  it("refuses an individual belonging to nowhere", () => {
    const homeless = {
      id: "individual.nobody",
      title: "Nobody",
      canon_status: "confirmed",
      role: "innkeeper",
      pronouns: "they/them",
      relationships: { haunts: [], people: [], factions: [], creatures: [], items: [], quests: [] },
    };
    expect(Individual.safeParse(homeless).success).toBe(false);
    expect(Individual.safeParse({ ...homeless, home: "location.bramblewood" }).success).toBe(true);
  });

  it("lets a location answer who lives there, without the location saying so", () => {
    // The reverse index doing the work it exists for: `home` points one way and
    // nobody has to keep a roster on the town.
    const residents = related(registry, "location.bramblewood", { direction: "in", field: "home" });
    expect(residents.map((edge) => edge.from)).toContain("individual.pib");
  });

  it("keeps chapter-scoped characters out of canon", () => {
    // bramblewood-01 voices three: Pib, a wisp with a rhyming habit, and an
    // embarrassed door. Only Pib has a town that would miss them.
    const chapter = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "content", "chapters", "bramblewood-01.json"),
        "utf8",
      ),
    ) as { llmHints?: { npcVoices?: Record<string, string> } };
    const voiced = Object.keys(chapter.llmHints?.npcVoices ?? {});
    expect(voiced).toContain("door_voice");
    expect(registry.byId.has("individual.door_voice")).toBe(false);
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
