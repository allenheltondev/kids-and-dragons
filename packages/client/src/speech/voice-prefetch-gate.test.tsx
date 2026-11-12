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

function World({ enabled, display }: { enabled: boolean; display: boolean }) {
  useVoicePrefetch(enabled, display);
  return null;
}

beforeEach(() => {
  asked = [];
  const speaker = (() => undefined) as unknown as Speaker;
  speaker.prefetch = (prefixes, opts) => void asked.push([prefixes, opts]);
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
});
