// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, HOLD_SLOP_PX, helpAttrs, installLongPress } from "./longpress";

function press(target: Element, type: string, at: { x: number; y: number } = { x: 10, y: 10 }): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  target.dispatchEvent(event);
}

describe("press and hold", () => {
  let card: HTMLButtonElement;
  let list: HTMLUListElement;
  const held = vi.fn();
  const tapped = vi.fn();
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    held.mockClear();
    tapped.mockClear();
    document.body.innerHTML = '<ul id="list"><li><button id="card">Brace</button></li></ul>';
    list = document.getElementById("list") as HTMLUListElement;
    card = document.getElementById("card") as HTMLButtonElement;
    for (const [name, value] of Object.entries(helpAttrs({ kind: "card", name: "Brace", text: "Stand guard.", icon: "shield" }))) card.setAttribute(name, value);
    card.addEventListener("click", tapped);
    stop = installLongPress(held);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("shows what a card does after a hold, and does not also play it", () => {
    press(card, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toHaveBeenCalledWith({ kind: "card", name: "Brace", text: "Stand guard.", icon: "shield" });
    press(card, "pointerup");
    card.click();
    expect(tapped).not.toHaveBeenCalled();
    // The swallow is once: the next tap is a tap.
    card.click();
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("leaves a tap alone", () => {
    press(card, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS - 50);
    press(card, "pointerup");
    card.click();
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).not.toHaveBeenCalled();
    expect(tapped).toHaveBeenCalledTimes(1);
  });

  it("lets a finger that scrolls go: a drift, or the browser taking the gesture, cancels the hold", () => {
    press(card, "pointerdown");
    press(card, "pointermove", { x: 10, y: 10 + HOLD_SLOP_PX + 1 });
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(held).not.toHaveBeenCalled();

    press(card, "pointerdown");
    press(card, "pointercancel");
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(held).not.toHaveBeenCalled();
  });

  it("forgives a finger that wobbles inside the slop", () => {
    press(card, "pointerdown");
    press(card, "pointermove", { x: 12, y: 13 });
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("never stops a pointer or touch event, so scrolling is the browser's", () => {
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    card.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    const move = new MouseEvent("pointermove", { bubbles: true, cancelable: true });
    list.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
  });

  it("ignores things that are not held, and the right mouse button", () => {
    const plain = document.createElement("button");
    list.append(plain);
    press(plain, "pointerdown");
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).not.toHaveBeenCalled();

    const right = new MouseEvent("pointerdown", { bubbles: true, button: 2 });
    Object.defineProperty(right, "pointerType", { value: "mouse" });
    card.dispatchEvent(right);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).not.toHaveBeenCalled();
  });

  it("swaps the browser's long-press menu for the sheet", () => {
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    card.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });
});
