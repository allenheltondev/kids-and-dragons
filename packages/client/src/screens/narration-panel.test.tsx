// @vitest-environment jsdom
/**
 * NarrationPanel — the shared surface, and the one voice.
 *
 * `speak()` is called here and only here (spec §11). WorldView exists exactly
 * once per player in both modes — a TV in Party Mode, the top pane in Travel
 * Mode — so a line spoken from PlayerPanel as well would be said twice on a
 * Travel Mode phone, which renders both.
 *
 * This file exists for the trading announcement. Everything else about a
 * hand-off happens on two phones, and in Party Mode the table is looking at
 * the television: without a line here, Dad taps "give it to her" and the only
 * thing that happens anywhere in the room is a card appearing on a phone she
 * may not be holding. §9.4 calls trading "the point in the session where the
 * three of you talk to each other" — that needs the room to hear it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { setSpeaker } from "@kad/shared";
import type { ItemCatalog, PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeItems } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { NarrationPanel } from "./NarrationPanel";
import { RANK_UP_MS } from "./RankUpMoment";

const ITEMS: ItemCatalog = makeItems();

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
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
    ...overrides,
  };
}

function member(playerId: string, name: string): PartyMember {
  const char = character({ id: `c_${playerId}`, ownerPlayerId: playerId, name });
  return { character: char, playerId, hp: 10, down: false, connected: true, ready: true };
}

const PARTY = [member("p_1", "Sparklehoof"), member("p_2", "Thistle")];

function mount(overrides: Partial<RunState> = {}, itemsLoaded: ItemCatalog | null = ITEMS) {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "party",
      seq: 3,
      phase: "scene",
      campaignId: "c",
      chapterId: "bramblewood-01",
      sceneId: "rest_mossbank",
      sceneType: "rest",
      narration: "The moss on the bank is warm.",
      art: null,
      party: PARTY,
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-08-16T12:00:00.000Z",
      ...overrides,
    },
    items: itemsLoaded,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
  return render(<NarrationPanel />);
}

const OFFER = {
  id: "t1",
  fromPlayerId: "p_1",
  toPlayerId: "p_2",
  itemId: "sunbloom_draught",
};

let spoken: string[] = [];

beforeEach(() => {
  spoken = [];
  setSpeaker((text) => spoken.push(text));
});

afterEach(() => {
  cleanup();
  setSpeaker(null);
  vi.restoreAllMocks();
});

describe("announcing a hand-off (spec §9.4)", () => {
  it("heads World with only the current chapter", () => {
    mount({ chapterInfo: { index: 1, title: "The City That Smelled Opportunity" }, sceneType: "story" });
    expect(screen.getByRole("heading", { name: "Chapter 1 · The City That Smelled Opportunity" })).toBeTruthy();
    expect(screen.queryByText("The story")).toBeNull();
  });
  it("says what is being given out loud, with the names left on screen (#552)", () => {
    mount({ trades: [OFFER] });
    expect(spoken).toContain("Hero wants to give another hero a Sunbloom Draught.");
    expect(spoken.join(" ")).not.toMatch(/Sparklehoof|Thistle/);
  });

  it("names it in the third person, so it works on a television", () => {
    // The shared surface has no "you" — it is the same screen for all three of
    // them, and in Party Mode it is across the room from every phone.
    mount({ trades: [OFFER] });
    const line = spoken.find((t) => t.includes("Sunbloom"))!;
    expect(line).not.toMatch(/\byou\b/i);
  });

  it("shows it on the shared screen as well as saying it", () => {
    mount({ trades: [OFFER] });
    expect(screen.getByText(/offers/)).toBeTruthy();
    expect(screen.getAllByText("Sparklehoof").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thistle").length).toBeGreaterThan(0);
  });

  it("shows it up top, off the plate, so an offer cannot push the story up", () => {
    const { container } = mount({ trades: [OFFER] });
    const trade = container.querySelector(".narration__trade");
    expect(trade?.closest(".narration__head")).not.toBeNull();
    expect(trade?.closest(".narration__plate")).toBeNull();
  });

  it("says nothing at all when nothing is being passed around", () => {
    mount({ trades: [] });
    expect(spoken.some((t) => t.includes("wants to give"))).toBe(false);
    expect(screen.queryByText(/offers/)).toBeNull();
  });

  it("does not say it twice for the same offer", () => {
    // Re-rendering is not re-announcing. The scene's narration follows the
    // same rule, for the same reason: this is a table, not a notification bar.
    const { rerender } = mount({ trades: [OFFER] });
    rerender(<NarrationPanel />);
    rerender(<NarrationPanel />);
    expect(spoken.filter((t) => t.includes("Sunbloom Draught"))).toHaveLength(1);
  });

  it("still reads the scene's own narration first", () => {
    // An offer is an aside; the scene outranks it and must not be stomped.
    mount({ trades: [OFFER] });
    expect(spoken[0]).toBe("The moss on the bank is warm.");
  });

  it("renders a run persisted before trading existed", () => {
    const legacy: Partial<RunState> = {};
    expect(() => mount(legacy)).not.toThrow();
    expect(screen.queryByText(/offers/)).toBeNull();
  });

  it("falls back rather than throwing when the item catalog has not loaded", () => {
    // Content is fetched separately from the bundle; the TV can be refreshed
    // into a scene before it lands.
    expect(() => mount({ trades: [OFFER] }, null)).not.toThrow();
    expect(spoken.some((t) => t.includes("wants to give"))).toBe(true);
  });
});

/**
 * Announcing is per *offer*, not per rendering of the list.
 *
 * Keying the dedup on the joined sentence made every change of shape a reason
 * to say everything again: a second offer turned "A" into "A B" and repeated A,
 * resolving A turned "A B" into "B" and repeated B, and the item catalog
 * arriving late turned "a thing" into "a Sunbloom Draught" and said the lot.
 * Three people around a television get interrupted by every one of those.
 */
describe("announcing several hand-offs", () => {
  const SECOND = {
    id: "t2",
    fromPlayerId: "p_2",
    toPlayerId: "p_1",
    itemId: "river_charm",
  };

  function push(trades: RunState["trades"]) {
    act(() => {
      useGameStore.setState((prev) => ({
        state: { ...prev.state!, trades, seq: prev.state!.seq + 1 },
      }));
    });
  }

  it("says only the new one when a second offer arrives", () => {
    const { rerender } = mount({ trades: [OFFER] });
    expect(spoken.filter((t) => t.includes("Sunbloom"))).toHaveLength(1);

    push([OFFER, SECOND]);
    rerender(<NarrationPanel />);

    expect(spoken.filter((t) => t.includes("Sunbloom"))).toHaveLength(1);
    expect(spoken.filter((t) => t.includes("River Charm"))).toHaveLength(1);
  });

  it("does not re-announce the survivor when one is resolved", () => {
    const { rerender } = mount({ trades: [OFFER] });
    push([OFFER, SECOND]);
    rerender(<NarrationPanel />);
    push([SECOND]);
    rerender(<NarrationPanel />);

    expect(spoken.filter((t) => t.includes("River Charm"))).toHaveLength(1);
  });

  it("does not re-announce when the item catalog arrives late", () => {
    // Content is fetched separately from the bundle, so a TV can be in a scene
    // before the names it needs have landed. The sentence then changes from
    // "a thing" to "a Sunbloom Draught" — which must not be a reason to speak.
    const { rerender } = mount({ trades: [OFFER] }, null);
    const saidWhileNameless = spoken.length;
    expect(spoken.some((t) => t.includes("a thing"))).toBe(true);

    act(() => {
      useGameStore.setState({ items: ITEMS });
    });
    rerender(<NarrationPanel />);

    expect(spoken).toHaveLength(saidWhileNameless);
  });
});

describe("the story turn (spec §6.1)", () => {
  const storyChoice = (forPlayerIds: string[]) => ({
    sceneId: "story_gate",
    sceneType: "story" as const,
    prompt: {
      kind: "choice" as const,
      sceneId: "story_gate",
      options: [{ id: "push", label: "Push the gate", icon: "hand" }],
      forPlayerIds,
      vote: false,
    },
  });

  it("tells the room whose turn it is, on screen and out loud", () => {
    mount(storyChoice(["p_2"]));
    expect(screen.getByTestId("turn-owner").textContent).toMatch(/Thistle.s turn to choose/);
    // The name is on screen; the room hears "hero" (#552).
    expect(spoken).toContain("Hero's turn.");
    expect(spoken.join(" ")).not.toContain("Thistle");
  });

  it("leaves the options to the phone that owns them", () => {
    mount(storyChoice(["p_2"]));
    expect(spoken.some((line) => line.includes("Push the gate"))).toBe(false);
  });

  it("names nobody when the choice is open to anyone", () => {
    mount(storyChoice([]));
    expect(screen.queryByText(/turn to choose/)).toBeNull();
  });

  it("names nobody once the turn holder's phone has dropped", () => {
    const { container } = mount({
      ...storyChoice(["p_2"]),
      party: [PARTY[0]!, { ...PARTY[1]!, connected: false }],
    });
    expect(screen.queryByText(/turn to choose/)).toBeNull();
    // But the line keeps its seat, so the drop cannot move the story.
    expect(container.querySelector(".narration__turn.narration__turn--empty")).not.toBeNull();
  });
});

describe("what somebody has picked but not confirmed", () => {
  const vote = {
    prompt: {
      kind: "choice" as const,
      sceneId: "s",
      options: [
        { id: "east", label: "Go east", icon: "arrow" },
        { id: "west", label: "Go west", icon: "arrow" },
      ],
      forPlayerIds: [],
      vote: true,
    },
  };

  afterEach(() => useGameStore.setState({ previews: {} }));

  it("does not light the option a group vote is leaning toward: the room sees ticks, not a pick", () => {
    // Stamped with the decision on screen: no chapter or trail in this
    // fixture, the fork scene, story turn 0.
    useGameStore.setState({
      previews: { p_2: { preview: { kind: "choice", choiceId: "west" }, context: "choice:bramblewood-01:0:s:0" } },
    });
    const { container } = mount(vote);
    expect(container.querySelector(".narration__choice--picked")).toBeNull();
    expect(container.querySelector(".kad-vote-tick--on")).toBeNull();
  });

  it("still lights the option one kid is leaning toward on their own decision, without naming them", () => {
    useGameStore.setState({
      previews: { p_2: { preview: { kind: "choice", choiceId: "west" }, context: "choice:bramblewood-01:0:s:0" } },
    });
    const { container } = mount({ prompt: { ...vote.prompt, vote: false, forPlayerIds: ["p_2"] } });
    const picked = container.querySelectorAll(".narration__choice--picked");
    expect(picked).toHaveLength(1);
    expect(picked[0]?.textContent).toContain("Go west");
    expect(picked[0]?.textContent).not.toContain("Thistle");
  });

  it("ticks who has locked in a vote, on the option they chose, as the phones do", () => {
    const { container } = mount({ prompt: { ...vote.prompt, votes: { p_2: "west" } } });
    const on = container.querySelectorAll(".kad-vote-tick--on");
    expect(on).toHaveLength(1);
    expect(on[0]?.closest(".narration__choice")?.textContent).toContain("Go west");
    // A tick, not a name — but the name is still there for screen readers.
    expect(on[0]?.closest(".narration__choice")?.querySelector(".kad-sr-only")?.textContent).toContain(
      "Thistle",
    );
    // Locked in is not a pick still being made: no cyan highlight for it.
    expect(container.querySelector(".narration__choice--picked")).toBeNull();
  });

  it("draws every voter's seat on every option, so a vote cannot grow a pill", () => {
    const before = mount(vote).container;
    const seats = (root: HTMLElement) =>
      [...root.querySelectorAll(".narration__choice")].map((c) => c.querySelectorAll(".kad-vote-tick").length);
    const empty = seats(before);
    expect(empty).toEqual([PARTY.length, PARTY.length]);
    cleanup();
    const after = mount({ prompt: { ...vote.prompt, votes: { p_2: "west" } } }).container;
    expect(seats(after)).toEqual(empty);
  });

  it("stays dark for a pick made for an earlier question", () => {
    useGameStore.setState({
      previews: { p_2: { preview: { kind: "choice", choiceId: "west" }, context: "choice:bramblewood-01:0:s:1" } },
    });
    const { container } = mount(vote);
    expect(container.querySelector(".narration__choice--picked")).toBeNull();
  });

  it("lights up nothing while nobody is picking", () => {
    useGameStore.setState({ previews: {} });
    const { container } = mount(vote);
    expect(container.querySelector(".narration__choice--picked")).toBeNull();
  });
});

describe("what the table picked (RunState.decision)", () => {
  const DECIDED = { sceneId: "camp", label: "Open the gate.", byPlayerId: "p_2", vote: true };

  it("says what the party voted, in one line over the story, and says it aloud", () => {
    mount({ sceneId: "camp", narration: "The gate swings open.", decision: DECIDED });
    expect(screen.getByTestId("decision").textContent).toBe("The party voted: Open the gate.");
    expect(spoken).toContain("The party voted: Open the gate. The gate swings open.");
  });

  it("names the kid who picked, when one kid chose for everyone", () => {
    mount({ sceneId: "camp", decision: { ...DECIDED, label: "Go west", vote: false } });
    expect(screen.getByTestId("decision").textContent).toBe("Thistle chose: Go west.");
    // Named on screen, "hero" out loud (#552).
    expect(spoken.some((line) => line.startsWith("Hero chose: Go west."))).toBe(true);
  });

  it("does not add a full stop to a label that already has one", () => {
    mount({ sceneId: "camp", decision: DECIDED });
    expect(screen.getByTestId("decision").textContent).not.toMatch(/\.\.$/);
  });

  it("is gone once the table has moved on to another scene", () => {
    mount({ sceneId: "road", decision: DECIDED });
    expect(screen.queryByTestId("decision")).toBeNull();
  });

  it("is not shown in a fight, which has no story choice to report", () => {
    mount({
      sceneId: "camp",
      sceneType: "encounter",
      encounter: { round: 1, turnOrder: [], combatants: [] } as never,
      decision: DECIDED,
    });
    expect(screen.queryByTestId("decision")).toBeNull();
  });
});

describe("a fight", () => {
  it("folds the panel to a strip so the board shows", () => {
    const { container } = mount({
      sceneType: "encounter",
      encounter: { round: 1, turnOrder: [], combatants: [] } as never,
    });
    expect(container.querySelector(".narration--fight")).not.toBeNull();
  });

  it("holds the aim line's seat while nobody is aiming", () => {
    const { container } = mount({
      sceneType: "encounter",
      encounter: { round: 1, turnOrder: [], combatants: [] } as never,
    });
    expect(container.querySelector(".narration__aim.narration__aim--empty")).not.toBeNull();
  });

  it("is a full panel outside one", () => {
    const { container } = mount({ encounter: null });
    expect(container.querySelector(".narration--fight")).toBeNull();
  });
});

describe("priority scenes (chapter.ts ScenePriority)", () => {
  const SEAL = "The gemstones are pieces of a seal. The seal holds a titan asleep under Mount Red Sky.";

  it("marks a revelation as one, on the plate and in words", () => {
    const { container } = mount({ sceneType: "story", narration: SEAL, scenePriority: 1 });
    expect(container.querySelector(".narration--p1")).not.toBeNull();
    const ribbon = container.querySelector(".narration__ribbon");
    expect(ribbon?.textContent).toBe("Remember this!");
    expect(ribbon?.closest(".narration__plate")).not.toBeNull();
  });

  it("says the ribbon ahead of the narration, so a listener hears it too", () => {
    mount({ sceneType: "story", narration: SEAL, scenePriority: 1 });
    expect(spoken[0]).toBe(`Remember this! ${SEAL}`);
  });

  it("marks a clue more quietly", () => {
    const { container } = mount({ sceneType: "story", narration: SEAL, scenePriority: 2 });
    expect(container.querySelector(".narration--p2")).not.toBeNull();
    expect(container.querySelector(".narration__ribbon")?.textContent).toBe("A clue");
  });

  it("leaves an ordinary scene, and a run saved before priorities, unmarked", () => {
    const { container } = mount({ sceneType: "story", scenePriority: null });
    expect(container.querySelector(".narration__ribbon")).toBeNull();
    expect(container.querySelector(".narration--p1, .narration--p2")).toBeNull();
    cleanup();
    spoken = [];
    const legacy = mount({ sceneType: "story" });
    expect(legacy.container.querySelector(".narration__ribbon")).toBeNull();
    expect(spoken[0]).toBe("The moss on the bank is warm.");
  });
});

describe("a friend who stepped away (#258)", () => {
  it("says so on the shared screen, and nothing while everyone is here", () => {
    mount({ sceneType: "story" });
    expect(screen.queryByTestId("stepped-away")).toBeNull();
    cleanup();
    mount({ sceneType: "story", party: [PARTY[0]!, { ...PARTY[1]!, connected: false }] });
    expect(screen.getByTestId("stepped-away").textContent).toBe("Thistle stepped away.");
  });
});

describe("the practice's hint (#255)", () => {
  const HINT = "Time to roll! When your phone says Roll, tap it.";

  it("shows it under the story and says it after the story, once", () => {
    const view = mount({ sceneType: "story", sceneId: "check_latch", narration: "The latch is tied in a bow.", hint: HINT });
    expect(screen.getByTestId("scene-hint").textContent).toBe(HINT);
    expect(spoken.indexOf(HINT)).toBeGreaterThan(spoken.indexOf("The latch is tied in a bow."));
    // A patch that changes nothing about the scene does not say it again.
    act(() => {
      useGameStore.setState({ state: { ...useGameStore.getState().state!, seq: 4 } });
    });
    view.rerender(<NarrationPanel />);
    expect(spoken.filter((line) => line === HINT)).toHaveLength(1);
  });

  it("shows and says nothing on a scene without one, which is every scene outside the practice", () => {
    mount({ sceneType: "story" });
    expect(screen.queryByTestId("scene-hint")).toBeNull();
    expect(spoken).toEqual(["The moss on the bank is warm."]);
  });
});

describe("a rank that just landed (#310)", () => {
  const UP = { characterId: "c_1", class: "duskrunner" as const, rank: "apprentice" as const, line: "Pip is a Duskrunner Apprentice now! New move: Vanish.", crow: "A crow lands on a fence nearby. \"Saw that. Nice. Don't mess with us.\" It flies off." };

  it("is said in one line on the scene it landed on, after the story, crow and all", () => {
    mount({ sceneType: "rest", sceneId: "camp", narration: "A fire, and the road beyond it.", rankUps: { sceneId: "camp", ups: [UP] } });
    expect(screen.getByTestId("rank-up").textContent).toBe(`${UP.line} ${UP.crow}`);
    expect(spoken.indexOf(`${UP.line} ${UP.crow}`)).toBeGreaterThan(spoken.indexOf("A fire, and the road beyond it."));
  });

  it("is gone once the table has moved on to another scene", () => {
    mount({ sceneType: "story", sceneId: "road", rankUps: { sceneId: "camp", ups: [UP] } });
    expect(screen.queryByTestId("rank-up")).toBeNull();
    expect(screen.queryByTestId("rank-up-moment")).toBeNull();
  });

  it("lifts the token over the stage beside the line (#314), said only once, by the line", async () => {
    mount({ sceneType: "rest", sceneId: "camp", narration: "A fire, and the road beyond it.", rankUps: { sceneId: "camp", ups: [UP] } });
    const moment = await screen.findByTestId("rank-up-moment");
    expect(moment.getAttribute("aria-hidden")).toBe("true");
    expect(moment.textContent).toContain("Don't mess with us.");
    expect(spoken.filter((line) => line.includes("Duskrunner Apprentice"))).toHaveLength(1);
  });

  it("cheers once per landing: not again on a redraw, but again when the same rank lands again in a run played over", async () => {
    // No test seam reset: the moment's own memory has to get this right.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const camp = { sceneType: "rest" as const, sceneId: "camp", rankUps: { sceneId: "camp", ups: [UP] } };
      mount(camp);
      await screen.findByTestId("rank-up-moment");
      act(() => { vi.advanceTimersByTime(RANK_UP_MS); });
      expect(screen.queryByTestId("rank-up-moment")).toBeNull();

      // The same landing, redrawn (a pane toggled, the panel remounted): no second cheer.
      cleanup();
      mount(camp);
      expect(screen.queryByTestId("rank-up-moment")).toBeNull();

      // The table moves on; the campaign fails and rolls the rank back; the chapter is played
      // over in the same run, and the same hero earns the same rank on the same scene.
      act(() => {
        const { rankUps: _gone, ...movedOn } = useGameStore.getState().state!;
        useGameStore.setState({ state: { ...movedOn, sceneId: "road" } });
      });
      cleanup();
      mount(camp);
      expect(await screen.findByTestId("rank-up-moment")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(RANK_UP_MS); });

      // And in a new run (a new evening, the same hero, rank and scene), even with no
      // state between the two landings for the memory to see go by.
      cleanup();
      mount(camp);
      expect(screen.queryByTestId("rank-up-moment")).toBeNull();
      act(() => {
        useGameStore.setState({ state: { ...useGameStore.getState().state!, runId: "r_2" } });
      });
      expect(await screen.findByTestId("rank-up-moment")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a check waiting on its roll", () => {
  it("tells the whole table who rolls, what is added and the number to reach", () => {
    // A playtest: the TV said only the question, and "Tricky: needed 12" was on
    // the roller's phone alone.
    mount({
      phase: "scene",
      sceneType: "check",
      prompt: {
        kind: "roll",
        sceneId: "s_wall",
        stat: "quick",
        tn: 12,
        prompt: "Sparklehoof, climb the wall!",
        characterId: "c_p_1",
        helper: { characterId: "c_p_2", sides: 4 },
      },
    });
    const line = document.querySelector(".narration__check")!;
    expect(line.textContent).toContain("Sparklehoof rolls d20 + 3 Quick, plus Thistle's d4.");
    expect(line.querySelector(".narration__target")!.textContent).toBe("Tricky: 12 or more makes it.");
  });
});

describe("a hero's name is shown, never spoken (#552)", () => {
  const NAME = "Zephyrine Quillfeather";
  const named = [member("p_1", NAME), member("p_2", "Thistle")];

  it("keeps every name on screen and out of every line this screen says", () => {
    mount({
      party: named,
      sceneId: "camp",
      sceneType: "rest",
      narration: "A fire, and the road beyond it.",
      decision: { sceneId: "camp", label: "Rest a while.", byPlayerId: "p_1", vote: false },
      rankUps: {
        sceneId: "camp",
        ups: [{ characterId: "c_p_1", class: "duskrunner", rank: "apprentice", line: `${NAME} is a Duskrunner Apprentice now!` }],
      },
      prompt: {
        kind: "choice",
        sceneId: "camp",
        options: [{ id: "sleep", label: "Sleep by the fire", icon: "moon" }],
        forPlayerIds: ["p_1"],
        vote: false,
      },
      trades: [{ id: "t9", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: "sunbloom_draught" }],
    });
    expect(screen.getByTestId("decision").textContent).toContain(NAME);
    expect(screen.getByTestId("rank-up").textContent).toContain(NAME);

    const heard = spoken.join(" ");
    expect(heard).toContain("Hero chose: Rest a while.");
    expect(heard).toContain("Hero is a Duskrunner Apprentice now!");
    expect(heard).toContain("Hero's turn.");
    expect(heard).toContain("Hero wants to give another hero a Sunbloom Draught.");
    expect(heard).not.toMatch(/Zephyrine|Quillfeather|Thistle/);
  });
});
