// @vitest-environment jsdom
/**
 * Who just joined (#267): seen on the screens that answer for the room, with a
 * Remove button only on a host's phone. On the shared screen it is one line with
 * nothing to tap, gone on its own once read (ui/notice-timing.ts), host or not.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useGameStore } from "../store";
import type { ClientSession } from "../store/contract";
import { noticeMs } from "../ui/notice-timing";
import { ArrivalNotices, joinedLine } from "./ArrivalNotices";

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
  it("show on the shared display, with nothing to tap", () => {
    seat({ playerId: "" });
    render(<ArrivalNotices placement="float" />);
    expect(screen.getByText("Mia joined")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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

  it("float on a TV that hosts, with nothing to tap: its Remove is in the Room panel", () => {
    seat({ playerId: "", host: true });
    const { container } = render(<><ArrivalNotices placement="float" /><ArrivalNotices placement="inline" /></>);
    expect(container.querySelectorAll(".kad-arrivals--float")).toHaveLength(1);
    expect(container.querySelectorAll(".kad-arrivals--inline")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("say everyone who just came on one line on the shared screen, never a stack of cards", () => {
    seat({ playerId: "", host: true });
    act(() => {
      useGameStore.setState({
        arrivals: [MIA, { playerId: "p_3", name: "Bo", color: "#fff" }, { playerId: "p_4", name: "Cy", color: "#fff" }],
      });
    });
    const { container } = render(<ArrivalNotices placement="float" />);
    expect(container.querySelectorAll(".kad-arrival")).toHaveLength(1);
    expect(screen.getByText("Mia, Bo and Cy joined")).toBeTruthy();
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

  it("keep the flood warning after the host clears every card it could see", () => {
    // Review of #269: players who fell off the list may still be in the room.
    seat({ host: true });
    act(() => {
      useGameStore.setState({ arrivals: [], arrivalsDropped: 12 });
    });
    render(<ArrivalNotices placement="inline" />);
    expect(screen.getByRole("alert").textContent).toMatch(/start a new room/i);
  });

  it("let the shared screen's flood warning go once read, and bring it back when more are dropped", () => {
    // Owner call C on #392.
    vi.useFakeTimers();
    seat({ playerId: "", host: true });
    act(() => {
      useGameStore.setState({ arrivals: [], arrivalsDropped: 12 });
    });
    render(<ArrivalNotices placement="float" />);
    const flood = /a lot of phones are joining/i;
    expect(screen.getByRole("alert").textContent).toMatch(flood);
    const ms = noticeMs("A lot of phones are joining. If you don't know them, start a new room.");
    act(() => {
      vi.advanceTimersByTime(ms);
    });
    expect(screen.queryByText(flood)).toBeNull();
    act(() => {
      useGameStore.setState({ arrivalsDropped: 20 });
    });
    expect(screen.getByRole("alert").textContent).toMatch(flood);
    act(() => {
      vi.advanceTimersByTime(ms);
    });
    expect(screen.queryByText(flood)).toBeNull();
  });

  it("go away on their own once read", () => {
    vi.useFakeTimers();
    seat({ playerId: "" });
    render(<ArrivalNotices placement="float" />);
    act(() => {
      vi.advanceTimersByTime(noticeMs("Mia joined") - 1);
    });
    expect(screen.getByText("Mia joined")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Mia joined")).toBeNull();
    expect(useGameStore.getState().arrivals).toEqual([]);
  });

  it("go away on their own on a TV that hosts, too", () => {
    // #389: the host's cards stayed until dismissed and lay across the chapter's goal.
    vi.useFakeTimers();
    seat({ playerId: "", host: true });
    render(<ArrivalNotices placement="float" />);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByText("Mia joined")).toBeNull();
  });

  it("start the reading time again when somebody else arrives, and stay a little longer for more names", () => {
    vi.useFakeTimers();
    seat({ playerId: "" });
    render(<ArrivalNotices placement="float" />);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    act(() => {
      useGameStore.setState({
        arrivals: [MIA, ...["Bo", "Cy", "Dee"].map((name) => ({ playerId: name, name, color: "#fff" }))],
      });
    });
    expect(screen.getByText("Mia, Bo and 2 more joined")).toBeTruthy();
    const ms = noticeMs("Mia, Bo and 2 more joined");
    expect(ms).toBeGreaterThan(noticeMs("Mia joined"));
    act(() => {
      vi.advanceTimersByTime(ms - 1);
    });
    expect(screen.getByText("Mia, Bo and 2 more joined")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/joined/)).toBeNull();
  });

  it("name up to three and count the rest", () => {
    expect(joinedLine(["Mia"])).toBe("Mia joined");
    expect(joinedLine(["Mia", "Bo"])).toBe("Mia and Bo joined");
    expect(joinedLine(["Mia", "Bo", "Cy"])).toBe("Mia, Bo and Cy joined");
    expect(joinedLine(["Mia", "Bo", "Cy", "Dee", "Eve"])).toBe("Mia, Bo and 3 more joined");
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
