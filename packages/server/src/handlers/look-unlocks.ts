/**
 * Earned looks during play (docs/hero-looks.md §6; #669): the receipts a step
 * earned, written to each hero's look the moment it lands, and the news of
 * them sent to her phone once.
 *
 * The same shape as the kit's milestones (camp-milestones.ts) and finds
 * (camp-finds.ts), for the same reasons:
 *
 *   - **Read off the step.** A tier lands at a chapter's end and a rank at a
 *     fight's end, both on the run's party (`stepMilestones`); a campaign is
 *     finished by the settlement that completes it; a `findLook` is recorded
 *     on the run by the engine (`RunState.lookFinds`, `stepLookFinds`); a
 *     friend joins through a befriend claim; a downtime moment shows the
 *     crew's camp (`RunState.camp`). A step with none of these costs nothing.
 *   - **Written after the commit**, beside the kit's, on her row at her home,
 *     conditional on its version and claim as read and retried on a lost race,
 *     so it cannot undo the commit's write to her nor be undone by one. A
 *     lost fight, a setback ending, a failed campaign's revert and a replayed
 *     chapter all leave her look alone (character.ts spreads the hero), so a
 *     receipt once written is hers for good.
 *   - **Once.** A look she already holds writes nothing; a replayed chapter,
 *     a retried step or a second room grants nothing new and says nothing.
 *   - **Never fails the turn**, and **never changes play**: nothing the engine
 *     reads is touched. A write that cannot land is logged; a milestone is
 *     still read back on her next read (`readEarnedLook`).
 *
 * What was new because of this step rides the broadcast as `lookUnlocks`,
 * never the log, so her phone says so once (client kit-news.ts). A receipt
 * her row only now catches up on (a tier she reached before looks could be
 * earned) is written and not announced.
 *
 * `heroLookOf` is the read side: her stored look with every milestone her row
 * (and, given one, her crew's camp) says she holds, which every server view
 * of her look goes through, so the book and the table offer what she has
 * earned even before anything has been written for her.
 */

import {
  LOOK_VERSION,
  catalogLook,
  earnedLooks,
  emptyLook,
  foundLookGrants,
  heroLookStanding,
  lookHasAnything,
  memberHome,
  milestoneGrants,
  readEarnedLook,
  resolvedStanding,
  withLookGrants,
} from "@kad/shared";
import type {
  MilestoneStanding,
  TierId,
  CampView,
  Character,
  EarnedLook,
  HeroLook,
  LookCampStanding,
  LookCatalog,
  LookFind,
  LookGrant,
  LookNames,
  LookUnlockNews,
  RunState,
} from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { rewrite } from "./claim.ts";
import { CAMP_WRITE_ATTEMPTS, readCamp, type CampDeps, type CampWriteResult } from "./camp.ts";
import type { MilestoneStep } from "./camp-milestones.ts";
import { iso } from "./deps.ts";

/** How receipts name a campaign and a camp friend: the content's own words. */
export function lookNames(deps: Pick<CampDeps, "content">): LookNames {
  return {
    campaign: (id) => deps.content.campaign(id)?.title,
    friend: (id) => deps.content.campCatalog()?.friends.find((f) => f.id === id)?.name,
  };
}

/** The camp as a camp milestone reads it. */
export function campStanding(camp: Pick<CampView, "friends" | "frameStage"> | null | undefined): LookCampStanding | null {
  return camp ? { friends: [...camp.friends], frameStage: camp.frameStage } : null;
}

/**
 * Her look as every server view shows it (§6): stored, with each milestone her
 * row says she holds (and her crew's, given `camp`), or null when there is
 * nothing to show or keep, so a hero with no look and nothing earned is drawn
 * exactly as before looks.
 */
export function heroLookOf(
  hero: Character,
  deps: Pick<CampDeps, "content">,
  options: { camp?: LookCampStanding | null } = {},
): HeroLook | null {
  const look = readEarnedLook(deps.content.looksCatalog(), hero, { camp: options.camp ?? null, names: lookNames(deps) });
  return lookHasAnything(look) ? look : null;
}

/**
 * Add receipts to one hero's look on her row as it stands now: `fn` is handed
 * her stored look and her row, and returns the grants to add. Retried on a
 * lost race from a fresh read. Bumps `revision`, as every look write does, so
 * a table editor open on the old look is refused once and refreshes. What it
 * wrote that was new comes back in `fresh`.
 */
export async function grantLooks(
  homeHouseholdId: string,
  characterId: string,
  fn: (look: HeroLook, hero: Character) => readonly LookGrant[],
  at: string,
  deps: Pick<CampDeps, "repo">,
): Promise<CampWriteResult<HeroLook> & { fresh?: string[] }> {
  let last: HeroLook | undefined;
  for (let attempt = 0; attempt < CAMP_WRITE_ATTEMPTS; attempt++) {
    const hero = await deps.repo.getCharacter(homeHouseholdId, characterId);
    if (!hero) return { ok: false, reason: "missing" };
    const stored = hero.look ?? emptyLook();
    const next = withLookGrants(stored, fn(structuredClone(stored), hero), at);
    if (next === stored) return { ok: true, value: stored, changed: false, fresh: [] };
    last = stored;
    const written: HeroLook = { ...next, v: LOOK_VERSION, revision: stored.revision + 1 };
    if (await deps.repo.writeCharacter(rewrite(hero, { ...hero, look: written }))) {
      return { ok: true, value: written, changed: true, fresh: Object.keys(written.unlocked).filter((id) => !Object.hasOwn(stored.unlocked, id)) };
    }
  }
  return { ok: false, reason: "conflict", ...(last ? { value: last } : {}) };
}

/**
 * The look finds `after` recorded that `before` had not, as `stepCampFinds`
 * reads the camp's: every one on a fresh chapter, the new ones within a
 * chapter, and none on a step that left the chapter without starting one.
 */
export function stepLookFinds(before: RunState, after: RunState, chapterStarted: boolean): LookFind[] {
  const found = after.lookFinds ?? [];
  if (found.length === 0) return [];
  if (chapterStarted) return [...found];
  if (before.chapterId !== after.chapterId) return [];
  const had = new Set((before.lookFinds ?? []).map((f) => f.rewardId));
  return found.filter((f) => !had.has(f.rewardId));
}

/** Whether a camp view earns anything a look rule reads: a friend, or the grand camp. */
function campCanEarn(camp: LookCampStanding | null): boolean {
  return camp !== null && (camp.friends.length > 0 || camp.frameStage >= 4);
}

/** What one step can have earned, read off it before the claim. */
export interface LookStep {
  /** Heroes whose tier or ranks moved (camp-milestones.ts `stepMilestones`). */
  milestones: readonly MilestoneStep[];
  /**
   * The tier each hero's chapter XP took her to, by character id (the
   * settlement's `awards`): the setback that fails a campaign is also a
   * completion that can reach a tier, and the revert that follows leaves
   * the run's party showing the old one, as `failCampaign` keeps her kit's.
   */
  tiers?: Readonly<Record<string, TierId>>;
  /** The campaign this step's settlement completed, on any ending; null for none. */
  finishedCampaign: string | null;
  /** Look finds this step recorded. */
  finds: readonly LookFind[];
  /** A friend joined the crew on this step (a befriend claim that gave one). */
  friendJoined: boolean;
}

/**
 * Write what this step earned to each hero it concerns, and say which looks
 * are new because of it. `state` is the run after the step.
 */
export async function claimLookUnlocks(
  step: LookStep,
  input: { run: Pick<RunRecord, "id" | "householdId">; before: RunState; state: RunState },
  deps: CampDeps,
): Promise<LookUnlockNews[]> {
  const catalog = deps.content.looksCatalog();
  if (!catalog) return [];
  const { run, before, state } = input;
  const removed = new Set(state.removed ?? []);
  const seated = state.party.filter((m) => !removed.has(m.playerId));

  // The crew's camp, when this step could have earned from it: a friend
  // joined (read afresh: a scene carries no camp view), or a downtime moment
  // shows a camp that differs from the one the step began with.
  let camp: LookCampStanding | null = null;
  const shown = campStanding(state.camp);
  const was = campStanding(before.camp);
  if (step.friendJoined) {
    try {
      camp = campStanding(await readCamp(run.householdId, state.crew, deps).then((c) => ({ friends: Object.keys(c.friends), frameStage: c.frameStage })));
    } catch (err) {
      console.error(`looks: could not read the camp for run ${run.id}:`, err);
    }
  } else if (campCanEarn(shown) && JSON.stringify(shown) !== JSON.stringify(was)) {
    camp = shown;
  }

  const wanted = new Set<string>();
  for (const m of step.milestones) wanted.add(m.member.character.id);
  for (const id of Object.keys(step.tiers ?? {})) wanted.add(id);
  for (const find of step.finds) for (const id of find.heroes) wanted.add(id);
  if (step.finishedCampaign !== null || camp !== null) for (const m of seated) wanted.add(m.character.id);
  if (wanted.size === 0) return [];

  const names = lookNames(deps);
  const at = iso(deps.now());
  const news: LookUnlockNews[] = [];
  for (const characterId of wanted) {
    const member = state.party.find((m) => m.character.id === characterId);
    const was = before.party.find((m) => m.character.id === characterId);
    const moved = step.milestones.find((m) => m.member.character.id === characterId);
    const awarded = step.tiers?.[characterId];
    // What the run shows of her now, and the tier her XP reached even if a revert put it back.
    const after: MilestoneStanding[] = [
      ...(moved ? [moved.after] : member ? [resolvedStanding(member.character)] : []),
      ...(awarded ? [{ tier: awarded }] : []),
    ];
    const prior: MilestoneStanding | null = moved ? moved.before : was ? resolvedStanding(was.character) : null;
    const finds = step.finds.filter((f) => f.heroes.includes(characterId));
    // What this step earned, to announce: a milestone the run shows now and did not before.
    const told = new Map<string, LookUnlockNews["cause"]>();
    try {
      const written = await grantLooks(
        member ? memberHome(member, run.householdId) : run.householdId,
        characterId,
        (_look, hero) => {
          told.clear();
          const earned = earnedLooks(catalog, heroLookStanding(hero, after, camp), names);
          if (moved || awarded) {
            // Told only what this step earned: a tier or rank the run did not show before it.
            const had = new Set(prior ? earnedLooks(catalog, heroLookStanding({ species: hero.species }, [prior]), names).map((e) => e.id) : []);
            const now = new Set(earnedLooks(catalog, heroLookStanding({ species: hero.species }, after), names).map((e) => e.id));
            for (const e of earned) if ((e.cause === "tier" || e.cause === "rank") && now.has(e.id) && !had.has(e.id)) told.set(e.id, e.cause);
          }
          if (step.finishedCampaign !== null) {
            for (const e of earned) if (e.cause === "campaign" && campaignOf(catalog, e) === step.finishedCampaign) told.set(e.id, "campaign");
          }
          if (camp !== null) for (const e of earned) if (e.cause === "camp") told.set(e.id, "camp");
          const found: LookGrant[] = finds.flatMap((f) =>
            foundLookGrants(catalog, f.looks, hero.species, f.rewardId, foundSource(f, state, deps)),
          );
          for (const g of found) told.set(g.id, "found");
          return [...found, ...milestoneGrants(earned)];
        },
        at,
        deps,
      );
      if (!written.ok) {
        if (written.reason !== "missing") console.error(`looks: hero ${characterId}'s looks were not written (${written.reason})`);
        continue;
      }
      for (const id of written.fresh ?? []) {
        const cause = told.get(id);
        const entry = catalogLook(catalog, id);
        if (cause && entry) news.push({ characterId, lookId: id, kind: entry.kind, cause });
      }
    } catch (err) {
      console.error(`looks: writing hero ${characterId}'s looks in run ${run.id} failed:`, err);
    }
  }
  return news;
}

function campaignOf(catalog: LookCatalog, earned: EarnedLook): string | null {
  const rule = catalogLook(catalog, earned.id)?.unlock;
  return rule && rule.from === "milestone" && "campaign" in rule ? rule.campaign : null;
}

/** A find's receipt, as the book says it: the chapter it was found in. */
function foundSource(find: LookFind, state: RunState, deps: Pick<CampDeps, "content">): string | undefined {
  const chapterId = find.rewardId.slice(0, find.rewardId.indexOf(".")) || state.chapterId;
  const title = chapterId ? deps.content.chapter(chapterId)?.title : undefined;
  return title ? `Found in ${title}` : undefined;
}
