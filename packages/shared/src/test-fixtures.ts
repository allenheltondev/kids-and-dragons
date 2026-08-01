/**
 * Fixtures shared by the colocated `*.test.ts` files.
 *
 * Not part of the package surface — deliberately absent from index.ts, and
 * named so vitest's `*.test.ts` glob does not collect it as a suite. It exists
 * because a realistic `RulesContent` is ~150 lines and six test files should
 * not each carry their own slightly different copy of the rules.
 *
 * The numbers here mirror content/rules.json's intent (spec §4, §8) but are
 * fixtures, not content: tests assert on behavior, not on these values.
 */

import type {
  Appearance,
  Character,
  ClassDef,
  ClassId,
  ItemCatalog,
  RulesContent,
  SpeciesDef,
  SpeciesId,
  Stats,
} from "./types/domain.js";
import type { Chapter, EncounterMap } from "./types/chapter.js";

function ability(id: string) {
  return { id, name: id, text: `${id} does a thing.`, icon: `icons/${id}.svg` };
}

function species(
  id: SpeciesId,
  passive: SpeciesDef["passive"],
  world: string,
  combat: string,
): SpeciesDef {
  return {
    id,
    name: id,
    blurb: `A ${id}.`,
    passive,
    worldAbility: ability(world),
    combatAction: ability(combat),
  };
}

function klass(
  id: ClassId,
  stat: ClassDef["stat"],
  baseSteps: number,
  signature: string,
  unlocks: Record<string, string>,
): ClassDef {
  return {
    id,
    name: id,
    stat,
    role: "role",
    blurb: `A ${id}.`,
    baseSteps,
    signature: ability(signature),
    unlocks: Object.fromEntries(
      Object.entries(unlocks).map(([level, action]) => [level, ability(action)]),
    ),
  };
}

export function makeRules(overrides: Partial<RulesContent> = {}): RulesContent {
  return {
    version: 1,
    baseStats: { might: 1, quick: 1, clever: 1, heart: 1 },
    creationPoints: 3,
    baseMaxHp: 10,
    baseGuard: 8,
    baseSteps: 4,
    difficultyTn: { easy: 8, normal: 12, hard: 16 },
    // Levels 2..10 — nine thresholds.
    //
    // Deliberately *not* the shipped curve in content/rules.json, and not drift:
    // this is round arithmetic chosen so a test can assert "300 XP is level 2"
    // without encoding a balance decision. Retuning the real curve is a content
    // change and must not turn thirty assertions red.
    levelXp: [300, 700, 1200, 1800, 2500, 3300, 4200, 5200, 6300],
    tierLevels: { fledgling: 1, sworn: 4, radiant: 7, mythic: 10 },
    species: {
      unicorn: species("unicorn", { stat: "heart", amount: 1, text: "+1 Heart" }, "mend", "mend_pulse"),
      dragonling: species(
        "dragonling",
        { stat: "might", amount: 1, text: "+1 Might" },
        "glide",
        "glide_strike",
      ),
      griffin: species("griffin", { stat: "quick", amount: 1, text: "+1 Quick" }, "skyward", "dive"),
      bigfoot: species("bigfoot", { amount: 0, maxHp: 2, text: "+2 max HP" }, "smash", "shatter"),
      kitsune: species(
        "kitsune",
        { stat: "clever", amount: 1, text: "+1 Clever" },
        "beguile",
        "bewilder",
      ),
      manticore: species(
        "manticore",
        { stat: "quick", amount: 1, text: "+1 Quick" },
        "leap",
        "pounce",
      ),
    },
    classes: {
      thornguard: klass("thornguard", "might", 4, "brace", { "3": "bulwark" }),
      duskrunner: klass("duskrunner", "quick", 6, "first_strike", { "3": "vanish" }),
      starweaver: klass("starweaver", "clever", 4, "burst", { "3": "ward" }),
      songkeeper: klass("songkeeper", "heart", 4, "rally", { "3": "soothe", "6": "chorus" }),
    },
    ...overrides,
  };
}

export function makeItems(): ItemCatalog {
  return {
    sunbloom_draught: {
      kind: "consumable",
      name: "Sunbloom Draught",
      text: "Heal 4 HP.",
      icon: "icons/items/sunbloom.svg",
      effect: { type: "heal", amount: 4 },
    },
    firecracker: {
      kind: "consumable",
      name: "Firecracker",
      text: "Throw for 3 damage.",
      icon: "icons/items/firecracker.svg",
      effect: { type: "damage", amount: 3 },
    },
    brave_whistle: {
      kind: "consumable",
      name: "Brave Whistle",
      text: "One loud note. +2 on your next roll.",
      icon: "icons/items/whistle.svg",
      effect: { type: "rollBonus", amount: 2 },
    },
    river_charm: {
      kind: "trinket",
      name: "River Charm",
      text: "+1 step.",
      icon: "icons/items/river-charm.svg",
      passive: { type: "stepBonus", amount: 1 },
    },
    emberglass_shard: {
      kind: "trinket",
      name: "Emberglass Shard",
      text: "+1 Might.",
      icon: "icons/items/emberglass.svg",
      passive: { type: "statBonus", stat: "might", amount: 1 },
    },
    oak_token: {
      kind: "trinket",
      name: "Oak Token",
      text: "+2 max HP.",
      icon: "icons/items/oak.svg",
      passive: { type: "maxHpBonus", amount: 2 },
    },
    pebble: { kind: "trinket", name: "Pebble", text: "It is a pebble.", icon: "icons/items/pebble.svg" },
    acorn: { kind: "trinket", name: "Acorn", text: "It is an acorn.", icon: "icons/items/acorn.svg" },
    feather: {
      kind: "trinket",
      name: "Feather",
      text: "It is a feather.",
      icon: "icons/items/feather.svg",
    },
    ribbon: { kind: "trinket", name: "Ribbon", text: "It is a ribbon.", icon: "icons/items/ribbon.svg" },
    rusted_key: {
      kind: "quest",
      name: "Rusted Key",
      text: "It opens something, somewhere.",
      icon: "icons/items/rusted-key.svg",
    },
    torn_map_east: {
      kind: "quest",
      name: "Torn Map (East)",
      text: "Half a map.",
      icon: "icons/items/map.svg",
    },
  };
}

export const APPEARANCE: Appearance = { palette: "meadow", accent: "#7FD4C1" };

export interface MakeCharacterInput {
  id?: string;
  ownerPlayerId?: string;
  name?: string;
  species?: SpeciesId;
  class?: ClassId;
  stats?: Stats;
  level?: number;
  xp?: number;
  inventory?: { itemId: string; kind: "consumable" | "trinket" }[];
}

/** A committed-only character — no campaign in flight. */
export function makeCharacter(input: MakeCharacterInput = {}): Character {
  const stats: Stats = input.stats ?? { might: 1, quick: 2, clever: 1, heart: 4 };
  return {
    id: input.id ?? "c_1",
    householdId: "h_1",
    ownerPlayerId: input.ownerPlayerId ?? "p_1",
    name: input.name ?? "Sparklehoof",
    species: input.species ?? "unicorn",
    class: input.class ?? "songkeeper",
    appearance: APPEARANCE,
    committed: {
      level: input.level ?? 1,
      xp: input.xp ?? 0,
      stats,
      tier: "fledgling",
      unlockedActions: ["rally"],
      inventory: input.inventory ?? [],
    },
    provisional: null,
    questItems: [],
    souvenirs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * A small chapter that exercises every scene type and both branch arms:
 *
 *   clearing (story, species-gated choice)
 *     ├─ squeeze → check_squeeze ──success→ shrine (quest item)
 *     │                          └─failure→ scratched (damage) → shrine
 *     └─ over    → shrine                         [griffin only]
 *   shrine (story) → thicket (encounter) ──victory→ camp
 *                                        └─defeat→ camp
 *   camp (rest, heals) → ridge (choice_point) → ending (no choices)
 */
/**
 * The board `makeChapter()`'s encounter runs on. Wide open on purpose — a
 * fixture should not make a test's outcome depend on a wall the test never
 * mentioned. `grid.test.ts` owns terrain.
 */
export function makeMap(): EncounterMap {
  return {
    id: "thicket",
    rows: Array.from({ length: 8 }, () => ".".repeat(10)),
    partySpawns: [
      { x: 0, y: 3 },
      { x: 0, y: 4 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
    ],
    enemySpawns: [
      { x: 9, y: 3 },
      { x: 9, y: 4 },
      { x: 8, y: 2 },
      { x: 8, y: 5 },
    ],
  };
}

export function makeChapter(): Chapter {
  return {
    id: "bramblewood-01",
    campaignId: "the-hollow-crown",
    index: 1,
    title: "The Rustling Path",
    biome: "enchanted_woods",
    estimatedMinutes: 20,
    xpAward: 300,
    entry: "scene_clearing",
    scenes: {
      scene_clearing: {
        type: "story",
        art: "bg/bramblewood/clearing",
        narration: "A wall of thorns twice your height.",
        choices: [
          { id: "squeeze", label: "Look for a gap", icon: "eye", goto: "check_squeeze" },
          {
            id: "over",
            label: "Go over it",
            icon: "wing",
            requiresSpecies: ["dragonling", "griffin"],
            goto: "scene_shrine",
          },
        ],
      },
      check_squeeze: {
        type: "check",
        stat: "quick",
        tn: 12,
        prompt: "Wriggle through the brambles",
        roller: "best",
        onSuccess: {
          goto: "scene_shrine",
          effects: [{ type: "grantItem", itemId: "sunbloom_draught", to: "roller" }],
        },
        onFailure: {
          goto: "scene_scratched",
          narration: "You get through, but the thorns take their toll.",
          effects: [{ type: "damage", amount: 1 }],
        },
      },
      scene_scratched: {
        type: "story",
        narration: "Scratched, but through.",
        choices: [{ id: "onward", label: "Onward", icon: "arrow", goto: "scene_shrine" }],
      },
      scene_shrine: {
        type: "story",
        art: "bg/bramblewood/shrine",
        narration: "A small stone shrine, half-swallowed by roots.",
        onEnter: [
          { type: "grantQuestItem", itemId: "rusted_key" },
          { type: "setFlag", flag: "found_shrine" },
        ],
        choices: [{ id: "east", label: "Take the path east", icon: "arrow", goto: "encounter_wisps" }],
      },
      encounter_wisps: {
        type: "encounter",
        map: "thicket",
        narration: "Three wisps rise out of the bracken.",
        enemies: [{ id: "wisp", count: 3, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }],
        onVictory: { goto: "scene_camp" },
        onDefeat: { goto: "scene_camp", narration: "They take your lantern and vanish." },
      },
      scene_camp: {
        type: "rest",
        narration: "A hollow out of the wind.",
        heal: 3,
        choices: [{ id: "sleep", label: "Sleep", icon: "moon", goto: "scene_ridge" }],
      },
      scene_ridge: {
        type: "choice_point",
        narration: "The ridge forks.",
        choices: [
          {
            id: "high",
            label: "The high road",
            icon: "arrow",
            goto: "scene_ending",
            effects: [{ type: "setFlag", flag: "took_high" }],
          },
          {
            id: "low",
            label: "The low road",
            icon: "arrow",
            goto: "scene_ending",
            effects: [{ type: "setFlag", flag: "took_low" }],
          },
        ],
      },
      scene_ending: {
        type: "story",
        narration: "The lights of home, at last.",
        choices: [],
      },
    },
    llmHints: {
      tone: "warm, playful",
      vocabulary: "age-8",
      forbidden: ["death"],
    },
  };
}
