/**
 * A kid's own page (#299): the badges she has earned, and the little she can
 * choose about how it looks.
 *
 * Badges are derived, never stored: every one is a function of what the game
 * already keeps (her heroes' finished campaigns, committed levels and
 * keepsakes, and the finds her home Field Guide credits to her). There is no
 * counter to drift and nothing to migrate, and a badge she earned at another
 * household's table is here because that table wrote it to her heroes.
 *
 * What she can choose is presets only (a color, a frame for each hero, a title
 * from her badges), stored as one small versioned field on her profile
 * (`PlayerProfile.flair`, architecture §3.2). No photos, no free text.
 */

import type { FinishedCampaign, Souvenir } from "./types/domain.js";

/** Bumped when the stored shape of `ProfileFlair` changes (architecture §3.2). */
export const PROFILE_FLAIR_VERSION = 1;

export interface Preset {
  id: string;
  /** What a kid reads on the button. */
  label: string;
}

export const PROFILE_COLORS = [
  { id: "meadow", label: "Meadow" },
  { id: "sky", label: "Sky" },
  { id: "berry", label: "Berry" },
  { id: "sunrise", label: "Sunrise" },
  { id: "moss", label: "Moss" },
  { id: "lagoon", label: "Lagoon" },
  { id: "plum", label: "Plum" },
  { id: "honey", label: "Honey" },
] as const satisfies readonly Preset[];

export const HERO_FRAMES = [
  { id: "plain", label: "Plain" },
  { id: "ivy", label: "Ivy" },
  { id: "stars", label: "Stars" },
  { id: "embers", label: "Embers" },
  { id: "waves", label: "Waves" },
] as const satisfies readonly Preset[];

export type ProfileColorId = (typeof PROFILE_COLORS)[number]["id"];
export type HeroFrameId = (typeof HERO_FRAMES)[number]["id"];

/** What she chose. Each part is absent until she picks, and a preset id or a badge id when she has. */
export interface ProfileFlair {
  v: number;
  color?: ProfileColorId;
  /** Hero id → frame. A hero with no entry is plain. */
  frames?: Record<string, HeroFrameId>;
  /** The id of a badge she has earned. */
  title?: string;
}

/** What a save sends: the whole choice, replacing what she had. A part left out or `null` is cleared. */
export interface FlairChoice {
  color?: ProfileColorId | null;
  frames?: Record<string, HeroFrameId> | null;
  title?: string | null;
}

export interface Badge {
  /** Stable. A campaign's is `finished:<campaignId>`. */
  id: string;
  name: string;
  /** One warm line for the badge's card. */
  blurb: string;
}

/** Everything a badge is computed from, read from rows the game already keeps. */
export interface BadgeInput {
  /** The household she calls home, to tell a friend's table from her own. */
  homeHouseholdId: string;
  /** Her finished campaigns across all her heroes, each with its title. */
  finished: readonly (FinishedCampaign & { title: string })[];
  /** Her heroes' committed levels: a level only counts once a campaign has banked it. */
  heroLevels: readonly number[];
  /** Keepsakes across her heroes, from campaigns that did not end well. */
  souvenirs: readonly Pick<Souvenir, "id">[];
  /** Field Guide entries credited to her. */
  finds: number;
}

/** The finds a badge is given at, smallest first. */
const FIND_BADGES = [
  { at: 1, id: "finds-1", name: "Sharp Eyes", blurb: "You spotted something new and wrote it in the Field Guide." },
  { at: 5, id: "finds-5", name: "Trail Reader", blurb: "Five finds in the Field Guide. Not much gets past you." },
  { at: 15, id: "finds-15", name: "Guide Keeper", blurb: "Fifteen finds! The Field Guide is getting thick." },
] as const;

const LEVEL_BADGES = [
  { at: 3, id: "level-3", name: "Growing Strong", blurb: "One of your heroes reached level 3." },
  { at: 5, id: "level-5", name: "Mighty Hero", blurb: "One of your heroes reached level 5." },
] as const;

/** Every badge she has earned, in the order the page shows them. Pure: the same rows give the same badges. */
export function deriveBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = [];

  // One per campaign, in the order she finished them. A loss ending counts: she saw it through.
  const byDate = [...input.finished].sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Set<string>();
  for (const line of byDate) {
    if (seen.has(line.campaignId)) continue;
    seen.add(line.campaignId);
    badges.push({
      id: `finished:${line.campaignId}`,
      name: `${line.title} Finisher`,
      blurb: "You saw this adventure all the way to the end.",
    });
  }
  if (seen.size >= 3) {
    badges.push({ id: "finished-3", name: "Story Collector", blurb: "Three adventures finished. What a shelf of stories." });
  }
  if (input.finished.some((line) => line.table !== input.homeHouseholdId)) {
    badges.push({ id: "guest-star", name: "Guest Star", blurb: "You finished an adventure at a friend's table." });
  }
  if (input.souvenirs.length > 0) {
    badges.push({ id: "kept-going", name: "Kept Going", blurb: "Things got tricky, and you kept going anyway." });
  }
  for (const level of LEVEL_BADGES) {
    if (input.heroLevels.some((l) => l >= level.at)) badges.push({ id: level.id, name: level.name, blurb: level.blurb });
  }
  for (const find of FIND_BADGES) {
    if (input.finds >= find.at) badges.push({ id: find.id, name: find.name, blurb: find.blurb });
  }
  return badges;
}

/**
 * What a stored `flair` means today, for a kid with these heroes and these
 * badges. Anything unknown is dropped, never an error: a row from a build with
 * more presets, a hero since deleted, or a title no longer earned all read as
 * "not chosen", and the page is plain where it was.
 */
export function readFlair(
  raw: unknown,
  heroIds: ReadonlySet<string>,
  badges: readonly Pick<Badge, "id">[],
): ProfileFlair | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const stored = raw as Record<string, unknown>;
  // No migration steps yet. A row from a newer build is read as unchosen rather than guessed at.
  if (stored["v"] !== PROFILE_FLAIR_VERSION) return null;

  const flair: ProfileFlair = { v: PROFILE_FLAIR_VERSION };
  const color = PROFILE_COLORS.find((c) => c.id === stored["color"]);
  if (color) flair.color = color.id;

  const framesRaw = stored["frames"];
  if (typeof framesRaw === "object" && framesRaw !== null && !Array.isArray(framesRaw)) {
    const frames: Record<string, HeroFrameId> = {};
    for (const [heroId, value] of Object.entries(framesRaw)) {
      const frame = HERO_FRAMES.find((f) => f.id === value);
      if (frame && heroIds.has(heroId)) frames[heroId] = frame.id;
    }
    if (Object.keys(frames).length > 0) flair.frames = frames;
  }

  const title = stored["title"];
  if (typeof title === "string" && badges.some((b) => b.id === title)) flair.title = title;
  return flair;
}

export type FlairChoiceResult = { ok: true; flair: ProfileFlair | null } | { ok: false; message: string };

/**
 * What a kid asked to save, checked. Unlike a stored row, a request that names
 * something that is not there is refused: it means a stale page or a made-up
 * request, and saying so beats quietly saving less than she asked for.
 * `null` fields clear a choice. A request that chooses nothing stores nothing.
 */
export function checkFlairRequest(
  body: unknown,
  heroIds: ReadonlySet<string>,
  badges: readonly Pick<Badge, "id">[],
): FlairChoiceResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "expected { color, frames, title }" };
  }
  const asked = body as Record<string, unknown>;
  const flair: ProfileFlair = { v: PROFILE_FLAIR_VERSION };

  const color = asked["color"];
  if (color !== undefined && color !== null) {
    const found = PROFILE_COLORS.find((c) => c.id === color);
    if (!found) return { ok: false, message: "that color is not one of the choices" };
    flair.color = found.id;
  }

  const frames = asked["frames"];
  if (frames !== undefined && frames !== null) {
    if (typeof frames !== "object" || Array.isArray(frames)) return { ok: false, message: "frames is a map of hero to frame" };
    const chosen: Record<string, HeroFrameId> = {};
    for (const [heroId, value] of Object.entries(frames)) {
      const found = HERO_FRAMES.find((f) => f.id === value);
      if (!found) return { ok: false, message: "that frame is not one of the choices" };
      if (!heroIds.has(heroId)) return { ok: false, message: "frames can only go on your own heroes" };
      if (found.id !== "plain") chosen[heroId] = found.id;
    }
    if (Object.keys(chosen).length > 0) flair.frames = chosen;
  }

  const title = asked["title"];
  if (title !== undefined && title !== null) {
    if (typeof title !== "string" || !badges.some((b) => b.id === title)) {
      return { ok: false, message: "a title has to be one of your badges" };
    }
    flair.title = title;
  }

  const chose = flair.color !== undefined || flair.frames !== undefined || flair.title !== undefined;
  return { ok: true, flair: chose ? flair : null };
}
