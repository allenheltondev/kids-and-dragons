/**
 * Pairing a new device to a kid (#281), on the client: the link a QR carries,
 * and what a device does with a code once it has one.
 *
 * The code is the credential, so nothing here asks who is holding the phone.
 * A QR opens the home screen with the code filled in rather than spending it
 * on load: link previews and prefetchers fetch URLs nobody tapped, and a
 * code spent by a preview is a code the kid never gets to use.
 */

import { api as defaultApi, type Api } from "../sync/client";
import {
  ACCOUNT_RECORD_KEY,
  asPlayerIdentity,
  defaultStorage,
  loadAccount,
  loadIdentity,
  loadPlayerDeviceToken,
  saveIdentity,
  type KeyValueStorage,
} from "./persistence";

/** Query parameter a pairing link carries. The home screen reads it and clears it. */
export const PAIR_PARAM = "pair";

/** Eight letters, as the server mints them. */
export const PAIRING_CODE_LENGTH = 8;

/** What a QR holds: the app's home with the code ready to spend, one tap away. */
export function pairingUrl(origin: string, code: string): string {
  return `${origin}/?${PAIR_PARAM}=${encodeURIComponent(code)}`;
}

/** As typed, pasted or scanned: any case, dash or spaces dropped, capped at the code's length. */
export function normalizePairingInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, PAIRING_CODE_LENGTH);
}

/** The code a `?pair=` link carries, or `null` if the URL has none. */
export function pairingFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(PAIR_PARAM);
  if (raw === null) return null;
  const code = normalizePairingInput(raw);
  return code === "" ? null : code;
}

export interface PairDeps {
  api: Pick<Api, "redeemPairingCode">;
  storage: KeyValueStorage;
}

/**
 * Spend a code on this device: it becomes that kid, with a token of its own.
 *
 * A binding it already held is handed to the server to be revoked and is
 * replaced here, so nothing keeps working that no one holds. Pairing as the
 * same kid again is the same: one live binding for this browser. A grown-up's
 * sign-in record for a different household is dropped, because this device
 * is no longer where that account's game lives.
 */
export async function pairThisDevice(
  code: string,
  deps: PairDeps = { api: defaultApi, storage: defaultStorage() },
): Promise<{ displayName: string }> {
  const previous = loadPlayerDeviceToken(deps.storage);
  const bound = await deps.api.redeemPairingCode(code, previous ?? undefined);

  const identity = loadIdentity(deps.storage);
  saveIdentity(
    asPlayerIdentity(
      { ...identity, householdId: bound.householdId, playerId: bound.playerId, displayName: bound.displayName },
      bound.deviceToken,
    ),
    deps.storage,
  );
  const account = loadAccount(deps.storage);
  if (account && account.householdId !== bound.householdId) deps.storage.removeItem(ACCOUNT_RECORD_KEY);
  return { displayName: bound.displayName };
}
