/**
 * Anonymous play and optional sign-in — architecture §4.5.
 *
 * The rule this file exists to protect: **nobody is asked to sign up in order to
 * play.** Somebody opens the app, taps "start a game", and a household exists.
 * It is a real household with real characters in it; the only thing it does not
 * have is an owner, and the only consequence is an expiry date.
 *
 * Signing in later is a *claim*, not a migration. `claimHousehold()` sets an
 * owner on the household the party is already sitting in and drops it out of the
 * sweep index — no ids change, nothing is copied, and the unicorn built twenty
 * minutes ago is the same row afterwards. That is what makes "sign in to keep
 * your characters" an honest offer to make at the end of a session rather than a
 * wall in front of the first one.
 *
 * The reverse — signing in *first*, on a phone that has never played — lands in
 * the same place from the other side: `linkAccount` finds the account has no
 * household and creates a permanent one.
 *
 * Sign-in itself happens between the browser and Cognito (email OTP, then a
 * passkey), so no credential ever reaches this code. What arrives here is an
 * already-verified `cognitoSub`; verification is the entry point's job
 * (`lambda/http.ts`), which is also the only place that knows Cognito exists.
 */

import type { Character, Household, PlayerProfile } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { GuestRenewal } from "../store/repository.ts";
import { newId } from "../ids.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

/**
 * How long an unclaimed household survives. Long enough that "we'll play again
 * next weekend" works and the offer to keep them is still live, short enough
 * that the table is not a graveyard of one-off sessions.
 *
 * This is the *only* thing anonymous play costs you, and it is deliberately much
 * longer than the 6-hour room TTL: the room ending is not the session being
 * forgotten, and a family that plays on Tuesday should still be able to claim
 * those characters on Saturday.
 */
export const GUEST_HOUSEHOLD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Somebody is playing in this household: if it is a guest, its 7 days start
 * again from now. The window is meant as "a week since you last played", not
 * "a week since you first did" — a campaign is eight evenings over weeks, and
 * one fixed from creation would sweep a family's party out from under them
 * halfway through it.
 *
 * Never throws: a store failure comes back as `"error"` (and is logged), so a
 * caller that only wants the week renewed can ignore the result, and a caller
 * about to create something under the household can refuse on `"swept"`.
 */
export async function keepGuestHousehold(
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "now">,
): Promise<GuestRenewal | "error"> {
  try {
    return await deps.repo.extendGuestHousehold(householdId, iso(deps.now() + GUEST_HOUSEHOLD_TTL_MS));
  } catch (err) {
    console.error(`keepGuestHousehold: could not extend ${householdId}:`, err);
    return "error";
  }
}

/** Assigned round-robin so three characters are never the same colour. */
export const PLAYER_COLORS = [
  "#7FD4C1",
  "#F2A65A",
  "#9A8CF2",
  "#E86A92",
  "#63B4E8",
  "#B7D96B",
] as const;

/** Everything here needs storage, tokens, and a clock — nothing else. */
export type AccountDeps = Pick<HandlerDeps, "repo" | "identity" | "now">;

/** A newly bound device: who it is, and the token that proves it. */
export interface BoundDevice {
  principal: DeviceIdentity;
  player: PlayerProfile;
  /** Present only when a *new* device binding was just created. */
  deviceToken: string;
}

// ---------------------------------------------------------------------------
// Anonymous play
// ---------------------------------------------------------------------------

export interface CreateGuestHouseholdInput {
  displayName: string;
  userAgent?: string | undefined;
  /**
   * A TV is opening the room. Its household is a placeholder, so the TV does
   * not found it: the first phone to join does (`Household.awaitingFounder`).
   */
  display?: boolean;
}

/**
 * The anonymous path: one household, one player, one bound device. That device
 * is the household's founder, the one that may later keep it by signing in,
 * unless it is a TV.
 */
export async function createGuestHousehold(
  input: CreateGuestHouseholdInput,
  deps: AccountDeps,
): Promise<BoundDevice & { household: Household }> {
  const nowMs = deps.now();
  const householdId = newId("h");
  const household: Household = {
    id: householdId,
    displayName: `${input.displayName}'s household`,
    ownerSub: null,
    guest: true,
    expiresAt: iso(nowMs + GUEST_HOUSEHOLD_TTL_MS),
    createdAt: iso(nowMs),
    awaitingFounder: true,
  };
  await deps.repo.putHousehold(household);

  const bound = await addPlayer(
    {
      householdId,
      displayName: input.displayName,
      userAgent: input.userAgent,
      founding: input.display !== true,
    },
    deps,
  );
  return { ...bound, household: (await deps.repo.getHousehold(householdId)) ?? household };
}

export interface AddPlayerInput {
  householdId: string;
  displayName: string;
  userAgent?: string | undefined;
  /**
   * Found the household if it is still awaiting a founder (default). False
   * only for a TV's own binding, which is a screen, not somebody who plays.
   */
  founding?: boolean;
}

/**
 * A profile plus the device token that *is* that profile from then on (§4.5).
 *
 * Issuing the token here rather than at a later "pair this device" step is what
 * removes the login screen: the response to joining a room already contains the
 * credential the phone will present forever after.
 */
export async function addPlayer(input: AddPlayerInput, deps: AccountDeps): Promise<BoundDevice> {
  const existing = await deps.repo.listPlayers(input.householdId);
  const player: PlayerProfile = {
    id: newId("p"),
    householdId: input.householdId,
    displayName: input.displayName,
    color: PLAYER_COLORS[existing.length % PLAYER_COLORS.length] ?? PLAYER_COLORS[0],
  };
  await deps.repo.putPlayer(player);

  const { token, deviceId } = await deps.identity.issueDeviceToken({
    householdId: input.householdId,
    playerId: player.id,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  if (input.founding !== false) await foundIfVacant(input.householdId, deviceId, deps);
  return {
    principal: { deviceId, householdId: input.householdId, playerId: player.id },
    player,
    deviceToken: token,
  };
}

/**
 * The first phone into a household that is awaiting a founder founds it. On
 * every other household this is a refused conditional write and nothing more.
 * Never fails the join it rides on: a store error costs this household its
 * claim (logged), not the phone its seat.
 */
async function foundIfVacant(householdId: string, deviceId: string, deps: AccountDeps): Promise<void> {
  try {
    await deps.repo.takeFounding(householdId, deviceId);
  } catch (err) {
    console.error(`addPlayer: could not record a founder for ${householdId}:`, err);
  }
}

/**
 * Whether `deviceId` may claim this guest household: its founder, or, on a
 * household made before founders were recorded, any device playing in it (the
 * old rule). Those households are all gone a week after this shipped, and with
 * them this exception; the store applies the same rule in the claim's write.
 */
export function mayClaim(household: Household, deviceId: string): boolean {
  const legacy = household.founderDeviceId === undefined && household.awaitingFounder !== true;
  return legacy || (household.founderDeviceId !== "" && household.founderDeviceId === deviceId);
}

// ---------------------------------------------------------------------------
// Optional sign-in
// ---------------------------------------------------------------------------

export interface LinkAccountInput {
  /** Already verified against the user pool's JWKS by the entry point. */
  cognitoSub: string;
  /** For the household display name on a first-ever sign-in. */
  email?: string | undefined;
  /** The device currently playing, if there is one. Its household is claimed. */
  principal?: DeviceIdentity | null;
  /**
   * The home-screen "Sign in or create an account" button. An account that
   * already owns a household is *signing in*, so it goes back to that household
   * (and the player picker) instead of claiming whatever guest game this phone
   * happened to start first. Only an account with nothing yet keeps the guest
   * household. Off for the end-of-chapter offer, which is explicitly "keep
   * these".
   */
  preferExisting?: boolean;
}

export interface LinkAccountResult {
  householdId: string;
  /** True when a guest household just became permanent — the thing worth saying. */
  claimed: boolean;
  players: PlayerProfile[];
  characters: Character[];
  /** Present only when this call created a household and bound this device to it. */
  deviceToken?: string;
  playerId?: string;
  /**
   * True when the device that asked already plays in `householdId` (it was
   * claimed, or it was already the account's), so there is no player to pick.
   * False means the phone is not yet anybody in this household.
   */
  deviceBound: boolean;
}

/**
 * Attach a Cognito account to a household. Three cases, and they are genuinely
 * different rather than three spellings of one thing:
 *
 * 1. **Playing anonymously right now** → claim this household. The characters on
 *    screen become permanent. This is the case the whole design is for, and
 *    only the device that started the household may do it (#265).
 * 2. **Signing in on a fresh device with an existing account** → resolve their
 *    household and hand back its players. Binding this device to one of them is
 *    a separate, explicit step (`adoptDevice`) because only the human knows
 *    which player they are.
 * 3. **Signing in with no account and no game** → create a permanent household
 *    and bind this device as its first player.
 *
 * A guest household whose owner is someone *else* is not claimable — you can be
 * a visitor in another family's session without inheriting it by signing in.
 * Nor is one this device did not start: a room code is an invitation to play,
 * and every phone that joins with it is bound into the household, so being in
 * it proves nothing about whose it is.
 */
export async function linkAccount(
  input: LinkAccountInput,
  deps: AccountDeps,
): Promise<HandlerResult<LinkAccountResult>> {
  const owned = await deps.repo.listHouseholdsForAccount(input.cognitoSub);
  const playsIn = (householdId: string) => input.principal?.householdId === householdId;

  // Case 1 — a device is already playing. Try to claim what it is playing in,
  // unless this is a sign-in to an account that already has a household.
  const claimGuest = !(input.preferExisting && owned.length > 0);
  if (input.principal) {
    const current = await deps.repo.getHousehold(input.principal.householdId);
    if (!current) return fail("NOT_FOUND", `no household ${input.principal.householdId}`);

    if (current.guest && claimGuest) {
      /*
       * The device that started a guest household claims it by signing in.
       * There is no "adult device" to require (#265): authority is the
       * verified sign-in this call carries, from the one device a room code
       * cannot make you. The store checks the founder again in the claim's own
       * write; this read only picks the answer.
       */
      if (!mayClaim(current, input.principal.deviceId)) {
        // The end-of-chapter offer is drawn only on the founding phone, so this
        // is a stale screen or somebody trying. A sign-in from the home screen
        // goes on to the account's own household, as below.
        if (!input.preferExisting) {
          return fail("FORBIDDEN", "Only the phone that started this game can keep it. Sign in on that one.");
        }
      } else {
        const claimed = await deps.repo.claimHousehold(current.id, input.cognitoSub, input.principal.deviceId);
        if (claimed) return ok(await describe(current.id, true, true, deps));
      }
      // Someone else's already, or not this device's to claim. Fall through to
      // this account's own household.
    } else if (current.ownerSub === input.cognitoSub) {
      // Already theirs — signing in again is not an event.
      return ok(await describe(current.id, false, true, deps));
    }
  }

  // Case 2 — an existing account, on a device that is not (or no longer) bound
  // to a household of theirs.
  const first = owned[0];
  if (first) return ok(await describe(first, false, playsIn(first), deps));

  // Case 3 — a brand new account with nothing to claim.
  const nowMs = deps.now();
  const householdId = newId("h");
  await deps.repo.putHousehold({
    id: householdId,
    displayName: `${input.email?.split("@")[0] ?? "Your"} household`,
    ownerSub: input.cognitoSub,
    guest: false,
    createdAt: iso(nowMs),
  });
  await deps.repo.putAccountPointer(input.cognitoSub, householdId);

  const bound = await addPlayer(
    { householdId, displayName: input.email?.split("@")[0] ?? "Grown-up" },
    deps,
  );
  return ok({
    ...(await describe(householdId, false, true, deps)),
    deviceToken: bound.deviceToken,
    playerId: bound.player.id,
  });
}

export interface AdoptDeviceInput {
  cognitoSub: string;
  householdId: string;
  playerId: string;
  userAgent?: string | undefined;
}

/**
 * Bind the device that just signed in to one of the household's existing
 * players — the "new phone, same family" path from §4.5, taken without another
 * device present to show a pairing QR.
 *
 * Signing in is the only thing that can do this. Every *other* device joins by
 * scanning a QR from a phone that is already bound, which is why this handler
 * insists on an account that actually owns the household rather than trusting
 * the ids in the request.
 */
export async function adoptDevice(
  input: AdoptDeviceInput,
  deps: AccountDeps,
): Promise<HandlerResult<{ deviceToken: string; playerId: string }>> {
  const owned = await deps.repo.listHouseholdsForAccount(input.cognitoSub);
  if (!owned.includes(input.householdId)) {
    return fail("FORBIDDEN", "that household belongs to a different account");
  }
  const player = await deps.repo.getPlayer(input.householdId, input.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.playerId}`);

  const { token } = await deps.identity.issueDeviceToken({
    householdId: input.householdId,
    playerId: player.id,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return ok({ deviceToken: token, playerId: player.id });
}

async function describe(
  householdId: string,
  claimed: boolean,
  deviceBound: boolean,
  deps: AccountDeps,
): Promise<LinkAccountResult> {
  const [players, characters] = await Promise.all([
    deps.repo.listPlayers(householdId),
    deps.repo.listCharacters(householdId),
  ]);
  return { householdId, claimed, deviceBound, players, characters };
}
