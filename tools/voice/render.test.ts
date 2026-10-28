import { describe, expect, it, vi } from "vitest";
import type { DesiredSegment } from "./desired";
import { renderOwed, type RenderDeps } from "./render";
import { MemoryClipStore } from "./store";

const segment = (n: number, chars = 100): DesiredSegment => ({ key: String(n).padStart(64, "0"), by: "narrator", text: "x".repeat(chars) });
const owed = (count: number, chars = 100): DesiredSegment[] => Array.from({ length: count }, (_, i) => segment(i + 1, chars));

function deps(over: Partial<RenderDeps> = {}) {
  const synth = vi.fn(() => Promise.resolve(Buffer.from("wav")));
  const store = new MemoryClipStore();
  const made: RenderDeps = {
    synth,
    encode: () => ({ bytes: Buffer.from("webm"), ms: 1234 }),
    store,
    price: (chars) => chars / 100, // a dollar per hundred characters
    sleep: () => Promise.resolve(),
    ...over,
  };
  return { made, synth, store };
}

const live = { render: true, maxDollars: 75, backoffMs: 0 };

describe("rendering what is owed", () => {
  it("renders each distinct clip once and keeps it with its length", async () => {
    const { made, synth, store } = deps();
    const report = await renderOwed([...owed(3), segment(1)], made, live);
    expect(synth).toHaveBeenCalledTimes(3);
    expect(report.rendered).toHaveLength(3);
    expect(report.lengths.get(segment(2).key)).toBe(1234);
    expect(store.clips.size).toBe(3);
  });

  it("never renders a clip the store already has: that is the generation cache", async () => {
    const { made, synth } = deps();
    await renderOwed(owed(3), made, live);
    synth.mockClear();
    const again = await renderOwed(owed(3), made, live);
    expect(synth).not.toHaveBeenCalled();
    expect(again.cached).toHaveLength(3);
    expect(again.dollars).toBe(0);
    expect(again.lengths.get(segment(1).key)).toBe(1234);
  });

  it("spends nothing and calls nothing in a dry run, but still prices it", async () => {
    const { made, synth, store } = deps();
    const report = await renderOwed(owed(3), made, { ...live, render: false });
    expect(synth).not.toHaveBeenCalled();
    expect(store.clips.size).toBe(0);
    expect(report.planned).toHaveLength(3);
    expect(report.dollars).toBeCloseTo(3);
  });
});

describe("the spend cap", () => {
  it("stops before the request that would cross it, and says what is left", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(5), made, { ...live, maxDollars: 3.5, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(3);
    expect(report.stoppedBy).toBe("dollars");
    expect(report.dollars).toBeLessThanOrEqual(3.5);
    expect(report.deferred).toHaveLength(2);
  });

  it("cannot be overshot by workers running together", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(20), made, { ...live, maxDollars: 4.5, concurrency: 8 });
    expect(synth.mock.calls.length).toBeLessThanOrEqual(4);
    expect(report.dollars).toBeLessThanOrEqual(4.5);
    expect(report.rendered.length + report.deferred.length).toBe(20);
  });

  it("honours a character cap too", async () => {
    const { made, synth } = deps();
    const report = await renderOwed(owed(5), made, { ...live, maxChars: 250, concurrency: 1 });
    expect(synth).toHaveBeenCalledTimes(2);
    expect(report.stoppedBy).toBe("chars");
  });

  it("does not charge a cached clip against the cap", async () => {
    const { made } = deps();
    await renderOwed(owed(3), made, live);
    const report = await renderOwed(owed(3), made, { ...live, maxDollars: 0 });
    expect(report.cached).toHaveLength(3);
    expect(report.stoppedBy).toBeNull();
  });
});

describe("when the provider fails", () => {
  it("retries, then succeeds", async () => {
    let calls = 0;
    const { made, store } = deps({
      synth: () => (++calls < 3 ? Promise.reject(new Error("HTTP 503")) : Promise.resolve(Buffer.from("wav"))),
    });
    const report = await renderOwed(owed(1), made, live);
    expect(calls).toBe(3);
    expect(report.rendered).toHaveLength(1);
    expect(store.clips.size).toBe(1);
  });

  it("gives up after its attempts, keeps nothing, and hands the reservation back", async () => {
    const { made, store } = deps({ synth: () => Promise.reject(new Error("HTTP 400: bad voice")) });
    const report = await renderOwed(owed(2), made, { ...live, attempts: 2 });
    expect(report.failed).toEqual([
      { key: segment(1).key, error: "HTTP 400: bad voice" },
      { key: segment(2).key, error: "HTTP 400: bad voice" },
    ]);
    expect(store.clips.size).toBe(0);
    expect(report.dollars).toBe(0);
    expect(report.lengths.size).toBe(0);
  });
});
