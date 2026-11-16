/** Ephemeral camp play: no rewards, saved scores, or story state. */
export const CAMP_INSTRUMENTS = ["log", "pot", "bells"] as const;
export type CampInstrument = typeof CAMP_INSTRUMENTS[number];
export type CampPlay =
  | { activity: "music"; instrument: CampInstrument }
  | { activity: "fetch"; friendId: string; aim: number; strength: number; target: number };
export interface CampPlayMessage {
  seq: number;
  runId: string;
  momentId: string;
  heroId: string;
  play: CampPlay;
}
export function readCampPlay(value: unknown): CampPlay | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (p.activity === "music" && CAMP_INSTRUMENTS.includes(p.instrument as CampInstrument)) return { activity: "music", instrument: p.instrument as CampInstrument };
  const percent = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 10 && n <= 90;
  if (p.activity === "fetch" && typeof p.friendId === "string" && p.friendId.length > 0 && p.friendId.length <= 64 && percent(p.aim) && percent(p.strength) && percent(p.target)) {
    return { activity: "fetch", friendId: p.friendId, aim: p.aim, strength: p.strength, target: p.target };
  }
  return null;
}
export function fetchResult(play: Extract<CampPlay, { activity: "fetch" }>): "catch" | "chase" | "search" {
  const distance = Math.hypot(play.aim - play.target, play.strength - 60);
  return distance <= 12 ? "catch" : distance <= 30 ? "chase" : "search";
}
/** What came back is a joke, never an inventory item. */
export function fetchWords(name: string, friendId: string, result: ReturnType<typeof fetchResult>): string {
  if (result === "catch") return `${name} catches your leaf! A perfect toss.`;
  if (result === "chase") return `${name} chases it down. Almost! Try aiming a little closer to the ring.`;
  const gifts: Record<string, string> = { bun: "a very chewed leaf", duckling: "a tiny feather", mosshorn: "a whole branch", kid_goat: "a mouthful of grass", quay_gull: "a shiny pebble", silver_otter: "a smooth stone" };
  return `${name} comes back with ${gifts[friendId] ?? "a surprisingly big stick"}. Try matching the ring's direction and distance!`;
}
