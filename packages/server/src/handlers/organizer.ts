/**
 * Organizers — one grown-up, or several, running games for kids who are not
 * all their family (#248): a club leader, a teacher, a grandparent with a
 * gaggle of cousins.
 *
 * **A group is an ordinary household with more than one owner.** Nothing
 * below this file can tell a group from a family, the same way nothing can
 * tell a guest household from a claimed one (architecture §3.0): its players,
 * devices, characters and runs are a household's, and every guard that asks
 * "may this account manage it?" reads the account's `ACCT#` pointers, as it
 * already did. A second owner is a second pointer, plus an `OWNER#` row so the
 * household can say who its owners are. There is no group type and no second
 * code path. That keeps this thin, so revisiting the household itself (#266)
 * has nothing extra to undo.
 *
 * Every function here needs a verified sign-in (#265): `cognitoSub` arrives
 * already checked by the entry point, as for `linkAccount`. Kids never sign
 * in; they reach their profiles through a shared tablet (#250) or their own
 * phone's binding, exactly as before.
 */

import type {
  Character,
  Household,
  OrganizerHero,
  OrganizerDevicesResponse,
  OrganizerHouseholdDeleted,
  OrganizerHouseholdSummary,
  OrganizerHouseholdsResponse,
  OrganizerHouseholdView,
  OrganizerInvite,
  OrganizerOwner,
  PairingCode,
  PlayerProfile,
} from "@kad/shared";
import { newId } from "../ids.ts";
import type { HouseholdOwnerRecord } from "../store/repository.ts";
import { createProfile, summaries, vetTypedName, type AccountDeps } from "./account.ts";
import { admitCodeLookup } from "./code-guard.ts";
import { createPairingCode } from "./pairing.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { ROOM_CODE_ALPHABET } from "./room.ts";
import { NEW_PLAYER_NAME_MAX } from "./shared-device.ts";
import { takeOutEverywhere } from "./remove.ts";
import { acceptTransfer, createTransferCode } from "./transfer.ts";
import { claimIsLive, claimOf, parseClaim, releaseClaim } from "./claim.ts";
import { deleteKid, deleteOwnedHousehold, retentionChoice, setRetention } from "./retention.ts";

export type OrganizerDeps = AccountDeps & Pick<HandlerDeps, "random" | "channel" | "content">;

/** Long enough for "Thursday Dragon Club at the library". */
export const HOUSEHOLD_NAME_MAX = 40;

/**
 * Ten letters from the room-code alphabet: about 46 bits. Redeeming one needs
 * a verified sign-in as well, and misses are counted per account, so it is
 * found by being handed over, never by guessing.
 */
export const INVITE_CODE_LENGTH = 10;

/**
 * Three days: long enough to text a co-organizer on Monday for Thursday's
 * club, short enough that a code left in an old message thread goes dead.
 */
export const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Who is asking, as every handler here takes it. */
export interface Organizer {
  cognitoSub: string;
  email?: string | undefined;
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

/** The household picker: every household this account owns. */
export async function listOwnedHouseholds(
  who: Organizer,
  deps: AccountDeps,
): Promise<HandlerResult<OrganizerHouseholdsResponse>> {
  return ok({ households: await summaries(await deps.repo.listHouseholdsForAccount(who.cognitoSub), deps) });
}

/**
 * A new group: a permanent household owned by the account that asked, with
 * nobody in it yet. Unlike a first sign-in (`linkAccount`), no device is bound:
 * the organizer's phone is how they run the group, not one of its players.
 */
export async function createGroup(
  input: Organizer & { displayName: unknown },
  deps: AccountDeps,
): Promise<HandlerResult<OrganizerHouseholdSummary>> {
  const name = householdName(input.displayName);
  if (!name.ok) return name;

  const nowMs = deps.now();
  const household: Household = {
    id: newId("h"),
    displayName: name.value,
    ownerSub: input.cognitoSub,
    guest: false,
    createdAt: iso(nowMs),
  };
  await deps.repo.putHousehold(household);
  await deps.repo.putOwner(ownerRow(household.id, input, nowMs));
  return ok({ id: household.id, displayName: household.displayName, players: 0 });
}

/** Everything an owner manages, in one read. */
export async function viewHousehold(
  input: Organizer & { householdId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  return ok(await describe(owned.value, input, deps));
}

/**
 * The household's shared tablets (#273), so an owner can find the one to forget
 * (`forgetDevice`) when it is lost or left at a grandparent's. Only shared
 * bindings: a kid's own phone is not forgotten from here.
 */
export async function listSharedDevices(
  input: Organizer & { householdId: unknown },
  deps: AccountDeps,
): Promise<HandlerResult<OrganizerDevicesResponse>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  const bindings = await deps.repo.listDevices(owned.value.id);
  const devices = bindings
    .filter((d) => d.kind === "shared")
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .map((d) => ({
      deviceId: d.deviceId,
      ...(d.userAgent ? { userAgent: d.userAgent } : {}),
      lastSeen: d.lastSeen,
      revoked: d.revoked === true,
    }));
  return ok({ devices });
}

export async function renameHousehold(
  input: Organizer & { householdId: unknown; displayName: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  const name = householdName(input.displayName);
  if (!name.ok) return name;

  // Re-read for the write, so a claim or founding that landed since is kept.
  const household = (await deps.repo.getHousehold(owned.value.id)) ?? owned.value;
  const renamed = { ...household, displayName: name.value };
  await deps.repo.putHousehold(renamed);
  return ok(await describe(renamed, input, deps));
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** A kid an owner adds ahead of the first game, so their face is on the tablet. */
export async function addProfile(
  input: Organizer & { householdId: unknown; displayName: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  const name = await profileName(owned.value.id, input.displayName, null, deps);
  if (!name.ok) return name;

  await createProfile(owned.value.id, name.value, deps);
  return ok(await describe(owned.value, input, deps));
}

export async function renameProfile(
  input: Organizer & { householdId: unknown; playerId: unknown; displayName: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const target = await ownedProfile(input, deps);
  if (!target.ok) return target;
  const { household, player } = target.value;
  const name = await profileName(household.id, input.displayName, player.id, deps);
  if (!name.ok) return name;

  if (!(await deps.repo.updatePlayer({ ...player, displayName: name.value }))) return gone(player);
  return ok(await describe(household, input, deps));
}

/**
 * Retire a profile, or bring one back (#248). A retired kid is off every
 * picker and no phone can be bound to them; their heroes stay, and so does
 * the profile, because "she's back next term" is the common ending.
 *
 * Retiring also revokes the kid's own phone. A group's kid who stopped coming
 * should not keep a working seat in it, and a phone left playing as a profile
 * nobody can see is the confusing half of that. Bringing them back does not
 * re-bind it: an owner signs in on it (`adoptDevice`), or the kid joins again.
 *
 * And it takes them out of every room the household has open, the way a
 * host's Remove does (`takeOutEverywhere`): a room session already issued
 * lives as long as its room, and revoking the phone does not end it. Retired
 * first, rooms second, so a rejoin in between is refused at the seat. A room
 * that could not be written answers with an error; retiring again finishes it.
 */
export async function setProfileRetired(
  input: Organizer & { householdId: unknown; playerId: unknown; retired: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  if (typeof input.retired !== "boolean") return fail("ILLEGAL", "expected { retired: true | false }");
  const target = await ownedProfile(input, deps);
  if (!target.ok) return target;
  const { household, player } = target.value;

  if (input.retired) {
    if (!(await deps.repo.updatePlayer({ ...player, retired: true }))) return gone(player);
    const devices = await deps.repo.listDevices(household.id);
    for (const device of devices) {
      if (device.kind !== "shared" && device.playerId === player.id && !device.revoked) {
        await deps.repo.revokeDevice(household.id, device.deviceId);
      }
    }
    const out = await takeOutEverywhere(household.id, player.id, deps);
    if (!out.ok) return out;
  } else {
    // A name somebody else took while they were away is a clash on the picker.
    const name = await profileName(household.id, player.displayName, player.id, deps);
    if (!name.ok) return name;
    const { retired: _back, ...active } = player;
    if (!(await deps.repo.updatePlayer(active))) return gone(player);
  }
  return ok(await describe(household, input, deps));
}

/**
 * A code that makes the next device to redeem it this kid (#281): "Play as
 * Ada on another device", from a grown-up who owns her household. It needs no
 * sign-in on the kid's side, so it is the way in for a hospital tablet
 * nobody has bound yet. A retired profile cannot be paired.
 */
export async function pairProfile(
  input: Organizer & { householdId: unknown; playerId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<PairingCode>> {
  const target = await ownedProfile(input, deps);
  if (!target.ok) return target;
  return createPairingCode(
    { householdId: target.value.household.id, playerId: target.value.player.id, createdBy: `owner:${input.cognitoSub}` },
    deps,
  );
}

/**
 * Delete a kid (#252): her profile, her heroes, her phones, and her name from
 * every save that had it (`deleteKid`). Her grown-up's call, so any owner of
 * her home may make it; refused while a hero of hers is mid-adventure. Not
 * through `ownedProfile`, so a delete that died part-way, whose profile
 * already reads as gone, can still be finished by asking again.
 */
export async function deleteProfile(
  input: Organizer & { householdId: unknown; playerId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  if (typeof input.playerId !== "string" || input.playerId === "") return fail("ILLEGAL", "expected { playerId }");
  const deleted = await deleteKid(owned.value, input.playerId, deps);
  if (!deleted.ok) return deleted;
  return ok(await describe(owned.value, input, deps));
}

/** "Delete our data" (#252): the household and everything under it, for its only owner. */
export async function deleteHousehold(
  input: Organizer & { householdId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdDeleted>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  return deleteOwnedHousehold(owned.value, input.cognitoSub, deps);
}

/** How long a kid who stops playing is kept (#252): a window in days, or `null` for until deleted. */
export async function setHouseholdRetention(
  input: Organizer & { householdId: unknown; retentionDays: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  const days = retentionChoice(input.retentionDays);
  if (!days.ok) return days;
  const household = await setRetention(owned.value, days.value, deps);
  return ok(await describe(household, input, deps));
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

/** A code that makes the next grown-up to sign in with it an owner too. */
export async function createOrganizerInvite(
  input: Organizer & { householdId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerInvite>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;

  const nowMs = deps.now();
  const expires = nowMs + INVITE_TTL_MS;
  // A collision in 46 bits is a curiosity, but the write is conditional, so a
  // second roll costs nothing and makes it impossible rather than unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode(deps.random);
    const written = await deps.repo.putOrganizerInviteIfAbsent({
      code,
      householdId: owned.value.id,
      createdBy: input.cognitoSub,
      createdAt: iso(nowMs),
      expiresAt: iso(expires),
      ttl: Math.ceil(expires / 1000),
    });
    if (written) return ok({ code, expiresAt: iso(expires) });
  }
  throw new Error("could not mint an organizer invite code");
}

/**
 * Redeem an invite: the account that signed in becomes an owner of the
 * invite's household, beside whatever it already owns. Misses are counted
 * against the account, as wrong room codes are against an address (#267).
 */
export async function acceptOrganizerInvite(
  input: Organizer & { code: unknown },
  deps: AccountDeps,
): Promise<HandlerResult<OrganizerHouseholdSummary>> {
  const code = typeof input.code === "string" ? normalizeInviteCode(input.code) : "";
  if (code.length !== INVITE_CODE_LENGTH) {
    return fail("ILLEGAL", `An organizer code is ${INVITE_CODE_LENGTH} letters.`);
  }

  const ticket = await admitCodeLookup(`invite:${input.cognitoSub}`, deps);
  if (!ticket) return fail("FORBIDDEN", "Too many wrong codes. Wait a few minutes, then try again.");

  // Spent and joined in one transaction: a failure here leaves the code
  // working, so trying again is the whole recovery.
  const { householdId: _named, ...owner } = ownerRow("", input, deps.now());
  const invite = await deps.repo.redeemOrganizerInvite(code, iso(deps.now()), owner);
  if (!invite) return fail("NOT_FOUND", "That code didn't work. It may be used up or too old; ask for a new one.");
  await ticket.hit();

  const [summary] = await summaries([invite.householdId], deps);
  return summary ? ok(summary) : fail("NOT_FOUND", "That group is gone.");
}

/**
 * Take an owner off the household: another one, or yourself ("leave this
 * group"). The founding owner (`Household.ownerSub`) cannot be removed, which
 * is also what keeps every group with at least one owner.
 */
export async function removeOrganizer(
  input: Organizer & { householdId: unknown; ownerId: unknown },
  deps: AccountDeps,
): Promise<HandlerResult<{ householdId: string; left: boolean }>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  if (typeof input.ownerId !== "string" || input.ownerId === "") return fail("ILLEGAL", "expected { ownerId }");
  if (input.ownerId === owned.value.ownerSub) {
    return fail("ILLEGAL", "The grown-up who started this one can't be taken off it.");
  }
  const owners = await deps.repo.listOwners(owned.value.id);
  if (!owners.some((o) => o.cognitoSub === input.ownerId)) return fail("NOT_FOUND", "That grown-up isn't an organizer here.");

  await deps.repo.removeOwner(owned.value.id, input.ownerId);
  return ok({ householdId: owned.value.id, left: input.ownerId === input.cognitoSub });
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * The household, if this account owns it. Owning is having the `ACCT#`
 * pointer, the same test `adoptDevice` and `forgetDevice` make.
 */
export async function ownedHousehold(
  who: Organizer,
  householdId: unknown,
  deps: Pick<AccountDeps, "repo">,
): Promise<HandlerResult<Household>> {
  if (typeof householdId !== "string" || householdId === "") return fail("ILLEGAL", "expected { householdId }");
  const owned = await deps.repo.listHouseholdsForAccount(who.cognitoSub);
  if (!owned.includes(householdId)) return fail("FORBIDDEN", "that household belongs to a different account");
  const household = await deps.repo.getHousehold(householdId);
  return household ? ok(household) : fail("NOT_FOUND", `no household ${householdId}`);
}

async function ownedProfile(
  input: Organizer & { householdId: unknown; playerId: unknown },
  deps: AccountDeps,
): Promise<HandlerResult<{ household: Household; player: PlayerProfile }>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  if (typeof input.playerId !== "string" || input.playerId === "") return fail("ILLEGAL", "expected { playerId }");
  const player = await deps.repo.getPlayer(owned.value.id, input.playerId);
  return player ? ok({ household: owned.value, player }) : fail("NOT_FOUND", `no player ${input.playerId}`);
}

/** A kid deleted (#252) or moved between reading her and writing her. */
function gone(player: PlayerProfile): HandlerResult<never> {
  return fail("NOT_FOUND", `${player.displayName} isn't here any more.`);
}

function householdName(raw: unknown): HandlerResult<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "" || name.length > HOUSEHOLD_NAME_MAX) {
    return fail("ILLEGAL", `a name of 1 to ${HOUSEHOLD_NAME_MAX} letters`);
  }
  return ok(name);
}

/**
 * A profile's name: short enough for the picker, and nobody else's on it.
 * Two faces with one name are two kids who cannot tell which is theirs, the
 * rule `seatOnSharedDevice` keeps for "Someone new". Retired faces are not on
 * the picker, so their names are free.
 */
async function profileName(
  householdId: string,
  raw: unknown,
  self: string | null,
  deps: Pick<AccountDeps, "repo">,
): Promise<HandlerResult<string>> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name === "" || name.length > NEW_PLAYER_NAME_MAX) {
    return fail("ILLEGAL", `a name of 1 to ${NEW_PLAYER_NAME_MAX} letters`);
  }
  const vetted = vetTypedName(name, name);
  if (!vetted.ok) return vetted;
  const players = await deps.repo.listPlayers(householdId);
  const clash = players.some(
    (p) => p.id !== self && !p.retired && p.displayName.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  return clash ? fail("ILLEGAL", `Someone called ${name} is already here.`) : ok(name);
}

export function ownerRow(householdId: string, who: Organizer, nowMs: number): HouseholdOwnerRecord {
  return {
    householdId,
    cognitoSub: who.cognitoSub,
    ...(who.email ? { email: who.email } : {}),
    addedAt: iso(nowMs),
  };
}

async function describe(
  household: Household,
  who: Organizer,
  deps: Pick<OrganizerDeps, "repo" | "now" | "content">,
): Promise<OrganizerHouseholdView> {
  const [stored, players, characters] = await Promise.all([
    deps.repo.listOwners(household.id),
    deps.repo.listPlayers(household.id),
    deps.repo.listCharacters(household.id),
  ]);
  const adventures = await heroAdventures(characters, deps);

  /*
   * An owner from before #248 (or who only ever claimed) has a pointer and no
   * row. Their first look at this screen writes one, so the other owners can
   * see who they are; an owner with neither is listed from `ownerSub` alone.
   */
  let owners = stored;
  if (!owners.some((o) => o.cognitoSub === who.cognitoSub)) {
    const row = ownerRow(household.id, who, deps.now());
    await deps.repo.putOwner(row);
    owners = [...owners, row];
  }
  const rows: OrganizerOwner[] = owners.map((o) => ({
    id: o.cognitoSub,
    ...(o.email ? { email: o.email } : {}),
    you: o.cognitoSub === who.cognitoSub,
    founding: o.cognitoSub === household.ownerSub,
  }));
  if (household.ownerSub && !owners.some((o) => o.cognitoSub === household.ownerSub)) {
    rows.unshift({ id: household.ownerSub, you: false, founding: true });
  }
  rows.sort((a, b) => Number(b.founding) - Number(a.founding));

  return {
    id: household.id,
    displayName: household.displayName,
    owners: rows,
    players: players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      color: player.color,
      retired: player.retired === true,
      heroes: heroesOf(player.id, characters, adventures),
    })),
    retentionDays: household.retentionDays ?? null,
  };
}

function heroesOf(
  playerId: string,
  characters: readonly Character[],
  adventures: ReadonlyMap<string, string>,
): OrganizerHero[] {
  return characters
    .filter((c) => c.ownerPlayerId === playerId)
    .sort((a, b) => b.committed.xp - a.committed.xp || a.name.localeCompare(b.name))
    .map((c) => {
      const adventure = adventures.get(c.id);
      return {
        id: c.id,
        name: c.name,
        species: c.species,
        class: c.class,
        level: c.committed.level,
        ...(adventure ? { adventure } : {}),
      };
    });
}

/**
 * The campaign each hero is in the middle of (#282), by title: the adventure
 * her claim names, while it is still in flight. What "End this adventure"
 * offers to end.
 */
async function heroAdventures(
  characters: readonly Character[],
  deps: Pick<OrganizerDeps, "repo" | "content">,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const hero of characters) {
    const held = claimOf(hero);
    if (held === null || !(await claimIsLive(held, hero, deps))) continue;
    const { campaignId } = parseClaim(held, hero);
    out.set(hero.id, deps.content.campaign(campaignId)?.title ?? campaignId);
  }
  return out;
}

/**
 * End the adventure a hero is in (#282, architecture §4.5): her provisional
 * gains from it are discarded and her claim released, so another table may
 * seat her. A grown-up's call, from this screen: the phone at a table that
 * refused her offers a new hero instead.
 */
export async function leaveAdventure(
  input: Organizer & { householdId: unknown; characterId: unknown },
  deps: OrganizerDeps,
): Promise<HandlerResult<OrganizerHouseholdView>> {
  const owned = await ownedHousehold(input, input.householdId, deps);
  if (!owned.ok) return owned;
  if (typeof input.characterId !== "string" || input.characterId === "") {
    return fail("ILLEGAL", "expected { characterId }");
  }
  const left = await releaseClaim(owned.value.id, input.characterId, deps);
  if (!left.ok) return left;
  return ok(await describe(owned.value, input, deps));
}

export function inviteCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)] ?? "A";
  }
  return code;
}

/** As typed or pasted: any case, with the dash it is shown with, or spaces. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** What an entry point has parsed from an organizer request. */
export interface OrganizerRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
}

/**
 * Every `/api/organizer/*` route, in one table that `lambda/http.ts` and
 * `dev-server.ts` both call, after verifying the sign-in each in its own way.
 * `null` for a path that is not one of them (a 404).
 */
export function organizerRoute(
  req: OrganizerRequest,
): ((who: Organizer, deps: OrganizerDeps) => Promise<HandlerResult<unknown>>) | null {
  const { body, query } = req;
  const key = `${req.method} ${req.path}`;
  switch (key) {
    case "GET /api/organizer/households":
      return (who, deps) => listOwnedHouseholds(who, deps);
    case "POST /api/organizer/households":
      return (who, deps) => createGroup({ ...who, displayName: body.displayName }, deps);
    case "GET /api/organizer/household":
      return (who, deps) => viewHousehold({ ...who, householdId: query.householdId }, deps);
    case "GET /api/organizer/devices":
      return (who, deps) => listSharedDevices({ ...who, householdId: query.householdId }, deps);
    case "POST /api/organizer/household/rename":
      return (who, deps) =>
        renameHousehold({ ...who, householdId: body.householdId, displayName: body.displayName }, deps);
    case "POST /api/organizer/players":
      return (who, deps) => addProfile({ ...who, householdId: body.householdId, displayName: body.displayName }, deps);
    case "POST /api/organizer/players/rename":
      return (who, deps) =>
        renameProfile(
          { ...who, householdId: body.householdId, playerId: body.playerId, displayName: body.displayName },
          deps,
        );
    case "POST /api/organizer/players/retire":
      return (who, deps) =>
        setProfileRetired(
          { ...who, householdId: body.householdId, playerId: body.playerId, retired: body.retired },
          deps,
        );
    case "POST /api/organizer/players/delete":
      return (who, deps) => deleteProfile({ ...who, householdId: body.householdId, playerId: body.playerId }, deps);
    case "POST /api/organizer/household/delete":
      return (who, deps) => deleteHousehold({ ...who, householdId: body.householdId }, deps);
    case "POST /api/organizer/household/retention":
      return (who, deps) =>
        setHouseholdRetention({ ...who, householdId: body.householdId, retentionDays: body.retentionDays }, deps);
    case "POST /api/organizer/players/pair":
      return (who, deps) => pairProfile({ ...who, householdId: body.householdId, playerId: body.playerId }, deps);
    case "POST /api/organizer/invite":
      return (who, deps) => createOrganizerInvite({ ...who, householdId: body.householdId }, deps);
    case "POST /api/organizer/invite/accept":
      return (who, deps) => acceptOrganizerInvite({ ...who, code: body.code }, deps);
    case "POST /api/organizer/transfer":
      return (who, deps) => createTransferCode({ ...who, householdId: body.householdId, playerId: body.playerId }, deps);
    case "POST /api/organizer/transfer/accept":
      return (who, deps) => acceptTransfer({ ...who, code: body.code, householdId: body.householdId }, deps);
    case "POST /api/organizer/heroes/leave":
      return (who, deps) =>
        leaveAdventure({ ...who, householdId: body.householdId, characterId: body.characterId }, deps);
    case "POST /api/organizer/owners/remove":
      return (who, deps) => removeOrganizer({ ...who, householdId: body.householdId, ownerId: body.ownerId }, deps);
    default:
      return null;
  }
}
