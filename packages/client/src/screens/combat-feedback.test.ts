import { describe, expect, it } from "vitest";
import { beginEncounter, parseBoard, type EncounterEvent } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { makeCharacter } from "../testing/fixtures";
import { combatFeedback } from "./combat-feedback";
import { describeBeats } from "./fight-log";
import { crossingProgress, enemyIntentLine } from "./combat-plan";
const encounter = beginEncounter({
  board: parseBoard([".....", ".....", "....."]),
  party: [{ character: makeCharacter(), at: { x: 1, y: 1 } }],
  enemies: [{ spec: { id: "wisp", name: "Wisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 4, attack: 2 }, at: { x: 3, y: 1 } }],
}, { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } });

describe("phone combat feedback", () => {
  it("describes physical preparation, impact and interruption without magic sparks", () => {
    const physical = { ...encounter, combatants: encounter.combatants.map(c => c.side === "enemy" ? { ...c,
      windupAttack: { label: "Plank slap", radius: 1 as const, damage: 3, presentation: "slam" as const }, windup: { tiles: [{ x: 1, y: 1 }] },
    } : c) };
    const events: EncounterEvent[] = [
      { type: "windupStarted", actorId: "wisp#1", label: "Plank slap", tiles: [{ x: 1, y: 1 }] },
      { type: "windupReleased", actorId: "wisp#1", label: "Plank slap", tiles: [{ x: 1, y: 1 }], targets: ["c_1"] },
      { type: "windupInterrupted", actorId: "wisp#1" },
    ];
    expect(combatFeedback([events[0]!], physical)).toEqual([]);
    expect(combatFeedback(events, physical).find(feedback => feedback.eventIndex === 1)).toMatchObject({ effect: "impact_strike", label: "Whap!", reaction: "slam" });
    expect(combatFeedback([events[0]!], encounter)).toEqual([
      { actorId: "wisp#1", effect: "guard_ward", label: "Plank slap", reaction: "ready", eventIndex: 0 },
    ]);
    const words = describeBeats(events, physical, null, 1).map(beat => beat.text).join(" ");
    expect(words).toContain("rears up for Plank slap");
    expect(words).toContain("slaps on the marked ground");
    expect(words).toContain("lowers the planks");
    expect(words).not.toMatch(/sparks|bursts/);
    expect(enemyIntentLine(physical, "wisp#1")).toContain("hits marked ground next turn");
  });
  it("counts saved crossings without crediting a hero who is still on the lane", () => {
    const state = { ...encounter, environment: { expired: false, spec: { exits: [{ id: "far-bank", label: "Bank", tiles: [{ x: 4, y: 1 }] }] } } };
    expect(crossingProgress(state)).toContain("0/1 across");
    const escaped = { ...state, combatants: state.combatants.map(c => c.side === "party" ? { ...c, escaped: true as const } : c) };
    expect(crossingProgress(JSON.parse(JSON.stringify(escaped)))).toContain("1/1 across");
    expect(crossingProgress(encounter)).toBeNull();
  });
  it("calls the wolf escape progress an arrival at the big campfire", () => {
    const state = { ...encounter, environment: { expired: false, spec: { exits: [{ id: "big-campfire", label: "Big campfire", tiles: [{ x: 4, y: 1 }] }] } } };
    expect(crossingProgress(state)).toBe("0/1 at the big campfire.");
    const arrived = { ...state, combatants: state.combatants.map(c => c.side === "party" ? { ...c, escaped: true as const } : c) };
    expect(crossingProgress(arrived)).toMatch(/^1\/1 at the big campfire: .+\.$/);
  });
  it("attaches damage, healing, protection and dodge to the affected fighter", () => {
    expect(combatFeedback([
      { type: "damage", actorId: "wisp#1", amount: 3, hp: 3 },
      { type: "heal", actorId: "c_1", amount: 2, hp: 8 },
      { type: "protected", actorId: "friend", byId: "c_1" },
      { type: "evaded", actorId: "friend", byId: "wisp#1" },
    ], encounter)).toMatchObject([
      { actorId: "wisp#1", effect: "impact_strike", reaction: "hurt", label: "−3", eventIndex: 0 },
      { actorId: "c_1", effect: "heal_bloom", label: "+2", eventIndex: 1 },
      { actorId: "c_1", effect: "guard_ward", reaction: "ready", eventIndex: 2 },
      { actorId: "friend", effect: "miss_veer", label: "Dodged!", eventIndex: 3 },
    ]);
  });
  it("does not invent damage or show a hit for a miss", () => {
    const events: EncounterEvent[] = [
      { type: "damage", actorId: "c_1", amount: 0, hp: 10 },
      { type: "roll", roll: { characterId: "c_1", die: 1, mod: 2, total: 3, tn: 11, result: "miss" }, targetId: "wisp#1" },
    ];
    expect(combatFeedback(events, encounter)).toMatchObject([{ actorId: "wisp#1", effect: "miss_veer", eventIndex: 1 }]);
  });
  it("celebrates the last enemy falling even without a roll, but never a fallen hero", () => {
    expect(combatFeedback([{ type: "down", actorId: "wisp#1" }], encounter)).toMatchObject([
      { actorId: "c_1", reaction: "celebrate", label: "We did it!" },
    ]);
    expect(combatFeedback([{ type: "down", actorId: "wisp#1" }, { type: "down", actorId: "c_1" }], encounter)).toEqual([]);
  });
  it("does not celebrate victory while another enemy remains", () => {
    const two = { ...encounter, combatants: [...encounter.combatants, { ...encounter.combatants.find(c => c.id === "wisp#1")!, id: "wisp#2" }] };
    expect(combatFeedback([{ type: "down", actorId: "wisp#1" }], two)).toEqual([]);
  });
  it.each(["pre-batch", "post-batch"])("celebrates only the second sequential enemy knockdown with a %s snapshot", snapshot => {
    const first = encounter.combatants.find(c => c.id === "wisp#1")!;
    const down = snapshot === "post-batch";
    const two = { ...encounter, combatants: [
      ...encounter.combatants.filter(c => c.side === "party"),
      { ...first, down, hp: down ? 0 : first.hp },
      { ...first, id: "wisp#2", down, hp: down ? 0 : first.hp },
    ] };
    const events: EncounterEvent[] = [
      { type: "damage", actorId: "wisp#1", amount: 6, hp: 0 },
      { type: "down", actorId: "wisp#1" },
      { type: "warded", actorId: "c_1", amount: 1 },
      { type: "damage", actorId: "wisp#2", amount: 6, hp: 0 },
      { type: "down", actorId: "wisp#2" },
    ];
    expect(combatFeedback(events, two).filter(feedback => feedback.label === "We did it!")).toEqual([
      { actorId: "c_1", effect: "burst_star", reaction: "celebrate", label: "We did it!", eventIndex: 4 },
    ]);
  });
  it("marks rescues, recovery and readiness without another interaction", () => {
    expect(combatFeedback([
      { type: "freed", byId: "c_1" }, { type: "revived", actorId: "c_1", hp: 1 }, { type: "bonus", actorId: "c_1", amount: 2 },
    ], encounter)).toMatchObject([
      { label: "Safe!", reaction: "celebrate" }, { label: "Up again!", reaction: "celebrate" }, { label: "+2 ready", reaction: "ready" },
    ]);
  });
});
