/**
 * Chromium's install offer (`beforeinstallprompt`), kept for when a grown-up
 * asks for it (#412).
 *
 * The browser fires it once, early, often before the home screen has mounted,
 * so `listenForInstallPrompt` runs from main.tsx before the first render. The
 * browser's own mini-infobar is held back (`preventDefault`): installing is
 * offered by our quiet card, on the home screen only, never over a game.
 * An offer can be shown once; after that it is spent and the card goes.
 */

import { useSyncExternalStore } from "react";

/** The parts of `BeforeInstallPromptEvent` we use. Not in TypeScript's DOM types. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

let waiting: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function isPromptEvent(event: Event): event is InstallPromptEvent {
  return typeof (event as Partial<InstallPromptEvent>).prompt === "function";
}

/** Start holding the offer. Returns the way to stop, for tests. */
export function listenForInstallPrompt(target: Pick<Window, "addEventListener" | "removeEventListener">): () => void {
  const onOffer = (event: Event): void => {
    if (!isPromptEvent(event)) return;
    event.preventDefault();
    waiting = event;
    emit();
  };
  const onInstalled = (): void => {
    waiting = null;
    emit();
  };
  target.addEventListener("beforeinstallprompt", onOffer);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onOffer);
    target.removeEventListener("appinstalled", onInstalled);
  };
}

/** Whether there is an offer to show. */
export function installPromptReady(): boolean {
  return waiting !== null;
}

/**
 * Show the browser's own install dialog. Whatever the answer, the offer is
 * spent: Chromium refuses a second `prompt()` on the same event.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const offer = waiting;
  if (offer === null) return "unavailable";
  waiting = null;
  emit();
  try {
    await offer.prompt();
    return (await offer.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A component's view of whether the offer is waiting. */
export function useInstallPromptReady(): boolean {
  return useSyncExternalStore(subscribeInstallPrompt, installPromptReady, () => false);
}

/** Tests: forget any held offer. */
export function resetInstallPrompt(): void {
  waiting = null;
  emit();
}
