/**
 * The Field Guide quiz's content (docs/trivia.md §3, §4.3, §5): what the
 * schemas cannot see about `content/trivia/<group>.json` and
 * `content/trivia/ladder.json`.
 *
 * Pure: `triviaBankProblems` takes what validate-content.ts has already
 * loaded and returns every problem, so the tests can hand it small fixtures.
 *
 * The rules, one by one:
 *
 *   - question ids unique across every bank file;
 *   - `entry`, every `also` and `image` name pages of content/field-guide.json;
 *     `also` never repeats the entry; `image` is the entry or one of `also`;
 *   - the spoiler rule (§3.3): any other page whose title (with or without a
 *     leading "The", case-insensitive, whole words) appears in the ask, the
 *     answer or a wrong option is listed in `also`. A title inside a longer
 *     title already matched ("Plains" inside "The Eastern Plains") is that
 *     longer page, not a second one. A plural names the page too ("the
 *     yetis", "Thornguards");
 *   - five or six wrong options, distinct from each other and from the answer
 *     (ignoring case and spacing);
 *   - options under 10 words, the ask under 20; no em dashes; US spelling;
 *   - `link` is "entry" or "shelf", and a `link: "entry"` question's answer is
 *     not the entry's own title (opening the page would give it away);
 *   - every question resolves to a picture that is on disk (§3.5): the page's
 *     `art`, or a class page's gear portrait (shared trivia.ts `triviaPicture`);
 *   - the ladder: rungs ascending and distinct on each track, badge ids unique,
 *     each title a title of content/looks.json whose unlock is
 *     `{ "from": "trivia", "rung": <at> }`, and every trivia look in the
 *     catalog named by the ladder at its rung.
 */

import { triviaPicture } from "../../packages/shared/src/trivia.ts";
import { checkText } from "./spelling-lint.mjs";

export const TRIVIA_DIR = "content/trivia";
export const LADDER = "content/trivia/ladder.json";
const LOOKS = "content/looks.json";

/** Under 10 words: at most 9. */
export const MAX_OPTION_WORDS = 9;
/** Under 20 words: at most 19. */
export const MAX_ASK_WORDS = 19;
export const WRONG_OPTIONS = { min: 5, max: 6 };

const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
const norm = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
const withoutThe = (title) => title.replace(/^the\s+/i, "");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The spellings a page's title is matched by: as written, and without a leading "The". */
export function titleForms(title) {
  const forms = new Set([title.trim()]);
  const bare = withoutThe(title.trim());
  if (bare) forms.add(bare);
  return [...forms];
}

/**
 * A title's plural spellings, its last word made plural the plain English ways
 * ("Yeti" → "Yetis", "Cloud Whale" → "Cloud Whales", "Witch" → "Witches",
 * "Harvest Sprite" → "Harvest Sprites"), so "the yetis" names the Yeti page.
 */
export function pluralForms(form) {
  const m = /^(.*?)(\p{L}+)$/u.exec(form);
  if (!m) return [];
  const [, head, last] = m;
  const out = new Set([`${last}s`]);
  if (/(?:s|x|z|ch|sh)$/i.test(last)) out.add(`${last}es`);
  if (/[^aeiou]y$/i.test(last)) out.add(`${last.slice(0, -1)}ies`);
  if (/f$/i.test(last)) out.add(`${last.slice(0, -1)}ves`);
  return [...out].map((p) => `${head}${p}`);
}

/**
 * Every guide page a text names, by title or its plural: `[{ id, title, index }]`.
 * Longer titles claim their words first, so a shorter title inside one is not a
 * second page.
 */
export function pagesNamed(text, guide) {
  const forms = [];
  for (const [id, entry] of Object.entries(guide.entries ?? {})) {
    if (typeof entry?.title !== "string") continue;
    for (const form of titleForms(entry.title)) {
      forms.push({ id, form });
      for (const plural of pluralForms(form)) forms.push({ id, form: plural });
    }
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  const claimed = [];
  const out = new Map();
  for (const { id, form } of forms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimed.some(([s, e]) => start >= s && end <= e)) continue;
      claimed.push([start, end]);
      if (!out.has(id)) out.set(id, { id, title: guide.entries[id].title, index: start });
    }
  }
  return [...out.values()].sort((a, b) => a.index - b.index);
}

/**
 * @param {object} input
 * @param {{ path: string, data: object }[]} input.files   each content/trivia/<group>.json, parsed and schema-checked
 * @param {object | null} input.ladder                     content/trivia/ladder.json, parsed and schema-checked
 * @param {{ entries: Record<string, object> }} input.guide content/field-guide.json
 * @param {object | null} input.looks                      content/looks.json
 * @param {(path: string) => boolean} input.exists         whether a repo-relative file is there
 * @returns {{ file: string, at: string, problem: string, hint?: string }[]}
 */
export function triviaBankProblems({ files, ladder, guide, looks, exists }) {
  const out = [];
  const entries = guide?.entries ?? {};
  const seen = new Map();

  for (const { path, data } of files) {
    (data?.questions ?? []).forEach((q, i) => {
      const at = `/questions/${i}`;
      const fail = (where, problem, hint) => out.push({ file: path, at: `${at}${where}`, problem, ...(hint ? { hint } : {}) });

      if (seen.has(q.id)) fail("/id", `"${q.id}" is already a question (${seen.get(q.id)})`, "Question ids are unique across every file in content/trivia: a mastered question is remembered by its id.");
      else seen.set(q.id, `${path}${at}`);

      const entry = entries[q.entry];
      if (!entry) fail("/entry", `"${q.entry}" is not a page of content/field-guide.json`, "A question is about one Field Guide page: use its id, such as creature.bone_crawler.");
      const also = Array.isArray(q.also) ? q.also : [];
      also.forEach((id, j) => {
        if (!entries[id]) fail(`/also/${j}`, `"${id}" is not a page of content/field-guide.json`);
        if (id === q.entry) fail(`/also/${j}`, `"${id}" is the question's own entry`, "also lists the other pages it names.");
      });
      if (q.image !== undefined) {
        if (!entries[q.image]) fail("/image", `"${q.image}" is not a page of content/field-guide.json`);
        else if (q.image !== q.entry && !also.includes(q.image)) fail("/image", `"${q.image}" is neither the entry nor in also`, "The picture must be a page she has found (§3.5): list it in also.");
      }

      // Words: counts, em dashes, spelling.
      const texts = [
        ["/ask", q.ask, MAX_ASK_WORDS],
        ["/answer", q.answer, MAX_OPTION_WORDS],
        ...(Array.isArray(q.wrong) ? q.wrong : []).map((w, j) => [`/wrong/${j}`, w, MAX_OPTION_WORDS]),
      ];
      for (const [where, text, max] of texts) {
        if (typeof text !== "string" || !text.trim()) {
          fail(where, "is empty");
          continue;
        }
        if (words(text) > max) fail(where, `"${text}" is ${words(text)} words`, where === "/ask" ? "A question is under 20 words: she reads it alone on a phone (§3.2)." : "An option is under 10 words (§3.2).");
        if (text.includes("—")) fail(where, `"${text}" has an em dash`, "No em dashes in player text (§3.2): use a comma, a colon or two sentences.");
        for (const hit of checkText(text)) fail(where, `"${hit.word}" is not US spelling: use "${hit.suggestion}"`);
      }

      // Options: five or six wrong ones, all different.
      const wrong = Array.isArray(q.wrong) ? q.wrong.filter((w) => typeof w === "string") : [];
      if (wrong.length < WRONG_OPTIONS.min || wrong.length > WRONG_OPTIONS.max) fail("/wrong", `${wrong.length} wrong option(s)`, "Five or six: three are drawn each time it is asked, so remembering a position teaches nothing (§4.2).");
      const options = new Map();
      if (typeof q.answer === "string") options.set(norm(q.answer), "the answer");
      wrong.forEach((w, j) => {
        const key = norm(w);
        if (options.has(key)) fail(`/wrong/${j}`, `"${w}" is the same as ${options.get(key)}`, "Every option reads differently.");
        else options.set(key, `wrong option ${j}`);
      });

      // The spoiler rule (§3.3): every other page it names is in also.
      for (const [where, text] of texts) {
        if (typeof text !== "string") continue;
        for (const named of pagesNamed(text, guide ?? { entries: {} })) {
          if (named.id === q.entry || also.includes(named.id)) continue;
          fail(where, `names "${named.title}" (${named.id}), which is not in also`, "A question is asked only once every page it names is found: list the page in also, or reword (§3.3).");
        }
      }

      // The link (§4.3).
      if (q.link !== "entry" && q.link !== "shelf") fail("/link", "needs a link", 'link is "entry" (open the page) or "shelf" (open its tab, when the answer is the page\'s own name).');
      else if (q.link === "entry" && entry && typeof q.answer === "string") {
        const answer = norm(q.answer);
        if (titleForms(entry.title).some((form) => norm(form) === answer)) {
          fail("/link", `the answer is "${entry.title}", the page's own title`, 'Opening the page would give the answer away: use "link": "shelf" (§4.3).');
        }
      }

      // The picture (§3.5).
      if (entry && (q.image === undefined || entries[q.image])) {
        const picture = triviaPicture(q, guide);
        if (!picture) fail(q.image !== undefined ? "/image" : "/entry", `"${q.image ?? q.entry}" has no picture`, "Every question is asked over a painting (§3.5): a page with no art gets no questions until it has one.");
        else if (!exists(picture.replace(/^\//, ""))) fail(q.image !== undefined ? "/image" : "/entry", `its picture ${picture} is not on disk`, "Run `npm run assets:pull`, or give the page its art first.");
      }
    });
  }

  if (ladder) out.push(...ladderProblems(ladder, looks));
  return out;
}

function ladderProblems(ladder, looks) {
  const out = [];
  const fail = (at, problem, hint, file = LADDER) => out.push({ file, at, problem, ...(hint ? { hint } : {}) });
  const badges = new Map();
  const titles = new Map((looks?.titles ?? []).map((t) => [t.id, t]));
  const named = new Map();
  for (const track of ["rungs", "firstTry"]) {
    let last = 0;
    (ladder[track] ?? []).forEach((rung, i) => {
      const at = `/${track}/${i}`;
      if (!(rung.at > last)) fail(`${at}/at`, `rung ${rung.at} is not above the one before (${last})`, "Each track is smallest first, one rung per count.");
      last = Math.max(last, rung.at);
      if (rung.badge) {
        if (badges.has(rung.badge.id)) fail(`${at}/badge/id`, `badge "${rung.badge.id}" is already ${badges.get(rung.badge.id)}`, "A badge id names one badge.");
        else badges.set(rung.badge.id, at);
        if (rung.badge.blurb?.includes("—") || rung.badge.name?.includes("—")) fail(`${at}/badge`, "has an em dash");
      }
      if (rung.title !== undefined) {
        if (track !== "rungs") fail(`${at}/title`, "the first-try track gives badges only", "docs/trivia.md §5.");
        const title = titles.get(rung.title);
        if (!title) fail(`${at}/title`, `no title "${rung.title}" in ${LOOKS}`, 'Add it to looks.json titles with "unlock": { "from": "trivia", "rung": <at> }.');
        else if (title.unlock?.from !== "trivia" || title.unlock.rung !== rung.at) fail(`${at}/title`, `${LOOKS} title "${rung.title}" is not unlocked by { "from": "trivia", "rung": ${rung.at} }`);
        named.set(rung.title, rung.at);
      }
      if (!rung.badge && rung.title === undefined) fail(at, "gives nothing", "A rung gives a badge, a title, or both; a rung whose reward is owed art waits out of the data.");
    });
  }
  for (const list of ["coats", "specials", "nameplates", "titles"]) {
    (looks?.[list] ?? []).forEach((look, i) => {
      if (look.unlock?.from !== "trivia") return;
      if (named.get(look.id) !== look.unlock.rung) fail(`/${list}/${i}/unlock`, `"${look.id}" is a quiz look the ladder does not give at rung ${look.unlock.rung}`, `Name it in ${LADDER} at that rung, or nothing can grant it.`, LOOKS);
    });
  }
  return out;
}
