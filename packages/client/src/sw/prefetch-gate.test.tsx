// @vitest-environment jsdom
/**
 * The scenes ahead are fetched only for a world that is on screen: a layout
 * that keeps the world mounted behind a phone's controls says so, and
 * nothing is fetched until the world is shown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";

const warm = vi.fn(async () => undefined);
vi.mock("./warm", () => ({ warm: (...args: unknown[]) => warm(...(args as [])) }));

const { usePrefetchUpcoming, resetPrefetched } = await import("./prefetch");

function World({ enabled }: { enabled: boolean }) {
  usePrefetchUpcoming(enabled);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPrefetched();
  warm.mockClear();
  const chapter = makeChapter();
  useGameStore.setState({
    chapter,
    state: makeState({ phase: "scene", chapterId: chapter.id, sceneId: chapter.entry, party: [makeMember()] }),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("prefetching the scenes ahead", () => {
  it("fetches nothing for a world mounted out of sight", () => {
    render(<World enabled={false} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(warm).not.toHaveBeenCalled();
  });

  it("fetches once the world is shown", () => {
    const { rerender } = render(<World enabled={false} />);
    act(() => void vi.advanceTimersByTime(10_000));
    rerender(<World enabled />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(warm).toHaveBeenCalledTimes(1);
    expect((warm.mock.calls[0] as unknown[])[0]).toEqual(expect.arrayContaining([expect.stringMatching(/rig\.riv$/)]));
  });
});
