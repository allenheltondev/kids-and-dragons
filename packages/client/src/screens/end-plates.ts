/**
 * The epilogue a run's campaign end should show right now, or null.
 *
 * Shared by the overlay that shows it (EpiloguePlates) and by the chapter summary, which reads
 * the ending's own words first and holds the rest of what it says until the epilogue is done, so
 * the two always agree on whether one is still to come.
 *
 * "None" and "not known yet" are different answers. A run in a campaign the store did not launch
 * has its file fetched (run-campaign.ts), and until it lands nobody can say whether an epilogue
 * follows; the summary must not speak its tally into that gap and have the epilogue come after
 * it. So the answer is `pending` while the file is out, for at most CAMPAIGN_WAIT_MS, and then
 * whatever is known.
 */

import { useEffect, useMemo, useState } from "react";
import { endPlates } from "@kad/shared";
import type { StartPlates } from "@kad/shared";
import { useRunState } from "../store";
import { useStoryPlatesSeen, useStoryPlatesUnavailable } from "../store/story-plates-seen";
import { useRunCampaign } from "./run-campaign";

/** How long the end of a campaign waits on its campaign file before it stops waiting for an epilogue. */
export const CAMPAIGN_WAIT_MS = 4000;

export interface EndPlatesStatus {
  /** The epilogue still to show on this device, or null. */
  due: StartPlates | null;
  /** True while it cannot be known yet whether one is due: the campaign file is still on its way. */
  pending: boolean;
}

export function useEndPlatesStatus(): EndPlatesStatus {
  const state = useRunState();
  const campaign = useRunCampaign(state?.campaignId ?? null);
  const seen = useStoryPlatesSeen();
  const unavailable = useStoryPlatesUnavailable();
  const complete = state?.phase === "chapter_complete";
  const chapterId = state?.chapterId ?? null;
  const sceneId = state?.sceneId ?? null;
  const ended = state?.campaign?.ended;
  // Only an ending that ends the campaign can have an epilogue, so only it waits on the file.
  const waiting = complete && ended !== undefined && campaign === undefined;
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    setGaveUp(false);
    const timer = setTimeout(() => setGaveUp(true), CAMPAIGN_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  const due = useMemo(() => {
    if (!complete || !campaign) return null;
    const picked = endPlates(campaign, chapterId, sceneId, ended);
    if (picked === null || seen.has(picked.key) || unavailable.has(picked.key)) return null;
    return picked;
  }, [complete, campaign, chapterId, sceneId, ended, seen, unavailable]);
  return { due, pending: waiting && !gaveUp };
}

export function useEndPlates(): StartPlates | null {
  return useEndPlatesStatus().due;
}
