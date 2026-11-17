/**
 * A kid's own page (#299): her badges and finds, and the presets she picked.
 *
 * Read with the journal (`getJournal`) and saved here. The principal is always
 * the caller's own device (the route resolves it from the device token, never
 * from the request), and nothing in a request names a kid, so there is no way
 * to ask for, or change, anybody else's page. A visiting table has a room
 * session and no device in her household, a shared tablet has no kid at all,
 * and another household's device resolves to its own kid: none of them reach
 * this.
 */

import {
  checkFlairRequest,
  deriveBadges,
  PROFILE_FLAIR_VERSION,
  readFlair,
  triviaCounts,
  type Badge,
  type Character,
  type FieldGuideFind,
  type KidProfileView,
  type PlayerProfile,
  type TriviaRecord,
} from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { readTrivia } from "./trivia.ts";

export interface ProfileInput {
  householdId: string;
  playerId: string;
}

/** How many finds the page picks out. */
const HIGHLIGHTS = 3;

/** Her badges, the ones her page can show and her title can be. */
export function badgesOf(
  input: ProfileInput,
  characters: readonly Character[],
  entries: Record<string, FieldGuideFind>,
  deps: Pick<HandlerDeps, "content">,
  /** Her quiz record (docs/trivia.md §5.1), for the quiz's badges. Null: none read, so none shown. */
  trivia: TriviaRecord | null = null,
): { badges: Badge[]; finds: KidProfileView["finds"] } {
  const mine = characters.filter((c) => c.ownerPlayerId === input.playerId);
  const credited = Object.entries(entries)
    .filter(([, find]) => find.firstFoundBy === input.playerId)
    .sort(([, a], [, b]) => b.foundAt.localeCompare(a.foundAt));
  const badges = deriveBadges({
    homeHouseholdId: input.householdId,
    finished: mine.flatMap((c) =>
      (c.finished ?? []).map((f) => ({ ...f, title: deps.content.campaign(f.campaignId)?.title ?? f.campaignId })),
    ),
    // Committed, not provisional: a level a failed campaign would discard is not earned yet.
    heroLevels: mine.map((c) => c.committed.level),
    souvenirs: mine.flatMap((c) => c.souvenirs),
    finds: credited.length,
    ...(trivia ? { trivia: triviaCounts(trivia), triviaLadder: deps.content.triviaLadder() } : {}),
  });
  return { badges, finds: { count: credited.length, recent: credited.slice(0, HIGHLIGHTS).map(([id]) => id) } };
}

/** Her page as the journal sends it. */
export function viewOf(
  input: ProfileInput,
  player: PlayerProfile,
  characters: readonly Character[],
  entries: Record<string, FieldGuideFind>,
  deps: Pick<HandlerDeps, "content">,
  trivia: TriviaRecord | null = null,
): KidProfileView {
  const { badges, finds } = badgesOf(input, characters, entries, deps, trivia);
  const heroIds = new Set(characters.filter((c) => c.ownerPlayerId === input.playerId).map((c) => c.id));
  return {
    displayName: player.displayName,
    badges,
    finds,
    flair: readFlair(player.flair, heroIds, badges) ?? { v: PROFILE_FLAIR_VERSION },
  };
}

/**
 * Save what she picked, replacing what she had. A pick that is not a preset,
 * not her hero or not a badge she has earned is refused.
 */
export async function saveFlair(
  input: ProfileInput & { body: unknown },
  deps: HandlerDeps,
): Promise<HandlerResult<KidProfileView>> {
  const [player, characters, book, trivia] = await Promise.all([
    deps.repo.getPlayer(input.householdId, input.playerId),
    deps.repo.listCharacters(input.householdId),
    deps.repo.getFieldGuide(input.householdId),
    // Her quiz badges are hers to pick too. A record that cannot be read refuses
    // none of the rest: only a quiz badge could not be picked just now.
    readTrivia(input.householdId, input.playerId, deps).catch((err: unknown) => {
      console.error(`profile: could not read ${input.playerId}'s quiz record:`, err);
      return null;
    }),
  ]);
  if (!player) return fail("NOT_FOUND", "no such player");

  const { badges } = badgesOf(input, characters, book.entries, deps, trivia);
  const heroIds = new Set(characters.filter((c) => c.ownerPlayerId === input.playerId).map((c) => c.id));
  const checked = checkFlairRequest(input.body, heroIds, badges);
  if (!checked.ok) return fail("ILLEGAL", checked.message);

  const { flair: _was, ...rest } = player;
  const next: PlayerProfile = checked.flair ? { ...rest, flair: checked.flair } : rest;
  // `updatePlayer` writes only a profile that is there and not being deleted (#252).
  if (!(await deps.repo.updatePlayer(next))) return fail("NOT_FOUND", "no such player");
  return ok(viewOf(input, next, characters, book.entries, deps, trivia));
}
