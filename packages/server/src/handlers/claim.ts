/**
 * One game at a time per hero: the claim (#282, architecture §4.5).
 *
 * A hero carries one `provisional` snapshot stamped with one id
 * (`provisional.runId`). That stamp is her claim: the adventure her
 * provisional gains belong to, and the only one that may write them. It names
 * the table's campaign attempt rather than one evening's room, because a
 * campaign spans evenings and every evening is a new run (progression.ts,
 * `campaignKey`): at home it is the campaign id, exactly as it always was, and
 * at a table that is not her home it is qualified by that table's household.
 *
 * Everything here reads. The writes ride the run's commit as `CharacterWrite`s,
 * conditioned on the claim and the version read, so whatever this module
 * decided against a read that has since moved fails and is decided again.
 */

import type { Character } from "@kad/shared";
import type { CharacterWrite } from "../store/repository.ts";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

/** Between a campaign and the table playing it, in a visiting table's claim. */
const AT = "@";

/**
 * The claim a table's adventure stamps on a hero. `adventure` is the campaign
 * id (a one-off chapter's run id, which never goes provisional); the hero's
 * home is `hero.householdId`, so a hero at home carries the bare id, as every
 * row written before the claim does, and a visiting hero carries the table.
 */
export function claimFor(adventure: string, tableHouseholdId: string, hero: Pick<Character, "householdId">): string {
  return hero.householdId === tableHouseholdId ? adventure : `${adventure}${AT}${tableHouseholdId}`;
}

/** The adventure a claim names, and the household whose table plays it. */
export function parseClaim(
  claim: string,
  hero: Pick<Character, "householdId">,
): { campaignId: string; table: string } {
  const at = claim.lastIndexOf(AT);
  return at < 0
    ? { campaignId: claim, table: hero.householdId }
    : { campaignId: claim.slice(0, at), table: claim.slice(at + 1) };
}

/** The claim a hero's row carries, or null when she is free. */
export function claimOf(hero: Pick<Character, "provisional">): string | null {
  return hero.provisional?.runId ?? null;
}

/**
 * Is the adventure `claim` names still in flight? Only an active campaign
 * attempt is: a complete or failed one has already committed or discarded what
 * it was owed, and a one-off's run or a campaign the content no longer ships
 * has nothing left that could. A host closing the room ends an evening, not the
 * attempt, so it is not terminal (host.ts, `closeRoom`).
 */
export async function claimIsLive(
  claim: string,
  hero: Pick<Character, "householdId">,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<boolean> {
  const { campaignId, table } = parseClaim(claim, hero);
  if (!deps.content.campaign(campaignId)) return false;
  const attempt = await deps.repo.getCampaignProgress(table, campaignId);
  return attempt?.status === "active";
}

/**
 * Where a hero stands against the adventure `claim` (null: an adventure
 * nothing is claimed for yet, as in a lobby): `mine` when she already carries
 * it, `free` when she carries nothing in flight, `busy` when another adventure
 * still holds her.
 */
export async function standing(
  hero: Character,
  claim: string | null,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<"mine" | "free" | "busy"> {
  const held = claimOf(hero);
  if (held === null) return "free";
  if (held === claim) return "mine";
  return (await claimIsLive(held, hero, deps)) ? "busy" : "free";
}

/** What a phone shows when a hero is busy elsewhere (#282). */
export function busyMessage(hero: Pick<Character, "name">): string {
  return `${hero.name} is in the middle of another adventure`;
}

/** A write to a stored hero, conditioned on the row as `read` found it. */
export function rewrite(read: Character, next: Character): CharacterWrite {
  return { character: next, expectedVersion: read.version ?? 0, expectedClaim: claimOf(read) };
}

/** A brand-new hero's row, which must not exist yet. */
export function create(character: Character): CharacterWrite {
  return { character, expectedVersion: null, expectedClaim: null };
}

/** Lost races a release retries before giving up, as host controls do. */
const RELEASE_ATTEMPTS = 3;

/**
 * Leave the adventure a hero is in (#282): discard its provisional gains and
 * quest items and clear her claim, conditioned on the claim and version read.
 * Only the adventure she was in when this started is left; if the row has
 * since moved to another, that one is not touched. `left` is the claim
 * released, or null when there was nothing to leave.
 */
export async function releaseClaim(
  householdId: string,
  characterId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<HandlerResult<{ left: string | null }>> {
  let leaving: string | null = null;
  for (let attempt = 1; ; attempt++) {
    const hero = await deps.repo.getCharacter(householdId, characterId);
    if (!hero) return fail("NOT_FOUND", `no hero ${characterId}`);
    const held = claimOf(hero);
    if (held === null || (leaving !== null && held !== leaving)) return ok({ left: null });
    leaving = held;
    if (await deps.repo.writeCharacter(rewrite(hero, { ...hero, provisional: null, questItems: [] }))) {
      return ok({ left: held });
    }
    if (attempt >= RELEASE_ATTEMPTS) return fail("STALE_SEQ", "the hero moved on just then; try again");
  }
}
