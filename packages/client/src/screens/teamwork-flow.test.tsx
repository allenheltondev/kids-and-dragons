// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { applyIntent, createRunState, enterScene, makeRng, resolveCharacter, type ClientIntent, type EngineContext, type InteractionPrompt, type InteractionScene } from "@kad/shared";
import { makeChapter, makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { StoryInteractionControls } from "./StoryInteraction";

const initial = useGameStore.getState();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(2_000_000); });
afterEach(() => { cleanup(); useGameStore.setState(initial, true); vi.useRealTimers(); });

function game(players: number, relaxed: boolean) {
  const chapter = makeChapter();
  chapter.scenes.teamwork = { type: "interaction", narration: "Lift together!", interaction: { kind: "cooperate", cue: "Lift the sling", supportLabel: "Hold the sling", actionLabel: "Lift it" }, onSuccess: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "lifted" }] }, onFailure: { goto: "scene_clearing" } } satisfies InteractionScene;
  const context = (): EngineContext => ({ chapter, rules: makeRules(), items: makeItems(), rng: makeRng("teamwork"), now: new Date().toISOString(), householdId: "h" });
  let state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  state.chapterId = chapter.id;
  state.party = Array.from({ length: players }, (_, i) => ({ playerId: `p${i}`, character: resolveCharacter(makeCharacter({ id: `c${i}`, ownerPlayerId: `p${i}` }), makeRules(), makeItems()), connected: true, ready: true, down: false, hp: 10 }));
  state = enterScene(state, "teamwork", context()).state;
  const opened = state.prompt as InteractionPrompt;
  state = applyIntent(state, { playerId: "p0", intent: { type: "INTERACT", openedSeq: opened.openedSeq, attempt: opened.attempt, action: "start", relaxed } }, context()).state;
  const errors: string[] = [];
  const deliver = (intent: ClientIntent, playerId = "p0") => {
    const result = applyIntent(useGameStore.getState().state!, { playerId, intent }, context());
    if (result.error) errors.push(result.error.message);
    useGameStore.setState({ state: result.state });
    return !result.error;
  };
  const send = vi.fn(async (intent: ClientIntent) => deliver(intent));
  useGameStore.setState({ state, send, synced: true, session: { playerId: "p0", runId: "r", roomCode: "TEST", mode: "party", sessionToken: "test" } });
  const helper = () => {
    const p = useGameStore.getState().state!.prompt as InteractionPrompt;
    deliver({ type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "support", mode: "prop" }, "p1");
  };
  return { errors, send, helper };
}

describe("phone controls playing against the authoritative engine", () => {
  it.each([false, true])("a solo prop finishes itself, relaxed=%s", async (relaxed) => {
    const { errors, send } = game(1, relaxed);
    render(<StoryInteractionControls />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Hold the sling" })); });
    expect(screen.queryByRole("button", { name: "Lift it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "See what happens next" })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(Number(screen.getByRole("progressbar", { name: "Lifting together" }).getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: "See what happens next" })).toBeTruthy();
    expect(send.mock.calls.filter(([intent]) => intent.type === "INTERACT" && intent.action === "complete")).toHaveLength(1);
    expect(useGameStore.getState().state!.flags.lifted).toBeUndefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "See what happens next" })); });
    expect(useGameStore.getState().state!.flags.lifted).toBe(true);
    expect(errors).toEqual([]);
  });
  it("every player participates, then a held phone completes without a finish tap", async () => {
    const { errors, helper } = game(2, false);
    render(<StoryInteractionControls />);
    await act(async () => { fireEvent.pointerDown(screen.getByRole("button", { name: "Hold the sling" }), { pointerId: 1 }); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect((useGameStore.getState().state!.prompt as InteractionPrompt).phase).toBe("active");
    await act(async () => { helper(); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect((useGameStore.getState().state!.prompt as InteractionPrompt).outcome).toBe("success");
    expect(errors).toEqual([]);
  });
  it("restarts a propped lift for the remaining team when a phone disconnects", async () => {
    const { errors, helper } = game(2, true);
    render(<StoryInteractionControls />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Hold the sling" })); helper(); });
    await act(async () => { vi.advanceTimersByTime(750); });
    await act(async () => {
      const state = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...state, party: state.party.map((m) => m.playerId === "p1" ? { ...m, connected: false } : m) } });
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect((useGameStore.getState().state!.prompt as InteractionPrompt).phase).toBe("active");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect((useGameStore.getState().state!.prompt as InteractionPrompt).outcome).toBe("success");
    expect(errors).toEqual([]);
  });
  it("letting go stops the lift instead of completing it in the background", async () => {
    const { errors, helper } = game(2, false);
    render(<StoryInteractionControls />);
    await act(async () => { helper(); fireEvent.pointerDown(screen.getByRole("button", { name: "Hold the sling" }), { pointerId: 1 }); });
    await act(async () => { vi.advanceTimersByTime(750); });
    await act(async () => { fireEvent.pointerUp(screen.getByRole("button", { name: /got it/i }), { pointerId: 1 }); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect((useGameStore.getState().state!.prompt as InteractionPrompt).phase).toBe("active");
    expect(screen.getByRole("progressbar", { name: "Lifting together" }).getAttribute("aria-valuenow")).toBe("0");
    expect(errors).toEqual([]);
  });
});
