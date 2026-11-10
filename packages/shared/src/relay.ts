/** Shared flight rules: render and score the same throw on every screen. */
export type RelayQuality = "clean" | "wobbly" | "wild";
export interface RelayFlight {
  id: number;
  launchedAt: string;
  durationMs: number;
  landing: number;
  quality: RelayQuality;
  aim: number;
  power: number;
  fromId?: string;
  dropped?: boolean;
}
export interface RelayState {
  flight: RelayFlight;
  chances: number;
  cleanPasses: number;
  saves: number;
  streak: number;
  bestStreak: number;
  last: "incoming" | "clean-catch" | "save" | "too-early" | "missed" | "clean-pass" | "wobbly-pass" | "wild-pass" | "rebound";
}
export interface RelayCatchInput { flightId: number; position: number; reach: number }
export interface RelayThrowInput { flightId: number; aim: number; power: number }

export const RELAY_CHANCES = 3;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function relayTarget(pass: number): { aim: number; power: number } {
  return { aim: pass % 2 === 0 ? 0.44 : -0.44, power: 0.64 };
}
/** `scale` is the acting hero's `edgeScale` (#567): a knack forgives a wider throw, a snag a narrower one. */
export function relayThrowQuality(aim: number, power: number, pass: number, relaxed: boolean, scale = 1): RelayQuality {
  const target = relayTarget(pass);
  const spread = (relaxed ? 1.6 : 1) * scale;
  const error = Math.max(Math.abs(aim - target.aim) / (0.22 * spread), Math.abs(power - target.power) / (0.18 * spread));
  return error <= 1 ? "clean" : error <= 2 ? "wobbly" : "wild";
}
export function relayLaunch(id: number, now: string, aim = 0.44, power = 0.64, pass = 0, relaxed = false, fromId?: string, scale = 1): RelayFlight {
  return { id, launchedAt: now, durationMs: Math.round((2500 - power * 900) * (relaxed ? 1.5 : 1)),
    landing: clamp(0.5 + (aim - relayTarget(pass).aim) * 0.45, 0.16, 0.84), quality: relayThrowQuality(aim, power, pass, relaxed, scale), aim, power,
    ...(fromId ? { fromId } : {}) };
}
export function relayStart(now: string): RelayState {
  return { flight: relayLaunch(0, now), chances: RELAY_CHANCES, cleanPasses: 0, saves: 0, streak: 0, bestStreak: 0, last: "incoming" };
}
export function relayPosition(flight: RelayFlight, now: number): number {
  return clamp((now - Date.parse(flight.launchedAt)) / flight.durationMs);
}
/** `scale` is the acting hero's `edgeScale` (#567): it widens or narrows the reach, never the timing. */
export function relayCatchWindow(flight: RelayFlight, relaxed: boolean, scale = 1): { start: number; end: number; radius: number } {
  return { start: relaxed ? 0.4 : flight.quality === "wild" ? 0.76 : flight.quality === "wobbly" ? 0.68 : 0.58,
    end: 0.98, radius: (relaxed ? 0.32 : flight.quality === "wild" ? 0.16 : 0.22) * scale };
}
/** Picking up a fallen object is untimed, but still requires reaching its landing. */
export function relayPickupRadius(relaxed: boolean, scale = 1): number {
  return (relaxed ? 0.32 : 0.25) * scale;
}
export function relayCatchScore(flight: RelayFlight, position: number, reach: number, relaxed: boolean, scale = 1): "clean" | "early" | "miss" | "recover" {
  if (flight.dropped) return Math.abs(reach - flight.landing) <= relayPickupRadius(relaxed, scale) ? "recover" : "miss";
  const window = relayCatchWindow(flight, relaxed, scale);
  if (position < window.start) return "early";
  if ((!relaxed && position > window.end) || Math.abs(reach - flight.landing) > window.radius) return "miss";
  return "clean";
}
