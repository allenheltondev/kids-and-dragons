/**
 * Field Guide reach (epic #101, issue #104): which entries of
 * content/field-guide.json can current content actually reveal?
 *
 * Every chapter is run through `chapterDiscoveries` from
 * packages/shared/src/discoveries.ts (the same rules the server and the
 * validator use: the chapter's biome, encounter enemies, and each scene's
 * `discovers` tags), and the union is compared with the guide's entries.
 *
 * An unreachable entry is fine. Canon is bigger than the campaigns written so
 * far, and protected mysteries stay hidden on purpose. But the list is pinned
 * here so it only changes on purpose: when a chapter starts revealing
 * something new, or stops revealing something, move the id between the two
 * lists below in the same change.
 *
 * To print the full report (what is reachable, and from which chapters):
 *
 *     FIELD_GUIDE_REACH=1 npx vitest run tools/content/field-guide-reach.test.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { chapterDiscoveries } from "../../packages/shared/src/discoveries.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readJson = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));

const guide = readJson("content", "field-guide.json");
const world = readJson("content", "world.json");
const bestiary = readJson("content", "bestiary.json");
const chapters = readdirSync(join(REPO, "content", "chapters"))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => readJson("content", "chapters", name));

/** canon id -> the chapters that can reveal it, in file order. */
const revealedBy = new Map();
for (const chapter of chapters) {
  for (const id of chapterDiscoveries(chapter, world, bestiary)) {
    if (!revealedBy.has(id)) revealedBy.set(id, []);
    revealedBy.get(id).push(chapter.id);
  }
}

const entries = Object.keys(guide.entries);
const reachable = entries.filter((id) => revealedBy.has(id)).sort();
const unreachable = entries.filter((id) => !revealedBy.has(id)).sort();

/** What current content can reveal. */
const EXPECTED_REACHABLE = [
  "biome.eastern_plains",
  "biome.enchanted_woods",
  "biome.plains",
  "biome.red_sky_foothills",
  "biome.sunward_fields",
  "biome.whispering_marsh",
  "character.bigfoot",
  "character.dragonling",
  "character.griffin",
  "character.kitsune",
  "character.manticore",
  "character.unicorn",
  "creature.bone_crawler",
  "creature.cinder_wolf",
  "creature.echo_hunter",
  "creature.embermoth",
  "creature.glassback_crab",
  "creature.jackalope",
  "creature.legend_dragon",
  "creature.mire_mimic",
  "creature.mosshorn",
  "creature.restless_remains",
  "creature.river_drake",
  "creature.snowhorn_goat",
  "creature.will_o_wisp",
  "faction.deep_hollow_cult",
  "faction.skywardens",
  "individual.marda_thorn",
  "individual.old_ossley",
  "individual.pib",
  "location.bramblewood",
  "location.exchange",
  "location.hollow_gate",
  "location.mosshome",
  "location.mount_red_sky",
  "location.redspire_citadel",
  "location.stone_crossing",
  "npc.boggart",
  "npc.burrowfolk",
  "npc.centaur",
  "npc.faun",
  "npc.frogfolk",
  "npc.harvest_sprite",
  "npc.merfolk",
  "npc.selkie",
  "npc.sheeple",
  "npc.stone_troll",
  "npc.witch_order",
  "npc.yeti",
  "npc.boughkin",
];

/** What no chapter reveals yet: places, peoples and creatures no campaign visits. */
const EXPECTED_UNREACHABLE = [
  "biome.expanse",
  "biome.frostfang_peaks",
  "biome.glacier_of_origins",
  "biome.mermaid_cove",
  "biome.open_sea",
  "biome.sallow_wastelands",
  "biome.sky_islands",
  "creature.cloud_whale",
  "creature.frost_wyrm",
  "creature.loftmire",
  "creature.reefglider",
  "creature.silver_otter",
  "location.bone_yard",
  "location.skullwater_cave",
  "location.the_whirlpool",
];

describe("Field Guide reach", () => {
  if (process.env.FIELD_GUIDE_REACH) {
    const lines = [
      `Field Guide reach: ${reachable.length} of ${entries.length} entries reachable from ${chapters.length} chapters`,
      "",
      "Reachable:",
      ...reachable.map((id) => `  ${id.padEnd(30)} ${revealedBy.get(id).join(", ")}`),
      "",
      `Unreachable (${unreachable.length}):`,
      ...unreachable.map((id) => `  ${id}`),
    ];
    console.log(lines.join("\n"));
  }

  it("reveals only ids that are field-guide entries", () => {
    const unknown = [...revealedBy.keys()].filter((id) => !(id in guide.entries));
    expect(unknown).toEqual([]);
  });

  it("reaches exactly the known set of entries", () => {
    expect(reachable).toEqual([...EXPECTED_REACHABLE].sort());
  });

  it("leaves exactly the known set of entries unreachable", () => {
    expect(unreachable).toEqual(EXPECTED_UNREACHABLE);
  });

  it("accounts for every entry in one list or the other", () => {
    expect([...EXPECTED_REACHABLE, ...EXPECTED_UNREACHABLE].sort()).toEqual([...entries].sort());
  });
});
