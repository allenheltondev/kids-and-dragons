/**
 * The epilogue a run's campaign end should show right now, or null.
 *
 * Shared by the overlay that shows it (EpiloguePlates) and by the chapter summary, which reads
 * the ending's own words first and holds the rest of what it says until the epilogue is done, so
 * the two always agree on whether one is still to come.
 */

import { useMemo } from "react";
import { endPlates } from "@kad/shared";
import type { StartPlates } from "@kad/shared";
import { useRunState } from "../store";
import { useStoryPlatesSeen, useStoryPlatesUnavailable } from "../store/story-plates-seen";
import { useRunCampaign } from "./run-campaign";

export function useEndPlates(): StartPlates | null {
  const state = useRunState();
  const campaign = useRunCampaign(state?.campaignId ?? null);
  const seen = useStoryPlatesSeen();
  const unavailable = useStoryPlatesUnavailable();
  const complete = state?.phase === "chapter_complete";
  const chapterId = state?.chapterId ?? null;
  const sceneId = state?.sceneId ?? null;
  const ended = state?.campaign?.ended;
  return useMemo(() => {
    if (!complete || !campaign) return null;
    const picked = endPlates(campaign, chapterId, sceneId, ended);
    if (picked === null || seen.has(picked.key) || unavailable.has(picked.key)) return null;
    return picked;
  }, [complete, campaign, chapterId, sceneId, ended, seen, unavailable]);
}
