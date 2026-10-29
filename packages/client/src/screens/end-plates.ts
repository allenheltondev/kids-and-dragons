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
 *
 * Giving up is final for that completion. Once the wait has run out the summary has said its
 * tally, so an epilogue the file reveals a moment later would play after it: the very order this
 * exists to prevent. That completion goes without (unremembered, so the next one still gets it).
 */

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { endPlates } from "@kad/shared";
import type { StartPlates } from "@kad/shared";
import { useRunState } from "../store";
import { useStoryPlatesSeen, useStoryPlatesUnavailable } from "../store/story-plates-seen";
import { useRunCampaign } from "./run-campaign";

/** How long the end of a campaign waits on its campaign file before it stops waiting for an epilogue. */
export const CAMPAIGN_WAIT_MS = 4000;

/*
 * The completion the wait gave up on, shared, so the summary and the epilogue overlay (and any
 * pane that mounts later) agree that it goes without: one of them deciding alone could let the
 * other play an epilogue the summary has already spoken past.
 */
const useGaveUp = create<{ on: string | null }>(() => ({ on: null }));

/** Tests: forget a give-up. */
export function resetEndPlatesWait(): void {
  useGaveUp.setState({ on: null });
}

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
  // Which completion this is, so a give-up belongs to it and to no later one.
  const completion = complete ? `${state?.runId ?? ""}|${chapterId ?? ""}|${sceneId ?? ""}` : null;
  // Only an ending that ends the campaign can have an epilogue, so only it waits on the file.
  const waiting = complete && ended !== undefined && campaign === undefined;
  const gaveUpOn = useGaveUp((s) => s.on);
  useEffect(() => {
    if (!waiting || completion === null) return;
    const timer = setTimeout(() => useGaveUp.setState({ on: completion }), CAMPAIGN_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, completion]);
  const gaveUp = completion !== null && gaveUpOn === completion;
  const due = useMemo(() => {
    if (!complete || !campaign || gaveUp) return null;
    const picked = endPlates(campaign, chapterId, sceneId, ended);
    if (picked === null || seen.has(picked.key) || unavailable.has(picked.key)) return null;
    return picked;
  }, [complete, campaign, gaveUp, chapterId, sceneId, ended, seen, unavailable]);
  return { due, pending: waiting && !gaveUp };
}

export function useEndPlates(): StartPlates | null {
  return useEndPlatesStatus().due;
}
