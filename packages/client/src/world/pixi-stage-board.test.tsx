// @vitest-environment jsdom
/**
 * The stage builds the board only for a patch the board draws.
 *
 * Every patch replaces the run, and most of them are nothing a fight's board shows: a vote, a
 * flag, a tick of `seq`. Building the board's view and handing it to the scene for each of
 * those is work a television does for nothing, so what is counted here is how often the
 * scene is handed one.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { EncounterState, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";

const mocks = vi.hoisted(() => ({ setEncounter: vi.fn(), calls: new Map<string, () => void>() }));
vi.mock("pixi.js", () => ({
  Application: class {
    renderer = { resize: () => undefined };
    ticker = { maxFPS: 0, started: false, stop: () => undefined, start: () => undefined };
    canvas = document.createElement("canvas");
    stage = { destroy: () => undefined };
    init = async () => undefined;
    render = () => undefined;
    destroy = () => undefined;
  },
}));
vi.mock("./scene", () => ({
  // Every call the stage makes on its scene is taken; only the board's is counted.
  createScene: () =>
    new Proxy({}, {
      get: (_target, name: string) => {
        if (name === "setEncounter") return mocks.setEncounter;
        if (!mocks.calls.has(name)) mocks.calls.set(name, () => undefined);
        return mocks.calls.get(name);
      },
    }),
  getActiveScene: () => null,
  setActiveScene: () => undefined,
}));
vi.mock("./lobby-camp-stage", () => ({ createLobbyCamp: () => null, lobbyCampLayout: () => null }));
vi.mock("./art-upkeep", () => ({
  ART_AHEAD: { tv: 0, other: 0, phone: 0 },
  artAhead: () => [],
  scheduleArtUpkeep: () => () => undefined,
}));
vi.mock("../screens/content", () => ({ useEnsureChapter: () => undefined }));

import { useGameStore } from "../store";
import { PixiStage } from "./PixiStage";

function hero(): ResolvedCharacter {
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
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

const PARTY: PartyMember[] = [{ character: hero(), playerId: "p_1", hp: 10, down: false, connected: true, ready: true }];

function fight(): EncounterState {
  return beginEncounter(
    {
      board: parseBoard([".....", ".....", "....."]),
      party: [{ character: hero(), at: { x: 1, y: 1 } }],
      enemies: [{ spec: { id: "wisp", name: "Bog Wisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }, at: { x: 3, y: 1 } }],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

const STORY: RunState = {
  runId: "r_1",
  roomCode: "ABCD",
  mode: "party",
  seq: 1,
  phase: "scene",
  campaignId: null,
  chapterId: "ch_1",
  sceneId: "s_1",
  sceneType: "story",
  narration: "The moss on the bank is warm.",
  art: null,
  party: PARTY,
  prompt: null,
  lastRoll: null,
  flags: {},
  xpEarned: 0,
  updatedAt: "2026-07-04T18:00:00.000Z",
};

/** The run as the next patch leaves it: a new object, with whatever it did not touch the same. */
function patch(change: Partial<RunState>): void {
  const current = useGameStore.getState().state!;
  act(() => useGameStore.setState({ state: { ...current, seq: current.seq + 1, updatedAt: `${current.seq}`, ...change } }));
}

async function mount(): Promise<void> {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "t" },
    state: STORY,
    chapter: null,
    previews: {},
  });
  render(<PixiStage />);
  // The renderer comes up a tick later, and hands the scene the board as it stands.
  await act(async () => undefined);
  expect(mocks.setEncounter).toHaveBeenCalled();
  mocks.setEncounter.mockClear();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("builds no board for a story patch, or for a pick on a story choice", async () => {
  await mount();
  patch({ flags: { met_pellam: true } });
  patch({ narration: "A griffin lands on the mail cart." });
  act(() => useGameStore.setState({ previews: { p_1: { preview: { kind: "choice", choiceId: "onward" }, context: "choice:x" } } }));
  expect(mocks.setEncounter).not.toHaveBeenCalled();
});

it("builds the board when the fight, the party or an aim in a fight changes, and only then", async () => {
  await mount();
  const encounter = fight();
  patch({ encounter });
  expect(mocks.setEncounter).toHaveBeenCalledTimes(1);
  expect(mocks.setEncounter.mock.lastCall?.[0]).toMatchObject({ encounter, party: PARTY });

  // A patch that is not the fight's: the board on the scene is already this one.
  patch({});
  patch({ flags: { met_pellam: true }, xpEarned: 4 });
  expect(mocks.setEncounter).toHaveBeenCalledTimes(1);

  // A hit lands: the fight is a new object.
  const hit = { ...encounter, round: encounter.round + 1 };
  patch({ encounter: hit });
  expect(mocks.setEncounter).toHaveBeenCalledTimes(2);
  expect(mocks.setEncounter.mock.lastCall?.[0]).toMatchObject({ encounter: hit });

  // Somebody aims on their phone.
  act(() => useGameStore.setState({ previews: { p_1: { preview: { kind: "end_turn" }, context: "fight:x" } } }));
  expect(mocks.setEncounter).toHaveBeenCalledTimes(3);

  // A friend's phone drops: the party is a new list.
  patch({ party: [{ ...PARTY[0]!, connected: false }] });
  expect(mocks.setEncounter).toHaveBeenCalledTimes(4);

  // The fight ends.
  patch({ encounter: null });
  expect(mocks.setEncounter).toHaveBeenCalledTimes(5);
  expect(mocks.setEncounter.mock.lastCall?.[0]).toBeNull();
});
