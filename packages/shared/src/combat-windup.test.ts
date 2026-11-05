import { describe, expect, it } from "vitest";
import { beginEncounter, combatantById, currentActorId, endTurn, moveTo, performAction, performEnemyWindup, type EncounterState } from "./encounter.js";
import { committedAttacks } from "./combat-threats.js";
import { parseBoard } from "./grid.js";
import { resolveCharacter } from "./character.js";
import { makeCharacter, makeRules, makeItems } from "./test-fixtures.js";

const rules = makeRules();
const ctx = { rules, abilities: {}, rng: { next: () => .99 } };
function fight(seats = 1): EncounterState {
  return beginEncounter({ board: parseBoard(Array.from({ length: 6 }, () => ".......")),
    party: Array.from({ length: seats }, (_, i) => ({ character: resolveCharacter(makeCharacter({ id: `hero${i}`, name: `Hero ${i}`, species: "unicorn", class: "thornguard", stats: { might: 1, quick: 3, clever: 0, heart: 0 } }), rules, makeItems()), at: { x: 1, y: i + 1 } })),
    enemies: [{ spec: { id: "lamp", count: 1, hp: 8, guard: 10, quick: 0, steps: 3, attack: 2, windupAttack: { label: "Sparks", radius: 1, damage: 3 } }, at: { x: 5, y: 1 } }],
  }, ctx);
}
function turn(state: EncounterState, id: string): EncounterState {
  for (let i = 0; i < 20 && currentActorId(state) !== id; i++) state = endTurn(state);
  expect(currentActorId(state)).toBe(id);
  return state;
}
function armed(seats = 1) { return performEnemyWindup(turn(fight(seats), "lamp#1"), ctx); }

describe("committed enemy bursts", () => {
  it("persists a physical presentation without changing targeting, rolls or damage", () => {
    const base = turn(fight(), "lamp#1");
    const physical = { ...base, combatants: base.combatants.map(c => c.windupAttack ? { ...c, windupAttack: { ...c.windupAttack, presentation: "slam" as const } } : c) };
    const normal = performEnemyWindup(base, ctx);
    const raised = performEnemyWindup(physical, ctx);
    expect(raised.events).toEqual(normal.events);
    const saved = JSON.parse(JSON.stringify(raised.state)) as EncounterState;
    expect(combatantById(saved, "lamp#1")!.windupAttack?.presentation).toBe("slam");
    expect(performEnemyWindup({ ...saved, actionTaken: false }, ctx).events).toEqual(performEnemyWindup({ ...normal.state, actionTaken: false }, ctx).events);
  });
  it.each([1, 2, 4])("gives every hero a response turn, saves fixed ground, and can be dodged with %i seats", seats => {
    const prepared = armed(seats);
    expect(prepared.events[0]?.type).toBe("windupStarted");
    expect(prepared.events.some(e => e.type === "damage")).toBe(false);
    const marked = committedAttacks(prepared.state)[0]!.tiles;
    let state = JSON.parse(JSON.stringify(endTurn(prepared.state))) as EncounterState;
    expect(committedAttacks(state)[0]!.tiles).toEqual(marked);
    for (let i = 0; i < seats; i++) {
      state = turn(state, `hero${i}`);
      const move = moveTo(state, { x: 4, y: i + 1 });
      expect(move.ok).toBe(true);
      if (move.ok) state = endTurn(move.state);
    }
    const released = performEnemyWindup(turn(state, "lamp#1"), ctx);
    expect(released.events).toEqual([{ type: "windupReleased", actorId: "lamp#1", label: "Sparks", tiles: marked, targets: [] }]);
    expect(committedAttacks(released.state)).toEqual([]);
    expect(released.state.combatants.filter(c => c.side === "party").every(c => c.hp === c.maxHp)).toBe(true);
  });

  it("hits heroes who stay, using normal protection and wards", () => {
    let state = armed(2).state;
    state = { ...state, actionTaken: false, combatants: state.combatants.map(c => c.id === "hero0" ? { ...c, protectedBy: "hero1" } : c.id === "hero1" ? { ...c, ward: { byId: "hero1", amount: 1 } } : c) };
    const released = performEnemyWindup(state, ctx);
    expect(released.events).toContainEqual({ type: "protected", actorId: "hero0", byId: "hero1" });
    expect(released.events.some(e => e.type === "warded")).toBe(true);
    expect(combatantById(released.state, "hero0")!.hp).toBe(combatantById(state, "hero0")!.hp);
    expect(combatantById(released.state, "hero1")!.hp).toBeLessThan(combatantById(state, "hero1")!.hp);
    expect(performEnemyWindup(released.state, ctx).events).toEqual([]);
  });

  it("dazing a charging foe cancels its marked attack instead of postponing it", () => {
    const prep = armed();
    let state = turn(endTurn(prep.state), "hero0");
    state = { ...state, combatants: state.combatants.map(c => c.id === "hero0" ? { ...c, actions: [...c.actions, "interrupt"] } : c) };
    const result = performAction(state, { ...ctx, abilities: { interrupt: { id: "interrupt", name: "Interrupt", icon: "spark", timing: "action", target: { kind: "enemy", range: 6 }, effects: [{ effect: { type: "skipTurn" } }] } } }, { abilityId: "interrupt", targetId: "lamp#1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toContainEqual({ type: "windupInterrupted", actorId: "lamp#1" });
    expect(committedAttacks(result.state)).toEqual([]);
    expect(combatantById(result.state, "lamp#1")!.windup).toBeUndefined();
  });

  it("a defeated charger has no remaining threat", () => {
    const state = armed().state;
    expect(committedAttacks({ ...state, combatants: state.combatants.map(c => c.side === "enemy" ? { ...c, down: true } : c) })).toEqual([]);
  });

  it("does not attack a protector again after the redirected hit knocks them down", () => {
    let state = armed(2).state;
    state = { ...state, actionTaken: false, combatants: state.combatants.map(c => c.id === "hero0" ? { ...c, protectedBy: "hero1" } : c.id === "hero1" ? { ...c, hp: 1 } : c) };
    const result = performEnemyWindup(state, ctx);
    expect(combatantById(result.state, "hero1")!.down).toBe(true);
    expect(result.events.filter(e => e.type === "roll")).toHaveLength(1);
  });
});
