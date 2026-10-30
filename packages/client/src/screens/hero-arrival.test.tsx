// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useGameStore } from "../store";
import { makeCharacter, makeState } from "../testing/fixtures";
import { cue } from "../audio/cue";
import { announceHeroArrival, heroArrivalSnapshot, takeHeroArrival } from "./hero-arrival";
import { HeroArrival, HERO_ARRIVAL_MS } from "./HeroArrival";

vi.mock("../audio/cue", () => ({ cue: vi.fn() }));
const hero = makeCharacter({ name: "Fern" });
function setup(quiet = false) {
  useGameStore.setState({ session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: makeState(quiet ? { quiet: true } : {}) });
  return render(<HeroArrival />);
}
afterEach(() => {
  cleanup();
  const pending = heroArrivalSnapshot();
  if (pending) takeHeroArrival(pending);
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("a newly made hero's hello", () => {
  it("celebrates explicit successful creation once, then leaves the controls clear", () => {
    vi.useFakeTimers();
    const view = setup();
    act(() => announceHeroArrival({ runId: "r_1", playerId: "p_1", hero }));
    expect(screen.getByText("Meet Fern!")).toBeTruthy();
    expect(cue).toHaveBeenCalledExactlyOnceWith("choice");
    act(() => vi.advanceTimersByTime(HERO_ARRIVAL_MS));
    expect(screen.queryByText("Meet Fern!")).toBeNull();
    view.unmount();
    setup();
    expect(screen.queryByText("Meet Fern!")).toBeNull();
    expect(cue).toHaveBeenCalledTimes(1);
  });
  it("keeps the hello silent in a quiet room", () => {
    setup(true);
    act(() => announceHeroArrival({ runId: "r_1", playerId: "p_1", hero }));
    expect(screen.getByText("Meet Fern!")).toBeTruthy();
    expect(cue).not.toHaveBeenCalled();
  });
  it("does not celebrate a reconnect or a ticket from another room", () => {
    setup();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => announceHeroArrival({ runId: "r_old", playerId: "p_1", hero }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(cue).not.toHaveBeenCalled();
  });
});
