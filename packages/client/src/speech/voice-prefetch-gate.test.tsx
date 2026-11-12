// @vitest-environment jsdom
/**
 * The narration ahead is asked for only by a world that is on screen, the scene the party is in
 * and the scenes after it as the story moves, and the rest of the chapter only by the shared screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { resetPrefetchRequests, setSpeaker } from "@kad/shared";
import type { PrefetchOptions, Speaker } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures";
import { makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { useVoicePrefetch } from "./voice-prefetch";

let asked: [readonly string[], PrefetchOptions | undefined][] = [];
/** Every prefetch call and every retirement, in order. */
let log: string[] = [];

function World({ enabled, display }: { enabled: boolean; display: boolean }) {
  useVoicePrefetch(enabled, display);
  return null;
}

beforeEach(() => {
  asked = [];
  log = [];
  const speaker = (() => undefined) as unknown as Speaker;
  speaker.prefetch = (prefixes, opts) => {
    asked.push([prefixes, opts]);
    log.push(opts?.background ? "background" : "near");
  };
  speaker.stopPrefetch = () => void log.push("stop");
  setSpeaker(speaker);
  const chapter = makeChapter();
  useGameStore.setState({
    chapter,
    state: makeState({ phase: "scene", chapterId: chapter.id, sceneId: chapter.entry, party: [makeMember()] }),
  });
});

afterEach(() => {
  cleanup();
  setSpeaker(null);
  resetPrefetchRequests();
});

describe("prefetching the narration ahead", () => {
  it("asks for nothing from a world mounted out of sight", () => {
    render(<World enabled={false} display />);
    expect(asked).toEqual([]);
  });

  it("asks for the chapter's start, then the scenes ahead as the story moves", () => {
    const chapter = useGameStore.getState().chapter!;
    render(<World enabled display={false} />);
    expect(asked).toHaveLength(1);
    expect(asked[0]![0]).toEqual(expect.arrayContaining([`${chapter.id}/@goal`, `${chapter.id}/${chapter.entry}/`]));
    expect(asked[0]![1]).toBeUndefined();

    const next = Object.keys(chapter.scenes).find((id) => id !== chapter.entry)!;
    act(() => useGameStore.setState({ state: makeState({ phase: "scene", chapterId: chapter.id, sceneId: next, party: [makeMember()] }) }));
    expect(asked).toHaveLength(2);
    expect(asked[1]![0]).toContain(`${chapter.id}/${next}/`);
    expect(asked[1]![0]).not.toContain(`${chapter.id}/@goal`);
  });

  it("takes the rest of the chapter too, in the background, on the shared screen only", () => {
    const chapter = useGameStore.getState().chapter!;
    const { unmount } = render(<World enabled display />);
    expect(asked.filter(([, opts]) => opts?.background)).toEqual([[[`${chapter.id}/`], { background: true }]]);
    unmount();

    asked = [];
    render(<World enabled display={false} />);
    expect(asked.filter(([, opts]) => opts?.background)).toEqual([]);
  });

  it("retires the old chapter's queue before asking for the new chapter's, and for no scene change", () => {
    const first = useGameStore.getState().chapter!;
    render(<World enabled display />);
    log.length = 0;
    // A scene change within the chapter leaves what is queued alone.
    const next = Object.keys(first.scenes).find((id) => id !== first.entry)!;
    act(() => useGameStore.setState({ state: makeState({ phase: "scene", chapterId: first.id, sceneId: next, party: [makeMember()] }) }));
    expect(log).toEqual(["near"]);

    // A new chapter: everything queued for the last one goes, then the new one is asked for.
    const second = { ...makeChapter(), id: "chapter-two" };
    log.length = 0;
    act(() =>
      useGameStore.setState({
        chapter: second,
        state: makeState({ phase: "scene", chapterId: second.id, sceneId: second.entry, party: [makeMember()] }),
      }),
    );
    expect(log).toEqual(["stop", "near", "background"]);
    expect(asked.at(-1)).toEqual([["chapter-two/"], { background: true }]);
  });

  it("retires its queue when the world leaves the screen, and when it unmounts", () => {
    const { rerender, unmount } = render(<World enabled display />);
    log.length = 0;
    rerender(<World enabled={false} display />);
    expect(log).toEqual(["stop"]);
    rerender(<World enabled display />);
    log.length = 0;
    unmount();
    expect(log).toEqual(["stop"]);
  });

  it("asks again when a hidden page is seen again, since hiding dropped what was queued", () => {
    const chapter = useGameStore.getState().chapter!;
    let state: "hidden" | "visible" = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    render(<World enabled display />);
    log.length = 0;
    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(log).toEqual([]);
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(log).toEqual(["near", "background"]);
    expect(asked.at(-1)).toEqual([[`${chapter.id}/`], { background: true }]);
  });
});
