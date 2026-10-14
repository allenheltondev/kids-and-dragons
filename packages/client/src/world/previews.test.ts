import { describe, expect, it } from "vitest";
import { beginEncounter, currentActor, parseBoard, previewContext } from "@kad/shared";
import type { EncounterState, IntentPreview, ResolvedCharacter, RunState } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { boardAim, describeCombatPreview, tablePreviews } from "./previews";
import type { HeldPreview } from "../store/contract";

/** Picks as the store holds them, each made for the decision `state` shows. */
function held(state: RunState, picks: Record<string, IntentPreview>): Record<string, HeldPreview> {
  const context = previewContext(state)!;
  return Object.fromEntries(Object.entries(picks).map(([id, preview]) => [id, { preview, context }]));
}

const PIP = makeCharacter({ id: "c_pip", ownerPlayerId: "p_pip", name: "Pip" });
const TAM = makeCharacter({ id: "c_tam", ownerPlayerId: "p_tam", name: "Tam" });
const PARTY = [PIP, TAM].map((c) => makeMember({ character: c, playerId: c.ownerPlayerId }));

function fight(): EncounterState {
  return beginEncounter(
    {
      board: parseBoard(["......", "......", "......", "......", "......", "......"]),
      party: [PIP, TAM].map((c: ResolvedCharacter, i) => ({ character: c, at: { x: 0, y: i } })),
      enemies: [{ spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 0, steps: 5, attack: 3 }, at: { x: 5, y: 5 } }],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.99 } },
  );
}

function story(): RunState {
  return makeState({
    party: PARTY,
    prompt: {
      kind: "choice",
      sceneId: "s",
      options: [
        { id: "east", label: "Go east", icon: "arrow" },
        { id: "west", label: "Go west", icon: "arrow" },
      ],
      forPlayerIds: [],
      vote: true,
    },
  });
}

describe("tablePreviews — a story choice", () => {
  it("lists who is leaning toward each option", () => {
    const leaning = tablePreviews(story(), held(story(), {
      p_pip: { kind: "choice", choiceId: "east" },
      p_tam: { kind: "choice", choiceId: "east" },
    }));
    expect(leaning.choices).toEqual({ east: ["Pip", "Tam"] });
    expect(leaning.combat).toBeNull();
  });

  it("drops a pick for an option no longer on offer", () => {
    expect(tablePreviews(story(), held(story(), { p_pip: { kind: "choice", choiceId: "north" } })).choices).toEqual({});
  });

  it("drops a pick from somebody who is not at the table", () => {
    expect(tablePreviews(story(), held(story(), { p_ghost: { kind: "choice", choiceId: "east" } })).choices).toEqual({});
  });

  it("ignores a late pick from an earlier visit to the same question", () => {
    // Same scene, same option ids, same player — but the story has been
    // somewhere else in between, so the pick is for a question already answered.
    const earlier = story();
    const later = { ...earlier, visited: [...(earlier.visited ?? []), "brook", "s"] };
    const stale = held(earlier, { p_pip: { kind: "choice", choiceId: "east" } });
    expect(tablePreviews(later, stale).choices).toEqual({});
    expect(tablePreviews(earlier, stale).choices).toEqual({ east: ["Pip"] });
  });
});

describe("tablePreviews — a fight", () => {
  const encounter = fight();
  const active = currentActor(encounter);
  const state = makeState({ party: PARTY, prompt: null, encounter });
  const activePlayer = PARTY.find((m) => m.character.id === active?.id)?.playerId ?? "";
  const otherPlayer = PARTY.find((m) => m.playerId !== activePlayer)?.playerId ?? "";

  it("starts on a party turn, which the rest of this block relies on", () => {
    expect(active?.side).toBe("party");
  });

  it("shows the fighter whose turn it is", () => {
    const preview: IntentPreview = { kind: "move", to: { x: 1, y: 0 } };
    const leaning = tablePreviews(state, held(state, { [activePlayer]: preview }));
    expect(leaning.combat?.playerId).toBe(activePlayer);
    expect(leaning.combat?.preview).toEqual(preview);
  });

  it("ignores everybody else, whose turn it is not", () => {
    expect(tablePreviews(state, held(state, { [otherPlayer]: { kind: "end_turn" } })).combat).toBeNull();
  });

  it("ignores a late pick from before the same player's confirmed move", () => {
    const stale = held(state, { [activePlayer]: { kind: "move", to: { x: 1, y: 0 } } });
    // Same turn, same player — but the move went through and the steps moved on.
    const after = { ...state, encounter: { ...encounter, stepsLeft: encounter.stepsLeft - 1 } };
    expect(tablePreviews(after, stale).combat).toBeNull();
  });

  it("ignores a story pick left over from before the fight", () => {
    expect(tablePreviews(state, held(state, { [activePlayer]: { kind: "choice", choiceId: "east" } })).combat).toBeNull();
  });
});

describe("boardAim and the caption", () => {
  const encounter = fight();
  const wisp = encounter.combatants.find((c) => c.side === "enemy")!;

  it("rings the tile a move is headed for", () => {
    expect(boardAim(encounter, { kind: "move", to: { x: 2, y: 3 } })).toEqual({ tiles: [{ x: 2, y: 3 }], targets: [] });
  });

  it("rings the figure an attack is aimed at, where it stands", () => {
    const aim = boardAim(encounter, { kind: "action", abilityId: "attack", targetIds: [wisp.id] });
    expect(aim).toEqual({ tiles: [], targets: [{ x: 5, y: 5 }] });
  });

  it("rings nothing for ending the turn", () => {
    expect(boardAim(encounter, { kind: "end_turn" })).toBeNull();
  });

  it("names the power and who it lands on", () => {
    const line = describeCombatPreview(
      { kind: "action", abilityId: "attack", targetIds: [wisp.id] },
      encounter,
      {},
      null,
    );
    expect(line).toBe("Attack → Bramblewisp 1");
  });
});
