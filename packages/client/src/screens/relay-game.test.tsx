// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyIntent, createRunState, enterScene, makeRng, resolveCharacter, type ClientIntent, type EngineContext, type InteractionPrompt } from "@kad/shared";
import { makeChapter, makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { StoryInteractionControls, StoryInteractionWorld } from "./StoryInteraction";
import { RelayCatcher } from "./RelayGame";

const initial = useGameStore.getState();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(2_000_000); });
afterEach(() => { cleanup(); useGameStore.setState(initial, true); document.documentElement.removeAttribute("data-motion"); vi.useRealTimers(); });
const catcher = { object: "relay-plank", caught: true, label: "Pass the mat", catchLabel: "Catch the mat", nextName: "Fern", busy: false };

describe("an object in a child's hands", () => {
  it("follows the finger and only throws when a deliberate upward drag is released", async () => {
    const onPass = vi.fn(async () => true);
    const { container } = render(<RelayCatcher {...catcher} onCatch={vi.fn(async () => true)} onPass={onPass} />);
    const object = screen.getByRole("button", { name: "Pass the mat" });
    fireEvent.pointerDown(object, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(object, { clientY: 205, pointerId: 1 });
    expect((container.querySelector(".relay-hands__object") as HTMLElement).style.getPropertyValue("--drag")).toBe("95px");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onPass).not.toHaveBeenCalled();
    fireEvent.pointerUp(object, { clientY: 205, pointerId: 1 });
    fireEvent.lostPointerCapture(object, { pointerId: 1 });
    expect((container.querySelector(".relay-hands__object") as HTMLElement).style.getPropertyValue("--drag")).toBe("95px");
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onPass).toHaveBeenCalledTimes(1);
  });
  it.each(["short", "cancel", "blur", "wrong finger", "sideways"])("settles back without passing after %s", async (mode) => {
    const onPass = vi.fn(async () => true);
    const { container } = render(<RelayCatcher {...catcher} onCatch={vi.fn(async () => true)} onPass={onPass} />);
    const object = screen.getByRole("button", { name: "Pass the mat" });
    fireEvent.pointerDown(object, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(object, { clientX: mode === "sideways" ? 150 : 0, clientY: mode === "short" ? 280 : mode === "sideways" ? 300 : 180, pointerId: mode === "wrong finger" ? 2 : 1 });
    if (mode === "cancel") fireEvent.pointerCancel(object, { pointerId: 1 });
    if (mode === "blur") fireEvent.blur(object);
    fireEvent.pointerUp(object, { clientX: mode === "sideways" ? 150 : 0, clientY: mode === "short" ? 280 : mode === "sideways" ? 300 : 180, pointerId: mode === "wrong finger" ? 2 : 1 });
    if (mode === "wrong finger") fireEvent.pointerCancel(object, { pointerId: 1 });
    fireEvent.click(object, { detail: 1 });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onPass).not.toHaveBeenCalled();
    expect((container.querySelector(".relay-hands__object") as HTMLElement).style.getPropertyValue("--drag")).toBe("0px");
  });
  it("catches on touch without treating that same touch as a pass", async () => {
    const onCatch = vi.fn(async () => true), onPass = vi.fn(async () => true);
    const { rerender } = render(<RelayCatcher {...catcher} caught={false} onCatch={onCatch} onPass={onPass} />);
    await act(async () => { fireEvent.pointerDown(screen.getByRole("button", { name: "Catch the mat" }), { clientY: 200, pointerId: 1 }); });
    rerender(<RelayCatcher {...catcher} onCatch={onCatch} onPass={onPass} />);
    const object = screen.getByRole("button", { name: "Pass the mat" });
    fireEvent.pointerUp(object, { clientY: 200, pointerId: 1 });
    fireEvent.click(object, { detail: 1 });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onCatch).toHaveBeenCalledTimes(1);
    expect(onPass).not.toHaveBeenCalled();
  });
  it("returns a rejected pass to the hands and lets the child try again", async () => {
    const onPass = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<RelayCatcher {...catcher} onCatch={vi.fn(async () => true)} onPass={onPass} />);
    fireEvent.click(screen.getByRole("button", { name: "Pass the mat" }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByText("Still in your hands. Try that pass again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pass the mat" }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onPass).toHaveBeenCalledTimes(2);
  });
  it("supports a stationary tap under reduced motion and a labeled image fallback", async () => {
    document.documentElement.setAttribute("data-motion", "reduced");
    const onPass = vi.fn(async () => true);
    const { container } = render(<RelayCatcher {...catcher} onCatch={vi.fn(async () => true)} onPass={onPass} />);
    fireEvent.error(container.querySelector("img.relay-object")!);
    expect(container.querySelector(".relay-object--fallback")?.textContent).toContain("the mat");
    fireEvent.click(screen.getByRole("button", { name: "Pass the mat" }));
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onPass).toHaveBeenCalledTimes(1);
  });
});

it.each([false, true])("moves one prop through two phones and the TV, reduced motion=%s", async (still) => {
  if (still) document.documentElement.setAttribute("data-motion", "reduced");
  const chapter = makeChapter();
  chapter.scenes.relay_test = { type: "interaction", narration: "Pass the mat", interaction: { kind: "relay", cue: "Pass the mat along", actionLabel: "Pass the mat", objectLabel: "the mat" }, onSuccess: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "delivered" }] }, onFailure: { goto: "scene_clearing" } };
  chapter.presentation = { interactions: { relay_test: { props: ["relay-plank"] } } };
  const ctx = (): EngineContext => ({ chapter, rules: makeRules(), items: makeItems(), rng: makeRng("relay"), now: new Date().toISOString(), householdId: "h" });
  let state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  state.chapterId = chapter.id;
  state.party = ["Aster", "Fern"].map((name, i) => ({ playerId: `p${i}`, character: resolveCharacter(makeCharacter({ id: `c${i}`, ownerPlayerId: `p${i}`, name }), makeRules(), makeItems()), connected: true, ready: true, down: false, hp: 10 }));
  state = enterScene(state, "relay_test", ctx()).state;
  const p = state.prompt as InteractionPrompt;
  state = applyIntent(state, { playerId: "p0", intent: { type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "start", relaxed: false } }, ctx()).state;
  const send = vi.fn(async (intent: ClientIntent) => {
    const store = useGameStore.getState();
    const result = applyIntent(store.state!, { playerId: store.session!.playerId, intent }, ctx());
    expect(result.error).toBeUndefined();
    useGameStore.setState({ state: result.state });
    return !result.error;
  });
  useGameStore.setState({ state, chapter, send, synced: true, session: { playerId: "p0", runId: "r", roomCode: "TEST", mode: "party", sessionToken: "test" } });
  render(<><StoryInteractionControls /><StoryInteractionWorld /></>);
  const phone = screen.getByRole("region", { name: "Interaction controls" });
  const tv = screen.getByRole("region", { name: "Story interaction" });
  const painted = '[src="/assets/story-props/relay-plank.webp"]';
  expect(phone.querySelectorAll(painted)).toHaveLength(1);
  expect(tv.querySelectorAll(painted)).toHaveLength(1);
  expect(tv.querySelector(".interaction-art")).toBeNull();
  expect(phone.querySelector(".relay-world")).toBeNull();
  expect(within(phone).getByText("To Fern")).toBeTruthy();
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "Catch the mat" })); });
  expect(tv.querySelector(".relay-world")?.getAttribute("data-caught")).toBe("true");
  const object = within(phone).getByRole("button", { name: "Pass the mat" });
  fireEvent.pointerDown(object, { pointerId: 1, clientY: 250 });
  fireEvent.pointerMove(object, { pointerId: 1, clientY: 150 });
  fireEvent.pointerUp(object, { pointerId: 1, clientY: 150 });
  await act(async () => { vi.advanceTimersByTime(300); });
  const flight = tv.querySelector(".relay-world__flight") as HTMLElement;
  expect(flight.style.getPropertyValue("--from-x")).toBe("10%");
  expect(flight.style.getPropertyValue("--to-x")).toBe("50%");
  expect(tv.querySelectorAll(painted)).toHaveLength(1);
  await act(async () => { useGameStore.setState({ session: { ...useGameStore.getState().session!, playerId: "p1" } }); });
  expect(within(phone).getByText("To home")).toBeTruthy();
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "Catch the mat" })); });
  fireEvent.click(within(phone).getByRole("button", { name: "Pass the mat" }));
  await act(async () => { vi.advanceTimersByTime(300); });
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).outcome).toBe("success");
  expect(tv.querySelector(".relay-world")?.getAttribute("data-delivered")).toBe("true");
  expect(tv.querySelectorAll(painted)).toHaveLength(1);
  expect(useGameStore.getState().state!.flags.delivered).toBeUndefined();
  if (!still) {
    expect(within(phone).queryByRole("button", { name: "See what happens next" })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(650); });
  }
  expect(within(tv).getByText("Delivered together!")).toBeTruthy();
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "See what happens next" })); });
  expect(useGameStore.getState().state!.flags.delivered).toBe(true);
});
