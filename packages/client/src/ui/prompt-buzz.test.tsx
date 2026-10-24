// @vitest-environment jsdom
/**
 * The question buzz (#465): one short vibration per new question this phone can answer,
 * and none for the TV, a shared tablet, reduced motion, a hidden page or no vibrate API.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { saveSharedDevice } from "../store/persistence";
import { promptKey, shouldBuzz, usePromptBuzz, type BuzzInput } from "./prompt-buzz";

const ready = { kind: "ready" as const, forPlayerIds: ["p1"] };

function run(visited: string[], prompt: RunState["prompt"] = ready): RunState {
  return {
    chapterId: "ch1",
    visited,
    prompt,
    party: [{ playerId: "p1", character: { id: "c1" } }],
  } as unknown as RunState;
}

function setRun(state: RunState | null, playerId = "p1"): void {
  act(() => {
    useGameStore.setState({
      state,
      session: state ? ({ playerId, runId: "r1", roomCode: "ABCD" } as never) : null,
    });
  });
}

function Probe(): null {
  usePromptBuzz();
  return null;
}

const base: BuzzInput = {
  key: "ch1:1:ready:",
  buzzed: null,
  playerId: "p1",
  sharedDevice: false,
  visible: true,
  reduced: false,
  supported: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  setRun(null);
});

describe("shouldBuzz", () => {
  it("buzzes for a new question this player can answer", () => {
    expect(shouldBuzz(base)).toBe(true);
  });

  it("does not buzz for the same question twice", () => {
    expect(shouldBuzz({ ...base, buzzed: base.key })).toBe(false);
  });

  it("does not buzz when no question is open for this player", () => {
    expect(shouldBuzz({ ...base, key: null })).toBe(false);
  });

  it.each([
    ["the TV or a display client", { playerId: "" }],
    ["a shared tablet", { sharedDevice: true }],
    ["a hidden page", { visible: false }],
    ["reduced motion", { reduced: true }],
    ["no vibrate API", { supported: false }],
  ])("stays silent on %s", (_, override) => {
    expect(shouldBuzz({ ...base, ...override })).toBe(false);
  });
});

describe("promptKey", () => {
  it("is stable while votes move, and new when the party revisits a scene", () => {
    const choice = (votes?: Record<string, string>) => ({
      kind: "choice" as const, sceneId: "s1", options: [], forPlayerIds: [], vote: true, votes,
    });
    expect(promptKey(run(["a"], choice()))).toBe(promptKey(run(["a"], choice({ p1: "x" }))));
    expect(promptKey(run(["a"], choice()))).not.toBe(promptKey(run(["a", "b"], choice())));
  });
});

describe("usePromptBuzz", () => {
  function stubVibrate(): ReturnType<typeof vi.fn> {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
    return vibrate;
  }

  it("calls vibrate once per new prompt, not again for the same one", () => {
    const vibrate = stubVibrate();
    render(<Probe />);
    setRun(run(["a"]));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(30);

    // The same question with a changed detail (a new seq, a vote) is not a new question.
    setRun({ ...run(["a"]), seq: 9 } as RunState);
    expect(vibrate).toHaveBeenCalledTimes(1);

    // Revisiting a scene is a new question.
    setRun(run(["a", "b"]));
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("does not buzz for a question already open when the page mounts", () => {
    const vibrate = stubVibrate();
    setRun(run(["a"]));
    render(<Probe />);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does not buzz for a question meant for someone else", () => {
    const vibrate = stubVibrate();
    render(<Probe />);
    setRun(run(["a"], { kind: "ready", forPlayerIds: ["p2"] }));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("stays silent on a shared tablet", () => {
    const vibrate = stubVibrate();
    saveSharedDevice({ token: "t", householdId: "h" });
    render(<Probe />);
    setRun(run(["a"]));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("stays silent on the TV (no player)", () => {
    const vibrate = stubVibrate();
    render(<Probe />);
    setRun(run(["a"]), "");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("stays silent under reduced motion", () => {
    const vibrate = stubVibrate();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<Probe />);
    setRun(run(["a"]));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("stays silent while the page is hidden", () => {
    const vibrate = stubVibrate();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    render(<Probe />);
    setRun(run(["a"]));
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("is silent and does not throw where vibrate is absent or refuses", () => {
    Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
    render(<Probe />);
    expect(() => setRun(run(["a"]))).not.toThrow();

    const refusing = vi.fn(() => { throw new Error("blocked"); });
    Object.defineProperty(navigator, "vibrate", { value: refusing, configurable: true, writable: true });
    expect(() => setRun(run(["a", "b"]))).not.toThrow();
    expect(refusing).toHaveBeenCalledTimes(1);
  });
});
