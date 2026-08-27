// @vitest-environment jsdom
/**
 * The speaker button — and the lifecycle invariant it carries: mounting a
 * world surface installs the one audio sink, unmounting it uninstalls it.
 * jsdom has no AudioContext, which makes these tests double as the proof
 * that a soundless environment mounts the control without a murmur.
 */

import { afterEach, describe, expect, it } from "vitest";
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
