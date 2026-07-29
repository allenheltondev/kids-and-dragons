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

import type { Character, Household, PlayerProfile, Role } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
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
}

/**
 * The anonymous path: one household, one adult player, one bound device.
 *
 * The first device is always `adult` — it is the one that started the game, and
 * `role: child` devices can never pair another device (§4.5). A phone that
 * cannot invite anyone else cannot be the first phone.
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
  };
  await deps.repo.putHousehold(household);

  const bound = await addPlayer(
    { householdId, displayName: input.displayName, role: "adult", userAgent: input.userAgent },
    deps,
  );
  return { ...bound, household };
}

export interface AddPlayerInput {
  householdId: string;
  displayName: string;
  role: Role;
  userAgent?: string | undefined;
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
    role: input.role,
  };
  await deps.repo.putPlayer(player);

  const { token, deviceId } = await deps.identity.issueDeviceToken({
    householdId: input.householdId,
    playerId: player.id,
    role: input.role,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return {
    principal: { deviceId, householdId: input.householdId, playerId: player.id, role: input.role },
    player,
    deviceToken: token,
  };
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
}

/**
 * Attach a Cognito account to a household. Three cases, and they are genuinely
 * different rather than three spellings of one thing:
 *
 * 1. **Playing anonymously right now** → claim this household. The characters on
 *    screen become permanent. This is the case the whole design is for.
 * 2. **Signing in on a fresh device with an existing account** → resolve their
 *    household and hand back its players. Binding this device to one of them is
 *    a separate, explicit step (`adoptDevice`) because only the human knows
 *    which player they are.
 * 3. **Signing in with no account and no game** → create a permanent household
 *    and bind this device as its first adult.
 *
 * A guest household whose owner is someone *else* is not claimable — you can be
 * a visitor in another family's session without inheriting it by signing in.
 */
export async function linkAccount(
  input: LinkAccountInput,
  deps: AccountDeps,
): Promise<HandlerResult<LinkAccountResult>> {
  const owned = await deps.repo.listHouseholdsForAccount(input.cognitoSub);

  // Case 1 — a device is already playing. Try to claim what it is playing in.
  if (input.principal) {
    const current = await deps.repo.getHousehold(input.principal.householdId);
    if (!current) return fail("NOT_FOUND", `no household ${input.principal.householdId}`);

    if (current.guest) {
      /*
       * Adults only. A child's device claiming a household would put the
       * household's ownership — and therefore its revocation rights — behind a
       * credential we promised she would never need (§4.5).
       */
      if (input.principal.role !== "adult") {
        return fail("FORBIDDEN", "only an adult device can claim a household");
      }
      const claimed = await deps.repo.claimHousehold(current.id, input.cognitoSub);
      if (claimed) return ok(await describe(current.id, true, deps));
      // Someone else's already. Fall through to this account's own household.
    } else if (current.ownerSub === input.cognitoSub) {
      // Already theirs — signing in again is not an event.
      return ok(await describe(current.id, false, deps));
    }
  }

  // Case 2 — an existing account, on a device that is not (or no longer) bound
  // to a household of theirs.
  const first = owned[0];
  if (first) return ok(await describe(first, false, deps));

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
    { householdId, displayName: input.email?.split("@")[0] ?? "Grown-up", role: "adult" },
    deps,
  );
  return ok({
    ...(await describe(householdId, false, deps)),
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
    role: player.role,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return ok({ deviceToken: token, playerId: player.id });
}

async function describe(
  householdId: string,
  claimed: boolean,
  deps: AccountDeps,
): Promise<LinkAccountResult> {
  const [players, characters] = await Promise.all([
    deps.repo.listPlayers(householdId),
    deps.repo.listCharacters(householdId),
  ]);
  return { householdId, claimed, players, characters };
}
