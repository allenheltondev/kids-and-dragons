// @vitest-environment jsdom
/**
 * Sound belongs to the page being seen: a backgrounded app, a switched tab or a
 * TV browser left on another input must go quiet, not play on until the app is
 * force-closed.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createAudioEngine, type PrefStore } from "./engine";

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}
class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeContext {
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  resumes = 0;
  suspends = 0;
  createGain(): FakeGain {
    return new FakeGain();
  }
  resume(): Promise<void> {
    this.resumes += 1;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const emptyStore: PrefStore = { getItem: () => null, setItem: () => undefined };

function build(): { engine: ReturnType<typeof createAudioEngine>; context: FakeContext } {
  const context = new FakeContext();
  const engine = createAudioEngine({
    createContext: () => context as unknown as BaseAudioContext,
    storage: emptyStore,
    samples: () => ({
      preload: () => undefined,
      cue: () => null,
      music: () => null,
      wantMusic: () => undefined,
    }) as never,
  });
  return { engine, context };
}

function show(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => show("visible"));

describe("the page going to the background", () => {
  it("suspends the context while the page is hidden and resumes it when shown again", () => {
    const { engine, context } = build();
    engine.unlock();
    const resumed = context.resumes;
    show("hidden");
    expect(context.suspends).toBe(1);
    show("visible");
    expect(context.resumes).toBe(resumed + 1);
    engine.dispose();
  });

  it("does not wake the context for a gesture while the page is hidden", () => {
    const { engine, context } = build();
    engine.unlock();
    show("hidden");
    const resumed = context.resumes;
    engine.unlock();
    expect(context.resumes).toBe(resumed);
    engine.dispose();
  });

  it("stops listening once disposed", () => {
    const { engine, context } = build();
    engine.unlock();
    engine.dispose();
    show("hidden");
    expect(context.suspends).toBe(0);
  });
});
