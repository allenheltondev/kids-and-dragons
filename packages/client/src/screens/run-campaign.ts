/**
 * The campaign a run is in, and whether it stands at its chapter's first scene.
 *
 * Shared by the chapter's start screens: "Last time…" (ChapterPreface) and the story plates
 * (StoryPlates). Both read the same two facts, so they live in one place.
 */

import { useEffect, useReducer } from "react";
import type { Campaign, RunState } from "@kad/shared";
import { useCampaign } from "../store";

/*
 * The campaign in play. The store holds the one the lobby launches; a run in another (a
 * campaign the household picked from the shelf) has its file fetched here once and kept.
 * Undefined while that fetch is out; null when there is no campaign or it cannot be had.
 */
const campaigns = new Map<string, Campaign | null>();
const fetching = new Map<string, Promise<void>>();

function fetchCampaign(id: string): Promise<void> {
  let task = fetching.get(id);
  if (!task) {
    task = fetch(`/content/campaigns/${encodeURIComponent(id)}.json`)
      .then((response) => (response.ok ? (response.json() as Promise<Campaign>) : null))
      .catch(() => null)
      .then((campaign) => {
        campaigns.set(id, campaign);
      });
    fetching.set(id, task);
  }
  return task;
}

/** Test seam: forget fetched campaigns. */
export function resetPrefaceCampaigns(): void {
  campaigns.clear();
  fetching.clear();
}

export function useRunCampaign(id: string | null): Campaign | null | undefined {
  const launched = useCampaign();
  const [, fetched] = useReducer((n: number) => n + 1, 0);
  const ours = id !== null && launched?.id === id;
  useEffect(() => {
    if (id === null || ours || campaigns.has(id)) return;
    let live = true;
    void fetchCampaign(id).then(() => {
      if (live) fetched();
    });
    return () => {
      live = false;
    };
  }, [id, ours]);
  if (id === null) return null;
  if (ours) return launched;
  return campaigns.has(id) ? campaigns.get(id)! : undefined;
}

/**
 * A run standing in its chapter's first scene, before anything has happened: the trail holds
 * that scene alone. A run saved before the trail existed has none, and is never a start.
 */
export function atChapterStart(state: RunState): boolean {
  return (
    state.chapterId !== null &&
    state.sceneId !== null &&
    (state.phase === "scene" || state.phase === "check") &&
    state.encounter == null &&
    (state.visited ?? []).length === 1
  );
}
