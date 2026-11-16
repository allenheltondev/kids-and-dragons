// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CampFetch, CampMusic, CampTreasures } from "./CampActivities";
import { CampPlayLayer } from "./CampPlayLayer";
import { useGameStore } from "../store";
import { makeState } from "../testing/fixtures";
import { setAudioSink } from "../audio";
const playCamp = vi.fn(async () => true);
const state = makeState({ phase: "lobby", campMoment: { id: "camp:1", kind: "lobby", outdoor: true, changes: {}, friends: { rotation: ["bun"], out: ["bun"], cards: [{ id: "bun", name: "Bun", figure: "cast/bun" }] } } });
beforeEach(() => { playCamp.mockClear(); useGameStore.setState({ state, campPlays: [], playCamp }); });
afterEach(() => { cleanup(); vi.useRealTimers(); setAudioSink(null); });
it("uses the chosen throw, waits for acceptance, and recovers after a miss", async () => {
  vi.useFakeTimers();
  render(<CampFetch state={state} held={false} />);
  fireEvent.change(screen.getByRole("slider", { name: "Throw direction" }), { target: { value: "10" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Toss the leaf" })); });
  expect(playCamp).toHaveBeenCalledWith({ activity: "fetch", friendId: "bun", aim: 10, strength: 40, target: 70 });
  expect(screen.getByRole("status").textContent).toContain("chewed leaf");
  expect(screen.getByRole("slider", { name: "Throw direction" }).hasAttribute("disabled")).toBe(true);
  act(() => vi.advanceTimersByTime(5000));
  fireEvent.change(screen.getByRole("slider", { name: "Throw direction" }), { target: { value: "30" } });
  fireEvent.change(screen.getByRole("slider", { name: "Throw distance" }), { target: { value: "60" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Toss the leaf" })); });
  expect(screen.getByRole("status").textContent).toContain("perfect toss");
});
it("does not animate or claim success for a rejected toss", async () => {
  playCamp.mockResolvedValueOnce(false);
  const { container } = render(<CampFetch state={state} held={false} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Toss the leaf" })); });
  expect(container.querySelector(".is-playing")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("did not reach camp");
});
it("lets players choose distinct instruments and preserves a bounded phrase", async () => {
  render(<CampMusic held={false} />);
  for (let i = 0; i < 14; i++) await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Cooking pot/ })); });
  expect(playCamp).toHaveBeenLastCalledWith({ activity: "music", instrument: "pot" });
  expect(screen.getByLabelText("Your last notes").children).toHaveLength(12);
});
it("inspects only the crew's collection with its actual source", () => {
  render(<CampTreasures pieces={["find_wagon_lantern", "shop_log_bench"]} sources={{ find_wagon_lantern: "Found in Green Roads North", shop_log_bench: "Bought with Dash Cash" }} />);
  expect(screen.getByRole("status").textContent).toContain("Found in Green Roads North");
  fireEvent.click(screen.getByRole("button", { name: /Log bench/ }));
  expect(screen.getByRole("status").textContent).toContain("Bought with Dash Cash");
  expect(screen.queryByRole("button", { name: /Gemfall trophy/ })).toBeNull();
});
it("sounds each shared note once and discards play when the story begins", () => {
  vi.useFakeTimers();
  const heard: string[] = [];
  setAudioSink({ cue: id => heard.push(id), music: () => undefined });
  render(<CampPlayLayer />);
  const event = { key: 1, runId: state.runId, seq: state.seq, momentId: "camp:1", heroId: "hero", play: { activity: "music" as const, instrument: "bells" as const } };
  act(() => useGameStore.setState({ campPlays: [event] }));
  expect(heard).toEqual(["camp-bells"]);
  act(() => useGameStore.setState({ campPlays: [event] }));
  expect(heard).toHaveLength(1);
  act(() => useGameStore.setState({ state: makeState({ phase: "scene", campMoment: undefined }) }));
  expect(document.querySelector(".camp-play-layer")).toBeNull();
  expect(useGameStore.getState().campPlays).toEqual([]);
  act(() => vi.advanceTimersByTime(5000));
  expect(useGameStore.getState().campPlays).toEqual([]);
});
