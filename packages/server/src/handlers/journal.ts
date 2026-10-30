/**
 * The journal — what a phone can study between games.
 *
 * A player who is not in a room can still open their hero, the household's
 * Field Guide and the atlas, and look at it all without anything being at
 * stake. Everything here is read-only and already belongs to them: their own
 * heroes (the same rule as `listHeroes`), and the household's book.
 *
 * Authorised by the device binding rather than a room session, because there
 * is no room — the entry points resolve the principal and hand it in.
 */

import {
  claimOf,
  parseClaim,
  resolveCharacter,
  storyChapters,
  type Character,
  type JournalCrew,
  type JournalResponse,
  type JournalStoryCampaign,
} from "@kad/shared";
import { claimIsLive } from "./claim.ts";
import { ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { listHeroes } from "./heroes.ts";
import { viewOf } from "./profile.ts";
import type { CampaignProgressRecord } from "../store/repository.ts";

export interface JournalInput {
  householdId: string;
  playerId: string;
}

/**
 * How many recent runs to look through for one that got past the lobby. A
 * room opened and abandoned is a run too; a few of those in a row should not
 * lose the map its "you were here", and a long history should not cost a read
 * per run to find it.
 */
const WHEREABOUTS_LOOKBACK = 5;

/**
 * The same, for a household with crews: enough recent runs that each crew's
 * last chapter, and the crew each hero last sat down with, is likely among them.
 */
const CREW_LOOKBACK = 20;

/** What the household's first crew is called in the book (client `FIRST_CREW`). */
const FIRST_CREW = "The first crew";
export async function getJournal(
  input: JournalInput,
  deps: HandlerDeps,
): Promise<HandlerResult<JournalResponse>> {
  const [heroes, book, characters, players, whereabouts, attempts, crewRows] = await Promise.all([
    listHeroes(input, deps),
    deps.repo.getFieldGuide(input.householdId),
    deps.repo.listCharacters(input.householdId),
    deps.repo.listPlayers(input.householdId),
    whereaboutsOf(input.householdId, deps),
    deps.repo.listCampaignProgress(input.householdId),
    deps.repo.listCrews(input.householdId),
  ]);
  if (!heroes.ok) return heroes;
  const crewBook =
    crewRows.length > 0
      ? await crewsOf(input.householdId, crewRows, characters.filter((c) => c.ownerPlayerId === input.playerId), deps)
      : null;
  const finders = findersOf(players, characters, deps);
  const finished = finishedOf(characters.filter((c) => c.ownerPlayerId === input.playerId), deps);
  const me = players.find((p) => p.id === input.playerId);
  const profile = me ? viewOf(input, me, characters, book.entries, deps) : undefined;
  return ok({
    heroes: heroes.value.heroes,
    fieldGuide: book.entries,
    finders,
    // With crews, the first crew's, as the book always showed: the household's
    // latest run may be another crew's, whose place is on its own entry.
    whereabouts: crewBook ? crewBook.crews[0]!.whereabouts : whereabouts,
    finished,
    ...(profile ? { profile } : {}),
    story: storyOf(attempts, deps),
    ...(crewBook ? crewBook : {}),
  });
}

/**
 * Each crew's book (architecture §4.5, "Crews"): its own story, read from its
 * own saves, and where it last adventured; and which crew each of this
 * player's heroes plays with. One pass over the recent runs answers both of
 * the latter, since a run's state says its crew and who sat in it.
 *
 * A hero's crew is the one whose adventure holds her (her claim, while that
 * adventure is under way at this household), or else the crew of the latest
 * recent run she sat in. A hero who is neither is the first crew's, and is
 * left out of `heroCrews`, as the first crew is everywhere.
 */
async function crewsOf(
  householdId: string,
  rows: readonly { id: string; name: string }[],
  mine: readonly Character[],
  deps: HandlerDeps,
): Promise<{ crews: JournalCrew[]; heroCrews: Record<string, string> }> {
  const runs = (await deps.repo.listRuns(householdId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, CREW_LOOKBACK);
  const placed = new Map<string | null, JournalCrew["whereabouts"]>();
  const lastSat = new Map<string, string | null>();
  for (const run of runs) {
    const state = await deps.repo.getState(run.id);
    if (!state?.chapterId) continue;
    const crew = state.crew ?? null;
    const chapter = deps.content.chapter(state.chapterId);
    if (chapter && !placed.has(crew)) placed.set(crew, { chapterId: chapter.id, biome: chapter.biome });
    for (const member of state.party) {
      if (!lastSat.has(member.character.id)) lastSat.set(member.character.id, crew);
    }
  }

  const all = [{ id: null as string | null, name: FIRST_CREW }, ...rows.map((r) => ({ id: r.id as string | null, name: r.name }))];
  const crews = await Promise.all(
    all.map(async (crew): Promise<JournalCrew> => ({
      id: crew.id,
      name: crew.name,
      story: storyOf(await deps.repo.listCampaignProgress(householdId, crew.id ?? undefined), deps),
      whereabouts: placed.get(crew.id) ?? null,
    })),
  );

  const known = new Set(rows.map((r) => r.id));
  const heroCrews: Record<string, string> = {};
  for (const hero of mine) {
    let crew = lastSat.get(hero.id) ?? null;
    const held = claimOf(hero);
    if (held !== null) {
      const claim = parseClaim(held, hero);
      if (claim.table === householdId && (await claimIsLive(held, hero, deps))) crew = claim.crew ?? null;
    }
    if (crew !== null && known.has(crew)) heroCrews[hero.id] = crew;
  }
  return { crews, heroCrews };
}

/**
 * The Story page (#358): each campaign attempt the household has, with the
 * chapters it played, newest attempt first. The household's, like the atlas:
 * the story is the table's, whoever was seated for which chapter. A campaign
 * the content no longer ships, or an attempt with no chapter to show, is left
 * out.
 */
function storyOf(
  attempts: readonly CampaignProgressRecord[],
  deps: HandlerDeps,
): JournalStoryCampaign[] {
  const chapter = (id: string) => deps.content.chapter(id);
  return [...attempts]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .flatMap((attempt) => {
      const campaign = deps.content.campaign(attempt.campaignId);
      if (!campaign) return [];
      const chapters = storyChapters(campaign, attempt, chapter);
      if (chapters.length === 0) return [];
      return [{ campaignId: campaign.id, title: campaign.title, status: attempt.status, chapters }];
    });
}

/**
 * Each of her heroes' finished campaigns (#283), from the record on the hero
 * herself, so a campaign finished at a friend's table is here too.
 */
function finishedOf(characters: readonly Character[], deps: HandlerDeps): NonNullable<JournalResponse["finished"]> {
  const out: NonNullable<JournalResponse["finished"]> = {};
  for (const character of characters) {
    const lines = [...(character.finished ?? [])]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((f) => ({
        campaignId: f.campaignId,
        title: deps.content.campaign(f.campaignId)?.title ?? f.campaignId,
        outcome: f.outcome,
        at: f.at,
      }));
    if (lines.length > 0) out[character.id] = lines;
  }
  return out;
}

/**
 * Who each player is, as a Field Guide credit. In play the credit is the
 * finder's character's name, because the party is who is at the table; here
 * there is no party, so it is the name of the hero that player has taken
 * furthest, and their own name when they have none.
 */
function findersOf(
  players: readonly { id: string; displayName: string }[],
  characters: readonly Character[],
  deps: HandlerDeps,
): Record<string, string> {
  const rules = deps.content.rules();
  const items = deps.content.items();
  const best = new Map<string, { name: string; level: number }>();
  for (const character of characters) {
    const { level } = resolveCharacter(character, rules, items);
    const held = best.get(character.ownerPlayerId);
    if (!held || level > held.level) best.set(character.ownerPlayerId, { name: character.name, level });
  }
  const finders: Record<string, string> = {};
  for (const player of players) finders[player.id] = best.get(player.id)?.name ?? player.displayName;
  return finders;
}

async function whereaboutsOf(
  householdId: string,
  deps: HandlerDeps,
): Promise<JournalResponse["whereabouts"]> {
  const runs = (await deps.repo.listRuns(householdId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, WHEREABOUTS_LOOKBACK);
  for (const run of runs) {
    const state = await deps.repo.getState(run.id);
    if (!state?.chapterId) continue;
    const chapter = deps.content.chapter(state.chapterId);
    if (chapter) return { chapterId: chapter.id, biome: chapter.biome };
  }
  return null;
}
