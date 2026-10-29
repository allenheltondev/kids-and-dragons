/**
 * Player names are shown, never spoken (#552, docs/voice-narration-plan.md §8).
 *
 * Decided by the owner: text on screen can say a player's name; audio always
 * says "hero". A hero's name is typed by a child, often their own, so it never
 * goes to a TTS provider, and the device voice says "hero" too, so the table
 * hears the same words whichever voice is speaking.
 *
 * Two layers keep it so:
 *  - each surface that composes a name into a sentence also composes the words
 *    it speaks, in the wording that reads best there (`NAME_BEARING_SURFACES`);
 *  - the `speak()` seam (speak.ts) runs everything through `withoutNames` with
 *    the party's names, so a line a surface forgot, or an engine string that
 *    grows a name later, is reworded before any speaker hears it.
 */

/**
 * Every surface that can put a player-entered name into a spoken line, and the
 * words it says instead. Recorded clips never carry these lines: the voice
 * inventory reads only authored content (tools/voice/inventory.ts), and these
 * are composed at run time, so every one of them is the device voice.
 */
export const NAME_BEARING_SURFACES: readonly { surface: string; shows: string; says: string }[] = [
  { surface: "Whose turn (NarrationPanel)", shows: "Ana's turn to choose", says: "Hero's turn." },
  { surface: "Decision line (NarrationPanel)", shows: "Ana chose: Climb the wall.", says: "Hero chose: Climb the wall." },
  { surface: "Hand-offs (NarrationPanel)", shows: "Ana wants to give Bo a Sunbloom Draught.", says: "Hero wants to give another hero a Sunbloom Draught." },
  { surface: "Rank-ups (engine rankUpLine)", shows: "Ana is a Thornguard Apprentice now!", says: "Hero is a Thornguard Apprentice now!" },
  { surface: "Roll results (DiceOverlay)", shows: "Ana rolled 14, plus 3 from Bo", says: "Hero rolled 14, plus 3 from another hero" },
  { surface: "Fight log and matchups (FightLog)", shows: "Ana hits the bog troll.", says: "Hero hits the bog troll." },
  { surface: "Transform cutscene (TransformCutscene)", shows: "Ana is shining!", says: "Hero is shining!" },
  { surface: "Chapter recap (ChapterCompletePanel)", shows: "Ana earned 10 experience from their own good rolls.", says: "Hero earned 10 experience from their own good rolls." },
  { surface: "Anything else the engine composes with a name", shows: "Ana and Bo found it.", says: "Heroes found it. (the seam's rewording)" },
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name as typed, and with its first letter capitalised for the start of a sentence. */
function spellings(name: string): string[] {
  const capital = name.charAt(0).toUpperCase() + name.slice(1);
  return capital === name ? [name] : [name, capital];
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * `text` with every party name said as "hero", decided by the owner:
 *  - "Ana chose" → "Hero chose", "Ana's turn" → "Hero's turn", "at Ana" → "at hero";
 *  - a list, "Ana, Bo and Cy" → "heroes" ("heroes'" when it owns something).
 *
 * A name is matched as typed or capitalised, as a whole word: lowercase "rose"
 * in a sentence is left alone for a hero called Rose, though a sentence that
 * starts "Rose petals..." is reworded too. Saying "hero" once too often is the
 * price of a name never being said.
 */
export function withoutNames(text: string, names: readonly string[]): string {
  const clean = [...new Set(names.map((n) => n.trim()).filter((n) => n !== "").flatMap(spellings))]
    // Longest first, so "Anabel" is not read as "Ana" and a stray "bel".
    .sort((a, b) => b.length - a.length);
  if (clean.length === 0 || text === "") return text;
  const name = `(?<![\\p{L}\\p{N}_])(?:${clean.map(escape).join("|")})(?![\\p{L}\\p{N}_])`;
  const join = `(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)`;
  const pattern = new RegExp(`${name}(?:${join}${name})*(?:['’]s(?![\\p{L}\\p{N}_]))?`, "gu");
  const one = new RegExp(name, "gu");
  return text.replace(pattern, (match: string, offset: number) => {
    const many = (match.match(one)?.length ?? 1) > 1;
    const possessive = /['’]s$/.test(match);
    const starts = /(^|[.!?:]["”’)]?\s+|\n\s*|^["“‘(]+)$/.test(text.slice(0, offset));
    const said = many ? (possessive ? "heroes'" : "heroes") : possessive ? "hero's" : "hero";
    return starts ? capitalise(said) : said;
  });
}
