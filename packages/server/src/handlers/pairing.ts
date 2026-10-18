/**
 * Pairing — a new device becomes a kid (#281, architecture §4.5 "Who owns
 * what").
 *
 * A kid never signs in and never types a password. Her own phone, or a
 * grown-up who owns her household, makes a **one-time code** that names her;
 * the device that redeems it gets a personal binding to her, exactly the one
 * `adoptDevice` gives a signed-in grown-up, and is her from then on. A
 * hospital tablet, a borrowed phone or a wiped one is her again in one scan.
 *
 * The code is the credential, so it is short-lived (ten minutes) and single
 * use, and the worst a stolen one does is let somebody play as her on one
 * device, which an owner can revoke. Redeeming therefore needs no sign-in,
 * and wrong codes are counted per client address like wrong room codes
 * (`code-guard.ts`).
 *
 * Who may make a code: a device personally bound to that profile, or a
 * signed-in owner of her household. A shared tablet is nobody and cannot, and
 * a retired profile cannot be paired, at the making or at the redeeming.
 */

import type { PairingCode, PairingResult, PlayerProfile } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import { admitCodeLookup } from "./code-guard.ts";
import type { AccountDeps } from "./account.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { ROOM_CODE_ALPHABET } from "./room.ts";

export type PairingDeps = AccountDeps & Pick<HandlerDeps, "random">;

/**
 * Eight letters from the room-code alphabet: about 37 bits. With a ten minute
 * life and misses counted per client, a guesser has a few dozen tries against
 * the handful of codes live at once.
 */
export const PAIRING_CODE_LENGTH = 8;

/** Long enough to walk across a ward, short enough that a code left on a screen goes dead. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/**
 * A code for one profile of one household. The caller has already proved the
 * right to ask (a device bound to her, or an owner of her household); this
 * checks the profile is one that can be paired.
 */
export async function createPairingCode(
  input: { householdId: string; playerId: string; createdBy: string },
  deps: PairingDeps,
): Promise<HandlerResult<PairingCode>> {
  const player = await deps.repo.getPlayer(input.householdId, input.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.playerId}`);
  if (player.retired) return fail("ILLEGAL", `${player.displayName} is retired. Bring them back first.`);

  const nowMs = deps.now();
  const expires = nowMs + PAIRING_TTL_MS;
  // A conditional write, so a second roll makes a collision impossible rather than unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = pairingCode(deps.random);
    const written = await deps.repo.putPairingCodeIfAbsent({
      code,
      householdId: input.householdId,
      playerId: player.id,
      createdBy: input.createdBy,
      createdAt: iso(nowMs),
      expiresAt: iso(expires),
      ttl: Math.ceil(expires / 1000),
    });
    if (written) return ok({ code, expiresAt: iso(expires), playerName: player.displayName });
  }
  throw new Error("could not mint a pairing code");
}

/**
 * Her own phone asks for a code. `principal` is a *personal* device binding
 * (`resolveDevice` refuses a shared tablet's token), so the profile is the
 * one the device already is and cannot be named by the request.
 */
export function pairFromDevice(
  principal: DeviceIdentity,
  deps: PairingDeps,
): Promise<HandlerResult<PairingCode>> {
  return createPairingCode(
    { householdId: principal.householdId, playerId: principal.playerId, createdBy: `device:${principal.deviceId}` },
    deps,
  );
}

export interface RedeemInput {
  code: unknown;
  /** Who is asking, for the wrong-code budget. */
  client: string;
  userAgent?: string | undefined;
  /**
   * The binding this device already held, if its request carried a token that
   * still resolves. It is revoked once the new one exists: the client replaces
   * the stored token anyway, so leaving it alive would only strand a working
   * credential for a kid on the owner's device list that nobody holds.
   */
  previous?: DeviceIdentity | null | undefined;
}

export type Paired = PairingResult & { deviceToken: string };

/**
 * Spend a code and bind this device to the profile it names. The code is
 * spent first, by a conditional delete, so of two devices holding one code
 * exactly one is bound. If issuing the binding then fails, the code is gone
 * and the kid asks for another; that is the whole recovery, and a code that
 * stayed redeemable after a failed write would be the worse trade.
 */
export async function redeemPairingCode(
  input: RedeemInput,
  deps: PairingDeps,
): Promise<HandlerResult<Paired> | { slowDown: true }> {
  const code = typeof input.code === "string" ? normalizePairingCode(input.code) : "";
  if (code.length !== PAIRING_CODE_LENGTH) {
    return fail("ILLEGAL", `A pairing code is ${PAIRING_CODE_LENGTH} letters.`);
  }

  const ticket = await admitCodeLookup(`pair:${input.client}`, deps);
  if (!ticket) return { slowDown: true };

  const pairing = await deps.repo.redeemPairingCode(code, iso(deps.now()));
  if (!pairing) return fail("NOT_FOUND", "That code didn't work. It may be used up or too old; ask for a new one.");
  // It was a real code, so it was not a guess.
  await ticket.hit();

  // Re-read now, not at the making: she may have been retired since. The code
  // is already spent, which is right, because it named somebody who cannot be paired.
  const player: PlayerProfile | null = await deps.repo.getPlayer(pairing.householdId, pairing.playerId);
  if (!player || player.retired) return fail("NOT_FOUND", "That player isn't playing here anymore.");

  const { token } = await deps.identity.issueDeviceToken({
    householdId: pairing.householdId,
    playerId: player.id,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });

  if (input.previous) {
    try {
      await deps.repo.revokeDevice(input.previous.householdId, input.previous.deviceId);
    } catch (err) {
      // The pairing worked; a binding that lingers is on the owner's list to revoke.
      console.error(`redeemPairingCode: could not revoke ${input.previous.deviceId}:`, err);
    }
  }
  return ok({
    deviceToken: token,
    householdId: pairing.householdId,
    playerId: player.id,
    displayName: player.displayName,
  });
}

/** This client has used up its wrong-code budget; the entry point answers 429. */
export function isSlowDown(result: Awaited<ReturnType<typeof redeemPairingCode>>): result is { slowDown: true } {
  return "slowDown" in result;
}

function pairingCode(random: () => number): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)] ?? "A";
  }
  return code;
}

/** As typed, pasted or read from a link: any case, with the dash it is shown with, or spaces. */
export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}
