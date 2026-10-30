/**
 * `content/help.json`: the words behind every "?" button, every long-press and the join line on the
 * shared screen (#256). Content, not strings in a component, so a fix is an edit to one file.
 *
 * The ids below are the contract with the client: each is a place a kid can be looking, so a screen
 * that ships without help is a test failure (`help-coverage.test.ts`), not a surprise at the table.
 * The schema (`schemas/help.schema.json`) mirrors this file; where the two disagree, this one wins.
 */

/** Every player surface that has a "?" button. Add a surface here and the content and the tests insist on its help. */
export const HELP_SURFACE_IDS = ["story", "combat", "sheet", "inventory", "map", "guide", "world", "creation"] as const;
export type HelpSurfaceId = (typeof HELP_SURFACE_IDS)[number];

/**
 * What a long-press can land on. The thing's own words (an item's text, a card's summary) come first
 * where it has them; these are the plain explanation of what kind of thing it is.
 */
export const HELP_THING_KINDS = ["card", "buff", "item", "token"] as const;
export type HelpThingKind = (typeof HELP_THING_KINDS)[number];

/** One or two plain sentences and the picture that goes with them. */
export interface HelpEntry {
  /** An icon id from the shared icon set. */
  icon: string;
  text: string;
}

/** One card of the "How to play" reference: a picture, a few words for a title, and what to know. */
export interface HelpTile {
  id: string;
  /** An icon id from the shared icon set. */
  icon: string;
  title: string;
  text: string;
}

export interface HelpContent {
  version: 1;
  surfaces: Record<HelpSurfaceId, HelpEntry>;
  things: Record<HelpThingKind, HelpEntry>;
  /**
   * The one line under the code and QR on the shared screen. It must read true for a four-letter room
   * and a six-letter visitor room alike, so it never counts letters.
   */
  join: HelpEntry;
  /**
   * The quick "How to play" reference behind a button in the "?" sheet: a handful of cards a kid can tap to
   * hear, for the moment they forget what a roll is or how a fight goes. Short, and the same at every table.
   */
  howToPlay: HelpTile[];
}

/** Sentences, counted the way a child hears them: a run of words ended by . ! or ? */
function sentenceCount(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim() !== "").length;
}

/** Words that count the letters of a room code. The join line is read in rooms of both lengths. */
const COUNTS_LETTERS = /\b(?:four|six|4|6)\b|\bletters?\b/i;

/**
 * What the schema cannot say: the voice rules of CLAUDE.md for a child listening to an adult read
 * it off the TV. One or two short sentences, no dashes to stumble over, and a join line that is true
 * of every room. Shared by `content:validate` and the client's coverage test, so the two agree.
 */
export function helpProblems(help: HelpContent): { at: string; message: string }[] {
  const problems: { at: string; message: string }[] = [];
  const entries: [string, HelpEntry][] = [
    ...HELP_SURFACE_IDS.map((id): [string, HelpEntry] => [`/surfaces/${id}`, help.surfaces[id]]),
    ...HELP_THING_KINDS.map((id): [string, HelpEntry] => [`/things/${id}`, help.things[id]]),
    ["/join", help.join],
    ...help.howToPlay.map((tile, i): [string, HelpEntry] => [`/howToPlay/${String(i)}`, tile]),
  ];
  for (const [at, entry] of entries) {
    const sentences = sentenceCount(entry.text);
    if (sentences < 1 || sentences > 2) {
      problems.push({ at: `${at}/text`, message: `${String(sentences)} sentences; help is one or two` });
    }
    if (/[–—]|--/.test(entry.text)) {
      problems.push({ at: `${at}/text`, message: "has a dash; use a comma or a full stop (no em dashes)" });
    }
    if (entry.text.split(/\s+/).length > 28) {
      problems.push({ at: `${at}/text`, message: "is longer than 28 words; it is read aloud to a child" });
    }
  }
  if (help.howToPlay.length < 4 || help.howToPlay.length > 8) {
    problems.push({ at: "/howToPlay", message: "the quick reference is four to eight cards" });
  }
  const seen = new Set<string>();
  help.howToPlay.forEach((tile, i) => {
    if (seen.has(tile.id)) problems.push({ at: `/howToPlay/${String(i)}/id`, message: `"${tile.id}" is used twice` });
    seen.add(tile.id);
    if (tile.title.length > 20) problems.push({ at: `/howToPlay/${String(i)}/title`, message: "is longer than 20 characters; it is a card's heading" });
  });
  if (COUNTS_LETTERS.test(help.join.text)) {
    problems.push({
      at: "/join/text",
      message: "counts the letters of the code; a visitor room's code is longer than a family room's, so the line must not say how many",
    });
  }
  if (sentenceCount(help.join.text) !== 1) {
    problems.push({ at: "/join/text", message: "the join step is one line, one sentence" });
  }
  return problems;
}
