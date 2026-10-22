/**
 * What this device has said about installing (#412), so it is not asked
 * again: the install card was put away, and the app's first launch, which is
 * `pending` from boot until "Start fresh" makes it `fresh`. Per-device UI
 * state only, never synced.
 *
 * Bringing a hero over needs no record of its own: pairing leaves a player
 * token behind, and a device with one is never asked.
 */

import {
  defaultStorage,
  hasDeviceIdentity,
  loadSharedDevice,
  type KeyValueStorage,
} from "../store/persistence";
import { isFirstLaunch, isStandalone, type InstallEnv } from "./detect";

export const INSTALL_HIDDEN_KEY = "kad.install.hidden";
export const FIRST_LAUNCH_KEY = "kad.install.firstLaunch";

export type FirstLaunch = "pending" | "fresh";

function read(key: string, storage: KeyValueStorage): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string, storage: KeyValueStorage): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* private mode or full: asked again next time, which is harmless */
  }
}

export function installCardDismissed(storage: KeyValueStorage = defaultStorage()): boolean {
  return read(INSTALL_HIDDEN_KEY, storage) === "1";
}

export function dismissInstallCard(storage: KeyValueStorage = defaultStorage()): void {
  write(INSTALL_HIDDEN_KEY, "1", storage);
}

/** What is recorded about the app's first launch, if anything. */
export function firstLaunch(storage: KeyValueStorage = defaultStorage()): FirstLaunch | null {
  const value = read(FIRST_LAUNCH_KEY, storage);
  return value === "pending" || value === "fresh" ? value : null;
}

/**
 * At boot, before the first render: if this is the installed app's first
 * launch, say so before any way in (the home screen, a TV's room, a join
 * link) can make this storage somebody. Once recorded, nothing re-decides it.
 */
export function recordFirstLaunch(env: InstallEnv, storage: KeyValueStorage = defaultStorage()): void {
  const first = isFirstLaunch({
    standalone: isStandalone(env),
    hasIdentity: hasDeviceIdentity(storage),
    sharedDevice: loadSharedDevice(storage) !== null,
    recorded: firstLaunch(storage) !== null,
  });
  if (first) write(FIRST_LAUNCH_KEY, "pending", storage);
}

export function startFresh(storage: KeyValueStorage = defaultStorage()): void {
  write(FIRST_LAUNCH_KEY, "fresh", storage);
}
