/**
 * `validateNarration()` — architecture §6.5, the gate every live generation
 * passes through before it reaches a screen.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS ACTUALLY DEFENDING AGAINST
 *
 * Not a jailbreak. The input to a live call is a chapter this household wrote
 * and a scene the game itself chose — there is no untrusted party in the loop.
 * What there *is*, is a small fast model writing under a tone constraint for an
 * eight-year-old, at a table, with no adult reading it first. The failure that
 * matters is not malice; it is the model being slightly wrong in a way nobody
 * catches until it is on the television:
 *
 *   - drifting past the tone into something frightening,
 *   - promising an action the game cannot perform ("say the magic word out
 *     loud"), which is worse than useless — a child will try it,
 *   - narrating a scene it has confused with another one,
 *   - answering with an apology, a preamble, or JSON.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY FAILURE IS SILENT
 *
 * §6.5: "Anything that fails is discarded and the authored text is used.
 * Silently. No error surface, no retry loop, no waiting." A rejection is not an
 * error condition — the authored line was always going to be good enough, which
 * is the entire premise of the layer being optional. The `reason` this returns
 * is for a log and a test, and must never reach a player.
 *
 * Every rule here is a *keyword and shape* screen, not a judgement. That is a
 * real limit and worth naming rather than overselling: a screen catches the
 * blunt failures and cannot catch a line that is subtly off. What makes that
 * acceptable is that the fallback is free — this can afford to be strict,
 * because everything it throws away costs the table nothing.
 */

import type { Chapter, Scene } from "@kad/shared";

/** §6.5 — "≤ 240 characters for flavor, ≤ 400 for recaps". */
export const FLAVOR_MAX = 240;
export const RECAP_MAX = 400;

/**
 * The shortest thing worth putting on a screen instead of the authored line.
 *
 * Not in §6.5, and it is here because the empty-ish answers are what a small
 * model actually produces when it has nothing: "Okay!", "...", a bare name. A
 * cap with no floor accepts all of them.
 */
export const FLAVOR_MIN = 20;

/**
 * What is forbidden when a chapter does not say.
 *
 * `llmHints` is optional in the schema, so this is what a chapter written
 * before chapter 7 — or by an author who has not got to the hints yet — gets.
 * The alternative is that a missing block means an *unguarded* validator, which
 * is the wrong way round: the chapters most likely to be missing hints are the
 * ones nobody has looked at through this lens at all.
 *
 * These three are the floor of the game's premise rather than a house style:
 * spec §7.3's "knocked down, never dead" is not a tone preference.
 */
export const DEFAULT_FORBIDDEN = ["death", "blood", "permanent loss"];

export type Verdict = { ok: true; text: string } | { ok: false; reason: string };

function reject(reason: string): Verdict {
  return { ok: false, reason };
}

/**
 * Verbs that promise the player an affordance this game does not have.
 *
 * §6.5: "No second-person imperatives that imply an action the game can't
 * perform." Every entry is something a child would genuinely attempt, and the
 * cost of them trying and nothing happening is that they stop trusting the
 * screen.
 *
 * `choose`, `pick` and `decide` are deliberately **absent**: tapping a labelled
 * choice is the one thing the game does do, and screening them would reject the
 * most natural sentence in a choice-point scene.
 */
const IMPOSSIBLE = [
  // There is no keyboard anywhere in this game (spec: "she taps, she does not
  // type").
  "type",
  "spell out",
  "write down",
  // No microphone.
  "say it out loud",
  "shout",
  "whisper to",
  "repeat after",
  // No free-form verbs: the only inputs are the buttons on the screen.
  "swipe",
  "shake your phone",
  "tilt",
  "press and hold",
  "double tap",
  // No save slots, no undo, no rewind — the run is where it is.
  "go back",
  "start over",
  "try again from",
  "save your game",
  // Nothing off-screen exists.
  "look behind you",
  "ask a grown-up to",
  "close your eyes",
];

/**
 * Shapes that mean the model answered the *request* rather than doing the job.
 *
 * Checked against the opening of the line, because that is where a preamble
 * lives and because these words are all perfectly legal mid-sentence — a wisp
 * may certainly say "sorry".
 */
const PREAMBLE = [
  "here is",
  "here's",
  "sure,",
  "sure!",
  "certainly",
  "of course",
  "i'm sorry",
  "i am sorry",
  "i apologize",
  "i apologise",
  "as an ai",
  "i cannot",
  "i can't",
  "note:",
  "narration:",
  "output:",
];

/** JSON, markdown fences, or a stage direction — a format leak either way. */
function looksStructured(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
  if (trimmed.includes("```")) return true;
  // A key-value leak like `"narration": "..."`, which is what a model trained
  // on structured output reaches for under pressure.
  if (/"\s*\w+\s*"\s*:/.test(trimmed)) return true;
  return false;
}

/**
 * The words a line has to touch to count as being about *this* scene.
 *
 * §6.5: "Must reference an entity present in the current scene." The set is
 * built from what the scene actually names — the creatures in a fight, the NPCs
 * the chapter gave voices to, and the significant words of the authored line
 * itself.
 *
 * The authored line is in there because most scenes have no enemies and no
 * named NPC, and a rule that only fires on encounters is not a rule. Its
 * significant words are the scene's own vocabulary: a line about the hedge wall
 * mentions the hedge, or the wall, or the thorns.
 */
export function sceneEntities(scene: Scene, chapter: Chapter): Set<string> {
  const words = new Set<string>();

  /**
   * Prose — filtered, because most of a sentence identifies nothing.
   *
   * Four letters is the shortest word that carries a subject in this vocabulary
   * ("door", "wisp", "gate"). Below it every line matches every scene through
   * "the" and "you", which would make the rule vacuous.
   */
  const addProse = (raw: string): void => {
    for (const word of raw.toLowerCase().split(/[^a-z0-9']+/i)) {
      if (word.length >= 4 && !STOPWORDS.has(word)) words.add(word);
    }
  };

  /**
   * A name — unfiltered, because it was chosen to identify something.
   *
   * The length rule is about prose and would silently drop the short names,
   * which are common: `pib` is three letters and is the entire reason the
   * chapter has an `npcVoices` block. Filtering it out made a line that named
   * the sprite and nothing else read as off-topic.
   */
  const addName = (raw: string): void => {
    for (const word of raw.toLowerCase().split(/[^a-z0-9']+/i)) {
      if (word.length > 0) words.add(word);
    }
  };

  if (scene.type === "encounter") {
    for (const enemy of scene.enemies) {
      addName(enemy.id);
      if (enemy.name) addName(enemy.name);
    }
  }
  for (const npc of Object.keys(chapter.llmHints?.npcVoices ?? {})) addName(npc);

  const authored = scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
  addProse(authored);

  return words;
}

/**
 * Words that appear in every scene of every chapter and therefore identify
 * none of them. Not a general stopword list — only the ones long enough to
 * survive the length filter above.
 */
const STOPWORDS = new Set([
  "your", "you", "yours", "with", "that", "this", "they", "them", "then",
  "there", "here", "what", "when", "where", "which", "while", "have", "here's",
  "into", "onto", "from", "over", "under", "about", "again", "back", "just",
  "like", "look", "looks", "still", "very", "will", "would", "could", "should",
  "some", "something", "someone", "anything", "everything", "nothing",
  "party", "everyone", "together", "around", "before", "after", "away",
]);

export interface NarrationCheck {
  scene: Scene;
  chapter: Chapter;
  /** The line being replaced. A candidate identical to it is pointless. */
  authored: string;
}

/**
 * The whole gate. Order is cheapest-first, and each rule names itself in the
 * rejection so a dev log says which one fired.
 */
export function validateNarration(candidate: string, context: NarrationCheck): Verdict {
  const text = candidate.trim();

  if (text.length === 0) return reject("empty");
  if (text.length < FLAVOR_MIN) return reject(`too short (${String(text.length)} < ${String(FLAVOR_MIN)})`);
  if (text.length > FLAVOR_MAX) return reject(`too long (${String(text.length)} > ${String(FLAVOR_MAX)})`);
  if (looksStructured(text)) return reject("structured output leaked");

  const lower = text.toLowerCase();

  const opening = lower.slice(0, 40);
  for (const phrase of PREAMBLE) {
    if (opening.startsWith(phrase)) return reject(`preamble: "${phrase}"`);
  }

  /*
   * The chapter's own forbidden list, which is the half of this an author
   * controls (`llmHints.forbidden`). Substring rather than word match on
   * purpose: the entries are topics, not tokens, and an author who forbids
   * "blood" means "bloodied" too.
   */
  for (const banned of context.chapter.llmHints?.forbidden ?? DEFAULT_FORBIDDEN) {
    if (lower.includes(banned.toLowerCase())) return reject(`forbidden topic: "${banned}"`);
  }

  for (const phrase of IMPOSSIBLE) {
    if (lower.includes(phrase)) return reject(`impossible instruction: "${phrase}"`);
  }

  /*
   * On-topic. Skipped when the scene names nothing at all — a scene with no
   * enemies, no voiced NPC and no authored text has no vocabulary to be on
   * topic *about*, and rejecting everything there would silently disable the
   * layer for exactly the scenes with the least authored text to fall back on.
   */
  const entities = sceneEntities(context.scene, context.chapter);
  if (entities.size > 0) {
    const mentioned = [...lower.matchAll(/[a-z0-9']+/g)].some((match) => entities.has(match[0]));
    if (!mentioned) return reject("mentions nothing in this scene");
  }

  // A line identical to the authored one is not wrong, just pointless — and
  // shipping it as "live" would make the layer look like it is working when it
  // is echoing.
  if (lower === context.authored.trim().toLowerCase()) return reject("identical to authored");

  return { ok: true, text };
}

/**
 * The recap's gate — §6.5's second length cap.
 *
 * Deliberately *not* the flavour rules with a bigger number. A recap is about
 * the session as a whole, so "must reference an entity in the current scene"
 * does not apply (there is no current scene), and the authored-text comparison
 * has nothing to compare against — there is no authored recap. What survives is
 * the length band, the format leak, the preamble, and the chapter's forbidden
 * list, which is the part that was ever about safety.
 */
export function validateRecap(candidate: string, chapter: Chapter): Verdict {
  const text = candidate.trim();

  if (text.length === 0) return reject("empty");
  if (text.length < FLAVOR_MIN) return reject(`too short (${String(text.length)} < ${String(FLAVOR_MIN)})`);
  if (text.length > RECAP_MAX) return reject(`too long (${String(text.length)} > ${String(RECAP_MAX)})`);
  if (looksStructured(text)) return reject("structured output leaked");

  const lower = text.toLowerCase();
  const opening = lower.slice(0, 40);
  for (const phrase of PREAMBLE) {
    if (opening.startsWith(phrase)) return reject(`preamble: "${phrase}"`);
  }
  for (const banned of chapter.llmHints?.forbidden ?? DEFAULT_FORBIDDEN) {
    if (lower.includes(banned.toLowerCase())) return reject(`forbidden topic: "${banned}"`);
  }
  for (const phrase of IMPOSSIBLE) {
    if (lower.includes(phrase)) return reject(`impossible instruction: "${phrase}"`);
  }

  return { ok: true, text };
}
