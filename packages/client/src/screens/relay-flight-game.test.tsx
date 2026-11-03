// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { relayStart, type InteractionPrompt } from "@kad/shared";
import { RelayFlightCatcher } from "./RelayFlightGame";

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute("data-motion"); });
const start = 2_000_000;
function game(caught = false) {
  const prompt: InteractionPrompt = { kind: "interaction", sceneId: "relay", openedSeq: 1, attempt: 0, playerIds: ["p0", "p1"], actorId: "p0", phase: "active", relaxed: false, supports: {},
    spec: { kind: "relay", cue: "Deliver it", actionLabel: "Pass", objectLabel: "the spark" },
    relay: relayStart(new Date(start).toISOString()), ...(caught ? { caughtBy: "p0" } : {}) };
  const onCatch = vi.fn(async () => true), onPass = vi.fn(async () => true);
  const props = { prompt, playerId: "p0", now: start + 1500, nextName: "Fern", busy: false, onCatch, onPass };
  const view = render(<RelayFlightCatcher {...props} />);
  const stage = screen.getByRole("button", { name: caught ? "Throw the spark" : "Catch the spark" });
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 320, width: 300, height: 320, toJSON() {} });
  return { ...view, props, stage, onCatch, onPass };
}

it("measures the catch at finger-down using the displayed flight and horizontal reach", async () => {
  const { stage, onCatch, onPass } = game();
  await act(async () => { fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 120, clientY: 220 }); });
  fireEvent.pointerUp(stage, { pointerId: 1 });
  fireEvent.click(stage, { detail: 1 });
  expect(onCatch).toHaveBeenCalledTimes(1);
  expect(onCatch).toHaveBeenCalledWith({ flightId: 0, position: 1500 / 1924, reach: 0.4 });
  expect(onPass).not.toHaveBeenCalled();
});

it("measures direction and strength from the released swipe instead of sending a guaranteed pass", async () => {
  const { stage, onPass } = game(true);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 150, clientY: 250 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 216, clientY: 107 });
  expect(onPass).not.toHaveBeenCalled();
  await act(async () => { fireEvent.pointerUp(stage, { pointerId: 1, clientX: 216, clientY: 107 }); });
  expect(onPass).toHaveBeenCalledWith({ flightId: 0, aim: 0.44, power: 143 / 224 });
  fireEvent.click(stage, { detail: 1 });
  expect(onPass).toHaveBeenCalledTimes(1);
});

it.each(["tap", "cancel", "blur", "other finger", "sideways"])("does not throw after %s", async (mode) => {
  const { stage, onPass } = game(true);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 150, clientY: 250 });
  if (mode === "cancel") fireEvent.pointerCancel(stage, { pointerId: 1 });
  if (mode === "blur") fireEvent.blur(stage);
  await act(async () => { fireEvent.pointerUp(stage, { pointerId: mode === "other finger" ? 2 : 1, clientX: 216, clientY: mode === "tap" || mode === "sideways" ? 250 : 107 }); });
  fireEvent.click(stage, { detail: 1 });
  expect(onPass).not.toHaveBeenCalled();
});

it("lets keyboard players aim and choose strength, and returns a rejected throw for retry", async () => {
  const { onPass } = game(true);
  onPass.mockResolvedValueOnce(false);
  fireEvent.change(screen.getByRole("slider", { name: "Direction" }), { target: { value: "-0.8" } });
  fireEvent.change(screen.getByRole("slider", { name: "Strength" }), { target: { value: "0.2" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Throw to Fern" })); });
  expect(onPass).toHaveBeenCalledWith({ flightId: 0, aim: -0.8, power: 0.2 });
  expect(screen.getByText("That move did not arrive. Try again.")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Throw to Fern" })); });
  expect(onPass).toHaveBeenCalledTimes(2);
});

it("keeps reduced-motion catches stationary and untimed, with the aim controls open", async () => {
  document.documentElement.setAttribute("data-motion", "reduced");
  const { onCatch, container } = game();
  expect(container.querySelector("details")?.open).toBe(true);
  expect((container.querySelector(".relay-skill__object") as HTMLElement).style.top).toBe("68%");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Catch with a button" })); });
  expect(onCatch).toHaveBeenCalledWith({ flightId: 0, position: 0.82, reach: 0.5 });
});
