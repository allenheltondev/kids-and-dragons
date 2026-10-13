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

import type { CampaignView, RunState } from "@kad/shared";

/** "Chapter 4 of 8: The Pride Roads", or null when there is nothing to name. */
export function nextChapterLine(view: CampaignView | null | undefined): string | null {
  if (!view?.next) return null;
  return `Chapter ${String(view.next.index)} of ${String(view.chapters)}: ${view.next.title}`;
}

/**
 * "Chapter 1 of 8 · The City That Smelled Opportunity" — what heads every
 * scene on the shared screen. Null for a run persisted before chapter titles
 * rode on the state; the caller falls back to the file id.
 */
export function chapterHeading(
  state: Pick<RunState, "chapterInfo" | "campaign"> | null | undefined,
): string | null {
  const info = state?.chapterInfo;
  if (!info) return null;
  const total = state?.campaign?.chapters;
  const number = total ? `Chapter ${String(info.index)} of ${String(total)}` : `Chapter ${String(info.index)}`;
  return `${number} · ${info.title}`;
}

/**
 * The campaign's premise, for a table about to start it from the beginning —
 * and only then. A party coming back for chapter 4 knows what Gemfall is; a
 * party that has never played needs telling before the first scene drops them
 * into the middle of it.
 *
 * Not for a table that has just finished it. `ended` is only ever set on the
 * room that played the last chapter, whose party is still seated and has just
 * lived the story; a new room starting the campaign over has no `ended` and
 * gets the premise through `next.index === 1` like any first evening.
 */
export function campaignPremise(view: CampaignView | null | undefined): string | null {
  if (!view?.blurb || view.ended !== undefined) return null;
  // Chapter 1 and nothing else. `next: null` is a routed fork nobody has
  // chosen yet, which only happens past the first beat; a fresh attempt
  // always resolves chapter 1.
  return view.next?.index === 1 ? view.blurb : null;
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
