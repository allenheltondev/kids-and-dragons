// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRunState, resolveCharacter } from "@kad/shared";
import type { ClientIntent, InteractionPrompt, InteractionSpec } from "@kad/shared";
import { makeCharacter, makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore, useMyTurnKey } from "../store";
import { StoryInteractionControls, StoryInteractionWorld } from "./StoryInteraction";
import { PaintedCover } from "./InteractionArt";
import wagons from "../../../../content/chapters/gemfall-04c.json";
import rocks from "../../../../content/chapters/gemfall-06.json";

const initial = useGameStore.getState();
beforeEach(() => { vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1); });
afterEach(() => { cleanup(); useGameStore.setState(initial, true); document.documentElement.removeAttribute("data-motion"); vi.restoreAllMocks(); });
const precision: InteractionSpec = { kind: "precision", cue: "Ring the bell", actionLabel: "Toss!", target: 0.5, width: 0.3, periodMs: 4000 };
function seed(spec: InteractionSpec = precision, extra: Partial<InteractionPrompt> = {}) {
  const state = createRunState({ runId: "r", roomCode: "TEST", mode: "party", now: new Date().toISOString() });
  state.chapterId = "test";
  state.sceneId = "test";
  state.party = [{ playerId: "p", character: resolveCharacter(makeCharacter(), makeRules(), makeItems()), connected: true, ready: true, down: false, hp: 10 }];
  state.prompt = { kind: "interaction", sceneId: "test", openedSeq: 4, attempt: 0, spec, playerIds: ["p"], actorId: "p", phase: "active", relaxed: false, supports: {}, startedAt: new Date().toISOString(), ...extra };
  const send = vi.fn(async (_intent: ClientIntent) => true);
  useGameStore.setState({ state, send, synced: true, session: { playerId: "p", runId: "r", roomCode: "TEST", mode: "party", sessionToken: "test" } });
  return send;
}

function authoredChapter(props: { props?: string[]; coverIcons?: string[] } = { props: [] }) {
  const store = useGameStore.getState();
  useGameStore.setState({
    state: { ...store.state!, chapterId: "test" },
    chapter: { id: "test", presentation: { interactions: { test: { props: props.props ?? [], coverIcons: props.coverIcons } } } } as never,
  });
}

describe("reusable story controls", () => {
  it.each([
    ["wagons", wagons.scenes.check_search.interaction, wagons.presentation.interactions.check_search, [[0, 1, 2], [1, 0, 2], [2, 0, 1], [2, 1, 0]], "Right", "2"],
    ["rocks", rocks.scenes.interaction_moth_trail.interaction, rocks.presentation.interactions.interaction_moth_trail, [[0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 1, 0]], "Middle", "1"],
  ] as const)("keeps distinct tracking art and positional answers consistent: %s", async (_name, rawSpec, appearance, positions, answerLabel, answerIndex) => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    const spec = rawSpec as Extract<InteractionSpec, { kind: "tracking" }>;
    for (const mode of ["normal", "relaxed", "reduced"] as const) {
      for (const [step, expected] of positions.entries()) {
        const elapsed = step === 0 ? 0 : (step + 1) * spec.stepMs;
        seed(spec, { relaxed: mode === "relaxed", startedAt: new Date(Date.now() - elapsed).toISOString() });
        authoredChapter(appearance);
        if (mode === "reduced") document.documentElement.setAttribute("data-motion", "reduced");
        const { container, unmount } = render(<StoryInteractionWorld />);
        const covers = container.querySelectorAll<HTMLElement>(".story-interaction__cover:not(.story-interaction__cover-label)");
        for (const [index, cover] of [...covers].entries()) {
          expect(cover.querySelector("img")?.getAttribute("src")).toContain(appearance.coverIcons[index]);
          const slot = mode === "normal" ? expected[index]! : positions[3][index]!;
          expect(parseFloat(cover.style.left)).toBeCloseTo((slot + 0.5) / 3 * 100);
        }
        expect([...container.querySelectorAll(".story-interaction__cover-label")].map(el => el.textContent)).toEqual(["Left", "Middle", "Right"]);
        if (mode !== "normal") expect(screen.getByText(`The glow waits under: ${answerLabel}.`)).toBeTruthy();
        unmount();
      }
      const send = seed(spec, { relaxed: mode === "relaxed", startedAt: new Date(Date.now() - spec.stepMs * 8).toISOString() });
      authoredChapter(appearance);
      const { unmount } = render(<StoryInteractionControls />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: `${spec.actionLabel}: ${answerLabel}` })); });
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "answer", answer: [answerIndex] }));
      unmount();
      document.documentElement.removeAttribute("data-motion");
    }
  });
  it("renders painted play options and retains the action when a painting fails", async () => {
    const send = seed({ kind: "play", cue: "Tea", actionLabel: "Share", participation: "any", options: [{ id: "pour", label: "Pour the tea", icon: "play_pour_tea", reaction: "Warm!" }] });
    render(<StoryInteractionControls />);
    const button = screen.getByRole("button", { name: "Pour the tea" });
    const image = button.querySelector("img")!;
    expect(image.getAttribute("src")).toContain("play_pour_tea");
    expect(image.getAttribute("aria-hidden")).toBe("true");
    fireEvent.error(image);
    await act(async () => { fireEvent.click(button); });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "INTERACT", action: "play", optionId: "pour", openedSeq: 4, attempt: 0 }));
  });
  it("shows an authored tracking target only during the peek or accessibility hint", () => {
    const spec: InteractionSpec = { kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Right"], start: 0, swaps: [[0, 1]], stepMs: 1000 };
    for (const [elapsed, relaxed, visible] of [[0, false, true], [1500, false, false], [3000, false, false], [3000, true, true]] as const) {
      seed(spec, { startedAt: new Date(Date.now() - elapsed).toISOString(), relaxed });
      authoredChapter({ props: ["prop_sun_card"], coverIcons: ["prop_playing_card", "prop_playing_card"] });
      const { container, unmount } = render(<StoryInteractionWorld />);
      expect(container.querySelectorAll(".painted-cover__target")).toHaveLength(visible ? 1 : 0);
      if (visible) {
        fireEvent.error(container.querySelector(".painted-cover__target")!);
        expect(container.querySelector(".painted-cover__glow")).toBeTruthy();
        expect(screen.getByText("Left")).toBeTruthy();
      }
      unmount();
    }
  });
  it("offers final cover positions in relaxed tracking", () => {
    const send = seed({ kind: "tracking", cue: "Watch", actionLabel: "Look under", covers: ["Left", "Middle", "Right"], start: 0, swaps: [[0, 2]], stepMs: 1000 }, { relaxed: true });
    render(<StoryInteractionControls />);
    expect(screen.getByText("The glow waits under: Right.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Look under: Right" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "answer", answer: ["2"] }));
  });
  it("uses one authored visual per moving tracking cover without revealing the answer", () => {
    seed({ kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Middle", "Right"], start: 0, swaps: [[0, 2]], stepMs: 1000 }, { startedAt: new Date(Date.now() - 1500).toISOString() });
    authoredChapter({ coverIcons: ["snow-mound", "relay-sack", "wind-bells"] });
    const { container } = render(<StoryInteractionWorld />);
    expect(container.querySelectorAll(".painted-cover img[alt='']")).toHaveLength(3);
    expect(container.querySelector(".painted-cover__peek")).toBeNull();
    expect(container.querySelector(".painted-cover__glow")).toBeNull();
    expect(screen.getByText("Left")).toBeTruthy();
  });
  it("uses a neutral reveal for authored covers in relaxed mode", () => {
    seed({ kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Right"], start: 0, swaps: [[0, 1]], stepMs: 1000 }, { startedAt: new Date(Date.now() - 3000).toISOString() });
    authoredChapter({ coverIcons: ["snow-mound", "wind-bells"] });
    document.documentElement.setAttribute("data-motion", "reduced");
    render(<StoryInteractionWorld />);
    expect(document.querySelectorAll(".painted-cover__glow")).toHaveLength(1);
    expect(document.querySelector(".painted-cover__peek")).toBeNull();
    expect(screen.getByText("The glow waits under: Right.")).toBeTruthy();
  });
  it("preserves the original Riftlight reveal figures when no cover art is authored", () => {
    const { container, rerender } = render(<PaintedCover bells={false} reveal diving={false} />);
    expect(container.querySelector(".painted-cover__peek")?.getAttribute("src")).toBe("/assets/cast/kid_peeking/assembled.png");
    rerender(<PaintedCover bells={false} reveal diving />);
    expect(container.querySelector(".painted-cover__peek")?.getAttribute("src")).toBe("/assets/cast/kid_burrowing/assembled.png");
  });
  it("keeps a visible fallback cover and labels when custom tracking art fails", () => {
    seed({ kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Right"], start: 0, swaps: [[0, 1]], stepMs: 1000 }, { startedAt: new Date(Date.now() - 3000).toISOString() });
    authoredChapter({ coverIcons: ["snow-mound", "wind-bells"] });
    const { container } = render(<StoryInteractionWorld />);
    fireEvent.error(container.querySelector(".painted-cover__front")!);
    expect(container.querySelector(".painted-cover__fallback")).toBeTruthy();
    expect(screen.getByText("Left")).toBeTruthy();
    expect(container.querySelector(".painted-cover__peek")).toBeNull();
  });
  it.each([
    [{ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "bundle" }, "relay-sack"],
    [{ kind: "balance", cue: "Steady", actionLabel: "Lift", objectLabel: "basket" }, "rope-basket"],
    [{ kind: "cooperate", cue: "Hold", supportLabel: "Hold", actionLabel: "Go" }, "rope-loop"],
    [{ kind: "timing", cue: "Wait", actionLabel: "Jump", target: 0.5, width: 0.3, periodMs: 4000 }, "carved-stone"],
  ] as const)("shows the authored %s prop on the shared display", (spec, id) => {
    seed(spec as InteractionSpec);
    authoredChapter({ props: [id] });
    const { container } = render(<StoryInteractionWorld />);
    expect(container.querySelector(`img[src="/assets/story-props/${id}.webp"]`)).toBeTruthy();
  });
  it("moves the egg basket between two active players as they catch and pass", () => {
    seed({ kind: "relay", cue: "Pass the eggs", actionLabel: "Pass", objectLabel: "basket" }, { phase: "ready", playerIds: ["p", "p2"] });
    const state = useGameStore.getState().state!;
    useGameStore.setState({
      state: { ...state, sceneId: "interaction_egg_baskets", party: [...state.party, { ...state.party[0]!, playerId: "p2" }] },
      chapter: { id: "test", presentation: { interactions: { interaction_egg_baskets: { props: ["prop_egg_basket"] } } } } as never,
    });
    const { container } = render(<StoryInteractionWorld />);
    const basket = () => container.querySelector(".interaction-art__main") as HTMLImageElement;
    const position = () => [basket().style.left, basket().style.top];
    const update = (change: Partial<InteractionPrompt>) => act(() => {
      const current = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...current, prompt: { ...current.prompt as InteractionPrompt, ...change } } });
    });
    expect(position()).toEqual(["70%", "48%"]);
    update({ phase: "active" });
    expect(position()).toEqual(["15%", "35%"]);
    update({ caughtBy: "p" });
    expect(position()).toEqual(["15%", "44%"]);
    update({ passed: ["p"], caughtBy: undefined });
    expect(position()).toEqual(["50%", "35%"]);
    update({ caughtBy: "p2" });
    expect(position()).toEqual(["50%", "44%"]);
    update({ passed: ["p", "p2"], caughtBy: undefined, phase: "result", outcome: "success" });
    expect(basket().style.left).toBe("85%");
  });
  it("preserves catalog-only Riftlight visuals when content has no prop", () => {
    seed({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "bundle" });
    authoredChapter({ props: ["relay-log"] });
    const { container } = render(<StoryInteractionWorld />);
    expect(container.querySelector(`img[src="/assets/story-props/relay-log.webp"]`)).toBeTruthy();
  });
  it("hides a painted interaction image if its asset fails at runtime", () => {
    seed({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "bundle" });
    authoredChapter({ props: ["relay-sack"] });
    const { container } = render(<StoryInteractionWorld />);
    const image = container.querySelector(".interaction-art__main") as HTMLImageElement;
    expect(image).toBeTruthy();
    fireEvent.error(image);
    expect(container.querySelector(".interaction-art__main")).toBeTruthy();
  });
  it("keeps the original text widget when neither content nor catalog art exists", () => {
    seed({ kind: "balance", cue: "Steady", actionLabel: "Lift", objectLabel: "basket" });
    const { container } = render(<StoryInteractionWorld />);
    expect(screen.getByText("basket")).toBeTruthy();
    expect(container.querySelector(".interaction-art")).toBeNull();
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

describe("how a game feels", () => {
  it("fills the wait/now ring as the window comes, and is full inside it", async () => {
    const { approach } = await import("./InteractionExtras");
    expect(approach(0.5, 0.5, 0.3)).toBe(1);
    expect(approach(0.6, 0.5, 0.3)).toBe(1);
    expect(approach(0, 0.5, 0.3)).toBe(0);
    const near = approach(0.3, 0.5, 0.3);
    const far = approach(0.1, 0.5, 0.3);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThan(1);
  });
  it("says Get ready before NOW on a timing board", () => {
    // 6000ms period: position 0.3 at 900ms, just short of a 0.35-0.65 window.
    seed({ kind: "timing", cue: "Wait", actionLabel: "Go", target: 0.5, width: 0.3, periodMs: 6000 }, { startedAt: new Date(Date.now() - 900).toISOString() });
    const { container } = render(<StoryInteractionWorld />);
    expect(container.querySelector(".game-lamp")?.getAttribute("data-soon")).toBe("true");
    expect(screen.getByText("Get ready…")).toBeTruthy();
  });
  it("colours each pattern option the same on the tile and the button", () => {
    seed({ kind: "memory", cue: "Echo", actionLabel: "Send", options: [{ id: "star", label: "Star", icon: "star" }, { id: "leaf", label: "Leaf", icon: "leaf" }], answer: ["leaf", "star"], stepMs: 1000 }, { relaxed: true });
    render(<StoryInteractionControls />);
    expect(screen.getByRole("button", { name: "Leaf" }).getAttribute("data-tone")).toBe("1");
    const tiles = [...document.querySelectorAll(".game-tile[data-tone]")].map((tile) => [tile.textContent?.replace(/\d/g, ""), tile.getAttribute("data-tone")]);
    expect(tiles).toContainEqual(["Leaf", "1"]);
    expect(tiles).toContainEqual(["Star", "0"]);
  });
  it("shows the TV the choices, not empty slots, while the lead builds an order on their phone", () => {
    seed({ kind: "sequence", cue: "Clues", actionLabel: "Try", options: [{ id: "a", label: "Reeds", icon: "eye" }, { id: "b", label: "Shells", icon: "eye" }], answer: ["a", "b"], clues: ["Reeds first", "Shells last"] });
    const { container, unmount } = render(<StoryInteractionWorld />);
    expect(container.querySelector(".game-slot")).toBeNull();
    expect(container.querySelectorAll(".game-row--legend .game-tile")).toHaveLength(2);
    unmount();
    render(<StoryInteractionControls />);
    expect(document.querySelectorAll(".game-slot")).toHaveLength(2);
  });
  it("puts the authored object on the precision marker and on whoever holds the relay", () => {
    seed(precision);
    authoredChapter({ props: ["goat-brush"] });
    const { container, unmount } = render(<StoryInteractionWorld />);
    expect(container.querySelector(".game-track__marker--prop img")?.getAttribute("src")).toBe("/assets/story-props/goat-brush.webp");
    unmount();
    seed({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "the mat" }, { caughtBy: "p" });
    authoredChapter({ props: ["relay-plank"] });
    const relay = render(<StoryInteractionWorld />);
    expect(relay.container.querySelector(".game-hero__token")?.getAttribute("src")).toBe("/assets/story-props/relay-plank.webp");
  });
  it("bursts on a result, and stays still under reduced motion", () => {
    seed(precision, { phase: "result", outcome: "success" });
    const { container, unmount } = render(<StoryInteractionWorld />);
    expect(container.querySelector(".game__burst .celebration--success")).toBeTruthy();
    unmount();
    seed(precision, { phase: "result", outcome: "failure" });
    const miss = render(<StoryInteractionWorld />);
    expect(miss.container.querySelector(".game__burst .celebration--miss")).toBeTruthy();
    miss.unmount();
    document.documentElement.setAttribute("data-motion", "reduced");
    seed(precision, { phase: "result", outcome: "success" });
    const still = render(<StoryInteractionWorld />);
    expect(still.container.querySelector(".game__burst")).toBeNull();
  });
});
