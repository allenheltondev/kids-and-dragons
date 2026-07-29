/**
 * Test fixtures. Not shipped — nothing under src/ imports this outside *.test.ts.
 *
 * Building a RunState by hand in every test buries the assertion under thirty
 * lines of character sheet, and the shapes are the contract, so they belong in
 * one place that fails loudly when the contract moves.
 */

import type { PartyMember, ResolvedCharacter, RunState } from "@kad/shared";

export function makeCharacter(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: ["rally"],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

export function makeMember(overrides: Partial<PartyMember> = {}): PartyMember {
  const character = overrides.character ?? makeCharacter();
  return {
    character,
    playerId: character.ownerPlayerId,
    hp: character.maxHp,
    down: false,
    connected: true,
    ready: false,
    ...overrides,
  };
}

export function makeState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "travel",
    seq: 1,
    phase: "lobby",
    campaignId: null,
    chapterId: null,
    sceneId: null,
    sceneType: null,
    narration: "",
    art: null,
    party: [makeMember()],
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}
