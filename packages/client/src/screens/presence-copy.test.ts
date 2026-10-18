import { describe, expect, it } from "vitest";
import type { EncounterState, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { catchUpLine, midChapter, sceneKey, situationKey, steppedAwayLine } from "./presence-copy";

const me = {
  character: { id: "c_1", name: "Pip" } as ResolvedCharacter,
  playerId: "p_1",
  hp: 10,
  down: false,
  connected: true,
  ready: false,
} satisfies PartyMember;

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    phase: "scene",
    chapterId: "ch",
    sceneId: "s1",
    sceneType: "story",
    prompt: null,
    visited: ["s0", "s1"],
    party: [me],
    ...overrides,
  } as RunState;
}

function fight(combatants: EncounterState["combatants"]): EncounterState {
  return { combatants, round: 1, turnIndex: 0 } as unknown as EncounterState;
}

describe("the shared screen's line", () => {
  it("names who stepped away, and how the table goes on when it is their turn", () => {
    expect(steppedAwayLine("Pip", false)).toBe("Pip stepped away.");
    expect(steppedAwayLine("Pip", true)).toBe("Pip stepped away. Any phone can pass their turn.");
  });
});

describe("the catch-up", () => {
  it("says welcome back to a returning kid and welcome to a late one", () => {
    expect(catchUpLine(state(), me, true)).toBe("Welcome back, Pip! The party is on the move.");
    expect(catchUpLine(state(), me, false)).toBe("Welcome, Pip! The party is on the move.");
  });

  it("says what the party is doing", () => {
    const choice: RunState["prompt"] = { kind: "choice", sceneId: "s1", options: [], forPlayerIds: [], vote: true };
    expect(catchUpLine(state({ prompt: choice }), me, true)).toContain("voting on what to do next");
    expect(catchUpLine(state({ phase: "check", prompt: { kind: "roll" } as RunState["prompt"] }), me, true)).toContain(
      "trying something tricky",
    );
    expect(catchUpLine(state({ sceneType: "rest" }), me, true)).toContain("taking a rest");
    expect(catchUpLine(state({ phase: "encounter" }), me, true)).toContain("A fight is about to start!");
  });

  it("tells a kid in a fight where their hero is", () => {
    const standing = fight([{ id: "c_1", down: false } as EncounterState["combatants"][number]]);
    const fallen = fight([{ id: "c_1", down: true } as EncounterState["combatants"][number]]);
    expect(catchUpLine(state({ phase: "encounter", encounter: standing }), me, true)).toContain(
      "your hero is right where you left them",
    );
    expect(catchUpLine(state({ phase: "encounter", encounter: fallen }), me, true)).toContain("help your hero up");
    // Seated mid-fight: not on the board, so they wait for the next one.
    expect(catchUpLine(state({ phase: "encounter", encounter: fight([]) }), me, false)).toContain(
      "You join in after it.",
    );
  });

  it("never counts the party or uses an em dash", () => {
    const lines = [true, false].map((back) => catchUpLine(state(), me, back));
    for (const line of lines) {
      expect(line).not.toMatch(/—/);
      expect(line).not.toMatch(/\b(two|three|four) of you\b/);
    }
  });
});

describe("what counts as having missed something", () => {
  it("is mid-chapter only between a chapter's start and its end", () => {
    expect(midChapter({ phase: "lobby" })).toBe(false);
    expect(midChapter({ phase: "creation" })).toBe(false);
    expect(midChapter({ phase: "scene" })).toBe(true);
    expect(midChapter({ phase: "encounter" })).toBe(true);
    expect(midChapter({ phase: "chapter_complete" })).toBe(false);
  });

  it("moves with the scene, the fight's turn and the open question", () => {
    const before = state();
    expect(situationKey(state())).toBe(situationKey(before));
    expect(situationKey(state({ sceneId: "s2", visited: ["s0", "s1", "s2"] }))).not.toBe(situationKey(before));
    expect(situationKey(state({ prompt: { kind: "roll" } as RunState["prompt"] }))).not.toBe(situationKey(before));
    expect(situationKey(state({ encounter: fight([]) }))).not.toBe(situationKey(before));
  });

  it("puts an old catch-up away only when the scene changes, not every turn", () => {
    expect(sceneKey(state({ encounter: fight([]) }))).toBe(sceneKey(state()));
    expect(sceneKey(state({ sceneId: "s2" }))).not.toBe(sceneKey(state()));
  });
});
