/**
 * Take your hero home (#251): moving a kid to another household.
 *
 * Decided in #266 (architecture §4.5, "Who owns what"): her hero's record is
 * hers, and a table's save is the table's. So moving her is **changing her
 * home household**. Her profile, her heroes and her Field Guide finds go to
 * the new home with every id unchanged, in one transaction, and the code that
 * pays for it is spent in that same transaction (`repo.moveProfile`). Runs and
 * campaign progress stay where they were played: she picks those stories up
 * again when she visits that table (#249).
 *
 * It is a move, never a copy, so there is never a question of which hero is
 * the real one.
 *
 * The code is modeled on an organizer invite (#248): a signed-in owner of her
 * home makes it, it is ten letters from the room-code alphabet, it works once,
 * and it goes dead after a day. Whoever redeems it must be signed in too, and
 * takes her into a home they own or a brand-new one made for her. Wrong codes
 * are counted against the account (`code-guard.ts`).
 *
 * **Her phone moves with her.** Its binding is hers, not the household's: it
 * lands on her face with no picker, so the phone that went to the club with
 * her goes home with her and keeps working, with no re-pairing. Its token
 * still names the old household, so the move leaves a forward there that
 * token resolution follows by primary key (`movedBinding` in identity.ts).
 * A shared tablet is the household's, and stays.
 *
 * **Not mid-campaign.** A hero whose provisional names an adventure still in
 * flight is that table's until it ends (§4.5, "the claim", #282): moving her
 * would strand the gains it is about to commit or revert. Both making the code
 * and redeeming it refuse while that is so.
 */

import type { Character, Household, TransferAccepted, TransferCode } from "@kad/shared";
import { newId } from "../ids.ts";
import type { GameRepository, MoveProfileInput, ProfileMove } from "../store/repository.ts";
import { DEVICE_TOKEN_TTL_MS } from "../token-identity.ts";
import { summaries } from "./account.ts";
import { admitCodeLookup } from "./code-guard.ts";
import { fail, iso, ok, type HandlerResult } from "./deps.ts";
import {
  INVITE_CODE_LENGTH,
  inviteCode,
  normalizeInviteCode,
  ownedHousehold,
  ownerRow,
  type Organizer,
  type OrganizerDeps,
} from "./organizer.ts";
import { takeOutEverywhere } from "./remove.ts";

/**
 * A day: long enough to make the code at pickup and redeem it at home that
 * evening, short enough that a code that lets someone take a kid's heroes
 * does not sit in a message thread for long.
 */
export const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long the forward for her phone outlives the move: past the life of any
 * device token minted before it, which is the last one that could need it.
 */
export const FORWARD_TTL_MS = DEVICE_TOKEN_TTL_MS + 24 * 60 * 60 * 1000;

/** A row a move races with makes it cancel and read again; this many times, then it says so. */
const MOVE_ATTEMPTS = 3;

/** A code that moves one of this household's kids to another home. */
export async function createTransferCode(
  input: Organizer & { householdId: unknown; playerId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<TransferCode>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  if (typeof input.playerId !== "string" || input.playerId === "") return fail("ILLEGAL", "expected { playerId }");
  const move = await deps.repo.readProfileMove(owned.value.id, input.playerId);
  if (!move) return fail("NOT_FOUND", `no player ${input.playerId}`);
  const busy = await busyHero(move, deps.repo);
  if (busy) return midAdventure(busy, move);

  const nowMs = deps.now();
  const expires = nowMs + TRANSFER_TTL_MS;
  // As for an invite: a collision is a curiosity, and the write is conditional.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode(deps.random);
    const written = await deps.repo.putTransferCodeIfAbsent({
      code,
      householdId: owned.value.id,
      playerId: move.player.id,
      createdBy: input.cognitoSub,
      createdAt: iso(nowMs),
      expiresAt: iso(expires),
      ttl: Math.ceil(expires / 1000),
    });
    if (written) {
      return ok({ code, expiresAt: iso(expires), playerId: move.player.id, displayName: move.player.displayName });
    }
  }
  throw new Error("could not mint a transfer code");
}

/**
 * Redeem a transfer code: the kid it names moves into `householdId`, which
 * this account must own, or, with no `householdId`, into a new home made for
 * her with this account as its owner.
 */
export async function acceptTransfer(
  input: Organizer & { code: unknown; householdId?: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<TransferAccepted>> {
  const code = typeof input.code === "string" ? normalizeInviteCode(input.code) : "";
  if (code.length !== INVITE_CODE_LENGTH) return fail("ILLEGAL", `A move code is ${INVITE_CODE_LENGTH} letters.`);

  const ticket = await admitCodeLookup(`transfer:${input.cognitoSub}`, deps);
  if (!ticket) return fail("FORBIDDEN", "Too many wrong codes. Wait a few minutes, then try again.");
  const record = await deps.repo.getTransferCode(code, iso(deps.now()));
  if (!record) return fail("NOT_FOUND", "That code didn't work. It may be used up or too old; ask for a new one.");
  // A real code, whatever happens next: not a guess.
  await ticket.hit();

  let into: Household | null = null;
  if (input.householdId !== undefined && input.householdId !== null) {
    const owned = await ownedHousehold(input, input.householdId, deps);
    if (!owned.ok) return owned;
    if (owned.value.id === record.householdId) return fail("ILLEGAL", "They already live here.");
    into = owned.value;
  }

  for (let attempt = 0; attempt < MOVE_ATTEMPTS; attempt++) {
    const move = await deps.repo.readProfileMove(record.householdId, record.playerId);
    if (!move) return fail("NOT_FOUND", "That kid has already moved, or isn't there any more.");
    const name = move.player.displayName;
    const busy = await busyHero(move, deps.repo);
    if (busy) return midAdventure(busy, move);
    if (into && (await nameTaken(into.id, name, deps.repo))) {
      return fail("ILLEGAL", `Someone called ${name} is already here. Rename one of them first.`);
    }

    const to: MoveProfileInput["to"] = into ? { householdId: into.id } : newHome(name, input, deps.now());
    const outcome = await deps.repo.moveProfile({
      move,
      code,
      nowIso: iso(deps.now()),
      to,
      forwardTtl: Math.ceil((deps.now() + FORWARD_TTL_MS) / 1000),
    });
    if (outcome === "spent") {
      return fail("NOT_FOUND", "That code didn't work. It may be used up or too old; ask for a new one.");
    }
    if (outcome === "too-big") {
      return fail("ILLEGAL", `${name} has more heroes and phones than one move can carry. Ask for help moving them.`);
    }
    if (outcome === "changed") continue;

    // Moved. Any room her old home still has open loses her seat, as a host's
    // Remove does: a session issued there outlives the move otherwise. The move
    // is already done, so a room that could not be written is only logged.
    const out = await takeOutEverywhere(record.householdId, move.player.id, deps).catch((err: unknown) => {
      console.error(`acceptTransfer: could not take ${move.player.id} out of ${record.householdId}'s rooms:`, err);
      return null;
    });
    if (out && !out.ok) console.error(`acceptTransfer: ${out.error.message}`);

    const home = "household" in to ? to.household.id : to.householdId;
    const [summary] = await summaries([home], deps);
    if (!summary) return fail("NOT_FOUND", "That home is gone.");
    return ok({ household: summary, playerId: move.player.id, displayName: name, heroes: move.characters.length });
  }
  return fail("STALE_SEQ", "Something changed while moving them. Try again.");
}

/**
 * The first of her heroes still in the middle of an adventure: a provisional
 * whose claim names a campaign attempt that is still `active`. The claim is
 * the campaign id at home (`campaignKey` in progression.ts) and, at a table
 * that is not her home, `<campaignId>@<tableHouseholdId>` (#282, #291), so it
 * is parsed into the attempt it names and that table's attempt is read, never
 * her home's. A complete, failed or vanished attempt holds nothing.
 */
export async function busyHero(
  move: Pick<ProfileMove, "householdId" | "characters">,
  repo: Pick<GameRepository, "getCampaignProgress">,
): Promise<Character | null> {
  for (const character of move.characters) {
    const claim = character.provisional?.runId;
    if (!claim) continue;
    const { campaignId, table } = parseClaim(claim, move.householdId);
    if ((await repo.getCampaignProgress(table, campaignId))?.status === "active") return character;
  }
  return null;
}

/**
 * The attempt a claim names: `parseClaim` in #291's handlers/claim.ts, which
 * replaces this once both have landed. A bare claim is her home's table.
 */
export function parseClaim(claim: string, home: string): { campaignId: string; table: string } {
  const at = claim.lastIndexOf("@");
  return at < 0 ? { campaignId: claim, table: home } : { campaignId: claim.slice(0, at), table: claim.slice(at + 1) };
}

function midAdventure(hero: Character, move: ProfileMove): HandlerResult<never> {
  return fail(
    "ILLEGAL",
    `${hero.name} is in the middle of an adventure here. Finish it before ${move.player.displayName} moves.`,
  );
}

/** The picker rule `profileName` keeps: two faces with one name are two kids who cannot tell which is theirs. */
async function nameTaken(householdId: string, name: string, repo: Pick<GameRepository, "listPlayers">): Promise<boolean> {
  const wanted = name.trim().toLocaleLowerCase();
  return (await repo.listPlayers(householdId)).some(
    (p) => !p.retired && p.displayName.trim().toLocaleLowerCase() === wanted,
  );
}

/** A kept household for her, owned by whoever redeemed the code: what `createGroup` writes. */
function newHome(name: string, who: Organizer, nowMs: number): MoveProfileInput["to"] {
  const household: Household = {
    id: newId("h"),
    displayName: `${name}'s household`,
    ownerSub: who.cognitoSub,
    guest: false,
    createdAt: iso(nowMs),
  };
  return { household, owner: ownerRow(household.id, who, nowMs) };
}
