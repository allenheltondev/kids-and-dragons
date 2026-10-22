/**
 * A screen that comes back stops trusting its stream (#264, #413): a fresh
 * one, then everything missed from the last seq (`store.reconnect`).
 *
 * The TV has done this since #264. A phone needs it as much, more so once the
 * game is an installed app: switching to another app and back, locking the
 * screen, or Android freezing the app in the background all leave a stream
 * the network may have killed without a word, and a phone that trusted it
 * would show last scene's question with nothing saying it was old.
 */

import { useEffect } from "react";
import { useGameStore } from "../store";
import { WAKE_COALESCE_MS, onWake } from "./wake";

/*
 * One wake is one fresh stream for the page, however many screens on it are
 * listening: each `onWake` merges only its own burst.
 */
let lastReconnect = -Infinity;

export function useReconnectOnWake(): void {
  useEffect(() => onWake(() => {
    const at = Date.now();
    if (at - lastReconnect < WAKE_COALESCE_MS) return;
    lastReconnect = at;
    useGameStore.getState().reconnect();
  }), []);
}
