/**
 * What the screens say about the campaign as a whole — one place, so the
 * television and the phones never disagree about whether it just ended.
 *
 * Everything here reads `RunState.campaign`, which the server computes from the
 * household's attempt; the client cannot know where the party got to, or that
 * the chapter it just finished was the campaign's last.
 *
 * A failed campaign is worded the way a setback is (spec §8.3): an ending, with
 * a souvenir, never a loss screen.
 */

import type { CampaignView } from "@kad/shared";

/** "Chapter 4 of 8: The Pride Roads", or null when there is nothing to name. */
export function nextChapterLine(view: CampaignView | null | undefined): string | null {
  if (!view?.next) return null;
  return `Chapter ${String(view.next.index)} of ${String(view.chapters)}: ${view.next.title}`;
}

/** The lobby's go button. Beginning, continuing, or beginning again. */
export function beginLabel(view: CampaignView | null | undefined): string {
  if (view?.ended) return `Start ${view.title} again`;
  if (!view?.next || view.next.index === 1) return "Begin the adventure";
  return `Play chapter ${String(view.next.index)}`;
}

/** The completion heading when this chapter ended the whole campaign, else null. */
export function campaignEndHeading(view: CampaignView | null | undefined): string | null {
  if (view?.ended === "complete") return `${view.title} is complete!`;
  if (view?.ended === "failed") return `The end of ${view.title}`;
  return null;
}

/** The line under that heading — what the ending means for the characters. */
export function campaignEndLine(view: CampaignView | null | undefined): string | null {
  if (view?.ended === "complete") {
    return "Your heroes keep everything they earned, for good.";
  }
  if (view?.ended === "failed") {
    return "This time the road ran out. Everyone goes back to how they began, and keeps a souvenir to remember it by.";
  }
  return null;
}
