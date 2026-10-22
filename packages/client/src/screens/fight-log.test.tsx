// @vitest-environment jsdom
/**
 * FightLog — the shared screen's running fight log. What it must do is what
 * a playtest asked for: the fight's story on the TV, every roll with the
 * number it needed and why, how hard each hit landed, and only the last few
 * beats, so the room can read it from the sofa.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import {
  beginEncounter,
  parseBoard,
  type DiceRoll,
  type EncounterEvent,
  type EncounterState,
  type ResolvedCharacter,
} from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { FIGHT_LOG_LINES, FightLog, GUARD_WORDS, batchesForLines, fightLogLines } from "./FightLog";

const RULES = makeRules();

function hero(): ResolvedCharacter {
  return {
    id: "c_sky",
    ownerPlayerId: "p_1",
    name: "Skyclaw",
    species: "griffin",
    class: "duskrunner",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 1, quick: 9, clever: 1, heart: 1 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 12,
    attackStat: "quick",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

function fight(startedAt = 1): EncounterState {
  const state = beginEncounter(
    {
      board: parseBoard([".....", ".....", "....."]),
      party: [{ character: hero(), at: { x: 1, y: 1 } }],
      enemies: [{ spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 13, quick: 3, steps: 5, attack: 3 }, at: { x: 2, y: 1 } }],
    },
    { rules: RULES, abilities: {}, rng: { next: () => 0.5 } },
  );
  return { ...state, startedAt };
}

const roll = (over: Partial<DiceRoll> = {}): DiceRoll => ({
  die: 14,
  mod: 2,
  total: 16,
  tn: 13,
  result: "hit",
  characterId: "c_sky",
  stat: "quick",
  ...over,
});

const skyclawHits: EncounterEvent[] = [
  { type: "roll", roll: roll(), targetId: "wisp#1", tier: "graze" },
  { type: "damage", actorId: "wisp#1", amount: 2, hp: 4 },
];

function mount(encounter: EncounterState | null) {
  useGameStore.setState({
    // Nothing left over from the test before: a held presentation would be played on mount.
    presentation: null,
    session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 1,
      phase: "encounter",
      campaignId: null,
      chapterId: "ch_1",
      sceneId: "s_1",
      sceneType: "encounter",
      narration: "",
      art: null,
      party: [],
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-07-04T18:00:00.000Z",
      encounter,
    },
  });
  return render(<FightLog />);
}

let seq = 1000;
function play(events: EncounterEvent[]): void {
  seq += 1;
  act(() => {
    useGameStore.setState({ presentation: { seq, presentation: { kind: "COMBAT_SEQUENCE", events } } });
  });
}

afterEach(() => cleanup());

describe("the fight log's words", () => {
  it("says each swing with its working, the Guard it needed and whose, and how hard it landed", () => {
    const lines = fightLogLines([{ seq: 1, events: skyclawHits }], fight());
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("Skyclaw rolled 14 + 2 Quick = 16 vs Guard 13. Graze! Bramblewisp 1 takes 2. 4 left.");
    expect(lines[0]!.swing).toMatchObject({ who: "Skyclaw", target: "Bramblewisp 1", tier: "graze", hurt: { amount: 2, left: 4 } });
  });

  it("never says You: the shared screen is nobody's own", () => {
    const lines = fightLogLines(
      [{ seq: 1, events: [{ type: "roll", roll: roll({ characterId: "wisp#1", stat: undefined, mod: 3, tn: 12, die: 20, total: 23 }), targetId: "c_sky", tier: "critical" }, { type: "damage", actorId: "c_sky", amount: 5, hp: 5 }] }],
      fight(),
    );
    expect(lines[0]!.text).toBe("Bramblewisp 1 rolled 20 + 3 = 23 vs Guard 12. Critical! Skyclaw takes 5. 5 left.");
  });

  it("keeps only the last few lines, oldest first", () => {
    const batches = Array.from({ length: 8 }, (_, i) => ({
      seq: i,
      events: [{ type: "heal", actorId: "c_sky", amount: 1, hp: i + 1 } as EncounterEvent],
    }));
    const lines = fightLogLines(batches, fight());
    expect(lines).toHaveLength(FIGHT_LOG_LINES);
    expect(lines.map((l) => l.text).at(-1)).toBe("Skyclaw gets 1 back. 8 now.");
  });
});

describe("FightLog on the shared screen", () => {
  it("draws each roll as its working and says what it needed and why, in a kid's words", () => {
    mount(fight());
    play(skyclawHits);
    const log = screen.getByRole("complementary", { name: "The fight so far" });
    const [line] = within(log).getAllByRole("listitem");
    expect(line!.textContent).toContain("Skyclaw");
    expect(line!.textContent).toContain("14");
    expect(line!.textContent).toContain("+ 2 Quick");
    expect(line!.textContent).toContain("= 16");
    expect(line!.textContent).toContain("vs Guard 13");
    expect(line!.textContent).toContain("Graze! 2");
    expect(line!.textContent).toContain("Needs 13: Bramblewisp 1's Guard.");
    expect(line!.textContent).toContain("Bramblewisp 1 takes 2. 4 left.");
    // And what Guard is, once, under the log.
    expect(log.textContent).toContain(GUARD_WORDS);
  });

  it("runs on across a round's sequences, and a miss says what it missed", () => {
    mount(fight());
    play(skyclawHits);
    play([{ type: "roll", roll: roll({ characterId: "wisp#1", die: 4, mod: 3, total: 7, tn: 12, result: "miss", stat: undefined }), targetId: "c_sky" }]);
    const items = within(screen.getByRole("complementary")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain("Miss!");
    expect(items[1]!.textContent).toContain("Needs 12: Skyclaw's Guard.");
  });

  it("keeps a swing on through steps that say nothing", () => {
    // A review: the log kept its last four *batches*, and a step is a batch
    // of its own that draws no line, so four steps pushed every swing out and
    // put "The fight is on!" back mid-fight.
    mount(fight());
    play(skyclawHits);
    for (let i = 0; i < 6; i += 1) play([{ type: "moved", actorId: "wisp#1", to: { x: 3, y: i % 3 } }]);
    const items = within(screen.getByRole("complementary")).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Graze! 2");
  });

  it("lets go of batches no line on screen comes from", () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      seq: 10 + i,
      events: [{ type: "moved", actorId: "wisp#1", to: { x: 3, y: 1 } } as EncounterEvent],
    }));
    const heals = Array.from({ length: 6 }, (_, i) => ({
      seq: i,
      events: [{ type: "heal", actorId: "c_sky", amount: 1, hp: i + 1 } as EncounterEvent],
    }));
    // Four lines are wanted: the last four heals, and the steps after them.
    expect(batchesForLines([...heals, ...steps], fight()).map((b) => b.seq)).toEqual([2, 3, 4, 5, 10, 11, 12, 13, 14]);
  });

  it("starts each fight empty", () => {
    mount(fight(1));
    play(skyclawHits);
    const current = useGameStore.getState().state!;
    act(() => useGameStore.setState({ state: { ...current, encounter: null } }));
    expect(screen.queryByRole("complementary")).toBeNull();
    act(() => useGameStore.setState({ state: { ...current, encounter: fight(2) } }));
    const items = within(screen.getByRole("complementary")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["The fight is on!"]);
  });
});
