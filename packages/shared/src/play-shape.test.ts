/**
 * `playShape` (play-shape.ts): what is only shown or said comes out, and
 * everything else stays in, including anything nobody has classified.
 */

import { describe, expect, it } from "vitest";
import { canonicalJson, COUNTED_KEYS, playShape, PRESENTATION_KEYS } from "./play-shape";

const chapter = () => ({
  id: "gemfall-99",
  campaignId: "gemfall",
  index: 9,
  title: "The Long Bridge",
  estimatedMinutes: 35,
  xpAward: 40,
  entry: "scene_bridge",
  voiceGuide: { tone: "warm", vocabulary: "plain", forbidden: ["gore"], npcVoices: { hesper: "dry" } },
  goal: { text: "Cross the bridge.", steps: [{ id: "cross", label: "Get across", flag: "crossed" }] },
  props: { rope: { kind: "quest", name: "A rope", text: "Frayed, but strong.", icon: "rope" } },
  scenes: {
    scene_bridge: {
      type: "story",
      art: "scenes/bridge.webp",
      narration: "The bridge sways.",
      variants: [{ when: { flag: "has_rope" }, text: "Your rope is ready.", at: "end" }],
      priority: 2,
      cast: [{ figure: "hesper", name: "Hesper" }],
      discovers: ["hesper"],
      onEnter: [{ type: "setFlag", flag: "saw_bridge" }],
      choices: [
        { id: "wade", label: "Wade across", icon: "water", goto: "check_wade", requiresSpecies: "selkie" },
        { id: "rope", label: "Use the rope", icon: "rope", goto: "scene_far_side", requiresItem: "rope", when: { coins: { min: 2 } }, effects: [{ type: "spendCoins", amount: 2 }] },
      ],
    },
    check_wade: {
      type: "check",
      stat: "might",
      tn: 12,
      tags: ["water"],
      prompt: "Push through the current.",
      onSuccess: { goto: "scene_far_side", narration: "You make it.", effects: [{ type: "setFlag", flag: "crossed" }] },
      onFailure: { goto: "scene_far_side", narration: "You are soaked.", effects: [{ type: "damage", amount: 1 }] },
    },
    game_cups: {
      type: "interaction",
      narration: "Watch the cups.",
      interaction: { kind: "tracking", cue: "Watch!", actionLabel: "Pick", covers: ["Left cup", "Middle cup", "Right cup"], start: 1, swaps: [[0, 1]], stepMs: 700 },
      onSuccess: { goto: "scene_far_side" },
      onFailure: { goto: "scene_far_side" },
    },
    game_bags: {
      type: "interaction",
      narration: "Load the bags.",
      interaction: {
        kind: "sequence",
        cue: "Load them in the right order.",
        actionLabel: "Load",
        options: [
          { id: "harbor", label: "Harbor bag", icon: "bag" },
          { id: "valley", label: "Valley bag", icon: "bag" },
          { id: "mountain", label: "Mountain bag", icon: "bag" },
        ],
        answer: ["harbor", "valley", "mountain"],
        clues: ["The harbor bag loads before the valley bag.", "The valley bag is between harbor and mountain.", "The mountain bag loads last."],
      },
      onSuccess: { goto: "scene_far_side" },
      onFailure: { goto: "scene_far_side" },
    },
    game_lamps: {
      type: "interaction",
      narration: "Watch the lamps.",
      interaction: {
        kind: "memory",
        cue: "Remember the order.",
        actionLabel: "Light",
        options: [
          { id: "red", label: "Red lamp", icon: "lamp" },
          { id: "blue", label: "Blue lamp", icon: "lamp" },
        ],
        answer: ["red", "blue"],
        stepMs: 600,
      },
      onSuccess: { goto: "scene_far_side" },
      onFailure: { goto: "scene_far_side" },
    },
    fight_crab: {
      type: "encounter",
      map: "bridge",
      enemies: [{ id: "crab", name: "Glassback crab", count: 1, hp: 6, guard: 11, quick: 2, steps: 3, attack: 2, art: "crab.webp" }],
      environment: {
        clock: { rounds: 5, label: "The tide", onExpire: "surge" },
        variants: [{ when: { facts: { tide: "high" } }, clock: { rounds: 3, label: "The tide", onExpire: "surge" } }],
      },
      onVictory: { goto: "scene_far_side" },
      onDefeat: { goto: "scene_far_side" },
    },
    scene_far_side: { type: "story", narration: "You are across.", choices: [], outcome: "success" },
  },
});

type Chapter = ReturnType<typeof chapter>;
const digest = (value: unknown) => canonicalJson(playShape(value));
const changed = (edit: (c: Chapter) => void) => {
  const c = chapter();
  edit(c);
  return digest(c) !== digest(chapter());
};

describe("what does not move the play shape", () => {
  it.each([
    ["a reworded narration", (c: Chapter) => (c.scenes.scene_bridge.narration = "The old bridge creaks.")],
    ["a new title", (c: Chapter) => (c.title = "The Longer Bridge")],
    ["a relabelled choice and its icon", (c: Chapter) => Object.assign(c.scenes.scene_bridge.choices[0]!, { label: "Swim for it", icon: "wave" })],
    ["a check's prompt", (c: Chapter) => (c.scenes.check_wade.prompt = "Lean into the water.")],
    ["a branch's narration", (c: Chapter) => (c.scenes.check_wade.onSuccess.narration = "Dripping, you climb out.")],
    ["a new painting", (c: Chapter) => (c.scenes.scene_bridge.art = "scenes/bridge-v2.webp")],
    ["who stands on stage", (c: Chapter) => (c.scenes.scene_bridge.cast = [])],
    ["a priority mark", (c: Chapter) => (c.scenes.scene_bridge.priority = 1)],
    ["how the pacing report counts a check", (c: Chapter) => Object.assign(c.scenes.check_wade, { checkKind: "talking" })],
    ["the voice the chapter is read in", (c: Chapter) => (c.voiceGuide.npcVoices.hesper = "bright")],
    ["the time it is guessed to take", (c: Chapter) => (c.estimatedMinutes = 40)],
    ["the goal's words", (c: Chapter) => Object.assign(c.goal, { text: "Get everyone over." }, { steps: [{ ...c.goal.steps[0]!, label: "All across" }] })],
    ["an item's name and description", (c: Chapter) => Object.assign(c.props.rope, { name: "Old rope", text: "It will hold." })],
    ["an enemy's name and art", (c: Chapter) => Object.assign(c.scenes.fight_crab.enemies[0]!, { name: "Big crab", art: "crab2.webp" })],
    ["a clock's label", (c: Chapter) => (c.scenes.fight_crab.environment.clock.label = "High water")],
    ["a mini-game's cue and button", (c: Chapter) => Object.assign(c.scenes.game_cups.interaction, { cue: "Eyes on the cups!", actionLabel: "Choose" })],
    ["what a cup is called", (c: Chapter) => (c.scenes.game_cups.interaction.covers[0] = "Left hat")],
    ["an option's label in a game with no clues", (c: Chapter) => (c.scenes.game_lamps.interaction.options[0]!.label = "Crimson lamp")],
    ["a clue game's cue, button and icons", (c: Chapter) => {
      Object.assign(c.scenes.game_bags.interaction, { cue: "Put them in order.", actionLabel: "Stack" });
      c.scenes.game_bags.interaction.options[0]!.icon = "sack";
    }],
    ["a narration variant's words", (c: Chapter) => (c.scenes.scene_bridge.variants[0]!.text = "The rope is coiled and ready.")],
    ["a narration variant added or dropped", (c: Chapter) => (c.scenes.scene_bridge.variants = [])],
    ["a comment", (c: Chapter) => Object.assign(c, { $comment: "reviewed" })],
  ])("%s", (_name, edit) => {
    expect(changed(edit as (c: Chapter) => void)).toBe(false);
  });

  it("the order the file was written in", () => {
    const c = chapter();
    const reordered = { ...c, scenes: Object.fromEntries(Object.entries(c.scenes).reverse()) };
    expect(digest(reordered)).toBe(digest(c));
  });
});

describe("what moves the play shape", () => {
  it.each([
    ["a check's difficulty", (c: Chapter) => (c.scenes.check_wade.tn = 13)],
    ["a check's stat", (c: Chapter) => (c.scenes.check_wade.stat = "quick")],
    ["a check's tags", (c: Chapter) => (c.scenes.check_wade.tags = [])],
    ["where a choice leads", (c: Chapter) => (c.scenes.scene_bridge.choices[0]!.goto = "scene_far_side")],
    ["a choice's species gate", (c: Chapter) => delete (c.scenes.scene_bridge.choices[0] as { requiresSpecies?: string }).requiresSpecies],
    ["a choice's item gate", (c: Chapter) => (c.scenes.scene_bridge.choices[1]!.requiresItem = "ladder")],
    ["a choice's condition", (c: Chapter) => (c.scenes.scene_bridge.choices[1]!.when = { coins: { min: 3 } })],
    ["what a choice costs", (c: Chapter) => (c.scenes.scene_bridge.choices[1]!.effects = [{ type: "spendCoins", amount: 3 }])],
    ["the order of the choices", (c: Chapter) => c.scenes.scene_bridge.choices.reverse()],
    ["a branch's effect", (c: Chapter) => (c.scenes.check_wade.onFailure.effects = [])],
    ["an effect on entering", (c: Chapter) => (c.scenes.scene_bridge.onEnter = [])],
    ["what a scene discovers", (c: Chapter) => (c.scenes.scene_bridge.discovers = [])],
    ["an enemy's numbers", (c: Chapter) => (c.scenes.fight_crab.enemies[0]!.hp = 7)],
    ["a fight's clock", (c: Chapter) => (c.scenes.fight_crab.environment.clock.rounds = 6)],
    ["a fight's variant, which changes the fight and not the words", (c: Chapter) => (c.scenes.fight_crab.environment.variants[0]!.clock.rounds = 2)],
    ["a mini-game's rules", (c: Chapter) => (c.scenes.game_cups.interaction.swaps = [[1, 2]])],
    ["how many cups a mini-game has", (c: Chapter) => c.scenes.game_cups.interaction.covers.push("Far cup")],
    // A sequence game is solved from its clues, and the engine deals them to phones by their place in the list.
    ["a clue reworded, here to contradict the answer", (c: Chapter) => (c.scenes.game_bags.interaction.clues[0] = "The harbor bag loads after the valley bag.")],
    ["the clues reordered, which changes who is dealt which", (c: Chapter) => c.scenes.game_bags.interaction.clues.reverse()],
    ["one clue dropped", (c: Chapter) => c.scenes.game_bags.interaction.clues.pop()],
    ["every clue removed", (c: Chapter) => (c.scenes.game_bags.interaction.clues = [])],
    ["what a clue game's option is called, which its clues name", (c: Chapter) => (c.scenes.game_bags.interaction.options[0]!.label = "Dock bag")],
    ["an ending's outcome", (c: Chapter) => (c.scenes.scene_far_side.outcome = "setback")],
    ["a scene removed", (c: Chapter) => delete (c.scenes as Partial<Chapter["scenes"]>).game_cups],
    ["the entry scene", (c: Chapter) => (c.entry = "check_wade")],
    ["the goal's flag", (c: Chapter) => (c.goal.steps[0]!.flag = "over")],
    ["an item's kind", (c: Chapter) => (c.props.rope.kind = "gear")],
    ["the award", (c: Chapter) => (c.xpAward = 50)],
    // Both look like staging and are not: one ends a player's beat, the other decides whether the camp can be edited.
    ["a scene marked as the start of a new beat", (c: Chapter) => Object.assign(c.scenes.scene_bridge, { spotlight: "next" })],
    ["whether a rest is indoors", (c: Chapter) => Object.assign(c.scenes.scene_far_side, { type: "rest", setting: "indoor" })],
  ])("%s", (_name, edit) => {
    expect(changed(edit as (c: Chapter) => void)).toBe(true);
  });

  it("a field nobody has classified, so a new one is pinned until someone says it is presentation", () => {
    expect(changed((c) => Object.assign(c.scenes.check_wade, { rerolls: 1 }))).toBe(true);
    expect(changed((c) => Object.assign(c, { somethingNew: true }))).toBe(true);
  });
});

describe("the shape itself", () => {
  it("keeps a counted list as its length and drops the words", () => {
    const shape = playShape(chapter()) as { scenes: { game_cups: { interaction: Record<string, unknown> } } };
    expect(shape.scenes.game_cups.interaction.covers).toEqual({ count: 3 });
    expect([...COUNTED_KEYS]).toEqual(["stages", "covers"]);
  });

  it("drops narration variants and keeps a fight's", () => {
    const shape = playShape(chapter()) as { scenes: Record<string, { variants?: unknown; environment?: { variants?: unknown[] } }> };
    expect(shape.scenes.scene_bridge).not.toHaveProperty("variants");
    expect(shape.scenes.fight_crab!.environment!.variants).toHaveLength(1);
  });

  it("carries no words out of a chapter, but for a clue game's clues and the labels they name", () => {
    const text = canonicalJson(playShape(chapter()));
    for (const words of ["sways", "Wade across", "Push through", "Glassback", "Left cup", "The tide", "Frayed", "Hesper", "warm", "Red lamp", "Load them in the right order", "Watch the lamps"]) {
      expect(text, words).not.toContain(words);
    }
    for (const words of ["The harbor bag loads before the valley bag.", "The mountain bag loads last.", "Harbor bag", "Mountain bag"]) {
      expect(text, words).toContain(words);
    }
  });

  it("keeps a clue game's clues whole and in order", () => {
    const shape = playShape(chapter()) as { scenes: { game_bags: { interaction: { clues: string[]; options: Record<string, unknown>[] } } } };
    expect(shape.scenes.game_bags.interaction.clues).toEqual(chapter().scenes.game_bags.interaction.clues);
    // The label the clues name stays; the picture does not.
    expect(shape.scenes.game_bags.interaction.options[0]).toEqual({ id: "harbor", label: "Harbor bag" });
    expect(PRESENTATION_KEYS.has("clues")).toBe(false);
  });

  it("never lists a name an effect uses, so no effect can lose a field", () => {
    for (const key of ["type", "itemId", "amount", "flag", "value", "to", "nonlethal", "pieceId", "rewardId", "friendId", "looks", "goto", "when", "id"]) {
      expect(PRESENTATION_KEYS.has(key), key).toBe(false);
    }
  });
});
