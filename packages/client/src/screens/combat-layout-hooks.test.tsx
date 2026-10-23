// @vitest-environment jsdom
/**
 * The dock's two layout hooks, with a ResizeObserver the test drives. jsdom
 * has none, so the combat panel's own tests only ever see the fallback.
 */

import { StrictMode, useRef, type ReactElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMoreBelow, useTallestThisTurn } from "./CombatPanel";

const observers = new Set<FakeResizeObserver>();
class FakeResizeObserver {
  readonly watched = new Set<Element>();
  constructor(private readonly callback: () => void) {
    observers.add(this);
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
    observers.delete(this);
  }
  fire() {
    this.callback();
  }
}
const live = () => [...observers].filter((o) => o.watched.size > 0);

let height = 100;
beforeEach(() => {
  observers.clear();
  height = 100;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ height }) as DOMRect,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Dock({ turn }: { turn: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useTallestThisTurn(ref, turn);
  return <div data-testid="dock" ref={ref} />;
}

describe("useTallestThisTurn", () => {
  it("grows with the dock, never shrinks within a turn, and starts over on the next", () => {
    const { getByTestId, rerender } = render(<Dock turn="a" />);
    const dock = getByTestId("dock");
    expect(dock.style.minBlockSize).toBe("100px");

    height = 140;
    for (const o of live()) o.fire();
    expect(dock.style.minBlockSize).toBe("140px");

    height = 90;
    for (const o of live()) o.fire();
    rerender(<Dock turn="a" />);
    expect(dock.style.minBlockSize).toBe("140px");

    rerender(<Dock turn="b" />);
    expect(dock.style.minBlockSize).toBe("90px");
  });

  it("does not measure again on a render that changed nothing", () => {
    const { rerender } = render(<Dock turn="a" />);
    const measured = vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length;
    for (let i = 0; i < 5; i++) rerender(<Dock turn="a" />);
    expect(vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls.length).toBe(measured);
  });

  it("still watches the dock after Strict Mode's mount, unmount, mount", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Dock turn="a" />
      </StrictMode>,
    );
    expect(live()).toHaveLength(1);
    height = 160;
    for (const o of live()) o.fire();
    expect(getByTestId("dock").style.minBlockSize).toBe("160px");
  });

  it("lets go of the observer on unmount", () => {
    const { unmount } = render(<Dock turn="a" />);
    unmount();
    expect(live()).toHaveLength(0);
  });
});

function Answers({ cards }: { cards: number }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useMoreBelow(ref);
  return (
    <div data-testid="answers" ref={ref}>
      {Array.from({ length: cards }, (_, i) => (
        <span key={i}>card {i}</span>
      ))}
    </div>
  );
}

describe("useMoreBelow", () => {
  it("subscribes once, not on every render, and survives Strict Mode", () => {
    const listen = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const { rerender } = render(
      <StrictMode>
        <Answers cards={2} />
      </StrictMode>,
    );
    const subscribed = listen.mock.calls.length;
    for (let i = 0; i < 5; i++) {
      rerender(
        <StrictMode>
          <Answers cards={2} />
        </StrictMode>,
      );
    }
    expect(listen.mock.calls.length).toBe(subscribed);
    expect(live()).toHaveLength(1);
  });

  it("lets go of everything on unmount", () => {
    const { unmount } = render(<Answers cards={2} />);
    unmount();
    expect(live()).toHaveLength(0);
  });
});
