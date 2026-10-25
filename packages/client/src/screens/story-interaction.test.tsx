// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRunState, resolveCharacter } from "@kad/shared";
import type { ClientIntent, InteractionPrompt, InteractionSpec } from "@kad/shared";
import { makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore, useMyTurnKey } from "../store";
import { StoryInteractionControls, StoryInteractionWorld } from "./StoryInteraction";

const initial = useGameStore.getState();
beforeEach(() => { vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1); });
afterEach(() => { cleanup(); useGameStore.setState(initial, true); document.documentElement.removeAttribute("data-motion"); vi.restoreAllMocks(); });
const precision: InteractionSpec = { kind: "precision", cue: "Ring the bell", actionLabel: "Toss!", target: 0.5, width: 0.3, periodMs: 4000 };
function seed(spec: InteractionSpec = precision, extra: Partial<InteractionPrompt> = {}) {
  const state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  state.party = [{ playerId: "p", character: resolveCharacter(makeCharacter(), makeRules(), makeItems()), connected: true, ready: true, down: false, hp: 10 }];
  state.prompt = { kind: "interaction", sceneId: "test", openedSeq: 4, attempt: 0, spec, playerIds: ["p"], actorId: "p", phase: "active", relaxed: false, supports: {}, startedAt: new Date().toISOString(), ...extra };
  const send = vi.fn(async (_intent: ClientIntent) => true);
  useGameStore.setState({ state, send, synced: true, session: { playerId: "p", runId: "r", roomCode: "TEST", mode: "party", sessionToken: "test" } });
  return send;
}

describe("reusable story controls", () => {
  it("offers final cover positions in relaxed tracking", () => {
    const send = seed({ kind: "tracking", cue: "Watch", actionLabel: "Look under", covers: ["Left", "Middle", "Right"], start: 0, swaps: [[0, 2]], stepMs: 1000 }, { relaxed: true });
    render(<StoryInteractionControls />);
    expect(screen.getByText("The glow waits under: Right.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Look under: Right" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "answer", answer: ["2"] }));
  });
  it("lets a player echo a repeated memory pattern using ordinary symbol buttons", async () => {
    const send = seed({ kind: "memory", cue: "Echo", actionLabel: "Send", options: [{ id: "star", label: "Star", icon: "star" }, { id: "leaf", label: "Leaf", icon: "leaf" }], answer: ["star", "leaf", "star"], stepMs: 1000 }, { relaxed: true });
    render(<StoryInteractionControls />);
    for (const name of ["Star", "Leaf", "Star"]) fireEvent.click(screen.getByRole("button", { name }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "answer", answer: ["star", "leaf", "star"] }));
  });
  it("shows authored playful reactions on the read-only shared surface", () => {
    const send = seed({ kind: "play", cue: "Hello", actionLabel: "Continue", participation: "any", options: [{ id: "hello", label: "Hello", icon: "hand", reaction: "A twig twitches." }] }, { reactions: [{ playerId: "p", text: "A twig twitches." }], taps: 1, contributions: { p: "hello" } });
    render(<StoryInteractionWorld />);
    expect(screen.getByText("A twig twitches.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends a bounded precision position with its attempt identity", async () => {
    const send = seed();
    render(<StoryInteractionControls />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Toss!" })); });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ type: "INTERACT", openedSeq: 4, attempt: 0, action: "stop" });
    const sent = send.mock.calls[0]?.[0] as { position: number };
    expect(sent.position).toBeGreaterThanOrEqual(0);
    expect(sent.position).toBeLessThanOrEqual(1);
  });
  it("provides a solo prop instead of requiring two simultaneous controls", () => {
    const send = seed({ kind: "cooperate", cue: "Hold the way", supportLabel: "Prop the branch", actionLabel: "Rescue" });
    render(<StoryInteractionControls />);
    expect((screen.getByRole("button", { name: "Rescue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Prop the branch" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "support", mode: "prop" }));
  });
  it("keeps the shared world read-only", () => {
    const send = seed();
    render(<StoryInteractionWorld />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("offers an untimed route without aiming motion under reduced motion", () => {
    seed();
    document.documentElement.setAttribute("data-motion", "reduced");
    render(<StoryInteractionControls />);
    expect(screen.queryByRole("img", { name: /moving marker/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Take a helping hand" })).toBeTruthy();
  });
  it("does not steal navigation focus for support renewals", () => {
    seed({ kind: "cooperate", cue: "Hold", supportLabel: "Hold", actionLabel: "Go" });
    function Key() { return <p data-testid="turn-key">{useMyTurnKey()}</p>; }
    render(<Key />);
    const key = screen.getByTestId("turn-key").textContent;
    const state = useGameStore.getState().state!;
    const prompt = state.prompt as InteractionPrompt;
    act(() => useGameStore.setState({ state: { ...state, prompt: { ...prompt, supports: { p: null } } } }));
    expect(screen.getByTestId("turn-key").textContent).toBe(key);
    act(() => useGameStore.setState({ state: { ...state, prompt: { ...prompt, phase: "result", outcome: "success" } } }));
    expect(screen.getByTestId("turn-key").textContent).not.toBe(key);
  });
  it("treats receiving the relay as a new turn, without restarting on catch", () => {
    seed({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "spark" });
    function Key() { return <p data-testid="turn-key">{useMyTurnKey()}</p>; }
    render(<Key />);
    const key = screen.getByTestId("turn-key").textContent;
    const state = useGameStore.getState().state!;
    const prompt = state.prompt as InteractionPrompt;
    act(() => useGameStore.setState({ state: { ...state, prompt: { ...prompt, caughtBy: "p" } } }));
    expect(screen.getByTestId("turn-key").textContent).toBe(key);
    act(() => useGameStore.setState({ state: { ...state, prompt: { ...prompt, passed: ["p"] } } }));
    expect(screen.getByTestId("turn-key").textContent).not.toBe(key);
  });
});
