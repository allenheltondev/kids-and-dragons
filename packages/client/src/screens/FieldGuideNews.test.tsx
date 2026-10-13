// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FieldGuide as FieldGuideData, Prompt, RunState } from "@kad/shared";
import { FieldGuideBanner, FieldGuideToast, NEWS_SHOW_MS, describeNews } from "./FieldGuideNews";
import { resetFieldGuideCache } from "./content";
import { setFieldGuideOverride } from "../feature-flags";
import { useGameStore } from "../store";
import { announceFieldGuideNews, clearFieldGuideNews, getFieldGuideNews } from "../store/field-guide-news";
import { FIELD_GUIDE_SEEN_KEY, resetFieldGuideSeen } from "../store/field-guide-seen";
import { usePlayerNavigation } from "../store/player-navigation";

const guide: FieldGuideData = {
  version: 1,
  entries: {
    "creature.moth": { id: "creature.moth", category: "creatures", kind: "creature", title: "Embermoth", art: "/art/moth.png" },
    "creature.wolf": { id: "creature.wolf", category: "creatures", kind: "creature", title: "Cinder Wolf" },
    "creature.c": { id: "creature.c", category: "creatures", kind: "creature", title: "Third" },
    "creature.d": { id: "creature.d", category: "creatures", kind: "creature", title: "Fourth" },
  },
};

const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => guide }) as unknown as Response);

const choice: Prompt = {
  kind: "choice", sceneId: "s_1", forPlayerIds: [], vote: false,
  options: [{ id: "east", label: "East", icon: "path" }],
};

function setRun(prompt: Prompt | null): void {
  const member = { playerId: "p_1", character: { id: "c_1", ownerPlayerId: "p_1", name: "Pip" }, hp: 5, down: false, connected: true, ready: true };
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: {
      runId: "r_1", roomCode: "ABCD", mode: "party", seq: 1, phase: "scene", sceneType: "story",
      party: [member], prompt, flags: {},
    } as unknown as RunState,
    presentation: null,
    progression: null,
  });
}

let seq = 10;
const news = (...ids: string[]) => act(() => { announceFieldGuideNews("r_1", ++seq, ids); });

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  resetFieldGuideCache();
  resetFieldGuideSeen();
  clearFieldGuideNews();
  setFieldGuideOverride(true);
  setRun(null);
  usePlayerNavigation.setState({ section: "bag", guideEntry: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setFieldGuideOverride(null);
  clearFieldGuideNews();
  useGameStore.setState({ state: null, session: null, presentation: null, progression: null });
});

describe("describeNews", () => {
  it("names up to three, then counts", () => {
    expect(describeNews(["A"], 1)).toBe("A");
    expect(describeNews(["A", "B"], 2)).toBe("A, B");
    expect(describeNews(["A", "B", "C", "D"], 4)).toBe("4 new entries");
    expect(describeNews([], 2)).toBe("2 new entries");
  });
});

describe("phone toast", () => {
  it("shows one toast per batch and acknowledges it", async () => {
    render(<FieldGuideToast />);
    news("creature.moth");
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("New in your Field Guide");
    expect(toast.textContent).toContain("Embermoth");
    expect(toast.querySelector("img")?.getAttribute("src")).toBe("/art/moth.png");
    expect(getFieldGuideNews()).toHaveLength(0);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("shows nothing, and fetches nothing, when there is no news (reload / resync)", async () => {
    render(<FieldGuideToast />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is suppressed entirely with the flag off, and does not fetch", async () => {
    setFieldGuideOverride(false);
    render(<FieldGuideToast />);
    news("creature.moth");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("waits while a turn prompt is pending, then appears when it clears", async () => {
    setRun(choice);
    render(<FieldGuideToast />);
    news("creature.moth");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(getFieldGuideNews()).toHaveLength(1);
    act(() => { setRun(null); });
    expect((await screen.findByRole("status")).textContent).toContain("Embermoth");
  });

  it("opens the entry and marks it seen when tapped", async () => {
    const user = userEvent.setup();
    render(<FieldGuideToast />);
    news("creature.moth");
    await user.click(await screen.findByRole("button", { name: /Embermoth/ }));
    const nav = usePlayerNavigation.getState();
    expect(nav.section).toBe("guide");
    expect(nav.guideEntry).toBe("creature.moth");
    expect(localStorage.getItem(FIELD_GUIDE_SEEN_KEY)).toContain("creature.moth");
  });

  it("collapses several finds into one toast that opens the index", async () => {
    const user = userEvent.setup();
    render(<FieldGuideToast />);
    news("creature.moth", "creature.wolf");
    const button = await screen.findByRole("button", { name: /Embermoth, Cinder Wolf/ });
    await user.click(button);
    expect(usePlayerNavigation.getState().section).toBe("guide");
    expect(usePlayerNavigation.getState().guideEntry).toBeNull();
  });

  it("goes away on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<FieldGuideToast />);
    news("creature.moth");
    await screen.findByRole("status");
    await act(async () => { await vi.advanceTimersByTimeAsync(NEWS_SHOW_MS + 50); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("TV banner", () => {
  it("collapses a batch of finds into one banner and acknowledges", async () => {
    render(<FieldGuideBanner />);
    news("creature.moth", "creature.wolf");
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("New in the Field Guide");
    expect(banner.textContent).toContain("Embermoth, Cinder Wolf");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(getFieldGuideNews()).toHaveLength(0);
  });

  it("counts when there are more than three", async () => {
    render(<FieldGuideBanner />);
    news("creature.moth", "creature.wolf", "creature.c", "creature.d");
    expect((await screen.findByRole("status")).textContent).toContain("4 new entries");
  });

  it("waits out a dice roll before showing", async () => {
    render(<FieldGuideBanner />);
    act(() => {
      useGameStore.setState({
        presentation: { seq: 5, presentation: { kind: "ROLL" } } as unknown as ReturnType<typeof useGameStore.getState>["presentation"],
      });
    });
    news("creature.moth");
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(getFieldGuideNews()).toHaveLength(1);
    // 1500ms roll + the gap
    expect((await screen.findByRole("status", {}, { timeout: 3000 })).textContent).toContain("Embermoth");
  });

  it("shows nothing with the flag off or with no news", async () => {
    render(<FieldGuideBanner />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    setFieldGuideOverride(false);
    render(<FieldGuideBanner />);
    news("creature.moth");
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
