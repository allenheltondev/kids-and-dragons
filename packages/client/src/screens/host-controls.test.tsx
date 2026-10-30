// @vitest-environment jsdom
/**
 * Running the room (#263): a roster read from the run, so it survives a
 * refresh; Remove, lock and close, only on the device that opened the room;
 * and close only after one "are you sure?".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PartyMember, RunState } from "@kad/shared";
import { useGameStore } from "../store";
import type { ClientSession } from "../store/contract";
import { makeState } from "../testing/fixtures";
import { HostControls, LetHeroGo, STOP_OFFER_MS, rosterOf } from "./HostControls";

function member(playerId: string, name: string, connected = true): PartyMember {
  return {
    playerId,
    character: { name, appearance: { accent: "#123456" } } as never,
    hp: 10,
    down: false,
    connected,
    ready: false,
  };
}

const RUN: Partial<RunState> = {
  seats: {
    p_1: { name: "Grown-up", color: "#7FD4C1", device: "phone" },
    p_2: { name: "Ada", color: "#F2A65A", device: "tablet" },
    p_3: { name: "Player", color: "#9A8CF2", device: "phone" },
  },
  party: [member("p_1", "Ember"), member("p_2", "Sparklehoof", false)],
};

function room(session: Partial<ClientSession>, run: Partial<RunState> = RUN) {
  const removePlayer = vi.fn(async () => true);
  const handKeeper = vi.fn(async () => true);
  const lockRoom = vi.fn(async () => true);
  const closeRoom = vi.fn(async () => true);
  const quietRoom = vi.fn(async () => true);
  const stopForToday = vi.fn(async () => true);
  const switchCrew = vi.fn(async () => true);
  const renameCrew = vi.fn(async () => true);
  act(() => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t", ...session },
      state: { ...makeState(), ...run },
      removePlayer,
      handKeeper,
      lockRoom,
      closeRoom,
      quietRoom,
      stopForToday,
      switchCrew,
      renameCrew,
    });
  });
  return { removePlayer, handKeeper, lockRoom, closeRoom, quietRoom, stopForToday, switchCrew, renameCrew };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    useGameStore.setState({ session: null, state: null });
  });
});

describe("rosterOf", () => {
  it("lists everybody who joined, a hero's name once there is one, and where they are", () => {
    expect(rosterOf({ ...RUN, party: RUN.party ?? [], removed: ["p_3"] }, "p_1")).toEqual([
      { playerId: "p_1", name: "Ember", color: "#7FD4C1", device: "phone", status: "here", me: true, visitor: false, keeper: false },
      { playerId: "p_2", name: "Sparklehoof", color: "#F2A65A", device: "tablet", status: "away", me: false, visitor: false, keeper: false },
      { playerId: "p_3", name: "Player", color: "#9A8CF2", device: "phone", status: "out", me: false, visitor: false, keeper: false },
    ]);
  });

  it("still lists a seated hero from a run older than the roster", () => {
    expect(rosterOf({ party: [member("p_9", "Rumble")] }, "")).toEqual([
      { playerId: "p_9", name: "Rumble", color: "#123456", device: null, status: "here", me: false, visitor: false, keeper: false },
    ]);
  });
});

describe("host controls", () => {
  it("are nowhere on a phone that did not open the room", () => {
    room({});
    const { container } = render(<><HostControls placement="inline" /><HostControls placement="float" /></>);
    expect(container.innerHTML).toBe("");
  });

  it("show the host everybody, including a kid still making their hero", () => {
    room({ host: true });
    render(<HostControls placement="inline" />);
    expect(screen.getByText(/Making a hero/)).toBeTruthy();
    expect(screen.getByText(/family tablet/)).toBeTruthy();
    // Remove for everybody but the host.
    expect(screen.queryByRole("button", { name: "Remove Ember from this game" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Sparklehoof from this game" })).toBeTruthy();
  });

  it("take a player out in one tap", () => {
    const { removePlayer } = room({ host: true });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Player from this game" }));
    expect(removePlayer).toHaveBeenCalledWith("p_3");
  });

  it("hands the keeper role to a phone in the room, never to a tablet or the host (#272)", () => {
    const { handKeeper } = room({ host: true });
    render(<HostControls placement="inline" />);
    // p_1 is the host's own seat and p_2 is the family tablet.
    expect(screen.queryByRole("button", { name: "Let Ember keep this game" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Let Sparklehoof keep this game" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Let Player keep this game" }));
    expect(handKeeper).toHaveBeenCalledWith("p_3");
  });

  it("says who keeps the game once the role is handed over (#272)", () => {
    room({ host: true }, { ...RUN, keeperPlayerId: "p_3" });
    render(<HostControls placement="inline" />);
    expect(screen.getByText(/keeps the game/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Let Player keep this game" })).toBeNull();
  });

  it("turn quiet mode on, and off again once it is on (#260)", () => {
    const { quietRoom } = room({ host: true });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Quiet mode" }));
    expect(quietRoom).toHaveBeenCalledWith(true);

    cleanup();
    const again = room({ host: true }, { ...RUN, quiet: true });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn quiet mode off" }));
    expect(again.quietRoom).toHaveBeenCalledWith(false);
  });

  it("lock the room, and say so", () => {
    const { lockRoom } = room({ host: true });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Lock the room" }));
    expect(lockRoom).toHaveBeenCalledWith(true);

    cleanup();
    room({ host: true }, { ...RUN, locked: true });
    render(<HostControls placement="inline" />);
    expect(screen.getByText("Locked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Let new players join again" }));
  });

  it("close the room only after one 'are you sure?'", () => {
    const { closeRoom } = room({ host: true });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Close the room" }));
    expect(closeRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(closeRoom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close the room" }));
    fireEvent.click(screen.getByRole("button", { name: "Close it" }));
    expect(closeRoom).toHaveBeenCalledTimes(1);
  });

  it("open from a corner button on a TV that opened the room", () => {
    room({ playerId: "", host: true });
    render(<HostControls placement="float" />);
    expect(screen.queryByRole("list", { name: "Who is in this room" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Room" }));
    expect(screen.getByRole("list", { name: "Who is in this room" })).toBeTruthy();
    expect(screen.getByText("Crews", { exact: true }).closest("details")?.hasAttribute("open")).toBe(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss room controls" }), { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Who is in this room" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Room" }));
  });

  it("mark a visitor on the roster (#249)", () => {
    const visiting = { ...RUN, seats: { ...RUN.seats, p_3: { name: "Wren", color: "#9A8CF2", device: "phone" as const, homeHouseholdId: "h_next_door" } } };
    expect(rosterOf({ ...visiting, party: [] }, "p_1").find((r) => r.playerId === "p_3")?.visitor).toBe(true);
    room({ host: true }, visiting);
    render(<HostControls placement="inline" />);
    expect(screen.getByText(/visiting/)).toBeTruthy();
  });
});

describe("crews: new players at the same TV", () => {
  it("names the first crew and starts a new crew from the lobby in one tap", () => {
    const { switchCrew } = room({ host: true }, { ...RUN, phase: "lobby" });
    render(<HostControls placement="inline" />);
    expect(screen.getByText("The first crew")).toBeTruthy();
    fireEvent.click(screen.getByText("Crews", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "New players? Start a new crew" }));
    expect(switchCrew).toHaveBeenCalledWith("new");
  });

  it("names the crew playing and switches to any other, the first crew included", () => {
    const crews: Partial<RunState> = {
      ...RUN,
      phase: "lobby",
      crew: "cw_otter",
      crews: [{ id: "cw_otter", name: "The Otter Crew" }, { id: "cw_comet", name: "The Comet Crew" }],
    };
    const first = room({ host: true }, crews);
    render(<HostControls placement="inline" />);
    expect(screen.getByText("The Otter Crew")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play as The Otter Crew" })).toBeNull();
    fireEvent.click(screen.getByText("Crews", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Play as The first crew" }));
    expect(first.switchCrew).toHaveBeenCalledWith(null);

    cleanup();
    const comet = room({ host: true }, crews);
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByText("Crews", { exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Play as The Comet Crew" }));
    expect(comet.switchCrew).toHaveBeenCalledWith("cw_comet");
  });

  it("names the first crew from the offered names, and shows the name it was given", () => {
    const { renameCrew } = room({ host: true }, { ...RUN, phase: "lobby", firstCrewName: "The Comet Crew" });
    render(<HostControls placement="inline" />);
    expect(screen.getByText("The Comet Crew")).toBeTruthy();
    expect(screen.queryByText("The first crew")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rename this crew" }));
    expect(screen.getByRole("button", { name: "The Comet Crew" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "The Otter Crew" }));
    expect(renameCrew).toHaveBeenCalledWith(null, "The Otter Crew");
  });

  it("does not offer a name another crew already has", () => {
    room({ host: true }, { ...RUN, phase: "lobby", crew: "cw_otter", crews: [{ id: "cw_otter", name: "The Otter Crew" }, { id: "cw_comet", name: "The Comet Crew" }] });
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename this crew" }));
    expect(screen.queryByRole("button", { name: "The Comet Crew" })).toBeNull();
    expect(screen.getByRole("button", { name: "The Lantern Crew" })).toBeTruthy();
  });

  it("is not offered once a chapter is under way, or before anybody has joined", () => {
    room({ host: true }, { ...RUN, phase: "scene", campaignId: "gemfall", chapterId: "gemfall-01" });
    render(<HostControls placement="inline" />);
    expect(screen.queryByRole("button", { name: "New players? Start a new crew" })).toBeNull();
    cleanup();
    room({ host: true }, { phase: "lobby", seats: {}, party: [] });
    render(<HostControls placement="inline" />);
    expect(screen.queryByRole("button", { name: "New players? Start a new crew" })).toBeNull();
  });
});

describe("stopping for today (#259)", () => {
  const UNDER_WAY: Partial<RunState> = { ...RUN, phase: "scene", campaignId: "gemfall", sceneId: "s_1", sceneType: "story" };

  it("saves and stops only after one 'are you sure?', while a chapter is under way", () => {
    const { stopForToday, closeRoom } = room({ host: true }, UNDER_WAY);
    render(<HostControls placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop for today" }));
    expect(screen.getByText(/tap Keep going and you will be right back/)).toBeTruthy();
    expect(stopForToday).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(stopForToday).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop for today" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and stop" }));
    expect(stopForToday).toHaveBeenCalledTimes(1);
    expect(closeRoom).not.toHaveBeenCalled();
  });

  it("has nothing to save in a lobby or between chapters", () => {
    room({ host: true }, { ...RUN, phase: "lobby", campaignId: "gemfall" });
    render(<HostControls placement="inline" />);
    expect(screen.queryByRole("button", { name: "Stop for today" })).toBeNull();
    cleanup();
    room({ host: true }, { ...RUN, phase: "chapter_complete", campaignId: "gemfall" });
    render(<HostControls placement="inline" />);
    expect(screen.queryByRole("button", { name: "Stop for today" })).toBeNull();
  });

  it("offers 'stop here for today?' at a Rest scene, without opening the panel", () => {
    const { stopForToday } = room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    expect(screen.getByText(/cozy place to stop for today/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop here for today" }));
    expect(stopForToday).toHaveBeenCalledTimes(1);
  });

  it("puts the offer away until the next rest, and never offers it on an ordinary scene", () => {
    room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();

    cleanup();
    room({ host: true }, UNDER_WAY);
    render(<HostControls placement="float" />);
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
  });

  it("keeps playing by itself on the shared screen after STOP_OFFER_MS, once, with a bar running down", () => {
    // Owner call B on #392: nothing on the TV waits for a tap.
    vi.useFakeTimers();
    const { stopForToday } = room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    expect(STOP_OFFER_MS).toBe(15_000);
    expect(screen.getByTestId("stop-offer-clock").textContent).toContain("Keeping going");
    act(() => {
      vi.advanceTimersByTime(STOP_OFFER_MS - 1);
    });
    expect(screen.getByText(/cozy place to stop/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
    // What Keep playing does: nothing is sent, and the offer stays away for this rest.
    act(() => {
      vi.advanceTimersByTime(10 * STOP_OFFER_MS);
    });
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
    expect(stopForToday).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still takes either answer before the time runs out, and Stop for today stays in Room", () => {
    vi.useFakeTimers();
    const { stopForToday } = room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    act(() => {
      vi.advanceTimersByTime(STOP_OFFER_MS / 2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(stopForToday).not.toHaveBeenCalled();

    cleanup();
    const again = room({ host: true }, { ...UNDER_WAY, sceneType: "rest", sceneId: "s_2" });
    render(<HostControls placement="float" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop here for today" }));
    expect(again.stopForToday).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(STOP_OFFER_MS * 2);
    });
    // A stop on its way is the host's answer: the clock does not put the offer away under it.
    expect(screen.getByText(/cozy place to stop/)).toBeTruthy();
  });

  it("offers again at the next rest, with a fresh clock", () => {
    vi.useFakeTimers();
    room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    act(() => {
      vi.advanceTimersByTime(STOP_OFFER_MS);
    });
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
    act(() => {
      useGameStore.setState({ state: { ...useGameStore.getState().state!, sceneId: "s_9" } });
    });
    expect(screen.getByText(/cozy place to stop/)).toBeTruthy();
  });

  it("waits for an answer on a host's phone, which is not driven by a remote", () => {
    vi.useFakeTimers();
    room({ host: true }, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="inline" />);
    act(() => {
      vi.advanceTimersByTime(STOP_OFFER_MS * 2);
    });
    expect(screen.getByText(/cozy place to stop/)).toBeTruthy();
    expect(screen.queryByTestId("stop-offer-clock")).toBeNull();
  });

  it("is not offered to a phone that did not open the room", () => {
    room({}, { ...UNDER_WAY, sceneType: "rest" });
    render(<HostControls placement="float" />);
    expect(screen.queryByText(/cozy place to stop/)).toBeNull();
  });
});

const withId = (m: PartyMember, id: string): PartyMember => ({ ...m, character: { ...m.character, id } });

describe("letting a hero go from a stopped game (#259)", () => {
  it("asks first, says what is lost, and then frees only that hero", async () => {
    const releaseSavedHero = vi.fn(async () => true);
    act(() => {
      useGameStore.setState({
        session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t", host: true },
        state: { ...makeState(), stopped: true, closed: true, party: [withId(member("p_1", "Ember"), "c_1"), withId(member("p_2", "Sparklehoof"), "c_2")] },
        releaseSavedHero,
      });
    });
    render(<LetHeroGo />);
    fireEvent.click(screen.getByText("Let a hero go"));
    fireEvent.click(screen.getByRole("button", { name: "Let Sparklehoof go" }));
    expect(screen.getByText(/gained in this adventure goes away/)).toBeTruthy();
    expect(releaseSavedHero).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep Sparklehoof in the game" }));
    expect(releaseSavedHero).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Let Sparklehoof go" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, let Sparklehoof go" }));
    expect(releaseSavedHero).toHaveBeenCalledWith("c_2", undefined);
    expect(await screen.findByText("Sparklehoof is free.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Let Ember go" })).toBeTruthy();
  });
});

