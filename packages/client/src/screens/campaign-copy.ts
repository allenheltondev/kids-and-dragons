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

import type { CampaignView, JourneyExitView, JourneyRiftActionView, JourneyView, RunState } from "@kad/shared";

/** "Chapter 4: The Pride Roads", or null when there is nothing to name. */
export function nextChapterLine(view: CampaignView | null | undefined): string | null {
  if (!view?.next) return null;
  return `Chapter ${String(view.next.index)}: ${view.next.title}`;
}

/**
 * "Chapter 1 · The City That Smelled Opportunity" — what heads every
 * scene on the shared screen. Null for a run persisted before chapter titles
 * rode on the state; the caller falls back to the file id.
 */
export function chapterHeading(
  state: Pick<RunState, "chapterInfo" | "campaign"> | null | undefined,
): string | null {
  const info = state?.chapterInfo;
  if (!info) return null;
  const number = `Chapter ${String(info.index)}`;
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

/**
 * Why the household cannot start this campaign yet ("Finish Gemfall first"),
 * or null when it can (#221). The server writes the sentence from the required
 * campaigns' titles; the screens only show it, and offer no way to start.
 */
export function lockedLine(view: CampaignView | null | undefined): string | null {
  return view?.locked?.reason ?? null;
}

/**
 * The line under a campaign in the lobby's "which adventure?" vote: where this
 * household would pick it up, or that it would be a fresh start.
 */
export function campaignOptionLine(view: CampaignView): string {
  if (view.locked) return view.locked.reason;
  // `next: null` is a routed fork nobody has chosen yet — only ever past
  // chapter 1, so the campaign is under way.
  if (!view.next) return "Pick up where you left off";
  if (view.next.index === 1) return view.ended ? "Start it again" : "A new adventure";
  return `Pick up at chapter ${String(view.next.index)} of ${String(view.chapters)}`;
}

/** The lobby's go button. Beginning, continuing, or beginning again. */
export function beginLabel(view: CampaignView | null | undefined): string {
  if (view?.ended) return `Start ${view.title} again`;
  if (!view?.next || view.next.index === 1) return "Begin the adventure";
  return `Play chapter ${String(view.next.index)}`;
}

/**
 * The lobby's practice offer (#255), for the heroes new to the game. Names,
 * never a count: "Rue is new here." / "Rue and Bo are new here."
 */
export function practiceOfferLine(names: readonly string[]): string {
  const who =
    names.length <= 1 ? (names[0] ?? "Somebody") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `${who} ${names.length > 1 ? "are" : "is"} new here. Play a short practice together first, or skip it.`;
}

/**
 * Begin, while the practice is on offer: the same tap, said as the skip it
 * is. "Skip the practice and begin the adventure".
 */
export function skipPracticeLabel(view: CampaignView | null | undefined): string {
  const begin = beginLabel(view);
  return `Skip the practice and ${begin.charAt(0).toLowerCase()}${begin.slice(1)}`;
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

// ---------------------------------------------------------------------------
// Graph campaigns (#195) - the journey's words
//
// Everything below reads `CampaignView.journey`, which exists only for a graph
// campaign. Ordered campaigns never reach it (the callers test `journey`
// first), so none of this can change what Gemfall says.
// ---------------------------------------------------------------------------

/** How a way is introduced: the author's `kind`, in a child's words. */
export function exitKindLabel(kind: JourneyExitView["kind"]): string {
  switch (kind) {
    case "forward":
      return "Onward";
    case "sideways":
      return "Side trip";
    case "return":
      return "Head back";
  }
}

/**
 * Why a shown-but-blocked way cannot be taken, without saying what would open
 * it - "something has to happen first" is a nudge, not a spoiler. Unknown
 * reasons (a later build may add some, as rifts will) get the plainest
 * sentence, so an old client never shows a raw code.
 */
export function exitBlockedLine(reason: JourneyExitView["reason"] | undefined): string {
  switch (reason) {
    case "locked":
      return "It's shut tight for now.";
    case "spent":
      return "You've already used this way.";
    case "closed":
      return "That place is finished, so there's no going back in.";
    case "guard":
      return "Not yet. Something has to happen first.";
    // Rifts (#196, #197): what the shimmer is doing, in a child's words. Never
    // the word "rift" in a reason (the chips already say what it is), and
    // never what would wake it.
    case "rift-dormant":
      return "It hasn't woken up yet.";
    case "rift-faded":
      return "It has faded for now. It might come back.";
    case "rift-closed":
      return "It has been shut.";
    case "rift-consumed":
      return "It's all used up.";
    case "rift-expired":
      return "It faded away for good.";
    case "rift-collapsed":
      return "It crumbled away.";
    case "fallback":
      return "There's another way open right now.";
    default:
      return "You can't go this way right now.";
  }
}

/** The icon on a rift action's button (#197) - icon + words, never the icon alone. */
export function riftActionIcon(action: JourneyRiftActionView["action"]): string {
  switch (action) {
    case "discover":
      return "eye";
    case "open":
      return "key";
    case "close":
      return "close";
    case "stabilize":
      return "shield";
    case "redirect":
      return "shuffle";
  }
}

/** True when a rift action asks "are you sure?" first: a close nothing can undo (#197). */
export function riftActionNeedsConfirm(action: Pick<JourneyRiftActionView, "irreversible">): boolean {
  return action.irreversible === true;
}

/**
 * Whose way a rift action is (#199), for its chip: "Starweaver",
 * "Starweaver or Songkeeper", "Mosslight Jar". A class reads as its own name
 * (every class's name is its id, capitalised — `content/rules.json`); an item
 * as the catalog names it, when the phone has the catalog. Null for a way
 * anyone can take, which needs no chip.
 */
export function riftActionNeedsLine(
  needs: JourneyRiftActionView["needs"],
  itemName: (id: string) => string | undefined = () => undefined,
): string | null {
  if (!needs) return null;
  // Any one of a list will do ("or"); both kinds at once are both needed ("with").
  const groups = [
    (needs.anyClass ?? []).map((id) => id.charAt(0).toUpperCase() + id.slice(1)).join(" or "),
    (needs.anyItem ?? []).map((id) => itemName(id) ?? "something you carry").join(" or "),
  ].filter((group) => group !== "");
  return groups.length === 0 ? null : groups.join(" with ");
}

/** The warning before a rift action that cannot be undone. */
export function riftActionWarning(_action: Pick<JourneyRiftActionView, "action">): string {
  return "Once it's shut, it won't open again.";
}

/**
 * What the phones say when a party has nowhere to go and nothing to try
 * (`JourneyView.stuck`, #197). The content checks make it unreachable, so it
 * only follows a campaign changing under a save; the line is honest about it
 * and points at the one person who can help, without blaming the players.
 */
export function journeyStuckLine(): string {
  return "Every way from here is shut right now. That isn't your fault - ask a grown-up for help.";
}

/** True when the way asks "are you sure?" before the party crosses it. */
export function exitNeedsConfirm(exit: Pick<JourneyExitView, "irreversible" | "once">): boolean {
  return exit.irreversible === true || exit.once === true;
}

/** The warning before a crossing that cannot be undone, or can only be done once. */
export function exitWarning(exit: Pick<JourneyExitView, "irreversible" | "once">): string {
  if (exit.irreversible) return "You won't be able to come back this way.";
  return "You can only go this way one time.";
}

/**
 * What a way leads to, as a chip (icon + words, never colour alone): a place
 * never seen ("Unexplored"), one the party knows ("Been here"; "It has
 * changed" when the place will not be as they left it), or - for a blocked
 * way, where there is nothing to promise - nothing.
 */
export function exitArrivalChip(exit: JourneyExitView): { icon: string; text: string } | null {
  if (!exit.available) return null;
  if (exit.arrival === "new") return { icon: "star", text: "Unexplored" };
  if (exit.changed) return { icon: "shuffle", text: "It has changed" };
  return { icon: "check", text: "Been here" };
}

/** The lobby button for a journey that has a place to play next. */
export function journeyBeginLabel(journey: JourneyView, ended?: CampaignView["ended"]): string {
  if (journey.status === "ended" || ended) return "Start again";
  const played = (journey.places ?? []).some((place) => place.completed);
  if (!played) return "Begin the adventure";
  return journey.visit > 1 ? `Go back to ${journey.title}` : `Go to ${journey.title}`;
}

/** The one line the shared screen says about where the journey stands. Null for an ordered campaign. */
export function journeyLine(view: CampaignView | null | undefined): string | null {
  const journey = view?.journey;
  if (!journey) return null;
  if (journey.status === "ended") {
    return journey.reachedEnding ? `Ending found: ${journey.reachedEnding.title}` : "The adventure is over";
  }
  if (journey.status === "choosing") return `Deciding where to go from ${journey.title}`;
  const played = (journey.places ?? []).some((place) => place.completed);
  return played ? `Next stop: ${journey.title}` : `The adventure starts at ${journey.title}`;
}
