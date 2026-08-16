// @vitest-environment jsdom
/**
 * PlaytestPanel — the author's cheat drawer (roadmap chapter 6).
 *
 * The engine's half is `shared/src/playtest.test.ts`, including the gate. This
 * is about the surface: does it list the scenes an author actually has, does it
 * send the intent the engine expects, and — the one that would cost a real
 * evening — does it say when a die is still loaded.
 */

import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Chapter, ClientIntent, RunState } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { PlaytestPanel, sceneList } from "./PlaytestPanel";

const CHAPTER: Chapter = makeChapter();

const sent: ClientIntent[] = [];

function mountStore(run: Partial<RunState> = {}, chapter: Chapter | null = CHAPTER) {
  sent.length = 0;
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t" },
    chapter,
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "travel",
      seq: 3,
      phase: "scene",
      campaignId: "the-hollow-crown",
      chapterId: "bramblewood-01",
      sceneId: "scene_clearing",
      sceneType: "story",
      narration: "A wall of thorns twice your height.",
      art: null,
      party: [],
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-08-16T12:00:00.000Z",
      ...run,
    },
    send: async (intent: ClientIntent) => {
      sent.push(intent);
      return true;
    },
  });
}

function mount(run: Partial<RunState> = {}, chapter: Chapter | null = CHAPTER) {
  mountStore(run, chapter);
  return render(<PlaytestPanel />);
}

/**
 * The drawer under a `Profiler`, which fires only when the subtree actually
 * commits — so a component that bails out of a re-render is measurable from the
 * outside. Counting renders of a *wrapper* would not work: the store re-renders
 * the subscriber itself, not its parent, so the wrapper's count never moves
 * either way and the assertion would be vacuous.
 */
function mountProfiled(run: Partial<RunState> = {}) {
  let commits = 0;
  mountStore(run);
  render(
    <Profiler id="playtest" onRender={() => { commits += 1; }}>
      <PlaytestPanel />
    </Profiler>,
  );
  return { commits: () => commits };
}

/** Opens the drawer, which starts shut so it does not cover the game. */
function open() {
  fireEvent.click(screen.getByRole("button", { name: /Playtest/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the scene list", () => {
  it("puts the entry scene first and keeps the author's order after it", () => {
    /*
     * Authored order rather than alphabetical or topological. A chapter file is
     * written roughly in the order it is played, so the author's own ordering is
     * the one they can find things in by muscle memory — and a topological sort
     * would reshuffle the list every time a branch moved.
     */
    /*
     * Measured against a chapter whose entry is *not* already the first key —
     * the fixture's is, so asserting against it would pass whether the hoist
     * happened or not.
     */
    const late: Chapter = { ...CHAPTER, entry: "scene_ridge" };
    const list = sceneList(late).map((scene) => scene.id);

    expect(list[0]).toBe("scene_ridge");
    // Hoisted, not duplicated: `scene_ridge` appears once.
    expect(list).toEqual([...new Set(list)]);
    expect(list.slice(1)).toEqual(Object.keys(CHAPTER.scenes).filter((id) => id !== "scene_ridge"));
  });

  it("carries each scene's type, which is how the shape of a chapter reads", () => {
    const byId = Object.fromEntries(sceneList(CHAPTER).map((s) => [s.id, s.type]));
    expect(byId["encounter_wisps"]).toBe("encounter");
    expect(byId["check_squeeze"]).toBe("check");
    expect(byId["scene_camp"]).toBe("rest");
  });

  it("survives an entry that names a scene the chapter does not have", () => {
    // `content:validate` catches this, but the drawer is the tool an author is
    // holding *while* the chapter is broken — it must not be the thing that
    // crashes.
    const broken: Chapter = { ...CHAPTER, entry: "scene_nowhere" };
    expect(sceneList(broken).map((s) => s.id)).toEqual(Object.keys(CHAPTER.scenes));
  });
});

describe("the drawer", () => {
  it("starts shut, so it is not covering the game", () => {
    mount();
    expect(screen.queryByRole("region", { name: "Playtest tools" })).toBeNull();
  });

  it("renders nothing at all before a chapter is loaded", () => {
    // No scenes to jump to and no roll to load a die for: the toggle would open
    // an empty box.
    const { container } = mount({}, null);
    expect(container.firstChild).toBeNull();
  });

  it("lists every scene once it is open", () => {
    mount();
    open();
    for (const id of Object.keys(CHAPTER.scenes)) {
      expect(screen.getByText(id)).toBeTruthy();
    }
  });

  it("says out loud that this is a local-only thing", () => {
    mount();
    open();
    expect(screen.getByText(/A deployed server refuses both/)).toBeTruthy();
  });
});

describe("what it costs the game", () => {
  it("does not re-render when a patch touches nothing it reads", () => {
    /*
     * The regression that broke an e2e run. `useRunState()` hands back the whole
     * state object and the server mints a new one for every patch, so the drawer
     * re-rendered — and rebuilt its scene list — on every tick of every fight,
     * on all three phones.
     *
     * That matters because combat holds every phone's patch for up to four
     * seconds to play the round out (`world/presentation.ts`), and the
     * playthrough test fails when the party has nothing to tap for long enough.
     * Work added per patch comes straight out of that budget. A drawer nobody
     * has opened should not be in the fight at all.
     */
    const { commits } = mountProfiled();
    const before = commits();

    // A patch that moves the sequence number and the XP — what every tick of a
    // fight does, and nothing this component reads.
    act(() => {
      useGameStore.setState((store) => ({
        state: store.state === null ? null : { ...store.state, seq: store.state.seq + 1, xpEarned: 12 },
      }));
    });

    expect(commits()).toBe(before);
  });

  it("still re-renders when the die or the scene moves", () => {
    // The other half: narrowing the subscription must not make it blind.
    const { commits } = mountProfiled();
    const before = commits();

    act(() => {
      useGameStore.setState((store) => ({
        state: store.state === null ? null : { ...store.state, playtestDie: 9 },
      }));
    });

    expect(commits()).toBeGreaterThan(before);
    expect(screen.getByRole("button", { name: /Playtest · d20 = 9/ })).toBeTruthy();
  });
});

describe("jumping", () => {
  it("sends the scene the author tapped", () => {
    mount();
    open();
    fireEvent.click(screen.getByText("scene_ridge"));
    expect(sent).toEqual([{ type: "PLAYTEST_GOTO", sceneId: "scene_ridge" }]);
  });

  it("marks where the party actually is", () => {
    // The list is long and every row looks alike; without this an author has no
    // way to tell a jump that worked from one that did nothing.
    mount({ sceneId: "scene_camp" });
    open();
    const here = screen.getByText("scene_camp").closest("button");
    expect(here?.getAttribute("aria-pressed")).toBe("true");
    const elsewhere = screen.getByText("scene_ridge").closest("button");
    expect(elsewhere?.getAttribute("aria-pressed")).toBeNull();
  });
});

describe("loading the die", () => {
  it("sends the face that was tapped", () => {
    mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: "17" }));
    expect(sent).toEqual([{ type: "PLAYTEST_SET_DIE", die: 17 }]);
  });

  it("offers every face the die has and no others", () => {
    mount();
    open();
    for (let die = 1; die <= 20; die += 1) {
      expect(screen.getByRole("button", { name: String(die) })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "21" })).toBeNull();
    expect(screen.queryByRole("button", { name: "0" })).toBeNull();
  });

  it("clears with null rather than with a face", () => {
    mount({ playtestDie: 4 });
    open();
    fireEvent.click(screen.getByRole("button", { name: /Stop forcing 4/ }));
    expect(sent).toEqual([{ type: "PLAYTEST_SET_DIE", die: null }]);
  });

  it("has nothing to clear when nothing is loaded", () => {
    mount();
    open();
    const clear = screen.getByRole("button", { name: /Rolling honestly/ });
    expect(clear.hasAttribute("disabled")).toBe(true);
  });

  it("shows the loaded die on the closed toggle", () => {
    /*
     * The one thing here that would cost a real evening. A die stays loaded
     * across every intent that does not roll, so an author who pinned a 1,
     * closed the drawer and went back to playing would watch the party fail
     * everything with nothing on screen saying why.
     */
    mount({ playtestDie: 1 });
    expect(screen.getByRole("button", { name: /Playtest · d20 = 1/ })).toBeTruthy();
  });

  it("says nothing about a die when the dice are honest", () => {
    mount();
    const toggle = screen.getByRole("button", { name: /Playtest/ });
    expect(toggle.textContent).not.toMatch(/d20/);
  });
});
