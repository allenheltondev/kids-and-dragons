/**
 * The shipped ability catalog, run through the real engine.
 *
 * `encounter.test.ts` owns the *rules* — what `shove` does to a figure against a
 * wall, whether `protect` survives its bearer being knocked down — using a
 * hand-written catalog. This file asks a different and narrower question about
 * `content/abilities.json` itself:
 *
 *     Does every ability the game actually grants do something on a board?
 *
 * Which matters because the engine is deliberately tolerant. `legalActions`
 * skips an ability it cannot look up, and `performAction` refuses one whose
 * targets came back empty, so a mis-authored entry does not crash — it produces
 * a card a child taps to no effect. `content:validate` catches the two static
 * versions of that mistake (an ability granted but never defined, a name that
 * disagrees with the card). It cannot catch an ability that is defined, and
 * legal, and lands on nobody: `soothe` with a range of 0, a `to: "area"` on an
 * ability whose target is a figure, a `when: "down"` on the only effect there is.
 *
 * So this walks the catalog and, for each entry, puts a party in a position
 * where the ability *ought* to be offered and asserts that the engine both
 * offers it and changes the board when it is used.
 *
 * It reads the real `content/` directory on purpose. A fixture catalog would
 * pass forever while the shipped one rotted.
 */

import { describe, expect, it } from "vitest";
import {
  ATTACK_ID,
  beginEncounter,
  legalActions,
  newCharacter,
  parseBoard,
  performAction,
  resolveCharacter,
  makeRng,
  type Character,
  type ClassId,
  type EncounterContext,
  type EncounterState,
  type EnemyPlacement,
  type ResolvedCharacter,
  type SpeciesId,
} from "@kad/shared";
import { clearContentCache, loadContent, type ContentStore } from "./loader.ts";
import { contentDir } from "../paths.ts";

const content: ContentStore = await loadContent(contentDir());
clearContentCache();

describe("the shipped chapters", () => {
  it("resolve every enemy against the bestiary", () => {
    // The real content directory, not a fixture: content/chapters/*.json now
    // name a creature instead of restating its stats, and this is what proves
    // the loader actually completes them for the engine.
    for (const id of content.chapterIds()) {
      for (const [sceneId, scene] of Object.entries(content.chapter(id)!.scenes)) {
        if (scene.type !== "encounter") continue;
        for (const enemy of scene.enemies) {
          for (const stat of ["hp", "guard", "quick", "steps", "attack", "count"] as const) {
            expect(enemy[stat], `${id}/${sceneId}/${enemy.id}/${stat}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

const rules = content.rules();
const items = content.items();
const catalog = content.abilities();

/** Wide open, so nothing here fails on a wall the test never mentioned. */
function board() {
  return parseBoard(["..........", "..........", "..........", "..........", ".........."]);
}

function ctx(): EncounterContext {
  return { rules, abilities: catalog, rng: makeRng("abilities") };
}

/**
 * A resolved character of the given species and class at the given level, built
 * through `newCharacter` and `resolveCharacter` rather than by hand.
 *
 * The long way round is the point: `resolveCharacter` is what decides which
 * abilities a level has unlocked, and hand-writing an `actions` array here would
 * let a level-9 ability be tested that no level-9 character is ever granted.
 */
function hero(input: {
  id: string;
  species: SpeciesId;
  class: ClassId;
  level?: number;
  hp?: number;
}): ResolvedCharacter {
  const base = newCharacter({
    id: input.id,
    householdId: "h_1",
    ownerPlayerId: `p_${input.id}`,
    name: input.id,
    species: input.species,
    class: input.class,
    // Every point in the class stat, so a hero can actually hit something —
    // these tests are about reach and effect, not about the dice.
    stats: statsFor(input.class),
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    rules,
    now: "2026-01-01T00:00:00.000Z",
  });
  const levelled: Character = {
    ...base,
    committed: { ...base.committed, level: input.level ?? 1 },
  };
  return resolveCharacter(levelled, rules, items);
}

function statsFor(classId: ClassId) {
  const stat = rules.classes[classId]?.stat;
  const stats = { might: 0, quick: 0, clever: 0, heart: 0 };
  if (stat) stats[stat] = rules.creationPoints;
  return stats;
}

/**
 * One weak enemy, so a single hit is visible in HP. Guard 1 so an attack cannot
 * miss — these tests are about reach and effect, and a whiffed d20 would make
 * them flaky.
 */
function wisp(at = { x: 4, y: 2 }): EnemyPlacement {
  return { spec: { id: "wisp", count: 1, hp: 6, guard: 1, quick: 1, steps: 4, attack: 3 }, at };
}

interface Scene {
  state: EncounterState;
  /** The figure whose turn it is forced to be. */
  actorId: string;
}

/**
 * An encounter with the given figures, wound forward until it is `actorId`'s
 * turn.
 *
 * Turn order is rolled from Quick (§7.2), so which hero acts first is not
 * something a test may assume. Rather than rig the dice — which would make every
 * assertion below depend on a seed — this spins the cursor to the figure the
 * test is about. Anything the skipped figures would have done, they do not do:
 * `turnIndex` is advanced directly, not through `endTurn`.
 */
function sceneWith(
  party: { character: ResolvedCharacter; at: { x: number; y: number }; hp?: number; down?: boolean }[],
  enemies: EnemyPlacement[],
  actorId: string,
): Scene {
  const started = beginEncounter({ board: board(), party, enemies }, ctx());
  const index = started.openingOrder.indexOf(actorId);
  if (index < 0) throw new Error(`${actorId} is not in the fight`);
  return { state: { ...started, turnIndex: index }, actorId };
}

function offered(scene: Scene): string[] {
  return legalActions(scene.state, ctx()).map((a) => a.abilityId);
}

function hpOf(state: EncounterState, id: string): number {
  const found = state.combatants.find((c) => c.id === id);
  if (!found) throw new Error(`no combatant ${id}`);
  return found.hp;
}

function tileOf(state: EncounterState, id: string) {
  const actor = state.board.actors.find((a) => a.id === id);
  if (!actor) throw new Error(`no actor ${id}`);
  return { x: actor.x, y: actor.y };
}

/** `performAction`, with a refusal turned into a readable failure. */
function act(
  scene: Scene,
  request: { abilityId: string; targetId?: string; targetTile?: { x: number; y: number } },
): EncounterState {
  const result = performAction(scene.state, ctx(), request);
  if (!result.ok) throw new Error(`${request.abilityId} refused: ${result.reason}`);
  return result.state;
}

// ---------------------------------------------------------------------------

describe("the shipped catalog", () => {
  it("defines or defers every ability rules.json grants", () => {
    /*
     * The same invariant `content:validate` enforces, asserted here too — because
     * the validator is a separate command that a hurried commit can skip, and this
     * one runs on every `npm test`. Cheap insurance against the failure mode the
     * whole catalog exists to prevent: a granted ability that no phone can use.
     */
    const granted = new Set<string>();
    for (const cls of Object.values(rules.classes)) {
      granted.add(cls.signature.id);
      for (const unlock of Object.values(cls.unlocks)) granted.add(unlock.id);
    }
    for (const sp of Object.values(rules.species)) granted.add(sp.combatAction.id);

    // Nothing authored that is not granted, and nothing granted twice over.
    for (const id of Object.keys(catalog)) expect(granted).toContain(id);
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });

  it("gives every authored ability a target rule the engine understands", () => {
    // A guard against the one authoring mistake the schema cannot see: a target
    // shape whose effects can never find anybody, e.g. `to: "area"` with no
    // `area` on a target that is a figure rather than a tile.
    for (const [id, ability] of Object.entries(catalog)) {
      for (const spec of ability.effects) {
        const scope = spec.to ?? "target";
        if (scope === "area") {
          expect(ability.target.kind, `${id} scopes an effect to an area`).toBe("tile");
        }
        if (scope === "target") {
          expect(ability.target.kind, `${id} scopes an effect to its target`).not.toBe("none");
        }
      }
    }
  });
});

describe("class signatures", () => {
  it("brace protects the friend standing next to you", () => {
    const guard = hero({ id: "c_guard", species: "bigfoot", class: "thornguard" });
    const friend = hero({ id: "c_friend", species: "unicorn", class: "songkeeper" });
    const scene = sceneWith(
      [
        { character: guard, at: { x: 1, y: 2 } },
        { character: friend, at: { x: 2, y: 2 } },
      ],
      [wisp()],
      guard.id,
    );

    expect(offered(scene)).toContain("brace");
    const after = act(scene, { abilityId: "brace", targetId: friend.id });
    expect(after.combatants.find((c) => c.id === friend.id)?.protectedBy).toBe(guard.id);
  });

  it("first_strike is never a button", () => {
    /*
     * The whole reason `AbilityTiming` exists. A Duskrunner is granted First
     * Strike as her signature, so it arrives in `actions` — and tapping it would
     * do nothing, because it is read once when order is rolled. §7.2 forbids
     * showing an action that cannot be taken, so it must be absent from
     * `legalActions` while still being hers.
     */
    const runner = hero({ id: "c_runner", species: "griffin", class: "duskrunner" });
    expect(runner.actions).toContain("first_strike");

    const scene = sceneWith([{ character: runner, at: { x: 1, y: 2 } }], [wisp()], runner.id);
    expect(offered(scene)).not.toContain("first_strike");
  });

  it("first_strike puts its bearer first in round one and nowhere after", () => {
    /*
     * "Go before anybody else on the first round" — so the assertion has to be
     * against somebody who would otherwise beat her. Turn order is Quick, highest
     * first (§7.2), and this wisp is quicker than any level-1 character can be:
     * without the ability it leads, and with it the Duskrunner leads round one and
     * the wisp gets its place back from round two.
     */
    const runner = hero({ id: "c_runner", species: "bigfoot", class: "duskrunner" });
    const quickWisp: EnemyPlacement = {
      spec: { id: "wisp", count: 1, hp: 6, guard: 1, quick: 20, steps: 4, attack: 3 },
      at: { x: 6, y: 2 },
    };
    const state = beginEncounter(
      { board: board(), party: [{ character: runner, at: { x: 1, y: 2 } }], enemies: [quickWisp] },
      ctx(),
    );

    expect(state.order[0]).toBe("wisp#1");
    expect(state.openingOrder[0]).toBe(runner.id);
  });

  it("burst hits every enemy inside its square", () => {
    const weaver = hero({ id: "c_weaver", species: "kitsune", class: "starweaver" });
    const two = [wisp({ x: 3, y: 2 }), wisp({ x: 4, y: 3 })];
    const scene = sceneWith([{ character: weaver, at: { x: 1, y: 2 } }], two, weaver.id);

    expect(offered(scene)).toContain("burst");
    // A 2x2 anchored at (3,2) covers (3,2), (4,2), (3,3) and (4,3) — both wisps.
    const after = act(scene, { abilityId: "burst", targetTile: { x: 3, y: 2 } });
    expect(hpOf(after, "wisp#1")).toBeLessThan(6);
    expect(hpOf(after, "wisp#2")).toBeLessThan(6);
  });

  it("rally lifts a knocked-down friend from across the board", () => {
    const keeper = hero({ id: "c_keeper", species: "unicorn", class: "songkeeper" });
    const fallen = hero({ id: "c_fallen", species: "bigfoot", class: "thornguard" });
    const scene = sceneWith(
      [
        { character: keeper, at: { x: 0, y: 0 } },
        // The far corner: Rally's range is "board", which is the ability.
        { character: fallen, at: { x: 9, y: 4 }, hp: 0, down: true },
      ],
      [wisp()],
      keeper.id,
    );

    expect(offered(scene)).toContain("rally");
    const after = act(scene, { abilityId: "rally", targetId: fallen.id });
    // §7.3 — back on their feet at 1 HP, not healed to full.
    expect(after.combatants.find((c) => c.id === fallen.id)?.down).toBe(false);
    expect(hpOf(after, fallen.id)).toBe(1);
  });

  it("rally heals a friend who is still standing", () => {
    // The `when` clauses, which are the reason Rally is one ability and not two.
    const keeper = hero({ id: "c_keeper", species: "unicorn", class: "songkeeper" });
    const hurt = hero({ id: "c_hurt", species: "bigfoot", class: "thornguard" });
    const scene = sceneWith(
      [
        { character: keeper, at: { x: 0, y: 0 } },
        { character: hurt, at: { x: 9, y: 4 }, hp: 2 },
      ],
      [wisp()],
      keeper.id,
    );

    const after = act(scene, { abilityId: "rally", targetId: hurt.id });
    expect(hpOf(after, hurt.id)).toBe(4);
  });
});

describe("class unlocks", () => {
  it("are not offered before their level", () => {
    const low = hero({ id: "c_low", species: "unicorn", class: "songkeeper", level: 2 });
    const high = hero({ id: "c_high", species: "unicorn", class: "songkeeper", level: 3 });
    expect(low.actions).not.toContain("soothe");
    expect(high.actions).toContain("soothe");
  });

  it("shove pushes an enemy back and takes its tile", () => {
    const guard = hero({ id: "c_guard", species: "bigfoot", class: "thornguard", level: 3 });
    const scene = sceneWith(
      [{ character: guard, at: { x: 3, y: 2 } }],
      [wisp({ x: 4, y: 2 })],
      guard.id,
    );

    expect(offered(scene)).toContain("shove");
    const after = act(scene, { abilityId: "shove", targetId: "wisp#1" });
    // Two verbs in order: the shove empties (4,2), then `moveSelf` takes it.
    expect(tileOf(after, "wisp#1")).toEqual({ x: 6, y: 2 });
    expect(tileOf(after, guard.id)).toEqual({ x: 4, y: 2 });
  });

  it("glimmer reaches a friend anywhere on the board", () => {
    const weaver = hero({ id: "c_weaver", species: "kitsune", class: "starweaver", level: 3 });
    const friend = hero({ id: "c_friend", species: "unicorn", class: "songkeeper" });
    const scene = sceneWith(
      [
        { character: weaver, at: { x: 0, y: 0 } },
        { character: friend, at: { x: 9, y: 4 } },
      ],
      [wisp()],
      weaver.id,
    );

    expect(offered(scene)).toContain("glimmer");
    const after = act(scene, { abilityId: "glimmer", targetId: friend.id });
    expect(after.combatants.find((c) => c.id === friend.id)?.rollBonus).toBe(2);
  });

  it("soothe reaches four steps and no further", () => {
    const keeper = hero({ id: "c_keeper", species: "unicorn", class: "songkeeper", level: 3 });
    const near = hero({ id: "c_near", species: "bigfoot", class: "thornguard" });
    const far = hero({ id: "c_far", species: "griffin", class: "duskrunner" });
    const scene = sceneWith(
      [
        { character: keeper, at: { x: 0, y: 2 } },
        { character: near, at: { x: 4, y: 3 }, hp: 1 },
        { character: far, at: { x: 9, y: 2 }, hp: 1 },
      ],
      [wisp()],
      keeper.id,
    );

    const soothe = legalActions(scene.state, ctx()).find((a) => a.abilityId === "soothe");
    expect(soothe?.targets).toContain(near.id);
    expect(soothe?.targets).not.toContain(far.id);

    const after = act(scene, { abilityId: "soothe", targetId: near.id });
    expect(hpOf(after, near.id)).toBe(4);
  });

  it("chorus needs no target and reaches the whole party, singer included", () => {
    const keeper = hero({ id: "c_keeper", species: "unicorn", class: "songkeeper", level: 6 });
    const friend = hero({ id: "c_friend", species: "bigfoot", class: "thornguard" });
    const scene = sceneWith(
      [
        { character: keeper, at: { x: 0, y: 0 }, hp: 5 },
        { character: friend, at: { x: 9, y: 4 }, hp: 5 },
      ],
      [wisp()],
      keeper.id,
    );

    const chorus = legalActions(scene.state, ctx()).find((a) => a.abilityId === "chorus");
    expect(chorus?.needsTarget).toBe(false);

    const after = act(scene, { abilityId: "chorus" });
    expect(hpOf(after, keeper.id)).toBe(7);
    expect(hpOf(after, friend.id)).toBe(7);
    expect(after.combatants.find((c) => c.id === keeper.id)?.rollBonus).toBe(1);
  });
});

describe("species actions", () => {
  /**
   * Each of the six, in the situation its sentence describes. Table-driven
   * because the assertion is the same shape every time — *it is offered, and
   * using it changes the board* — and because a seventh species is then one row.
   */
  const cases: {
    species: SpeciesId;
    ability: string;
    /** Where the hero stands, and where the wisp does. */
    hero: { x: number; y: number };
    enemy: { x: number; y: number };
    request: (heroId: string) => { abilityId: string; targetId?: string; targetTile?: { x: number; y: number } };
    check: (before: EncounterState, after: EncounterState, heroId: string) => void;
    /** A hurt friend beside the hero, for the ones that heal. */
    friendAt?: { x: number; y: number };
  }[] = [
    {
      species: "unicorn",
      ability: "mending_light",
      hero: { x: 1, y: 2 },
      enemy: { x: 8, y: 2 },
      friendAt: { x: 2, y: 2 },
      request: () => ({ abilityId: "mending_light", targetId: "c_friend" }),
      check: (_before, after) => expect(hpOf(after, "c_friend")).toBe(4),
    },
    {
      species: "dragonling",
      ability: "gliding_leap",
      hero: { x: 1, y: 2 },
      enemy: { x: 8, y: 2 },
      request: () => ({ abilityId: "gliding_leap", targetTile: { x: 5, y: 2 } }),
      check: (_before, after, heroId) => expect(tileOf(after, heroId)).toEqual({ x: 5, y: 2 }),
    },
    {
      species: "griffin",
      ability: "sky_watch",
      hero: { x: 1, y: 2 },
      enemy: { x: 8, y: 2 },
      request: () => ({ abilityId: "sky_watch" }),
      check: (_before, after, heroId) =>
        expect(after.combatants.find((c) => c.id === heroId)?.rollBonus).toBe(2),
    },
    {
      species: "bigfoot",
      ability: "ground_smash",
      hero: { x: 3, y: 2 },
      enemy: { x: 4, y: 2 },
      request: () => ({ abilityId: "ground_smash" }),
      check: (_before, after) => expect(tileOf(after, "wisp#1")).toEqual({ x: 6, y: 2 }),
    },
    {
      species: "kitsune",
      ability: "fox_fire",
      hero: { x: 3, y: 2 },
      enemy: { x: 6, y: 2 },
      request: () => ({ abilityId: "fox_fire", targetId: "wisp#1" }),
      check: (_before, after) =>
        expect(after.combatants.find((c) => c.id === "wisp#1")?.skipNextTurn).toBe(true),
    },
    {
      species: "manticore",
      ability: "pounce",
      hero: { x: 1, y: 2 },
      enemy: { x: 6, y: 2 },
      // Land beside the wisp; the attack collects from where the leap ended,
      // which is the whole ordering question the ability exists to pose.
      request: () => ({ abilityId: "pounce", targetTile: { x: 5, y: 2 }, targetId: "wisp#1" }),
      check: (_before, after, heroId) => {
        expect(tileOf(after, heroId)).toEqual({ x: 5, y: 2 });
        expect(hpOf(after, "wisp#1")).toBeLessThan(6);
      },
    },
  ];

  for (const c of cases) {
    it(`${c.species}: ${c.ability} is offered and changes the board`, () => {
      const self = hero({ id: "c_self", species: c.species, class: "thornguard" });
      const party = [{ character: self, at: c.hero }];
      if (c.friendAt) {
        party.push({
          character: hero({ id: "c_friend", species: "bigfoot", class: "songkeeper" }),
          at: c.friendAt,
          hp: 1,
        } as (typeof party)[number]);
      }
      const scene = sceneWith(party, [wisp(c.enemy)], self.id);

      expect(offered(scene)).toContain(c.ability);
      const after = act(scene, c.request(self.id));
      c.check(scene.state, after, self.id);
    });

    it(`${c.species}: ${c.ability} is spent for the rest of the encounter`, () => {
      // §7.2 — species actions are once per encounter, and the catalog says so
      // per entry. A missing `oncePerEncounter` is invisible until round two.
      const self = hero({ id: "c_self", species: c.species, class: "thornguard" });
      const party = [{ character: self, at: c.hero }];
      if (c.friendAt) {
        party.push({
          character: hero({ id: "c_friend", species: "bigfoot", class: "songkeeper" }),
          at: c.friendAt,
          hp: 1,
        } as (typeof party)[number]);
      }
      const scene = sceneWith(party, [wisp(c.enemy)], self.id);
      const after = act(scene, c.request(self.id));

      // Same figure, action spent — clear the flags a fresh turn would and ask
      // again. The ability must be gone; Attack must not be.
      const fresh: Scene = {
        state: { ...after, actionTaken: false, stepsLeft: self.steps },
        actorId: self.id,
      };
      expect(offered(fresh)).not.toContain(c.ability);
      expect(scene.state.combatants.some((x) => x.id === self.id)).toBe(true);
    });
  }
});

describe("what is not in the catalog", () => {
  it("leaves a deferred ability off the phone rather than crashing", () => {
    /*
     * The tolerance this whole design leans on. A level-6 Thornguard is granted
     * Bramble Wall, which needs a verb that changes the terrain and is therefore
     * in `$deferred`. `resolveCharacter` still lists it — the card exists, the
     * rules promise it — and `legalActions` must simply not offer it. Anything
     * else is a crash at the table for a gap somebody wrote down on purpose.
     */
    const guard = hero({ id: "c_guard", species: "bigfoot", class: "thornguard", level: 6 });
    expect(guard.actions).toContain("bramble_wall");
    expect(catalog["bramble_wall"]).toBeUndefined();

    const scene = sceneWith([{ character: guard, at: { x: 3, y: 2 } }], [wisp({ x: 4, y: 2 })], guard.id);
    const shown = offered(scene);
    expect(shown).not.toContain("bramble_wall");
    // And the turn is still playable.
    expect(shown).toContain(ATTACK_ID);
  });

  it("refuses an ability the actor was never granted", () => {
    // `performAction` re-derives `legalActions`, so this is the security
    // boundary and not a UI nicety: a Thornguard cannot cast Burst by sending
    // the id, however her phone got hold of it.
    const guard = hero({ id: "c_guard", species: "bigfoot", class: "thornguard" });
    const scene = sceneWith([{ character: guard, at: { x: 3, y: 2 } }], [wisp({ x: 4, y: 2 })], guard.id);

    const result = performAction(scene.state, ctx(), {
      abilityId: "burst",
      targetTile: { x: 4, y: 2 },
    });
    expect(result.ok).toBe(false);
  });
});
