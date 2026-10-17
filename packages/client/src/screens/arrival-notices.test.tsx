// @vitest-environment jsdom
/**
 * Who just joined (#267): seen on the screens that answer for the room, with a
 * Remove button only where removing is allowed, and gone on their own.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useGameStore } from "../store";
import type { ClientSession } from "../store/contract";
import { ArrivalNotices } from "./ArrivalNotices";

const MIA = { playerId: "p_2", name: "Mia", color: "#7FD4C1" };

function seat(session: Partial<ClientSession>): void {
  act(() => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t", ...session },
      arrivals: [MIA],
    });
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    useGameStore.setState({ session: null, arrivals: [], arrivalsDropped: 0 });
  });
});

describe("arrival notices", () => {
  it("show on the shared display, with nothing to tap but dismiss", () => {
    seat({ playerId: "" });
    render(<ArrivalNotices placement="float" />);
    expect(screen.getByText("Mia")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("give the host a Remove button that takes that player out", () => {
    const removePlayer = vi.fn(async () => true);
    act(() => {
      useGameStore.setState({ removePlayer });
    });
    seat({ host: true });
    render(<ArrivalNotices placement="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Mia from this game" }));
    expect(removePlayer).toHaveBeenCalledWith("p_2");
  });

  it("stay off an ordinary player's phone, which is busy with its own turn", () => {
    seat({});
    render(<><ArrivalNotices placement="float" /><ArrivalNotices placement="inline" /></>);
    expect(screen.queryByText("Mia")).toBeNull();
  });

  it("sit in a host phone's own view, never floating over its controls", () => {
    // A floating notice covered the host's turn button for as long as it showed.
    seat({ host: true });
    const { container } = render(<><ArrivalNotices placement="float" /><ArrivalNotices placement="inline" /></>);
    expect(container.querySelectorAll(".kad-arrivals--float")).toHaveLength(0);
    expect(container.querySelectorAll(".kad-arrivals--inline")).toHaveLength(1);
  });

  it("float on a TV that hosts, which has no controls to cover", () => {
    seat({ playerId: "", host: true });
    const { container } = render(<><ArrivalNotices placement="float" /><ArrivalNotices placement="inline" /></>);
    expect(container.querySelectorAll(".kad-arrivals--float")).toHaveLength(1);
    expect(container.querySelectorAll(".kad-arrivals--inline")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Remove Mia from this game" })).toBeTruthy();
  });

  it("draw only the newest few for the host, with the rest behind one control", () => {
    // Review of #269: hundreds of cards would bury the host's own controls.
    const many = Array.from({ length: 50 }, (_, i) => ({ playerId: `p_${i}`, name: `Kid ${i}`, color: "#fff" }));
    seat({ host: true });
    act(() => {
      useGameStore.setState({ arrivals: many });
    });
    render(<ArrivalNotices placement="inline" />);
    expect(screen.getAllByRole("button", { name: /^Remove .* from this game$/ })).toHaveLength(3);
    // Newest first.
    expect(screen.getByText("Kid 49")).toBeTruthy();
    expect(screen.queryByText("Kid 0")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "47 more joined" }));
    expect(screen.getAllByRole("button", { name: /^Remove .* from this game$/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("button", { name: /^Remove .* from this game$/ })).toHaveLength(3);
  });

  it("tell the host plainly when a flood has pushed arrivals off its list", () => {
    seat({ host: true });
    act(() => {
      useGameStore.setState({ arrivalsDropped: 12 });
    });
    render(<ArrivalNotices placement="inline" />);
    expect(screen.getByRole("alert").textContent).toMatch(/start a new room/i);
  });

  it("go away on their own", () => {
    vi.useFakeTimers();
    seat({ playerId: "" });
    render(<ArrivalNotices placement="float" />);
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(screen.queryByText("Mia")).toBeNull();
  });

  it("stay for the host until dismissed, so a stranger noticed late can still be removed", () => {
    // Review of #269: a 30-second notice was the host's only Remove control.
    vi.useFakeTimers();
    const removePlayer = vi.fn(async () => true);
    act(() => {
      useGameStore.setState({ removePlayer });
    });
    seat({ host: true });
    render(<ArrivalNotices placement="inline" />);
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Mia from this game" }));
    expect(removePlayer).toHaveBeenCalledWith("p_2");
  });
});
