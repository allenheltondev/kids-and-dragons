// @vitest-environment jsdom
/**
 * A class place on the phone and the TV (#311): each kid decides alone,
 * switching asks "are you sure?" first, the way on waits for every answer,
 * and the TV says who switched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setSpeaker } from "@kad/shared";
import type { ClientIntent, PartyMember, Prompt, ResolvedCharacter, RulesContent, RunState } from "@kad/shared";
import { makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { setPlayerSection } from "../store/player-navigation";
import { PlayerPanel } from "./PlayerPanel";
import { NarrationPanel } from "./NarrationPanel";
import { switchLines } from "./ClassPlace";

function hero(playerId: string, name: string, cls: ResolvedCharacter["class"]): PartyMember {
  const character = {
    id: `c_${playerId}`,
    ownerPlayerId: playerId,
    name,
    species: "unicorn",
    class: cls,
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: [],
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
    isProvisional: true,
    practiced: true,
  } as ResolvedCharacter;
  return { character, playerId, hp: 10, down: false, connected: true, ready: false };
}

const WAY_ON: Prompt = {
  kind: "choice",
  sceneId: "dojo",
  options: [{ id: "on", label: "Go on", icon: "door" }],
  forPlayerIds: [],
  vote: false,
};

function state(party: PartyMember[], answers: NonNullable<RunState["classPlace"]>["answers"] = {}): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "travel",
    seq: 1,
    phase: "scene",
    campaignId: "c",
    chapterId: "ch_1",
    sceneId: "dojo",
    sceneType: "story",
    narration: "The Dojo.",
    art: null,
    party,
    prompt: WAY_ON,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    classPlace: { class: "thornguard", answers },
    updatedAt: "2026-07-04T18:00:00.000Z",
  };
}

function mount(run: RunState, playerId = "p_1", surface: "phone" | "tv" = "phone", rules = makeRules()) {
  setPlayerSection("turn");
  const sent: ClientIntent[] = [];
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId, mode: "travel", sessionToken: "t" },
    state: run,
    items: makeItems(),
    rules,
    campaign: null,
    send: vi.fn(async (intent: ClientIntent) => {
      sent.push(intent);
      return true;
    }),
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  render(surface === "phone" ? <PlayerPanel /> : <NarrationPanel />);
  return { sent };
}

afterEach(() => {
  cleanup();
});

describe("the phone at a class place", () => {
  it("asks this kid alone, and switching needs an \"are you sure?\"", async () => {
    const user = userEvent.setup();
    const { sent } = mount(state([hero("p_1", "Pip", "songkeeper")]));

    expect(screen.getByText("Become a thornguard?")).toBeTruthy();
    expect(screen.getByText("Only you decide this one.")).toBeTruthy();
    // The way on waits for the answer, so it is not on the phone yet.
    expect(screen.queryByText("Go on")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Be a thornguard" }));
    expect(sent).toEqual([]);
    const sure = screen.getByRole("alertdialog");
    expect(sure.textContent).toContain("Are you sure?");
    expect(sure.textContent).toContain("You take off your song bell and put on the thorn bracer.");
    expect(sure.textContent).toContain("It keeps everything you earned.");
    expect(sure.textContent).toContain("You can switch back at the Conservatory.");

    // "No, wait" goes back without sending anything.
    await user.click(screen.getByRole("button", { name: "No, wait" }));
    expect(sent).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Be a thornguard" }));
    await user.click(screen.getByRole("button", { name: "Yes, switch!" }));
    expect(sent).toEqual([{ type: "SWITCH_CLASS", classId: "thornguard" }]);
  });

  it("keeps the class worn with one more tap", async () => {
    const user = userEvent.setup();
    const { sent } = mount(state([hero("p_1", "Pip", "songkeeper")]));
    await user.click(screen.getByRole("button", { name: "Stay a songkeeper" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Keep your song bell?");
    await user.click(screen.getByRole("button", { name: "Yes, keep it" }));
    expect(sent).toEqual([{ type: "KEEP_CLASS", classId: "thornguard" }]);
  });

  it("lets a kid who said stay change their mind while the room is open", async () => {
    const user = userEvent.setup();
    const party = [hero("p_1", "Pip", "songkeeper"), hero("p_2", "Moss", "songkeeper")];
    const { sent } = mount(state(party, { p_1: { switched: false } }));
    expect(screen.getByText("You are a songkeeper.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stay a songkeeper" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Be a thornguard" }));
    expect(sent).toEqual([]);
    expect(screen.getByRole("alertdialog").textContent).toContain("Are you sure?");
    await user.click(screen.getByRole("button", { name: "Yes, switch!" }));
    expect(sent).toEqual([{ type: "SWITCH_CLASS", classId: "thornguard" }]);
  });

  it("offers no second switch to a kid who already switched", () => {
    mount(state([hero("p_1", "Pip", "thornguard")], { p_1: { switched: true, from: "songkeeper" } }));
    expect(screen.queryByRole("button", { name: /Be a/ })).toBeNull();
  });

  it("shows who the way on is waiting for, then the way on once everyone has answered", () => {
    const party = [hero("p_1", "Pip", "thornguard"), hero("p_2", "Moss", "songkeeper"), hero("p_3", "Wren", "starweaver")];
    mount(state(party, { p_1: { switched: true, from: "songkeeper" } }));
    expect(screen.getByText("You are a thornguard now!")).toBeTruthy();
    expect(screen.getByText("Waiting for Moss and Wren to decide.")).toBeTruthy();
    expect(screen.queryByText("Go on")).toBeNull();

    act(() => {
      useGameStore.setState({
        state: state(party, {
          p_1: { switched: true, from: "songkeeper" },
          p_2: { switched: false },
          p_3: { switched: false },
        }),
      });
    });
    expect(screen.queryByText(/Waiting for/)).toBeNull();
    expect(screen.getByText("Go on")).toBeTruthy();
  });

  it("asks nothing of a hero who already wears the room's class", () => {
    mount(state([hero("p_1", "Bram", "thornguard")]));
    expect(screen.queryByText(/Become a/)).toBeNull();
    expect(screen.getByText("You are a thornguard.")).toBeTruthy();
    expect(screen.getByText("Go on")).toBeTruthy();
  });

  it("says each line of the \"are you sure?\" in one short sentence", () => {
    for (const line of switchLines("thornguard", "duskrunner")) {
      expect(line.split(/[.!?]\s/).length).toBe(1);
      expect(line.split(" ").length).toBeLessThanOrEqual(12);
    }
  });
});

describe("the TV at a class place", () => {
  it("shows who switched, who kept, and who is still deciding", () => {
    const party = [
      hero("p_1", "Pip", "thornguard"),
      hero("p_2", "Moss", "thornguard"),
      hero("p_3", "Wren", "starweaver"),
      hero("p_4", "Bram", "songkeeper"),
    ];
    mount(
      state(party, {
        p_1: { switched: true, from: "songkeeper" },
        p_2: { switched: true, from: "songkeeper" },
        p_3: { switched: false },
      }),
      "p_1",
      "tv",
    );
    const roll = screen.getByTestId("class-roll");
    expect(roll.textContent).toContain("Pip put on the thorn bracer!");
    expect(roll.textContent).toContain("Moss put on the thorn bracer!");
    expect(roll.textContent).toContain("Wren kept the star circlet.");
    expect(roll.textContent).toContain("Bram is deciding…");
  });

  it("moves a kid who changes their mind from kept to switched", () => {
    const party = [hero("p_1", "Pip", "songkeeper"), hero("p_2", "Moss", "songkeeper")];
    mount(state(party, { p_1: { switched: false }, p_2: { switched: false } }), "p_1", "tv");
    expect(screen.getByTestId("class-roll").textContent).toContain("Pip kept the song bell.");

    act(() => {
      useGameStore.setState({
        state: state([hero("p_1", "Pip", "thornguard"), party[1]!], {
          p_1: { switched: true, from: "songkeeper" },
          p_2: { switched: false },
        }),
      });
    });
    const roll = screen.getByTestId("class-roll").textContent ?? "";
    expect(roll).toContain("Pip put on the thorn bracer!");
    expect(roll).not.toContain("Pip kept");
    expect(roll).toContain("Moss kept the song bell.");
  });
});

// ---------------------------------------------------------------------------
// The Exchange's fitting stall (#312): the same two pieces, a different gate
// ---------------------------------------------------------------------------

const STALL_RULES: RulesContent = {
  ...makeRules(),
  fittingStall: {
    stands: [{ chapterId: "ch_1", sceneId: "dojo" }],
    keeper: "Madame Tuck",
    narration: "The tailor is a frogfolk named Madame Tuck. She wears every hat she owns at once.",
  },
};

function atStall(party: PartyMember[], answers: NonNullable<RunState["classPlace"]>["answers"] = {}): RunState {
  return { ...state(party), classPlace: { stall: true, answers } };
}

/** A hero who has finished a chapter: not new, so the stall asks nothing of her. */
function veteran(playerId: string, name: string, cls: ResolvedCharacter["class"]): PartyMember {
  const member = hero(playerId, name, cls);
  return { ...member, character: { ...member.character, xp: 300 } };
}

describe("the phone at the fitting stall", () => {
  it("offers a new hero every other class, and the swap needs an \"are you sure?\"", async () => {
    const user = userEvent.setup();
    const { sent } = mount(atStall([hero("p_1", "Pip", "songkeeper")]), "p_1", "phone", STALL_RULES);

    expect(screen.getByText("Try on a new class?")).toBeTruthy();
    expect(screen.getByText("Only you decide this one. It is free, but only this one time.")).toBeTruthy();
    expect(screen.queryByText("Go on")).toBeNull();
    for (const name of ["Be a thornguard", "Be a duskrunner", "Be a starweaver", "Stay a songkeeper"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Be a songkeeper" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Be a duskrunner" }));
    expect(sent).toEqual([]);
    const sure = screen.getByRole("alertdialog").textContent ?? "";
    expect(sure).toContain("You take off your song bell and put on the dusk hood.");
    expect(sure).toContain("This is your one free swap.");
    expect(sure).toContain("Madame Tuck will not offer it again.");
    expect(sure).toContain("You can switch back at the Conservatory.");

    await user.click(screen.getByRole("button", { name: "Yes, switch!" }));
    expect(sent).toEqual([{ type: "SWITCH_CLASS", classId: "duskrunner", stall: true }]);
  });

  it("keeps the class worn, said as the stall's answer", async () => {
    const user = userEvent.setup();
    const { sent } = mount(atStall([hero("p_1", "Pip", "songkeeper")]), "p_1", "phone", STALL_RULES);
    await user.click(screen.getByRole("button", { name: "Stay a songkeeper" }));
    await user.click(screen.getByRole("button", { name: "Yes, keep it" }));
    expect(sent).toEqual([{ type: "KEEP_CLASS", classId: "songkeeper", stall: true }]);
  });

  it("lets a kid who kept change their mind, but offers no second swap", async () => {
    const user = userEvent.setup();
    const party = [hero("p_1", "Pip", "songkeeper"), hero("p_2", "Moss", "songkeeper")];
    mount(atStall(party, { p_1: { switched: false } }), "p_1", "phone", STALL_RULES);
    expect(screen.getByText("Waiting for Moss to decide.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Be a starweaver" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    cleanup();

    const fitted = { ...hero("p_1", "Pip", "starweaver"), character: { ...hero("p_1", "Pip", "starweaver").character, fitted: true as const } };
    mount(atStall([fitted], { p_1: { switched: true, from: "songkeeper" } }), "p_1", "phone", STALL_RULES);
    expect(screen.getByText("You are a starweaver now!")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Be a/ })).toBeNull();
    expect(screen.getByText("Go on")).toBeTruthy();
  });

  it("asks nothing of a hero who is not new", () => {
    mount(atStall([veteran("p_1", "Bram", "thornguard"), hero("p_2", "Pip", "songkeeper")]), "p_1", "phone", STALL_RULES);
    expect(screen.queryByText("Try on a new class?")).toBeNull();
    expect(screen.queryByRole("button", { name: /Be a/ })).toBeNull();
    expect(screen.getByText("You are a thornguard.")).toBeTruthy();
    expect(screen.getByText("Waiting for Pip to decide.")).toBeTruthy();
  });

  it("says each line of the stall's \"are you sure?\" in one short sentence", () => {
    for (const line of switchLines("songkeeper", "thornguard", "Madame Tuck")) {
      expect(line.split(/[.!?]\s/).length).toBe(1);
      expect(line.split(" ").length).toBeLessThanOrEqual(12);
    }
  });
});

describe("the TV at the fitting stall", () => {
  it("introduces the tailor, then says who switched, who kept, and who is deciding", () => {
    const party = [
      { ...hero("p_1", "Pip", "duskrunner"), character: { ...hero("p_1", "Pip", "duskrunner").character, fitted: true as const } },
      hero("p_2", "Moss", "songkeeper"),
      hero("p_3", "Wren", "starweaver"),
      veteran("p_4", "Bram", "thornguard"),
    ];
    mount(atStall(party, { p_1: { switched: true, from: "songkeeper" }, p_2: { switched: false } }), "p_1", "tv", STALL_RULES);
    const stall = screen.getByTestId("fitting-stall").textContent ?? "";
    expect(stall).toContain("The tailor is a frogfolk named Madame Tuck.");
    const roll = screen.getByTestId("class-roll").textContent ?? "";
    expect(roll).toContain("Pip put on the dusk hood!");
    expect(roll).toContain("Moss kept the song bell.");
    expect(roll).toContain("Wren is deciding…");
    expect(roll).toContain("Bram is a thornguard.");
    // The tailor is introduced before the roll call, never after.
    expect(stall.indexOf("Madame Tuck")).toBeLessThan(stall.indexOf("Pip"));
  });

  it("reads the stall's words aloud once, after the story", () => {
    const spoken: string[] = [];
    setSpeaker((text) => spoken.push(text));
    try {
      const party = [hero("p_1", "Pip", "songkeeper")];
      mount(atStall(party), "p_1", "tv", STALL_RULES);
      act(() => {
        useGameStore.setState({ state: atStall(party, { p_1: { switched: false } }) });
      });
      const words = STALL_RULES.fittingStall!.narration;
      expect(spoken.filter((line) => line === words)).toHaveLength(1);
      expect(spoken.indexOf(words)).toBeGreaterThan(spoken.indexOf("The Dojo."));
    } finally {
      setSpeaker(null);
    }
  });

  it("has no stall words at a class's room", () => {
    mount(state([hero("p_1", "Pip", "songkeeper")]), "p_1", "tv", STALL_RULES);
    expect(screen.queryByTestId("fitting-stall")).toBeNull();
    expect(screen.getByTestId("class-roll")).toBeTruthy();
  });
});
