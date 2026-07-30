/**
 * The client's combat rules boundary (store/combat.ts).
 *
 * Two promises pinned here: the catalog the phone renders cards from is the
 * committed `content/abilities.json` (parsed with the same tolerance the
 * server's loader applies — unknown verbs dropped, never thrown on), and
 * "is it my turn" answers exactly the way the server's `requireTurn` will.
 */

import { describe, expect, it } from "vitest";
import type { EncounterContext, EnemySpec, RulesContent } from "@kad/shared";
import { beginEncounter, currentActor, legalActions, makeRng, parseBoard } from "@kad/shared";
import abilitiesFile from "../../../../content/abilities.json";
import { PREVIEW_RNG, combatContext, isMyCombatTurn, parseAbilityCatalog } from "./combat";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";

const RULES = { version: 1 } as unknown as RulesContent;

const WISP: EnemySpec = {
  id: "wisp",
  name: "Bramblewisp",
  count: 1,
  hp: 6,
  guard: 11,
  quick: 0,
  steps: 5,
  attack: 3,
};

/** A fight where the party member is guaranteed to act first: Quick 25 beats
    any d20 the wisp (Quick 0) can roll, so the seed cannot flip the order. */
function encounterWithPartyFirst() {
  const character = makeCharacter({ stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
  const ctx: EncounterContext = { rules: RULES, abilities: {}, rng: makeRng("combat-test") };
  return beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character, at: { x: 0, y: 0 } }],
      enemies: [{ spec: WISP, at: { x: 3, y: 3 } }],
    },
    ctx,
  );
}

describe("parseAbilityCatalog", () => {
  it("parses the committed catalog — every entry the content ships survives", () => {
    const catalog = parseAbilityCatalog(abilitiesFile);
    // The catalog the server plays with is the one the phone draws cards
    // from. A parse that silently dropped Burst would hide a legal action,
    // which §7.2 forbids just as hard as showing an illegal one.
    for (const id of Object.keys(abilitiesFile.abilities)) {
      expect(catalog[id], `ability "${id}" fell out of the parse`).toBeDefined();
    }
    expect(catalog["burst"]?.target.kind).toBe("tile");
    expect(catalog["rally"]?.target.range).toBe("board");
  });

  it("drops an entry whose verb the engine does not implement", () => {
    const catalog = parseAbilityCatalog({
      abilities: {
        bad: {
          id: "bad",
          name: "Bad",
          icon: "spark",
          timing: "action",
          target: { kind: "none" },
          effects: [{ effect: { type: "stun" } }],
        },
      },
    });
    expect(catalog).toEqual({});
  });

  it("ignores $comment keys and survives junk shapes", () => {
    expect(parseAbilityCatalog(null)).toEqual({});
    expect(parseAbilityCatalog("nope")).toEqual({});
    expect(parseAbilityCatalog({ abilities: { $comment: "words" } })).toEqual({});
  });
});

describe("combatContext", () => {
  it("feeds legalActions without ever rolling — the stub rng is a constant", () => {
    expect(PREVIEW_RNG.next()).toBe(PREVIEW_RNG.next());

    const encounter = encounterWithPartyFirst();
    const actions = legalActions(encounter, combatContext(RULES, parseAbilityCatalog(abilitiesFile)));
    // Nobody adjacent, nobody down: Ready is the one universal action left.
    expect(actions.map((a) => a.abilityId)).toContain("ready");
    expect(actions.map((a) => a.abilityId)).not.toContain("attack");
  });
});

describe("isMyCombatTurn", () => {
  it("is true exactly for the player whose figure the clock is on", () => {
    const encounter = encounterWithPartyFirst();
    expect(currentActor(encounter)?.side).toBe("party");
    const state = makeState({ encounter, party: [makeMember()] });

    expect(isMyCombatTurn(state, "p_1")).toBe(true);
    expect(isMyCombatTurn(state, "p_2")).toBe(false);
    // The display client is nobody (spec §2.1).
    expect(isMyCombatTurn(state, "")).toBe(false);
  });

  it("is false outside a fight and on an enemy's turn", () => {
    expect(isMyCombatTurn(makeState(), "p_1")).toBe(false);
    expect(isMyCombatTurn(null, "p_1")).toBe(false);

    // Flip the guarantee: a Quick-25 wisp always wins initiative.
    const character = makeCharacter({ stats: { might: 2, quick: 0, clever: 3, heart: 5 } });
    const ctx: EncounterContext = { rules: RULES, abilities: {}, rng: makeRng("combat-test") };
    const encounter = beginEncounter(
      {
        board: parseBoard(["....", "....", "....", "...."]),
        party: [{ character, at: { x: 0, y: 0 } }],
        enemies: [{ spec: { ...WISP, quick: 25 }, at: { x: 3, y: 3 } }],
      },
      ctx,
    );
    expect(currentActor(encounter)?.side).toBe("enemy");
    expect(isMyCombatTurn(makeState({ encounter, party: [makeMember()] }), "p_1")).toBe(false);
  });
});
