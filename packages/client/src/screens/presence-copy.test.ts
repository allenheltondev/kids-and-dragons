import { describe, expect, it } from "vitest";
import type { EncounterState, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { midChapter, sceneKey, steppedAwayLine, watchingLine } from "./presence-copy";

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

describe("what a watching phone says", () => {
  it("says what the party is doing, and nothing before the story starts", () => {
    const choice: RunState["prompt"] = { kind: "choice", sceneId: "s1", options: [], forPlayerIds: [], vote: true };
    expect(watchingLine(state({ phase: "lobby" }))).toBeNull();
    expect(watchingLine(state())).toBe("The party is on the move.");
    expect(watchingLine(state({ prompt: choice }))).toContain("voting on what to do next");
    expect(watchingLine(state({ phase: "check", prompt: { kind: "roll" } as RunState["prompt"] }))).toContain("trying something tricky");
    expect(watchingLine(state({ sceneType: "rest" }))).toContain("taking a rest");
    expect(watchingLine(state({ phase: "encounter" }))).toContain("A fight is about to start!");
    expect(watchingLine(state({ phase: "encounter", encounter: fight([]) }))).toBe("The party is in a fight!");
  });
});

describe("where the story is", () => {
  it("is mid-chapter only between a chapter's start and its end", () => {
    expect(midChapter({ phase: "lobby" })).toBe(false);
    expect(midChapter({ phase: "creation" })).toBe(false);
    expect(midChapter({ phase: "scene" })).toBe(true);
    expect(midChapter({ phase: "encounter" })).toBe(true);
    expect(midChapter({ phase: "chapter_complete" })).toBe(false);
  });

  it("changes with the scene, not every turn of a fight", () => {
    expect(sceneKey(state({ encounter: fight([]) }))).toBe(sceneKey(state()));
    expect(sceneKey(state({ sceneId: "s2" }))).not.toBe(sceneKey(state()));
  });
});
