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
import { HostControls, rosterOf } from "./HostControls";

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
  const lockRoom = vi.fn(async () => true);
  const closeRoom = vi.fn(async () => true);
  act(() => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t", ...session },
      state: { ...makeState(), ...run },
      removePlayer,
      lockRoom,
      closeRoom,
    });
  });
  return { removePlayer, lockRoom, closeRoom };
}

afterEach(() => {
  cleanup();
  act(() => {
    useGameStore.setState({ session: null, state: null });
  });
});

describe("rosterOf", () => {
  it("lists everybody who joined, a hero's name once there is one, and where they are", () => {
    expect(rosterOf({ ...RUN, party: RUN.party ?? [], removed: ["p_3"] }, "p_1")).toEqual([
      { playerId: "p_1", name: "Ember", color: "#7FD4C1", device: "phone", status: "here", me: true },
      { playerId: "p_2", name: "Sparklehoof", color: "#F2A65A", device: "tablet", status: "away", me: false },
      { playerId: "p_3", name: "Player", color: "#9A8CF2", device: "phone", status: "out", me: false },
    ]);
  });

  it("still lists a seated hero from a run older than the roster", () => {
    expect(rosterOf({ party: [member("p_9", "Rumble")] }, "")).toEqual([
      { playerId: "p_9", name: "Rumble", color: "#123456", device: null, status: "here", me: false },
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
  });
});
