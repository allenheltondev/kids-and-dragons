/**
 * What this device has said about installing (#412), so it is not asked
 * again: the install card was put away, and the app's first launch was
 * answered with "Start fresh". Per-device UI state only, never synced.
 *
 * Bringing a hero over needs no record of its own: pairing leaves a player
 * token behind, and a device with one is never asked.
 */

import { defaultStorage, type KeyValueStorage } from "../store/persistence";

export const INSTALL_HIDDEN_KEY = "kad.install.hidden";
export const FIRST_LAUNCH_KEY = "kad.install.firstLaunch";

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

export function firstLaunchAnswered(storage: KeyValueStorage = defaultStorage()): boolean {
  return read(FIRST_LAUNCH_KEY, storage) === "fresh";
}

export function startFresh(storage: KeyValueStorage = defaultStorage()): void {
  write(FIRST_LAUNCH_KEY, "fresh", storage);
}
