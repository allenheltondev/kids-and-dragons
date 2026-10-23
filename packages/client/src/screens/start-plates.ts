/**
 * The story plates a run's chapter start should show right now, or null.
 *
 * Shared by the overlay that shows them (StoryPlates) and by `useStartPreface`, which holds
 * "Last time…" and the first scene's read-aloud behind them, so the two always agree on whether
 * a painting is up.
 */

import { useMemo } from "react";
import { startPlates } from "@kad/shared";
import type { StartPlates } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import { useStoryPlatesSeen, useStoryPlatesUnavailable } from "../store/story-plates-seen";
import { atChapterStart, useRunCampaign } from "./run-campaign";

export function useStartPlates(): StartPlates | null {
  const state = useRunState();
  const chapter = useChapter();
  const campaign = useRunCampaign(state?.campaignId ?? null);
  const seen = useStoryPlatesSeen();
  const unavailable = useStoryPlatesUnavailable();
  const atStart = state !== null && atChapterStart(state);
  const sceneId = state?.sceneId ?? null;
  return useMemo(() => {
    // A playtest jump, or a chapter that opens somewhere other than its entry, is not a start.
    if (!atStart || !campaign || !chapter || chapter.id !== state?.chapterId || chapter.entry !== sceneId) return null;
    const picked = startPlates(campaign, chapter);
    if (picked === null || seen.has(picked.key) || unavailable.has(picked.key)) return null;
    return picked;
    // `state` is read only for its chapter id, which `atStart` and `sceneId` already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atStart, campaign, chapter, sceneId, seen, unavailable, state?.chapterId]);
}
