// @vitest-environment jsdom
/**
 * The phone's "New tent unlocked" (#621, docs/camp.md §5.4): queued from the
 * live broadcast, told to the hero's own phone only, and only once the
 * transformation cutscene (or the rank-up moment) it belongs to has played.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { announceKitNews, announceLookNews, clearKitNews, getKitNews } from "../store/kit-news";
import { DISTINCTION_HOLD_MS, KIT_NEWS_GAP_MS, KitNewsToast, kitNewsReadyAt, kitNewsWords } from "./KitNews";
import { RANK_UP_MS } from "./RankUpMoment";
import { TRANSFORM_BEAT_MS } from "./TransformCutscene";

function setRun(): void {
  const member = (playerId: string, id: string, name: string) => ({
    playerId, character: { id, ownerPlayerId: playerId, name }, hp: 5, down: false, connected: true, ready: true,
  });
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: {
      runId: "r_1", roomCode: "ABCD", mode: "party", seq: 1, phase: "chapter_complete", sceneType: "story",
      party: [member("p_1", "c_pip", "Pip"), member("p_2", "c_wren", "Wren")], prompt: null, flags: {},
    } as unknown as RunState,
    presentation: null,
    progression: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clearKitNews();
  setRun();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearKitNews();
  useGameStore.setState({ state: null, session: null, presentation: null, progression: null });
});

describe("the kit news queue", () => {
  it("takes a message once, and a piece once per hero", () => {
    announceKitNews("r_1", 5, [{ characterId: "c_pip", pieceId: "sworn", kind: "tent" }], 1, 0);
    announceKitNews("r_1", 5, [{ characterId: "c_pip", pieceId: "sworn", kind: "tent" }], 1, 0);
    announceKitNews("r_1", 6, [{ characterId: "c_pip", pieceId: "sworn", kind: "tent" }], 1, 0);
    expect(getKitNews()).toEqual([{ characterId: "c_pip", pieceId: "sworn", kind: "tent", seq: 5, arrivedAt: 0, crossings: 1 }]);
  });

  it("waits for every beat of the cutscene, or for the rank-up moment", () => {
    expect(kitNewsReadyAt({ kind: "tent", arrivedAt: 1000, crossings: 3 })).toBe(1000 + 3 * TRANSFORM_BEAT_MS + KIT_NEWS_GAP_MS);
    expect(kitNewsReadyAt({ kind: "decoration", arrivedAt: 1000, crossings: 0 })).toBe(1000 + DISTINCTION_HOLD_MS + KIT_NEWS_GAP_MS);
    // The shared screen's moment and the phone's wait are one length.
    expect(DISTINCTION_HOLD_MS).toBe(RANK_UP_MS);
  });

  it("says what it is in a kid's words", () => {
    expect(kitNewsWords([{ kind: "tent", pieceId: "sworn" }])).toBe("New tent unlocked: Sworn tent");
    expect(kitNewsWords([{ kind: "decoration", pieceId: "deco_thornguard_apprentice" }])).toBe("New decoration for your tent: Thornguard Apprentice");
  });
});

describe("the phone's notice", () => {
  it("is queued after the transformation cutscene, never during it", () => {
    render(<KitNewsToast />);
    // Two heroes crossed a tier on this message: the cutscene plays two beats.
    act(() => announceKitNews("r_1", 7, [{ characterId: "c_pip", pieceId: "sworn", kind: "tent" }], 2));
    expect(screen.queryByTestId("kit-news")).toBeNull();

    act(() => { vi.advanceTimersByTime(2 * TRANSFORM_BEAT_MS - 1); });
    expect(screen.queryByTestId("kit-news")).toBeNull();

    act(() => { vi.advanceTimersByTime(KIT_NEWS_GAP_MS + 1); });
    const notice = screen.getByTestId("kit-news");
    expect(notice.textContent).toContain("New tent unlocked");
    expect(notice.textContent).toContain("Sworn tent");
    expect(getKitNews()).toEqual([]);
  });

  it("waits out the rank-up moment for a decoration", () => {
    render(<KitNewsToast />);
    act(() => announceKitNews("r_1", 8, [{ characterId: "c_pip", pieceId: "deco_songkeeper_apprentice", kind: "decoration" }], 0));
    act(() => { vi.advanceTimersByTime(DISTINCTION_HOLD_MS); });
    expect(screen.queryByTestId("kit-news")).toBeNull();
    act(() => { vi.advanceTimersByTime(KIT_NEWS_GAP_MS + 1); });
    expect(screen.getByTestId("kit-news").textContent).toContain("Songkeeper Apprentice");
  });

  it("tells only this phone's own hero", () => {
    render(<KitNewsToast />);
    act(() => announceKitNews("r_1", 9, [{ characterId: "c_wren", pieceId: "radiant", kind: "tent" }], 1));
    act(() => { vi.advanceTimersByTime(TRANSFORM_BEAT_MS + KIT_NEWS_GAP_MS + 1); });
    expect(screen.queryByTestId("kit-news")).toBeNull();
  });
});

describe("her earned looks, told where her kit's news is (#669)", () => {
  it("takes a look message once, beside the same message's kit news, and a look once per hero", () => {
    announceKitNews("r_1", 10, [{ characterId: "c_pip", pieceId: "sworn", kind: "tent" }], 1, 0);
    announceLookNews("r_1", 10, [{ characterId: "c_pip", lookId: "the_sworn", kind: "title", cause: "tier" }], 1, 0);
    announceLookNews("r_1", 10, [{ characterId: "c_pip", lookId: "the_sworn", kind: "title", cause: "tier" }], 1, 0);
    announceLookNews("r_1", 11, [{ characterId: "c_pip", lookId: "the_sworn", kind: "title", cause: "tier" }], 1, 0);
    expect(getKitNews().map((i) => [i.kind, i.pieceId])).toEqual([["tent", "sworn"], ["title", "the_sworn"]]);
  });

  it("waits for the moment that earned it, and says it in a kid's words", () => {
    expect(kitNewsReadyAt({ kind: "title", cause: "tier", arrivedAt: 0, crossings: 2 })).toBe(2 * TRANSFORM_BEAT_MS + KIT_NEWS_GAP_MS);
    expect(kitNewsReadyAt({ kind: "title", cause: "rank", arrivedAt: 0, crossings: 0 })).toBe(DISTINCTION_HOLD_MS + KIT_NEWS_GAP_MS);
    expect(kitNewsReadyAt({ kind: "coat", cause: "found", arrivedAt: 0, crossings: 0 })).toBe(KIT_NEWS_GAP_MS);
    expect(kitNewsWords([{ kind: "title", pieceId: "the_tracker" }])).toBe("New title for you: the Tracker");
    expect(kitNewsWords([{ kind: "coat", pieceId: "unicorn_accent_bluebell" }])).toBe("New color for you: Bluebell");
    expect(kitNewsWords([{ kind: "special", pieceId: "aurora" }])).toBe("New special for you: Aurora");
    expect(kitNewsWords([{ kind: "nameplate", pieceId: "songbird" }, { kind: "title", pieceId: "the_tracker" }])).toBe("New looks for you: Songbird, the Tracker");
  });

  it("tells a find on her own phone after a breath, once", () => {
    render(<KitNewsToast />);
    act(() => announceLookNews("r_1", 12, [{ characterId: "c_pip", lookId: "the_tracker", kind: "title", cause: "found" }], 0));
    act(() => { vi.advanceTimersByTime(KIT_NEWS_GAP_MS + 1); });
    expect(screen.getByTestId("kit-news").textContent).toContain("the Tracker");
    expect(getKitNews()).toEqual([]);
  });
});
