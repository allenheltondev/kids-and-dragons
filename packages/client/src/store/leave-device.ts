/**
 * Leaving a device, on the client (server: `handlers/leave-device.ts`).
 *
 * A phone or tablet that plays as one kid can stop: a ward's tablet at
 * discharge, a phone handed down to a sibling, a borrowed one going back.
 * Whoever is holding it can do this, with no grown-up signed in.
 *
 * The server is asked first and the device forgets second. The other order
 * could leave a binding alive that no device holds: harmless to the kid, but
 * a seat on her household's device list that nobody can explain. If the
 * server says the device is already nobody, that is the state being asked
 * for, so the device forgets and carries on.
 */

import type { DeviceStanding } from "@kad/shared";
import { api as defaultApi, ApiError, type Api } from "../sync/client";
import { clearSavedJournal } from "./journal-db";
import {
  defaultStorage,
  forgetPlayerDevice,
  loadPlayerDeviceToken,
  loadSharedDevice,
  tabStorage,
  type KeyValueStorage,
} from "./persistence";

export interface LeaveDeps {
  api: Pick<Api, "deviceStanding" | "leaveDevice">;
  storage: KeyValueStorage;
  tab: KeyValueStorage;
  /** The offline book may live outside `storage` (IndexedDB, #458). */
  clearBook(storage: KeyValueStorage): Promise<void>;
}

function defaultDeps(): LeaveDeps {
  return { api: defaultApi, storage: defaultStorage(), tab: tabStorage(), clearBook: clearSavedJournal };
}

/**
 * Who this device plays as and whether it may leave, or `null` where there is
 * nothing to offer: a device that is nobody, a family tablet (a grown-up
 * forgets those, from the organizer panel), or one the server no longer knows.
 */
export async function standingOfThisDevice(deps: LeaveDeps = defaultDeps()): Promise<DeviceStanding | null> {
  if (loadSharedDevice(deps.storage) !== null) return null;
  const token = loadPlayerDeviceToken(deps.storage);
  if (token === null) return null;
  try {
    return await deps.api.deviceStanding(token);
  } catch {
    // Offline, or a binding already gone: there is nothing true to say, so say nothing.
    return null;
  }
}

/** Takes this device off its kid. Throws with the server's sentence when it refuses. */
export async function leaveThisDevice(deps: LeaveDeps = defaultDeps()): Promise<void> {
  const token = loadPlayerDeviceToken(deps.storage);
  if (token !== null) {
    try {
      await deps.api.leaveDevice(token);
    } catch (err) {
      // 401: the server already counts this device as nobody. Anything else
      // (a refusal, no network) leaves the device exactly as it was.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
  }
  forgetPlayerDevice(deps.storage, deps.tab);
  await deps.clearBook(deps.storage);
}
