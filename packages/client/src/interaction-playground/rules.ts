/** Local design experiments for #493; no campaign state or network authority. */
export function markerAt(elapsedMs: number): number {
  const phase = ((Math.max(0, elapsedMs) % 3200) / 1600);
  return phase <= 1 ? phase : 2 - phase;
}

export function landsShot(position: number, relaxed: boolean): boolean {
  return Number.isFinite(position) && Math.abs(position - 0.5) <= (relaxed ? 0.3 : 0.15);
}

export function gateReady(players: number, holding: readonly number[]): boolean {
  // Last seat rescues; solo uses a latched prop instead of an impossible hold.
  return Array.from({ length: Math.max(1, players - 1) }, (_, seat) => seat)
    .every((seat) => holding.includes(seat));
}

export const symbols = ["Frog", "Owl", "Fox"] as const;
export type SymbolName = typeof symbols[number];
export const clues = [
  "Start with the frog.",
  "The owl comes immediately before the fox.",
  "Use each animal once.",
] as const;

export function cluesForSeat(seat: number, players: number): readonly string[] {
  return clues.filter((_, index) => index % players === seat);
}

export function bridgeSolved(steps: readonly SymbolName[]): boolean {
  return steps.length === 3 && steps.every((step, index) => step === symbols[index]);
}
