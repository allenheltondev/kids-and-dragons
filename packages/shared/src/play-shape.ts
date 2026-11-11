/**
 * The part of a chapter or campaign file that decides how it plays.
 *
 * Gemfall is pinned: an edit to how it plays has to be deliberate
 * (`gemfall-compat.test.ts`). It used to be pinned by a hash of every byte of
 * every file, so a reworded sentence, a new painting or a retuned voice all
 * needed the pin re-taken, in the one file every branch then collided in.
 * This is what gets hashed instead: the file with what is only shown or said
 * taken out.
 *
 * The rule is which way a mistake falls. Fields are taken out by name, from
 * the list below, and **anything not on the list stays in**. A field nobody
 * has classified, or one added next year, counts as play until someone says
 * otherwise, so the pin can be too strict and never too loose.
 *
 * What stays, among other things: scene ids, every `goto`, checks (`stat`,
 * `tn`, `tags`, `roller`), effects, flags, item and class and species gates,
 * `when` conditions on choices, encounters (enemies' numbers, maps, the
 * environment), interactions' targets and answers and how many stages or
 * covers they have, rests, outcomes, goals' and objectives' flags,
 * `discovers`, the campaign's chapter list and route sets.
 *
 * Pure, and no hashing here: this package also runs in a browser. The caller
 * hashes `canonicalJson(playShape(file))`.
 */

/**
 * Fields that are only shown or said. None of these names is used anywhere in
 * the chapter types for something the engine reads to decide an outcome
 * (`types/chapter.ts`, `interactions.ts`, `ItemDef`): effects carry `itemId`,
 * `flag` and `amount`, never a `text`, `name` or `label`. Some are copied into
 * the run so a screen can show them (`art`, `title`, `hint`, `priority`); none
 * changes what a tap does.
 *
 * Before adding a name, check what reads it. `spotlight` looks like staging
 * and ends a player's beat; a rest's `setting` looks like a backdrop and
 * decides whether the camp can be edited there. Both stay pinned.
 */
export const PRESENTATION_KEYS: ReadonlySet<string> = new Set([
  // Words: narrated, printed on a button, or read by a voice.
  "$comment",
  "narration",
  "prompt",
  "hint",
  "title",
  "blurb",
  "label",
  "text",
  "name",
  "cue",
  "actionLabel",
  "objectLabel",
  "supportLabel",
  "reaction",
  "clues",
  // Pictures and sound.
  "icon",
  "art",
  "music",
  "cast",
  "presentation",
  "plate",
  // How a scene is drawn or retold. (Not `spotlight`: marking a scene "next" ends the
  // owner's beat, which changes whose turn it is.)
  "priority",
  // Read only by reports: the pacing report's guess at the time, and how it counts a check.
  "estimatedMinutes",
  "checkKind",
  // The voice the words are read in.
  "voiceGuide",
  // The campaign's story around the chapters: plates before and after, and "Last time…".
  "prologue",
  "epilogues",
  "lastTime",
]);

/**
 * Lists of words where only how many there are is play: a free-play game ends
 * after as many taps as it has `stages`, and a tracking game has as many cups
 * as it has `covers` (`interactions.ts`, `engine.ts`). What each one says is
 * shown, so the list is kept as its length.
 */
export const COUNTED_KEYS: ReadonlySet<string> = new Set(["stages", "covers"]);

/**
 * A narration variant: other words for this party (`NarrationVariant`). It is
 * told from an encounter environment's variant, which changes the fight and
 * shares the key `variants`, by carrying the words themselves.
 */
function isNarrationVariant(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { text?: unknown }).text === "string";
}

/** The file with what is only shown or said taken out. Arrays keep their order: the order of choices is play. */
export function playShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(playShape);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRESENTATION_KEYS.has(key)) continue;
    if (COUNTED_KEYS.has(key) && Array.isArray(child)) {
      out[key] = { count: child.length };
      continue;
    }
    if (key === "variants" && Array.isArray(child)) {
      const kept = child.filter((entry) => !isNarrationVariant(entry)).map(playShape);
      if (kept.length > 0) out[key] = kept;
      continue;
    }
    out[key] = playShape(child);
  }
  return out;
}

/** JSON with every object's keys in order, so the same content always reads the same whatever order it was written in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
