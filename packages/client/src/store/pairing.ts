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

/** "ABCDEFGH" → "ABCD-EFGH": four and four, easier to read out across a ward. */
export function formatPairingCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
