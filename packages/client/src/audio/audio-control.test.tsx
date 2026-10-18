// @vitest-environment jsdom
/**
 * The speaker button — and the lifecycle invariant it carries: mounting a
 * world surface installs the one audio sink, unmounting it uninstalls it.
 * jsdom has no AudioContext, which makes these tests double as the proof
 * that a soundless environment mounts the control without a murmur.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AudioControl } from "./AudioControl";
import { getAudioSink } from "./cue";

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // jsdom without storage: nothing to clear.
  }
});

describe("lifecycle", () => {
  it("installs the sink on mount and uninstalls it on unmount", () => {
    expect(getAudioSink()).toBeNull();
    const { unmount } = render(<AudioControl />);
    expect(getAudioSink()).not.toBeNull();
    unmount();
    expect(getAudioSink()).toBeNull();
  });
});

describe("the toggle", () => {
  it("reads as sound-off after a tap, and persists the choice", () => {
    render(<AudioControl />);
    const button = screen.getByRole("button", { name: "Turn sound off" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Turn sound on" })).toBeTruthy();
    expect(localStorage.getItem("kad-audio")).toContain('"muted":true');
  });

  it("comes back muted next mount when it was left muted", () => {
    const first = render(<AudioControl />);
    fireEvent.click(screen.getByRole("button", { name: "Turn sound off" }));
    first.unmount();

    render(<AudioControl />);
    expect(screen.getByRole("button", { name: "Turn sound on" })).toBeTruthy();
  });
});

describe("asking for the gesture", () => {
  const HINT = "Click or press a key for sound";

  it("asks, because the screen everybody watches never gets tapped", () => {
    /*
     * The bug this exists for: a display client is opened on the laptop wired
     * to the television and then left alone. No gesture means no audio
     * context, every cue dropped, and sound that was built and never heard —
     * indistinguishable, from the sofa, from sound that was never built.
     */
    render(<AudioControl />);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("keeps asking while the browser still refuses a context", () => {
    // jsdom has no AudioContext, so the gesture cannot succeed here — and the
    // prompt must stay honest rather than vanish on a gesture that achieved
    // nothing.
    render(<AudioControl />);
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(screen.queryByText(HINT)).toBeTruthy();
  });

  it("says nothing when sound is off anyway", () => {
    // Muted is a decision already made; asking for a gesture to enable
    // something you turned off is nagging.
    render(<AudioControl />);
    fireEvent.click(screen.getByRole("button", { name: "Turn sound off" }));
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

describe("Tap for sound on the shared screen (#264)", () => {
  class BlockedContext {
    currentTime = 0;
    state: "suspended" | "running" = "suspended";
    destination = {};
    listeners = new Set<() => void>();
    addEventListener(_: string, fn: () => void): void { this.listeners.add(fn); }
    removeEventListener(_: string, fn: () => void): void { this.listeners.delete(fn); }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    resume(): Promise<void> {
      // The TV browser lets sound start only on the second try.
      if (BlockedContext.allowed) {
        this.state = "running";
        for (const fn of this.listeners) fn();
      }
      return Promise.resolve();
    }
    close(): Promise<void> { return Promise.resolve(); }
    static allowed = false;
  }

  afterEach(() => { vi.unstubAllGlobals(); BlockedContext.allowed = false; });

  it("shows one plain button while sound is blocked, and drops it once sound is running", async () => {
    vi.stubGlobal("AudioContext", BlockedContext);
    render(<AudioControl display />);
    expect(screen.getAllByRole("button", { name: "Tap for sound" })).toHaveLength(1);
    expect(screen.queryByText("Click or press a key for sound")).toBeNull();

    // A first tap that the browser still refuses leaves the ask on screen.
    fireEvent.click(screen.getByRole("button", { name: "Tap for sound" }));
    expect(screen.getByRole("button", { name: "Tap for sound" })).toBeTruthy();

    BlockedContext.allowed = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tap for sound" }));
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
  });

  it("stays out of the way when sound is off", () => {
    vi.stubGlobal("AudioContext", BlockedContext);
    render(<AudioControl display />);
    fireEvent.click(screen.getByRole("button", { name: "Turn sound off" }));
    expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
  });

  it("does not ask a browser with no audio at all for a tap that cannot help", () => {
    // jsdom: no AudioContext. Silent play is the whole story there.
    render(<AudioControl display />);
    expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
  });

  it("does not put the button on a phone", () => {
    vi.stubGlobal("AudioContext", BlockedContext);
    render(<AudioControl />);
    expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
  });
});

describe("entry screen continuity", () => {
  it("keeps the same sink while moving from home through creation and lobby to a quest", () => {
    const view = render(<AudioControl soundtrack="entry-home" />);
    const sink = getAudioSink()!;
    const music = vi.spyOn(sink, "music");
    view.rerender(<AudioControl soundtrack="entry-home" />);
    expect(music).not.toHaveBeenCalled();
    view.rerender(<AudioControl soundtrack="entry-lobby" />);
    view.rerender(<AudioControl soundtrack="forest" />);
    expect(getAudioSink()).toBe(sink);
    expect(music.mock.calls).toEqual([["entry-lobby"], ["forest"]]);
  });
  it("sounds readiness once on transition, without replaying on joining a ready room", () => {
    const view = render(<AudioControl ready />);
    const cue = vi.spyOn(getAudioSink()!, "cue");
    view.rerender(<AudioControl ready />);
    expect(cue).not.toHaveBeenCalled();
    view.rerender(<AudioControl ready={false} />);
    view.rerender(<AudioControl ready />);
    view.rerender(<AudioControl ready />);
    expect(cue.mock.calls).toEqual([["party-ready"]]);
  });
  it("releases the home speaker on joining as a party controller", () => {
    const view = render(<AudioControl soundtrack="entry-home" />);
    view.rerender(<AudioControl enabled={false} soundtrack="entry-lobby" />);
    expect(getAudioSink()).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn sound off" })).toBeNull();
  });
});

it("does not announce an already-ready party when attaching from home", () => {
  const view = render(<AudioControl ready={false} readinessKey="" />);
  const cue = vi.spyOn(getAudioSink()!, "cue");
  view.rerender(<AudioControl ready readinessKey="new-room" />);
  expect(cue).not.toHaveBeenCalled();
});
