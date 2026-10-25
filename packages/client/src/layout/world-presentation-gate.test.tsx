// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PartyLayout } from "./PartyLayout";
import { TravelLayout } from "./TravelLayout";
import { useGameStore } from "../store";
import { rollRevealMs } from "../world/presentation";
import { MessageSequencer } from "../sync/channel";
import { makeState } from "../testing/fixtures";
import type { PresentationGate } from "../sync/channel";

// Renderer decoration does not participate in patch delivery or gate timing.
vi.mock("../world/PixiStage", () => ({ PixiStage: () => null }));
const register = useGameStore.getState().registerPresentationPlayer;

afterEach(() => {
  cleanup();
  useGameStore.setState({ registerPresentationPlayer: register });
  vi.useRealTimers();
});

function connect(mode: "party" | "travel", display = false) {
  vi.useFakeTimers();
  const state = makeState({ mode, phase: "scene", sceneType: "story", narration: "Before roll" });
  const sequencer = new MessageSequencer({ handlers: {
    onState: (state) => useGameStore.setState({ state }),
    onPresentation: () => undefined,
    onProgression: () => undefined,
    onGap: () => undefined,
  } });
  useGameStore.setState({
    state,
    session: { runId: state.runId, roomCode: state.roomCode, playerId: display ? "" : "p_1", sessionToken: display ? "" : "token", mode },
    presentation: null, progression: null, chapter: null,
    loadContent: async () => undefined, loadChapter: async () => undefined,
    // Bridge the registered surface player into a real channel sequencer.
    registerPresentationPlayer: (gate: PresentationGate | null) => {
      const unregister = register(gate);
      sequencer.setGate(gate);
      return () => { sequencer.setGate(null); unregister(); };
    },
  });
  sequencer.reset(state, state.seq);
  let seq = state.seq;
  return {
    sequencer,
    roll() {
      seq += 1;
      act(() => sequencer.ingest({ kind: "patch", runId: state.runId, seq,
        patch: [{ op: "replace", path: "/narration", value: `After roll ${seq}` }, { op: "replace", path: "/seq", value: seq }],
        presentation: { kind: "ROLL", roll: { die: 12, mod: 0, total: 12, tn: 10, result: "success", characterId: "c_1" } },
      }));
    },
  };
}

describe("World surfaces and authoritative patch timing", () => {
  it("applies Party-phone presentation patches immediately on every tab", () => {
    const { sequencer, roll } = connect("party");
    render(<PartyLayout surface="player" />);
    for (const name of ["You", "World", "Map", "You"]) {
      act(() => screen.getByRole("button", { name }).click());
      const before = sequencer.seq;
      roll();
      expect(sequencer.seq).toBe(before + 1);
      expect(useGameStore.getState().state?.narration).toBe(`After roll ${before + 1}`);
    }
  });

  it.each(["travel", "tv"] as const)("keeps %s presentation patches gated until animation finishes", async (surface) => {
    const { sequencer, roll } = connect(surface === "travel" ? "travel" : "party", surface === "tv");
    render(surface === "tv" ? <PartyLayout surface="world" /> : <TravelLayout />);
    const before = sequencer.seq;
    roll();
    expect(sequencer.seq).toBe(before);
    expect(useGameStore.getState().state?.narration).toBe("Before roll");
    // Hold the patch until all dice land, then the presentation's 500ms grace.
    await act(async () => { await vi.advanceTimersByTimeAsync(rollRevealMs({}) - 1); });
    expect(sequencer.seq).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(502); });
    expect(sequencer.seq).toBe(before + 1);
    expect(useGameStore.getState().state?.narration).toBe(`After roll ${before + 1}`);
  });
});
