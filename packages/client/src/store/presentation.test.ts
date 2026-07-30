/**
 * The delivery rules behind `usePresentation`, tested through its extracted
 * core `watchPresentation` (no DOM in this test environment).
 *
 * The regression this pins down: the ROLL that summons the dice overlay — or
 * the LEVEL_UP whose patch flips the phase to chapter_complete — is written to
 * the store *before* the surface it summons has mounted and subscribed. The
 * old implementation seeded its watermark from the store at subscribe time,
 * which marked exactly that event as already seen: the overlay mounted for a
 * roll it would never show. An event that arrived before mount must be
 * delivered once — and never twice, however many times React 19 strict mode
 * resubscribes.
 */

import { describe, expect, it, vi } from "vitest";
import type { PresentationEvent } from "./contract";
import { watchPresentation } from "./index";

function fakeSource() {
  let presentation: PresentationEvent | null = null;
  const listeners = new Set<(state: { presentation: PresentationEvent | null }) => void>();
  return {
    getState: () => ({ presentation }),
    subscribe(listener: (state: { presentation: PresentationEvent | null }) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit(event: PresentationEvent) {
      presentation = event;
      for (const listener of [...listeners]) listener({ presentation });
    },
  };
}

const ROLL: PresentationEvent = {
  seq: 2,
  presentation: {
    kind: "ROLL",
    roll: { die: 17, mod: 3, total: 20, tn: 14, result: "success", characterId: "c_1" },
  },
};

describe("watchPresentation", () => {
  it("delivers an event that arrived before mount — once, and never twice", () => {
    const source = fakeSource();
    const handler = vi.fn();
    const watermark = { current: 0 };

    // The ROLL lands first; the overlay it summons subscribes second.
    source.emit(ROLL);
    const unsubscribe = watchPresentation(source, "ROLL", watermark, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ROLL.presentation, ROLL);

    // Strict mode: unsubscribe and resubscribe with the same instance
    // watermark. The event was handled; it must not replay.
    unsubscribe();
    watchPresentation(source, "ROLL", watermark, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("replays nothing on a fresh store — a refresh must not replay a roll", () => {
    const source = fakeSource();
    const handler = vi.fn();

    watchPresentation(source, "ROLL", { current: 0 }, handler);

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers events that arrive while subscribed, dedupes on seq", () => {
    const source = fakeSource();
    const handler = vi.fn();
    watchPresentation(source, "ROLL", { current: 0 }, handler);

    source.emit(ROLL);
    source.emit(ROLL); // the same seq again (strict-mode double set)
    source.emit({ ...ROLL, seq: 3 });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("filters on kind but still advances past other kinds", () => {
    const source = fakeSource();
    const handler = vi.fn();
    const watermark = { current: 0 };
    watchPresentation(source, "ROLL", watermark, handler);

    source.emit({ seq: 5, presentation: { kind: "DOWN", targetId: "c_1" } });

    expect(handler).not.toHaveBeenCalled();
    // The DOWN was seen: a resubscribe must not hand it to a DOWN watcher
    // sharing this instance's watermark, nor stall the watermark behind it.
    expect(watermark.current).toBe(5);
  });

  it("delivers the two halves of a chapter-complete fanfare to a panel that mounts between them", () => {
    // LEVEL_UP arrives (and flips the phase, mounting the panel)…
    const source = fakeSource();
    const leveled = vi.fn();
    const transformed = vi.fn();
    source.emit({ seq: 7, presentation: { kind: "LEVEL_UP", characterId: "c_1", level: 2 } });

    // …the panel mounts and subscribes to both kinds…
    watchPresentation(source, "LEVEL_UP", { current: 0 }, leveled);
    watchPresentation(source, "TRANSFORM", { current: 0 }, transformed);
    expect(leveled).toHaveBeenCalledTimes(1);

    // …and the TRANSFORM that follows still lands.
    source.emit({ seq: 8, presentation: { kind: "TRANSFORM", characterId: "c_1", tier: "wild" } });
    expect(transformed).toHaveBeenCalledTimes(1);
    expect(leveled).toHaveBeenCalledTimes(1);
  });
});
