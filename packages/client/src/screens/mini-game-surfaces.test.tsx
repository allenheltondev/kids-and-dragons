// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyIntent, createRunState, enterScene, makeRng, resolveCharacter, type ClientIntent, type EngineContext, type InteractionAction, type InteractionPrompt, type InteractionSpec } from "@kad/shared";
import { makeChapter, makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { StoryInteractionControls, StoryInteractionWorld } from "./StoryInteraction";

const initial = useGameStore.getState();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(2_000_000); vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1); });
afterEach(() => { cleanup(); useGameStore.setState(initial, true); vi.restoreAllMocks(); vi.useRealTimers(); });
const options = [{ id: "leaf", label: "Leaf", icon: "leaf" }, { id: "star", label: "Star", icon: "star" }];
function game(spec: InteractionSpec, props: string[] = []) {
  const chapter = makeChapter();
  chapter.scenes.game = { type: "interaction", narration: "Help together", interaction: spec, onSuccess: { goto: "scene_clearing" }, onFailure: { goto: "scene_clearing" } };
  chapter.presentation = { interactions: { game: { props, ...(spec.kind === "tracking" ? { coverIcons: ["snow-mound", "relay-sack"] } : {}) } } };
  const ctx = (): EngineContext => ({ chapter, rules: makeRules(), items: makeItems(), rng: makeRng("surfaces"), now: new Date().toISOString(), householdId: "h" });
  let state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  state.chapterId = chapter.id;
  state.party = ["Aster", "Fern"].map((name, i) => ({ playerId: `p${i}`, character: resolveCharacter(makeCharacter({ id: `c${i}`, ownerPlayerId: `p${i}`, name }), makeRules(), makeItems()), connected: true, ready: true, down: false, hp: 10 }));
  state = enterScene(state, "game", ctx()).state;
  const p = state.prompt as InteractionPrompt;
  state = applyIntent(state, { playerId: "p0", intent: { type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "start", relaxed: false } }, ctx()).state;
  const deliver = (intent: ClientIntent, playerId = "p0") => {
    const result = applyIntent(useGameStore.getState().state!, { playerId, intent }, ctx());
    expect(result.error).toBeUndefined();
    useGameStore.setState({ state: result.state });
    return !result.error;
  };
  useGameStore.setState({ state, chapter, synced: true, send: async (intent) => deliver(intent), session: { playerId: "p0", runId: "r", roomCode: "TEST", mode: "party", sessionToken: "test" } });
  render(<><StoryInteractionControls /><StoryInteractionWorld /></>);
  return {
    phone: screen.getByRole("region", { name: "Interaction controls" }), tv: screen.getByRole("region", { name: "Story interaction" }),
    helper: (action: InteractionAction) => { const p = useGameStore.getState().state!.prompt as InteractionPrompt; deliver({ type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, ...action }, "p1"); },
  };
}

it("makes the moving precision object the touch surface and freezes the same result on the TV", async () => {
  const { phone, tv } = game({ kind: "precision", cue: "Aim", actionLabel: "Throw", target: 0.5, width: 0.3, periodMs: 4000 }, ["rope-loop"]);
  const tap = within(phone).getByRole("button", { name: "Throw" });
  expect(tap.querySelector(".game-track__prop")).toBeTruthy();
  expect(phone.querySelectorAll('[src="/assets/story-props/rope-loop.webp"]')).toHaveLength(1);
  expect(tv.querySelectorAll('[src="/assets/story-props/rope-loop.webp"]')).toHaveLength(1);
  await act(async () => { fireEvent.click(tap); });
  const position = (region: HTMLElement) => (region.querySelector(".game-track__marker") as HTMLElement).style.left;
  expect(position(tv)).toBe(position(phone));
  expect(tv.querySelector(".game-track")?.getAttribute("data-stopped")).toBe("miss");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(position(tv)).toBe("0%");
});

it("lets children touch a cover and lifts the chosen and correct covers on both screens", async () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(Date.now()), 16));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
  const { phone, tv } = game({ kind: "tracking", cue: "Follow", actionLabel: "Look under", covers: ["Left", "Right"], start: 0, swaps: [[0, 1]], stepMs: 1000 }, ["prop_sun_card"]);
  expect(within(phone).queryByRole("button", { name: "Look under: Left" })).toBeNull();
  await act(async () => { vi.advanceTimersByTime(2300); });
  const cover = within(phone).getByRole("button", { name: "Look under: Left" });
  expect(cover.querySelector(".painted-cover__front")?.getAttribute("src")).toContain("relay-sack");
  expect(phone.querySelector(".game-options--covers")).toBeNull();
  await act(async () => { fireEvent.click(cover); });
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).submittedAnswer).toEqual(["0"]);
  for (const region of [phone, tv]) {
    expect(region.querySelector('.game-cover-pick[data-picked="true"] .painted-cover')?.getAttribute("data-raised")).toBe("true");
    expect(region.querySelector('.game-cover-pick[data-correct="true"] .painted-cover__target')).toBeTruthy();
    expect(within(region).getByText("Your pick")).toBeTruthy();
  }
});

it("keeps memory pads in place from playback through the child's answer", async () => {
  const { phone, tv } = game({ kind: "memory", cue: "Echo", actionLabel: "Send", options, answer: ["leaf", "star"], stepMs: 1000 });
  const leaf = within(phone).getByRole("button", { name: "Leaf" }) as HTMLButtonElement;
  expect(leaf.disabled).toBe(true);
  expect(leaf.getAttribute("data-lit")).toBe("true");
  await act(async () => { vi.advanceTimersByTime(2250); });
  expect(within(phone).getByRole("button", { name: "Leaf" })).toBe(leaf);
  expect(leaf.disabled).toBe(false);
  fireEvent.click(leaf);
  fireEvent.click(within(phone).getByRole("button", { name: "Star" }));
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "Send" })); });
  expect(tv.querySelectorAll(".game-slot--full")).toHaveLength(2);
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).outcome).toBe("success");
});

it("edits a sequence by touching the mistaken tile and preserves the other choices", async () => {
  const { phone, tv } = game({ kind: "sequence", cue: "Order", actionLabel: "Try", options, answer: ["star", "leaf"], clues: ["Star first"] });
  fireEvent.click(within(phone).getByRole("button", { name: "Leaf" }));
  fireEvent.click(within(phone).getByRole("button", { name: "Star" }));
  fireEvent.click(within(phone).getByRole("button", { name: "Remove step 1: Leaf" }));
  expect(within(phone).getByRole("button", { name: "Remove step 1: Star" })).toBeTruthy();
  fireEvent.click(within(phone).getByRole("button", { name: "Leaf" }));
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "Try" })); });
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).submittedAnswer).toEqual(["star", "leaf"]);
  expect(tv.querySelectorAll(".game-slot--full")).toHaveLength(2);
});

it("puts the shared lift inside the hold surface without a second disconnected prop", async () => {
  const { phone, tv, helper } = game({ kind: "cooperate", cue: "Lift", supportLabel: "Hold it", actionLabel: "Lift" }, ["rope-basket"]);
  const hold = within(phone).getByRole("button", { name: "Hold it" });
  expect(hold.querySelector('[src="/assets/story-props/rope-basket.webp"]')).toBeTruthy();
  expect(phone.querySelectorAll('[src="/assets/story-props/rope-basket.webp"]')).toHaveLength(1);
  expect(tv.querySelectorAll('[src="/assets/story-props/rope-basket.webp"]')).toHaveLength(1);
  await act(async () => { fireEvent.pointerDown(hold, { pointerId: 1 }); helper({ action: "support", mode: "prop" }); });
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(Number((hold.querySelector(".game-lift") as HTMLElement).style.getPropertyValue("--lift"))).toBeGreaterThan(0);
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).outcome).toBe("success");
});

it("marks a child's play choice immediately and shows its authored reaction on the TV", async () => {
  const { phone, tv } = game({ kind: "play", cue: "Say hello", actionLabel: "Finish", participation: "everyone", options: [{ id: "wave", label: "Wave", icon: "hand", reaction: "A wave comes back!" }, { id: "bow", label: "Bow", icon: "heart", reaction: "A tiny bow!" }] });
  await act(async () => { fireEvent.click(within(phone).getByRole("button", { name: "Wave" })); });
  expect(within(phone).getByRole("button", { name: "Wave" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(tv).getByText("A wave comes back!")).toBeTruthy();
});


it("keeps the timing object and tapped moment visible when the result arrives", async () => {
  const { phone, tv } = game({ kind: "timing", cue: "Wait", actionLabel: "Ring", target: 0.5, width: 0.3, periodMs: 4000 }, ["wind-bells"]);
  const tap = within(phone).getByRole("button", { name: "Ring" });
  expect(tap.querySelector(".game-lamp__object")).toBeTruthy();
  await act(async () => { fireEvent.click(tap); });
  await act(async () => { vi.advanceTimersByTime(1000); });
  for (const region of [phone, tv]) {
    expect(region.querySelector(".game-lamp")?.getAttribute("data-safe")).toBe("false");
    expect(region.querySelectorAll('[src="/assets/story-props/wind-bells.webp"]')).toHaveLength(1);
  }
});


it.each(["precision", "timing"] as const)("records a %s touch when the finger lands rather than when it lifts", async (kind) => {
  const { phone } = game({ kind, cue: "Tap", actionLabel: "Tap it", target: 0.5, width: 0.3, periodMs: 4000 });
  const target = within(phone).getByRole("button", { name: "Tap it" });
  await act(async () => { fireEvent.pointerDown(target, { pointerId: 1, button: 0 }); });
  expect((useGameStore.getState().state!.prompt as InteractionPrompt).stopPosition).toBe(0);
  const seq = useGameStore.getState().state!.seq;
  await act(async () => { vi.advanceTimersByTime(1000); });
  fireEvent.pointerUp(target, { pointerId: 1, button: 0 });
  fireEvent.click(target, { detail: 1 });
  expect(useGameStore.getState().state!.seq).toBe(seq);
});
