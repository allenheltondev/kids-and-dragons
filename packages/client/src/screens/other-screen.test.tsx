// @vitest-environment jsdom
/**
 * Another TV in another place (OtherScreen.tsx): the leader's code, folded
 * away in the Room panel until wanted, and the other TV's way in, behind a
 * quiet link on the start screen or a `?screen=` link.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useGameStore } from "../store";
import { useKeepsakeStore } from "../store/keepsake";
import { isBusy, resetBusy } from "../sw/busy";
import { shouldReload, type CalmInputs } from "../sw/calm";
import { makeState } from "../testing/fixtures";
import { HostControls } from "./HostControls";
import { HomeScreen } from "./HomeScreen";
import { AddScreen, ShowHere, otherTvs, screenShareText } from "./OtherScreen";

const CODE = { code: "ABCDEFGH", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };

function host(addScreen: () => Promise<typeof CODE | null> = vi.fn(async () => CODE)) {
  act(() => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "travel", sessionToken: "t", host: true },
      state: makeState(),
      addScreen,
    });
  });
  return addScreen;
}

beforeEach(() => {
  localStorage.clear();
  useKeepsakeStore.setState({ check: async () => undefined, step: "closed", account: null });
});

afterEach(() => {
  cleanup();
  resetBusy();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  act(() => {
    useGameStore.setState({ session: null, state: null });
  });
});

describe("the leader's half, in the Room panel", () => {
  it("sits folded in the host's panel, and makes nothing until asked", () => {
    const addScreen = host();
    render(<HostControls placement="inline" />);
    const section = screen.getByText("Another TV").closest("details");
    expect(section).toBeTruthy();
    expect(section?.open).toBe(false);
    expect(addScreen).not.toHaveBeenCalled();
  });

  it("is nowhere on a phone that did not open the room", () => {
    act(() => {
      useGameStore.setState({
        session: { runId: "r_1", roomCode: "ABCD", playerId: "p_2", mode: "travel", sessionToken: "t" },
        state: makeState(),
      });
    });
    render(<HostControls placement="inline" />);
    expect(screen.queryByText("Another TV")).toBeNull();
  });

  it("says players there join with this room's code, then shows a code big, with how long it lasts", async () => {
    const addScreen = host();
    render(<AddScreen roomCode="ABCD" shareable={false} />);
    expect(screen.getByText("ABCD")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get a code for the other TV" }));
    expect(addScreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("Code for the other TV")).toHaveProperty("textContent", "ABCD-EFGH");
    expect(screen.getByText(/one time, for 10 minutes/)).toBeTruthy();
    // The TV has nothing to send a link with: it shows the code to read out.
    expect(screen.queryByRole("button", { name: "Send it as a link" })).toBeNull();
  });

  it("offers to send a link from the host's own phone, with the code in words too", async () => {
    host();
    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      render(<AddScreen roomCode="ABCD" shareable />);
      fireEvent.click(screen.getByRole("button", { name: "Get a code for the other TV" }));
      fireEvent.click(await screen.findByRole("button", { name: "Send it as a link" }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const sent = (share.mock.calls[0] as unknown as [{ url: string; text: string }])[0];
      expect(sent.url).toBe(`${window.location.origin}/?screen=ABCDEFGH`);
      expect(sent.text).toContain("ABCD-EFGH");
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("says when a code ran out, and makes a new one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const addScreen = host(vi.fn(async () => ({ code: "ABCDEFGH", expiresAt: new Date(Date.now() + 1000).toISOString() })));
    render(<AddScreen roomCode="ABCD" shareable={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Get a code for the other TV" }));
    await screen.findByLabelText("Code for the other TV");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText(/That code ran out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make a new code" }));
    expect(addScreen).toHaveBeenCalledTimes(2);
  });

  it("keeps the panel as it was when the server will not make a code", async () => {
    host(vi.fn(async () => null));
    render(<AddScreen roomCode="ABCD" shareable={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Get a code for the other TV" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Get a code for the other TV" })).toHaveProperty("disabled", false));
    expect(screen.queryByLabelText("Code for the other TV")).toBeNull();
  });
});

describe("the other TV's half", () => {
  it("waits for all eight letters, then shows the game", async () => {
    const showFromCode = vi.fn(async () => undefined);
    act(() => useGameStore.setState({ showFromCode }));
    render(<ShowHere initialCode="" onClose={() => undefined} />);
    const go = screen.getByRole("button", { name: "Show the game here" });
    const field = screen.getByLabelText("Code for this TV");
    fireEvent.change(field, { target: { value: "abcd" } });
    expect(go).toHaveProperty("disabled", true);
    fireEvent.change(field, { target: { value: "abcd-efgh" } });
    expect((field as HTMLInputElement).value).toBe("ABCD-EFGH");
    expect(go).toHaveProperty("disabled", false);
    fireEvent.click(go);
    await waitFor(() => expect(showFromCode).toHaveBeenCalledWith("ABCDEFGH"));
  });

  it("says why a code did not work, and lets them try again", async () => {
    const showFromCode = vi.fn(async () => {
      throw new Error("That code didn't work. It may be used up or too old; ask for a new one.");
    });
    act(() => useGameStore.setState({ showFromCode }));
    render(<ShowHere initialCode="ABCDEFGH" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Show the game here" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/used up or too old/);
    expect(screen.getByRole("button", { name: "Show the game here" })).toHaveProperty("disabled", false);
  });

  it("is one quiet link in the Host card, beside Party Mode's table name, and Back returns there", () => {
    render(<HomeScreen />);
    // Not on the join view, beside the kids' own Join a game.
    expect(screen.queryByRole("button", { name: "Join a game lobby" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Host a game" }));
    fireEvent.click(screen.getByRole("button", { name: "Join a game lobby" }));
    return screen.findByRole("heading", { name: "Join a game lobby" }).then(() => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.queryByRole("heading", { name: "Join a game lobby" })).toBeNull();
      // Back to where they came from: the Host card, as it was.
      expect(screen.getByRole("button", { name: "Open the lobby here" })).toBeTruthy();
    });
  });

  it("opens straight to it from the leader's link, with the code typed and nothing spent", async () => {
    const showFromCode = vi.fn(async () => undefined);
    act(() => useGameStore.setState({ showFromCode }));
    window.history.replaceState(null, "", "/?screen=abcdefgh");
    render(<HomeScreen />);
    const field = (await screen.findByLabelText("Code for this TV")) as HTMLInputElement;
    expect(field.value).toBe("ABCD-EFGH");
    expect(showFromCode).not.toHaveBeenCalled();
  });
});

describe("how many other TVs are showing the game", () => {
  it("says so on the folded section, and what it is for when there are none", () => {
    expect(otherTvs(0)).toBe("Play together from another place");
    expect(otherTvs(1)).toBe("1 other TV is showing this game");
    expect(otherTvs(3)).toBe("3 other TVs are showing this game");
  });

  it("follows the room's screens as they come and go, without opening the section", () => {
    host();
    render(<HostControls placement="inline" />);
    const line = () => screen.getByText("Another TV").closest("summary")?.textContent ?? "";
    expect(line()).toContain("Play together from another place");
    act(() => useGameStore.setState({ state: { ...makeState(), screens: ["s_a"] } }));
    expect(line()).toContain("1 other TV is showing this game");
    act(() => useGameStore.setState({ state: { ...makeState(), screens: ["s_a", "s_b"] } }));
    expect(line()).toContain("2 other TVs are showing this game");
    expect(screen.getByText("Another TV").closest("details")?.open).toBe(false);
  });
});

describe("screenShareText", () => {
  it("carries the link and the code, for a TV that cannot open a link", () => {
    const text = screenShareText("ABCDEFGH", "https://example.test/?screen=ABCDEFGH");
    expect(text).toContain("https://example.test/?screen=ABCDEFGH");
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("Join a game lobby");
  });
});

/** A calm page with a new build waiting, but for whatever `editing` (busy.ts) says. */
const CALM: CalmInputs = { visible: true, synced: true, picking: false, inFight: false, editing: false, keepsakeOpen: false, pairing: false };
const reloads = (): boolean => shouldReload(true, { ...CALM, editing: isBusy() }, null, 0);

describe("an update reload never takes a one-use code (sw/converge.ts)", () => {
  it("waits while the other TV has a code typed, and while it is being spent", async () => {
    let answer!: () => void;
    const showFromCode = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    act(() => useGameStore.setState({ showFromCode }));
    const { unmount } = render(<ShowHere initialCode="" onClose={() => undefined} />);
    expect(reloads()).toBe(true);

    fireEvent.change(screen.getByLabelText("Code for this TV"), { target: { value: "abcdefgh" } });
    expect(reloads()).toBe(false);

    // Spent on the server, the viewer token not yet kept: the most dangerous moment.
    fireEvent.click(screen.getByRole("button", { name: "Show the game here" }));
    await waitFor(() => expect(showFromCode).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Code for this TV"), { target: { value: "" } });
    expect(reloads()).toBe(false);

    // Kept, and the card gives way to the game.
    await act(async () => answer());
    unmount();
    expect(reloads()).toBe(true);
  });

  it("waits while a code a link brought is on the card", () => {
    render(<ShowHere initialCode="ABCDEFGH" onClose={() => undefined} />);
    expect(reloads()).toBe(false);
  });

  it("waits while the leader's code is on screen, and lets go once it runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    host(vi.fn(async () => ({ code: "ABCDEFGH", expiresAt: new Date(Date.now() + 1000).toISOString() })));
    render(<AddScreen roomCode="ABCD" shareable={false} />);
    // Opening the section to read it holds nothing.
    expect(reloads()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Get a code for the other TV" }));
    await screen.findByLabelText("Code for the other TV");
    expect(reloads()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText(/That code ran out/)).toBeTruthy();
    expect(reloads()).toBe(true);
  });
});
