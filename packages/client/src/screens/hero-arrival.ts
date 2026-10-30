import type { ResolvedCharacter } from "@kad/shared";

export interface HeroArrivalTicket { runId: string; playerId: string; hero: ResolvedCharacter }
let pending: HeroArrivalTicket | null = null;
const listeners = new Set<() => void>();
export const heroArrivalSnapshot = (): HeroArrivalTicket | null => pending;
export function subscribeHeroArrival(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Called only after this phone successfully creates a hero. Never persisted. */
export function announceHeroArrival(ticket: HeroArrivalTicket): void {
  pending = ticket;
  for (const listener of listeners) listener();
}
export function takeHeroArrival(ticket: HeroArrivalTicket): boolean {
  if (pending !== ticket) return false;
  pending = null;
  for (const listener of listeners) listener();
  return true;
}
