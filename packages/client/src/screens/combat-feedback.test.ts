import { describe, expect, it } from "vitest";
import { beginEncounter, parseBoard, type EncounterEvent } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { makeCharacter } from "../testing/fixtures";
import { combatFeedback } from "./combat-feedback";
const encounter = beginEncounter({
  board: parseBoard([".....", ".....", "....."]),
  party: [{ character: makeCharacter(), at: { x: 1, y: 1 } }],
  enemies: [{ spec: { id: "wisp", name: "Wisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 4, attack: 2 }, at: { x: 3, y: 1 } }],
}, { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } });

describe("phone combat feedback", () => {
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
  it("marks rescues, recovery and readiness without another interaction", () => {
    expect(combatFeedback([
      { type: "freed", byId: "c_1" }, { type: "revived", actorId: "c_1", hp: 1 }, { type: "bonus", actorId: "c_1", amount: 2 },
    ], encounter)).toMatchObject([
      { label: "Safe!", reaction: "celebrate" }, { label: "Up again!", reaction: "celebrate" }, { label: "+2 ready", reaction: "ready" },
    ]);
  });
});
