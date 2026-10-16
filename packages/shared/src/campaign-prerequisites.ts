/**
 * Campaign prerequisites (#221): one campaign that cannot be started until the
 * household has finished another.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 *
 * `Campaign.requires` lists campaign ids. Absent, or empty, is today's
 * behaviour: nothing locks. A prerequisite is met when the household's
 * `CampaignProgressRecord` for it says `complete`, whichever ending the party
 * reached — a loss ending completes and commits its characters exactly as a
 * win does (spec §8.3). A `failed` attempt (the setback limit) or one still
 * `active` does not count, and neither does no record at all.
 *
 * The prerequisite belongs to the household, not to a character: a hero who
 * joins a party already underway still comes in at the tier floor (spec §8.4),
 * and nothing here reads a character.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES HERE
 *
 * Pure, in shared, for the reason `routes.ts` is: the loader refuses a bad
 * declaration at startup, `content:validate` reports it to the author, and the
 * server asks the same question at every chapter start and for the lobby. A
 * rule implemented three times is a rule with three answers.
 */

import type { Campaign } from "./types/chapter.js";

/** One thing wrong with a campaign set's prerequisites. */
export interface PrerequisiteProblem {
  campaignId: string;
  /** JSON pointer into the campaign file, e.g. `/requires/0`. */
  path: string;
  problem: string;
}

/**
 * Everything wrong with the prerequisites a set of campaigns declares: a
 * campaign requiring itself or one the set does not have, a repeat, and a
 * cycle (A needs B needs A — neither could ever be started).
 *
 * Takes the whole set because "unknown" and "cycle" are facts about the set,
 * not about one file. Each cycle is reported once, at the first campaign in id
 * order that sits on it.
 */
export function prerequisiteProblems(
  campaigns: readonly Pick<Campaign, "id" | "requires">[],
): PrerequisiteProblem[] {
  const problems: PrerequisiteProblem[] = [];
  const known = new Set(campaigns.map((c) => c.id));
  const edges = new Map<string, string[]>();

  for (const campaign of campaigns) {
    if (campaign.requires === undefined) continue;
    if (!Array.isArray(campaign.requires)) {
      problems.push({ campaignId: campaign.id, path: "/requires", problem: "requires must be a list of campaign ids" });
      continue;
    }
    const valid: string[] = [];
    campaign.requires.forEach((id, i) => {
      const path = `/requires/${String(i)}`;
      if (id === campaign.id) {
        problems.push({ campaignId: campaign.id, path, problem: `campaign "${id}" cannot require itself` });
      } else if (!known.has(id)) {
        problems.push({
          campaignId: campaign.id,
          path,
          problem: `requires campaign "${String(id)}", which does not exist`,
        });
      } else if (valid.includes(id)) {
        problems.push({ campaignId: campaign.id, path, problem: `requires "${id}" more than once` });
      } else {
        valid.push(id);
      }
    });
    edges.set(campaign.id, valid);
  }

  // Cycles, by depth-first search over the declarations that name real
  // campaigns. `onPath` is the walk in progress; meeting a campaign already on
  // it closes a cycle.
  const done = new Set<string>();
  const onPath: string[] = [];
  const visit = (id: string): void => {
    if (done.has(id)) return;
    const at = onPath.indexOf(id);
    if (at !== -1) {
      const cycle = [...onPath.slice(at), id];
      problems.push({
        campaignId: cycle[0]!,
        path: "/requires",
        problem: `prerequisite cycle: ${cycle.join(" -> ")}`,
      });
      return;
    }
    onPath.push(id);
    for (const next of edges.get(id) ?? []) visit(next);
    onPath.pop();
    done.add(id);
  };
  for (const id of [...edges.keys()].sort()) visit(id);
  return problems;
}

/** The part of a `CampaignProgressRecord` a prerequisite reads. */
export interface PrerequisiteAttempt {
  campaignId: string;
  status: "active" | "complete" | "failed";
}

/**
 * The prerequisites a household has not met: each required campaign without a
 * `complete` record among `attempts`. Empty means unlocked — always, for a
 * campaign that declares none.
 */
export function unmetPrerequisites(
  campaign: Pick<Campaign, "requires">,
  attempts: readonly PrerequisiteAttempt[],
): string[] {
  return (campaign.requires ?? []).filter(
    (id) => !attempts.some((a) => a.campaignId === id && a.status === "complete"),
  );
}

/** "Finish Gemfall first" — the plain reason, from the required campaigns' titles. */
export function prerequisiteReason(titles: readonly string[]): string {
  if (titles.length === 0) return "";
  const last = titles[titles.length - 1]!;
  const names = titles.length === 1 ? last : `${titles.slice(0, -1).join(", ")} and ${last}`;
  return `Finish ${names} first`;
}
