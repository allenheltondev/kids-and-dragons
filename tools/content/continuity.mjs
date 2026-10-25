/**
 * Continuity sweep: dangling references in every campaign's prose.
 *
 *   npm run content:continuity            # fail on anything not allow-listed
 *   npm run content:continuity -- --all   # also list the allow-listed ones
 *
 * Every file in content/campaigns is swept: an ordered campaign by its beats
 * (`analyseCampaign`), a graph campaign by its places and ways
 * (`analyseGraphCampaign`). One allow-list serves both.
 *
 * A "dangling reference" is a scene that uses a name (a person, a place, an
 * item: any capitalised word) that some way of arriving at the scene never
 * showed the party. It is a must-analysis. Inside a chapter, knowledge at a
 * scene is the INTERSECTION of what every path into it showed; across
 * chapters, a chapter's entry knowledge is the intersection over every
 * history that can reach it. A name counts as shown by the text of any scene
 * on the way (narration, choice labels, cast, prompts, branch narration), and
 * a scene may use a name it introduces itself (`named X`, `called X`,
 * `X, a ...`, a cast entry).
 *
 * Gated choices (requiresFlag / requiresItem / when: flag, item, count.min>=1) prove whatever
 * the setters of their flag or item showed. All of that lives in ONE function,
 * `gateProves` (variants share `conditionProves`); `when` and `variants` (#160)
 * are taught there and in `gateConditions` / `whenConditions`.
 *
 * The road weave is modelled from data, never from a table here. A chapter is
 * selected by the route flag its `route` names (content/campaigns/*.json
 * `routeSets`, chapter `route: {set, flag}`), and the flag a party holds is
 * whatever the chapters it actually played last set. 3C's failed ford sets
 * `route_wild`; 3B's walk-over sets `route_rush`; so a road flag never proves
 * which chapter 3 was played. What a route flag proves is computed from the
 * histories that END holding it, not from every history that contains a
 * chapter of that road.
 *
 * LIMITS. This only sees capitalised names. "The jar", "your goat", "that
 * ledger" still need a human read at every merge point (see
 * docs/campaigns/gemfall-authoring.md). It also cannot see through a gate it
 * does not model: those, and ordinary capitalised words, go in
 * tools/content/continuity-allow.json with a one-line reason each. The
 * allow-list is checked both ways: a finding not on it fails, and an entry
 * that no longer matches a finding fails too (stale), so it cannot rot.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");
export const ALLOW_PATH = join(HERE, "continuity-allow.json");

/**
 * Ordinary capitalised words that are not references to anything: months,
 * titles of address, the party's own species, exclamations. Kept here (not in
 * the allow-list) because they are true of every scene. Sentence-initial words
 * that also occur in lowercase somewhere in the corpus are filtered
 * automatically (see `extractNames`); this list is for the rest.
 */
export const STOP_WORDS = new Set([
  "I", "Oh", "Ah", "Hmm", "Mm", "Mmm", "Hm", "Ha", "Ahem", "Psst", "Shh", "Yes", "No", "Okay", "OK", "Hey", "Hello",
  "Wow", "Yay", "Uh", "Aha", "Ooh", "Ow", "Whoa", "Phew", "Pfft", "Tsk", "Eek", "Ugh", "Yum", "Hurray", "Hooray",
  "Welcome", "Please", "Thank", "Thanks", "Sorry", "Good", "Mr", "Mrs", "Ms", "Dr", "Sir",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "The", "A", "An", "Who", "What", "When", "Where", "Why", "How", "To", "There", "This", "That", "These", "Those", "If", "And",
  "But", "Or", "So", "Then", "For", "In", "On", "At", "Of", "With", "Not", "Now", "One", "Two", "Three", "Four", "Five", "Six",
  "Seven", "Eight", "Nine", "Ten",
  "Unicorn", "Dragon", "Dragons", "Phoenix", "Mermaid", "Pegasus", "Griffin", "Fairy", "Goat", "Kraken", "Yeti", "Mantis",
]);

// ---------------------------------------------------------------------------
// Names in text

const WORD = /[A-Za-z][A-Za-z'’]*/g;
const INTRO_VERBS =
  /\b(?:named|called|name is|name's|name’s|known as|nicknamed|goes by|go by|answers to|calls? (?:himself|herself|itself|themself|themselves|it|you|them|this)|files you as|dubbed|dubs (?:it|you|them)|titled|labelled|labeled|nicknames (?:it|him|her|them)|introduces (?:himself|herself|itself|themself|themselves) as)\s+(?:the\s+)?((?:[A-Z][\w'’]*)(?:\s+[A-Z][\w'’]*)*)/g;
/** "a black tower: Redspire Citadel": a colon hands over the name. */
const COLON_NAME = /:\s+(?:the\s+)?((?:[A-Z][\w'’]*)(?:\s+[A-Z][\w'’]*)*)/g;
/** "Hessa's people, the Deep Hollow choir": a comma and an article gloss the name. */
const COMMA_THE = /,\s+the\s+((?:[A-Z][\w'’]*)(?:\s+[A-Z][\w'’]*)*)/g;
const KIN =
  /\b(?:daughter|son|child|kid|brother|sister|cousin|aunt|uncle|friend|mother|father|grandmother|grandfather|pal|partner|apprentice|assistant|boss|captain|cook|guard|clerk|boy|girl|goat|pony|dog|cat|bird|pet)[,\s]+([A-Z][a-z][\w'’]*)/g;
/** "Parsnip the donkey": a name followed by what it is. */
const NAME_THE_NOUN = /\b([A-Z][a-z][\w'’]*) the [a-z]+/g;
const APPOSITIVE = /\b([A-Z][a-z][\w'’]*),\s+(?:a|an|the|your|their|his|her|its|one)\b/g;
const OPENERS = /["“‘'(\[]/;

/** `{facets}` and `{party}` are filled in at the table; they are not names. */
function stripTokens(text) {
  return String(text ?? "").replace(/\{[a-z_]+\}/g, (m) => " ".repeat(m.length));
}

/** Strips a possessive or contraction: Gullet's -> Gullet. */
function stem(token) {
  return token.replace(/['’](?:s|d|ll|re|ve|m)$/i, "").replace(/['’]$/, "");
}

/** A capitalised token that could be a name: not ALL CAPS, not "I'm". */
function isCapitalised(token) {
  const t = stem(token);
  return /^[A-Z]/.test(t) && t.length > 1 && /[a-z]/.test(t);
}

/**
 * What the corpus says about its own words: `lower` are words seen in
 * lowercase ("gate", "then"), `midCaps` are words seen capitalised in the
 * middle of a sentence ("Gullet", "Hollow"). A sentence-initial capital is a
 * name only when the corpus capitalises it elsewhere, which is what drops
 * "Convince the caravan" and "Nobody laughs" without a word list.
 */
export function buildVocabulary(texts) {
  const lower = new Set();
  const midCaps = new Set();
  for (const text of texts) {
    for (const t of scanTokens(text)) {
      if (!t.cap) {
        if (/^[a-z]/.test(t.name)) lower.add(t.name);
      } else if (!t.sentenceStart) midCaps.add(t.name);
    }
  }
  return { lower, midCaps };
}

/** Word tokens with their position in the sentence and whether they are capitalised. */
function scanTokens(text) {
  const out = [];
  if (!text) return out;
  text = stripTokens(text);
  for (const m of text.matchAll(WORD)) {
    const name = stem(m[0]);
    let i = m.index - 1;
    while (i >= 0 && text[i] === " ") i--;
    const sentenceStart = i < 0 || OPENERS.test(text[i]) || /[.!?]/.test(text[i]);
    out.push({ name, index: m.index, end: m.index + m[0].length, cap: isCapitalised(m[0]), sentenceStart });
  }
  return out;
}

/**
 * Every name used in `text`, as phrases.
 *
 * A run of adjacent capitalised words is one candidate. If it holds a word
 * that is not an ordinary lowercase word anywhere ("Thrum" in "Mother Thrum")
 * the name is that word; if every word is ordinary ("Great River") the name
 * is the whole phrase. A sentence-initial capital counts only when the corpus
 * capitalises the word mid-sentence somewhere (`buildVocabulary`).
 */
export function extractNames(text, vocab = { lower: new Set(), midCaps: new Set() }, stop = STOP_WORDS, shown = null) {
  const names = new Set();
  const toks = scanTokens(text);
  let run = [];
  let prevEnd = -1;
  // "Wardens" and "Warden" are one name when the corpus uses the singular.
  const singular = (n) => (n.length > 3 && n.endsWith("s") && vocab.midCaps.has(n.slice(0, -1)) ? n.slice(0, -1) : n);
  const flush = () => {
    if (run.length) {
      // Reading "Nan Rummage" shows Nan too, though only Rummage is distinctive.
      if (shown) for (const t of run) shown.add(t.name);
      const distinctive = run.filter((t) => !vocab.lower.has(t.name[0].toLowerCase() + t.name.slice(1)));
      if (distinctive.length) for (const t of distinctive) names.add(singular(t.name));
      else names.add(run.map((t) => t.name).join(" "));
    }
    run = [];
  };
  for (const t of toks) {
    const ordinary = vocab.lower.has(t.name[0].toLowerCase() + t.name.slice(1));
    const ok = t.cap && !stop.has(t.name) && !(t.sentenceStart && (ordinary || !vocab.midCaps.has(t.name)));
    if (!ok) {
      flush();
    } else {
      if (run.length && !/^[ -]$/.test(text.slice(prevEnd, t.index))) flush();
      run.push(t);
      prevEnd = t.end;
    }
  }
  flush();
  return names;
}

/** A name phrase and each word in it: what reading "Great River" shows. */
export function shownBy(names) {
  const out = new Set();
  for (const n of names) {
    out.add(n);
    for (const w of n.split(" ")) out.add(w);
  }
  return out;
}

/** Is `name` (a phrase) covered by `known`: itself, or every one of its words. */
export function knows(known, name) {
  return known.has(name) || name.split(" ").every((w) => known.has(w));
}

/**
 * Names `text` introduces for the reader: "a clerk named Pellam", "called
 * Gullet", "Burdock, a goblin ...". Each word of a multi-word name counts.
 */
export function introducedNames(text, stop = STOP_WORDS) {
  const names = new Set();
  if (!text) return names;
  text = stripTokens(text);
  for (const m of text.matchAll(INTRO_VERBS)) {
    for (const w of m[1].split(/\s+/)) if (!stop.has(stem(w))) names.add(stem(w));
  }
  for (const m of text.matchAll(COMMA_THE)) {
    for (const w of m[1].split(/\s+/)) if (!stop.has(stem(w))) names.add(stem(w));
  }
  for (const m of text.matchAll(COLON_NAME)) {
    for (const w of m[1].split(/\s+/)) if (!stop.has(stem(w))) names.add(stem(w));
  }
  for (const m of text.matchAll(KIN)) {
    if (!stop.has(m[1])) names.add(stem(m[1]));
  }
  for (const m of text.matchAll(NAME_THE_NOUN)) {
    if (!stop.has(m[1])) names.add(m[1]);
  }
  for (const m of text.matchAll(APPOSITIVE)) {
    if (!stop.has(m[1])) names.add(m[1]);
  }
  return names;
}

/** Names used in these texts (phrases). */
function mainUses(texts, vocab) {
  const s = new Set();
  for (const t of texts) for (const n of extractNames(t, vocab)) s.add(n);
  return s;
}
/** Names these texts show to a reader (phrases and their words). */
function shownMain(texts, vocab) {
  const shown = new Set();
  for (const t of texts) for (const n of shownBy(extractNames(t, vocab, STOP_WORDS, shown))) shown.add(n);
  return shown;
}

// ---------------------------------------------------------------------------
// Narration variants (#159): `variants: [{when, text, at, replace}]`

/** A `when` that holds for every party: no keys, or only a trivially true partySize. */
export function alwaysTrue(when) {
  if (!when) return true;
  const keys = Object.keys(when).filter((k) => k !== "partySize");
  const ps = when.partySize;
  return keys.length === 0 && (!ps || ((ps.min ?? 0) <= 1 && ps.max === undefined));
}

/**
 * What a text with variants shows on EVERY path (a must-analysis), as shown
 * names. A variant's text is shown only where its `when` held, so it is
 * conservatively NOT counted as showing anything, except:
 *   - an always-true variant (counts as part of the text);
 *   - a `replace` variant, which stands in for the base: only what both the
 *     base and every replacing variant show is guaranteed (an always-true
 *     replacement stands in for the base outright).
 * Uses in variant text are still checked (see `variantChecks`).
 */
export function shownWithVariants(texts, variants, vocab) {
  const list = variants ?? [];
  let shown = shownMain(texts, vocab);
  const replacers = list.filter((v) => v.replace);
  if (replacers.length) {
    const sole = replacers.find((v) => alwaysTrue(v.when));
    shown = sole ? shownMain([sole.text], vocab) : intersect([shown, ...replacers.map((v) => shownMain([v.text], vocab))]);
  }
  for (const v of list) if (!v.replace && alwaysTrue(v.when)) shown = union(shown, shownMain([v.text], vocab));
  return shown;
}

// ---------------------------------------------------------------------------
// What a scene says, and where it goes

/** Words on a cast or enemy entry are shown by the entry itself. */
function nameTokens(name) {
  return String(name ?? "")
    .split(/\s+/)
    .map(stem)
    .filter((w) => isCapitalised(w) || /^[A-Z]/.test(w));
}

/**
 * The text a scene shows when the party arrives, split by where it lives:
 * `main` always appears; `intro` are names the scene hands the reader itself.
 * Branch narration (check / encounter outcomes) is returned per exit by
 * `sceneExits`, because it is shown only on the way out.
 */
export function sceneMain(scene) {
  const main = [scene.narration, scene.prompt].filter(Boolean);
  const intro = new Set();
  for (const c of scene.cast ?? []) for (const t of nameTokens(c.name)) intro.add(t);
  for (const e of scene.enemies ?? []) for (const t of nameTokens(e.name)) intro.add(t);
  for (const t of [...main, ...(scene.choices ?? []).map((c) => c.label)]) {
    for (const n of introducedNames(t)) intro.add(n);
  }
  return { main, intro };
}

/**
 * Every way out of a scene: `{ to, effects, text: [branch narration],
 * choice }`. `choice` is set for player choices, so labels and gates apply.
 */
export function sceneExits(scene) {
  const branch = (b) => ({
    to: b.goto,
    effects: b.effects ?? [],
    text: [b.narration].filter(Boolean),
    variants: b.variants ?? [],
  });
  switch (scene.type) {
    case "check":
      return [branch(scene.onSuccess), branch(scene.onFailure)];
    case "interaction":
      // A story interaction continues by outcome; the helping hand is optional.
      return [scene.onSuccess, scene.onFailure, scene.onAssisted].filter(Boolean).map(branch);
    case "encounter":
      // An environmental fight's other endings (#201) are branches like these.
      return [scene.onVictory, scene.onDefeat, scene.onEscape, scene.onTimeout].filter(Boolean).map(branch);
    default:
      return (scene.choices ?? []).map((choice) => ({
        to: choice.goto,
        effects: choice.effects ?? [],
        text: [],
        variants: [],
        choice,
      }));
  }
}

// ---------------------------------------------------------------------------
// Gates

/**
 * The conditions a choice puts on the party, normalised to `{kind, name}`.
 * Only the ones that PROVE something are returned: a held flag, a held item.
 * (`notFlag`, `notItem`, `count`, `partySize`, `requiresSpecies` and
 * `requiresClass` prove no name was shown.) #160's `when` objects are read
 * here, and only here.
 */
export function gateConditions(choice) {
  const out = [];
  if (choice.requiresFlag) out.push({ kind: "flag", name: choice.requiresFlag });
  if (choice.requiresItem) out.push({ kind: "item", name: choice.requiresItem });
  return out.concat(whenConditions(choice.when));
}

/**
 * The conditions of a #160 `Condition` that PROVE something: a held flag, a
 * held item, and `count` with `min >= 1` (at least one of `of`). `notFlag`,
 * `notItem`, `count` with only a max, and `partySize` prove nothing.
 */
export function whenConditions(when) {
  const out = [];
  if (!when) return out;
  if (when.flag) out.push({ kind: "flag", name: when.flag });
  if (when.item) out.push({ kind: "item", name: when.item });
  const c = when.count;
  if (c && (c.min ?? 0) >= 1) {
    const of = Array.isArray(c.of) ? c.of : [c.of];
    // Several ids, or a `prefix*`: holding the count means holding at least
    // one of them, so what is proved is what ALL of them would prove.
    out.push(of.length === 1 && !of[0].endsWith("*") ? { kind: "item", name: of[0] } : { kind: "any", of });
  }
  return out;
}

/** What a bare `Condition` proves (variants, `when`): `null` when it cannot hold. */
export function conditionProves(when, ctx) {
  return provesAll(whenConditions(when), ctx);
}

function provesAll(conds, ctx) {
  let proved = null;
  for (const cond of conds) {
    const names = proveOne(cond, ctx);
    if (names === null) return null;
    proved = proved ? union(proved, names) : names;
  }
  return proved ?? new Set();
}

/** One condition: names it proves, or `null` if it cannot hold in this history. */
function proveOne(cond, ctx) {
  if (cond.kind === "any") {
    const ids = new Set();
    for (const id of cond.of) {
      if (id.endsWith("*")) {
        for (const known of ctx.itemIds) if (known.startsWith(id.slice(0, -1))) ids.add(known);
      } else ids.add(id);
    }
    const proofs = [];
    let unknownPossible = false;
    for (const id of ids) {
      const p = proveOne({ kind: "item", name: id }, ctx);
      if (p !== null) proofs.push(p);
      else if (!ctx.quest.has(`item:${id}`)) unknownPossible = true;
    }
    if (proofs.length) return intersect(proofs);
    return unknownPossible || ids.size === 0 ? new Set() : null;
  }
  const key = cond.kind === "item" ? `item:${cond.name}` : cond.name;
  const sources = [];
  if (ctx.entry.maybeHeld.has(key)) sources.push(ctx.entry.flagK.get(key) ?? ctx.entry.K);
  if (ctx.setterK.has(key)) sources.push(ctx.setterK.get(key));
  if (!sources.length) return cond.kind === "flag" || ctx.quest.has(key) ? null : new Set();
  return intersect(sources);
}

/**
 * THE gate function. What taking `choice` proves was shown, beyond what the
 * path already knew: for each condition, the names every possible source of
 * the flag or item showed, taken as the intersection over sources. Reads
 * `requiresFlag`, `requiresItem` and the `when` of #160 (flag, item,
 * count.min >= 1), and nothing else. Variants go through `conditionProves`,
 * which shares `proveOne`.
 *
 * Sources of a flag: the histories that arrive holding it (`entry.flagK`,
 * computed from the chapters' ENDINGS that left it standing) and every
 * `setFlag` in this chapter (`ctx.setterK`, filled as the analysis runs).
 *
 * Returns `null` when the gate cannot hold in this history: a flag nobody
 * set, or a quest item (a facet) the party never picked up. The choice is
 * hidden at runtime, so the caller drops it instead of judging its label. A
 * plain item with no visible source proves nothing but stays (the party may
 * carry it from somewhere the analysis does not track).
 */
export function gateProves(choice, ctx) {
  return provesAll(gateConditions(choice), ctx);
}

// ---------------------------------------------------------------------------
// Set helpers

function intersect(sets) {
  const [first, ...rest] = sets;
  const out = new Set();
  for (const x of first) if (rest.every((s) => s.has(x))) out.add(x);
  return out;
}
function union(a, b) {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
/** Meet for a map slot: intersect with what is already there, if anything. */
function meetInto(map, key, set) {
  const old = map.get(key);
  map.set(key, old ? intersect([old, set]) : new Set(set));
}

// ---------------------------------------------------------------------------
// One chapter

/**
 * @typedef {object} Entry
 * @property {Set<string>} K              names every history reaching the chapter showed
 * @property {Map<string,Set<string>>} flagK  per flag (or `item:ID`): names shown by the histories that hold it
 * @property {Set<string>} maybeHeld      flags (and `item:ID`) some history arrives holding
 * @property {Map<string,string>} held    the route-selecting sets (e.g. road, pursuit) -> flag
 */

/**
 * Must-analysis over one chapter's scene graph, from one entry state.
 *
 * Nodes are (scene, route flags written so far), like route-paths.mjs, so
 * the chapter's endings can be told apart by the flags they leave standing.
 * Returns:
 *   dangling   Map<sceneId, Set<name>>  used, not shown by some way in
 *   endings    [{ scene, written: Map<set,flag|null>, K, granted: Set<item> }]
 *   visited    Set<sceneId>
 */
export function analyseChapter(chapter, entry, { flagToSet, vocab, quest = new Set(), itemIds = new Set(), props = chapter.props ?? {} }) {
  const scenes = chapter.scenes ?? {};
  const ctx = { entry, setterK: new Map(), quest, itemIds };
  const itemNames = (itemId) => {
    const p = props[itemId];
    return p ? shownMain([`${p.name ?? ""}. ${p.text ?? ""}`], vocab) : new Set();
  };

  let result;
  // Setter knowledge feeds gates, gates feed setter knowledge: iterate to a
  // fixed point. Gains only grow between passes, so it settles quickly.
  const sig = (m) => JSON.stringify([...m].map(([k, v]) => [k, [...v].sort()]).sort());
  for (let pass = 0; pass < 60; pass++) {
    result = onePass(chapter, scenes, entry, ctx, { flagToSet, vocab, itemNames });
    const settled = sig(result.setterK) === sig(ctx.setterK);
    ctx.setterK = result.setterK;
    if (settled) break;
  }
  return result;
}

function onePass(chapter, scenes, entry, ctx, { flagToSet, vocab, itemNames }) {
  const inK = new Map(); // node key -> names every way in showed (must)
  const inM = new Map(); // node key -> names some way in showed (may)
  const nodes = new Map(); // node key -> { id, written }
  const work = [];
  const setterK = new Map();
  const quest = new Set();
  const dangling = new Map();
  const endings = [];
  const writtenKey = (w) => [...w].sort(([a], [b]) => a.localeCompare(b)).map(([s, f]) => `${s}=${f ?? "-"}`).join(",");

  // Route-set flags a path has written so far: set -> flag, or null if cleared.
  const applyWrites = (written, effects) => {
    let w = written;
    for (const eff of effects) {
      if (eff.type !== "setFlag" || !flagToSet.has(eff.flag)) continue;
      const set = flagToSet.get(eff.flag);
      w = new Map(w);
      if (eff.value === false) {
        if (w.get(set) === eff.flag || (!w.has(set) && entry.held.get(set) === eff.flag)) w.set(set, null);
      } else w.set(set, eff.flag);
    }
    return w;
  };

  const startKey = `${chapter.entry}|`;
  nodes.set(startKey, { id: chapter.entry, written: new Map() });
  inK.set(startKey, new Set(entry.K));
  inM.set(startKey, new Set(entry.M));
  work.push(startKey);

  // Pass A: propagate knowledge to a fixed point.
  const out = (key) => {
    const { id } = nodes.get(key);
    const scene = scenes[id];
    const { main } = sceneMain(scene);
    return union(inK.get(key), shownWithVariants(main, scene.variants, vocab));
  };
  const outMay = (key) => {
    const { id } = nodes.get(key);
    const { main } = sceneMain(scenes[id]);
    // May-knowledge takes every variant: some party saw each of them.
    return union(inM.get(key), shownMain([...main, ...(scenes[id].variants ?? []).map((v) => v.text)], vocab));
  };

  let guard = 0;
  while (work.length) {
    if (++guard > 400_000) throw new Error(`continuity: ${chapter.id} did not settle`);
    const key = work.shift();
    const { id, written } = nodes.get(key);
    const scene = scenes[id];
    if (!scene) continue;
    const base = out(key);
    const baseM = outMay(key);
    // Names the scene's own labels show (ungated ones; gated ones are shown only when the gate holds).
    for (const ex of sceneExits(scene)) {
      if (!scenes[ex.to]) continue;
      let known = new Set(base);
      let may = new Set(baseM);
      if (ex.choice) {
        const gained = gateProves(ex.choice, ctx);
        if (gained === null) continue; // hidden in this history
        for (const n of shownMain([ex.choice.label], vocab)) {
          known.add(n);
          may.add(n);
        }
        known = union(known, gained);
        may = union(may, gained);
      }
      known = union(known, shownWithVariants(ex.text, ex.variants, vocab));
      may = union(may, shownMain([...ex.text, ...ex.variants.map((v) => v.text)], vocab));
      // Effects apply in order: the scene's onEnter first, then the exit's.
      const w = applyWrites(written, [...(scene.onEnter ?? []), ...ex.effects]);
      for (const eff of [...(scene.onEnter ?? []), ...ex.effects]) {
        if (eff.type === "grantItem" || eff.type === "grantQuestItem") {
          known = union(known, itemNames(eff.itemId));
          may = union(may, itemNames(eff.itemId));
        }
      }
      const nkey = `${ex.to}|${writtenKey(w)}`;
      const prev = inK.get(nkey);
      const next = prev ? intersect([prev, known]) : known;
      const prevM = inM.get(nkey);
      const nextM = prevM ? union(prevM, may) : may;
      if (!prev || !sameSet(prev, next) || !sameSet(prevM, nextM)) {
        inK.set(nkey, next);
        inM.set(nkey, nextM);
        nodes.set(nkey, { id: ex.to, written: w });
        work.push(nkey);
      }
    }
  }

  // Setters: the knowledge at the moment a flag is set or an item is granted.
  const recordSetter = (eff, at) => {
    if (eff.type === "setFlag" && eff.value !== false) meetInto(setterK, eff.flag, at);
    if (eff.type === "grantItem" || eff.type === "grantQuestItem") {
      meetInto(setterK, `item:${eff.itemId}`, union(at, itemNames(eff.itemId)));
      // Only quest items (the facets) survive the chapter boundary.
      if (eff.type === "grantQuestItem") quest.add(`item:${eff.itemId}`);
    }
  };

  // Pass B: with settled knowledge, find uses, setters and endings.
  for (const [key, { id, written }] of nodes) {
    const scene = scenes[id];
    if (!scene) continue;
    const known = inK.get(key);
    const knownM = inM.get(key);
    const { main, intro } = sceneMain(scene);
    const mainSet = mainUses(main, vocab);
    const base = union(known, shownWithVariants(main, scene.variants, vocab));
    // Dangling means SOME way in showed the name and some way did not (a merge
    // point). A name no way in has shown is the scene coining it, not citing it.
    // A name is recorded as `lack` where some way in missed it and `may` where
    // some way in had it. The campaign pass intersects the two over EVERY
    // history, because one chapter is analysed once per road it can be reached
    // by, and the way in that lacked a name is often a different road's.
    const miss = (names, have, haveM, extraIntro = intro) => {
      for (const n of names) {
        if (knows(extraIntro, n)) continue;
        if (!dangling.has(id)) dangling.set(id, { lack: new Set(), may: new Set() });
        const rec = dangling.get(id);
        if (!knows(have, n)) rec.lack.add(n);
        if (knows(haveM, n)) rec.may.add(n);
      }
    };
    // A variant's text is checked against what its own `when` proves, and may
    // introduce a name itself. A variant that cannot hold in this history is skipped.
    const variantChecks = (variants, have, haveM, sceneIntro) => {
      for (const v of variants ?? []) {
        const gain = conditionProves(v.when, ctx);
        if (gain === null) continue;
        const own = union(sceneIntro, introducedNames(v.text));
        miss(mainUses([v.text], vocab), union(have, gain), union(haveM, gain), own);
      }
    };
    miss(mainSet, known, knownM);
    variantChecks(scene.variants, known, knownM, intro);
    const exits = sceneExits(scene);
    for (const ex of exits) {
      let gained = new Set();
      if (ex.choice) {
        gained = gateProves(ex.choice, ctx);
        if (gained === null) continue;
        miss(mainUses([ex.choice.label], vocab), union(known, gained), union(knownM, gained));
      }
      miss(mainUses(ex.text, vocab), base, union(knownM, shownMain(main, vocab)));
      variantChecks(ex.variants, base, union(knownM, shownMain(main, vocab)), intro);
      // Setters: the knowledge at the moment the flag or item is granted.
      let k = base;
      if (ex.choice) k = union(union(k, shownMain([ex.choice.label], vocab)), gained);
      k = union(k, shownWithVariants(ex.text, ex.variants, vocab));
      for (const eff of ex.effects) recordSetter(eff, k);
    }
    for (const eff of scene.onEnter ?? []) recordSetter(eff, base);
    if (exits.length === 0) {
      // An ending's own onEnter still happens: `setFlag` here is how most
      // chapters write their route sets.
      const granted = (scene.onEnter ?? []).filter((e) => e.type === "grantItem" || e.type === "grantQuestItem");
      const extra = granted.reduce((acc, e) => union(acc, itemNames(e.itemId)), new Set());
      endings.push({
        scene: id,
        written: applyWrites(written, scene.onEnter ?? []),
        K: union(out(key), extra),
        M: union(outMay(key), extra),
      });
    }
  }
  return { dangling, endings, setterK, quest, visited: new Set([...nodes.values()].map((n) => n.id)) };
}

// ---------------------------------------------------------------------------
// The whole campaign

/**
 * Reads a campaign and its chapters from disk. `from` reads one from
 * somewhere other than `content/`: `{ file, chapters }`, the campaign file
 * and its chapters' directory (a fixture keeps both beside its tests).
 */
export function loadCampaign(campaignId = "gemfall", root = REPO, from = null) {
  const file = from?.file ?? join(root, "content", "campaigns", `${campaignId}.json`);
  const chapterDir = from?.chapters ?? join(root, "content", "chapters");
  const campaign = JSON.parse(readFileSync(file, "utf8"));
  const chapters = campaign.chapters.map((id) => JSON.parse(readFileSync(join(chapterDir, `${id}.json`), "utf8")));
  return { campaign, chapters };
}

/** Every campaign in `content/campaigns`, ordered and graph alike, by id. */
export function loadCampaigns(root = REPO) {
  return readdirSync(join(root, "content", "campaigns"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadCampaign(f.slice(0, -".json".length), root));
}

/**
 * The sweep for any campaign: a graph campaign (`campaign.graph`) by its
 * places and ways (`analyseGraphCampaign`), an ordered one by its beats
 * (`analyseCampaign`). Same findings, same allow-list.
 */
export function analyse(campaign, chapters) {
  return campaign.graph ? analyseGraphCampaign(campaign, chapters) : analyseCampaign(campaign, chapters);
}

/** All text a chapter can show, for the vocabulary and for "where else". */
function chapterTexts(chapter) {
  const out = [];
  for (const [id, scene] of Object.entries(chapter.scenes ?? {})) {
    const texts = [scene.narration, scene.prompt, ...(scene.choices ?? []).map((c) => c.label)];
    for (const k of ["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat", "onEscape", "onTimeout"]) texts.push(scene[k]?.narration);
    out.push({ scene: id, texts: texts.filter(Boolean), cast: [...(scene.cast ?? []), ...(scene.enemies ?? [])].map((c) => c.name) });
  }
  return out;
}

/**
 * Runs the sweep. Returns
 *   findings: [{ key, chapter, scene, name, elsewhere: ["chapter/scene", ...] }]
 *   stranded: states that selected no chapter (content:validate's job, surfaced here)
 *   unreached: chapter ids no history reaches
 */
/**
 * What every sweep needs from a campaign's text before it walks anything: the
 * route sets, the vocabulary, where each name appears (for messages), the
 * props, the quest items (which outlive a chapter) and every item id.
 */
function campaignContext(campaign, chapters) {
  const flagToSet = new Map();
  for (const [set, members] of Object.entries(campaign.routeSets ?? {})) for (const f of members) flagToSet.set(f, set);

  const allTexts = chapters.flatMap((c) => chapterTexts(c));
  const vocab = buildVocabulary(allTexts.flatMap((t) => t.texts));

  // Where each name appears, for the "elsewhere" part of a message.
  const appearances = new Map();
  for (const chapter of chapters) {
    for (const { scene, texts, cast } of chapterTexts(chapter)) {
      const here = new Set();
      for (const t of texts) for (const n of shownMain([t], vocab)) here.add(n);
      for (const c of cast) for (const n of nameTokens(c)) here.add(n);
      for (const n of here) {
        if (!appearances.has(n)) appearances.set(n, []);
        appearances.get(n).push(`${chapter.id}/${scene}`);
      }
    }
  }

  // Props are defined where an item is first granted but shown wherever it is.
  const props = Object.assign({}, ...chapters.map((c) => c.props ?? {}));
  const quest = new Set();
  const itemIds = new Set(Object.keys(props));
  for (const c of chapters) {
    for (const scene of Object.values(c.scenes ?? {})) {
      for (const eff of [...(scene.onEnter ?? []), ...sceneExits(scene).flatMap((e) => e.effects)]) {
        if (eff.type === "grantQuestItem") quest.add(`item:${eff.itemId}`);
        if (eff.type === "grantItem" || eff.type === "grantQuestItem") itemIds.add(eff.itemId);
      }
    }
  }
  return { flagToSet, vocab, appearances, props, quest, itemIds };
}

/** Merges one chapter analysis's dangling records into the campaign's. */
function mergeDangling(into, chapterId, dangling) {
  for (const [scene, rec] of dangling) {
    const k = `${chapterId}/${scene}`;
    if (!into.has(k)) into.set(k, { lack: new Set(), may: new Set() });
    for (const n of rec.lack) into.get(k).lack.add(n);
    for (const n of rec.may) into.get(k).may.add(n);
  }
}

/**
 * Dangling records as findings: a name some history into the scene lacked
 * and some history had.
 */
function toFindings(dangling, appearances) {
  const findings = [];
  for (const [k, rec] of [...dangling].sort(([a], [b]) => a.localeCompare(b))) {
    const [chapter, scene] = k.split("/");
    for (const name of [...rec.lack].filter((n) => rec.may.has(n)).sort()) {
      const elsewhere = (appearances.get(name) ?? []).filter((w) => w !== k);
      findings.push({ key: `${k}/${name}`, chapter, scene, name, elsewhere });
    }
  }
  return findings;
}

export function analyseCampaign(campaign, chapters) {
  const { flagToSet, vocab, appearances, props, quest, itemIds } = campaignContext(campaign, chapters);
  const selectors = new Set(chapters.map((c) => c.route?.set).filter(Boolean));
  const byIndex = new Map();
  for (const c of chapters) {
    if (!byIndex.has(c.index)) byIndex.set(c.index, []);
    byIndex.get(c.index).push(c);
  }

  const keyOf = (held) => [...selectors].sort().map((s) => `${s}=${held.get(s) ?? "-"}`).join(",");
  const start = { K: new Set(), M: new Set(), flagK: new Map(), maybeHeld: new Set(), held: new Map() };
  let states = new Map([[keyOf(start.held), start]]);

  const dangling = new Map(); // "chapter/scene" -> Set<name>
  const stranded = [];
  const reached = new Set();

  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const group = byIndex.get(index);
    const next = new Map();
    for (const [skey, state] of states) {
      const chapter =
        group.find((c) => !c.route) ?? group.find((c) => c.route && state.held.get(c.route.set) === c.route.flag);
      if (!chapter) {
        stranded.push({ index, state: skey });
        continue;
      }
      reached.add(chapter.id);
      const res = analyseChapter(chapter, state, { flagToSet, vocab, quest, itemIds, props });
      mergeDangling(dangling, chapter.id, res.dangling);
      for (const end of res.endings) {
        const held = new Map(state.held);
        const standing = new Set();
        const flagK = new Map();
        // Route sets the chapter wrote on this path: the new member stands.
        const writtenSets = new Set(end.written.keys());
        for (const [set, flag] of end.written) {
          if (flag === null) held.delete(set);
          else {
            held.set(set, flag);
            standing.add(flag);
            flagK.set(flag, new Set(end.K));
          }
        }
        // Carried through: flags in sets this path did not write.
        for (const f of state.maybeHeld) {
          if (f.startsWith("item:")) continue;
          if (writtenSets.has(flagToSet.get(f))) continue;
          standing.add(f);
          flagK.set(f, union(state.flagK.get(f) ?? state.K, end.K));
        }
        // Items persist; histories that granted one this chapter showed what its setters did.
        const items = new Set([...state.maybeHeld].filter((f) => f.startsWith("item:")));
        for (const k of res.quest) items.add(k);
        for (const item of items) {
          const sources = [];
          if (state.maybeHeld.has(item)) sources.push(union(state.flagK.get(item) ?? state.K, end.K));
          if (res.setterK.has(item)) sources.push(res.setterK.get(item));
          standing.add(item);
          flagK.set(item, intersect(sources));
        }
        // Held flags that are not route-set members never cross; only sets do.
        const nkey = keyOf(held);
        const prev = next.get(nkey);
        if (!prev) {
          next.set(nkey, { K: new Set(end.K), M: new Set(end.M), flagK, maybeHeld: standing, held });
        } else {
          prev.K = intersect([prev.K, end.K]);
          prev.M = union(prev.M, end.M);
          for (const [f, set] of flagK) meetInto(prev.flagK, f, set);
          for (const f of standing) prev.maybeHeld.add(f);
        }
      }
    }
    states = next;
  }

  return {
    findings: toFindings(dangling, appearances),
    stranded,
    unreached: chapters.filter((c) => !reached.has(c.id)).map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// A graph campaign

/** A graph condition field that names one id or a list of them. */
const ids = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Whether a world-fact test holds for a fact still at its declared `initial`
 * (`FactTest` in packages/shared/src/types/campaign-graph.ts).
 */
function factTestHoldsInitially(test, fact) {
  const v = fact?.initial ?? (fact?.type === "flag" ? false : fact?.type === "counter" ? fact.min : undefined);
  if (test === null || typeof test !== "object") return v === test;
  if (test.in && !test.in.includes(v)) return false;
  if (test.not !== undefined && v === test.not) return false;
  if (test.min !== undefined && !(typeof v === "number" && v >= test.min)) return false;
  if (test.max !== undefined && !(typeof v === "number" && v <= test.max)) return false;
  return true;
}

/**
 * Whether a node variant could be the place on a fresh attempt's very first
 * arrival: nothing in its `when` needs the journey to have moved, and every
 * fact it reads is satisfied by its initial value.
 */
function couldHoldAtStart(when, facts) {
  if (!when) return true;
  if (when.flag || ids(when.visited).length || ids(when.completed).length || ids(when.traversed).length || when.outcome) return false;
  if (when.visit && (when.visit.min ?? 1) > 1) return false;
  return Object.entries(when.facts ?? {}).every(([id, test]) => factTestHoldsInitially(test, facts[id]));
}

/**
 * The continuity sweep for a graph campaign (docs/campaigns/graph-campaigns.md).
 *
 * There are no beats to walk in order, so knowledge is attached to places.
 * What a party knows only ever grows, which is what makes this sound without
 * enumerating journeys:
 *
 *   - **Entering a place.** Every way in is an edge from somewhere the party
 *     finished (or the start, for the entry node). What is guaranteed on
 *     arrival is the intersection, over every edge in, of what the place it
 *     came from guaranteed on leaving, what the edge's own label shows, and
 *     what its `when` proves.
 *   - **Leaving a place.** What every ending of every chapter played there
 *     guarantees, from that entry knowledge (`analyseChapter`, unchanged).
 *     A `pass` revisit plays nothing, but the place was completed earlier,
 *     so the same holds.
 *   - **What a condition proves.** `completed: X` proves what leaving X
 *     guarantees; `visited: X` what entering X does; `traversed: E` what
 *     leaving E's `from` does, plus E's label. A journey flag or a quest
 *     item proves what EVERY setter of it showed, wherever in the graph the
 *     setter is (a chapter's `setFlag` or grant, an edge's or a completion
 *     rule's `setFlag`): holding it means one of them happened. `notFlag`,
 *     `notVisited`, `outcome`, `visit` and facts prove nothing (facts are
 *     written by the graph, not shown by any scene).
 *   - **Variants.** A node variant's chapter is entered from the same edges,
 *     plus what its own `when` proves. It shares the fresh-attempt start only
 *     if its `when` could hold before the journey has moved.
 *
 * Loops are settled by iterating to a fixed point. Findings are the same
 * shape as an ordered campaign's, so one allow-list serves both.
 */
export function analyseGraphCampaign(campaign, chapters) {
  const g = campaign.graph;
  const { flagToSet, vocab, appearances, props, quest, itemIds } = campaignContext(campaign, chapters);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const nodes = Object.entries(g.nodes ?? {});
  const edges = Object.entries(g.edges ?? {});
  const facts = g.facts ?? {};
  const journeyFlags = new Set([...(g.flags ?? []), ...flagToSet.keys()]);
  const labelOf = (edge) => edge.label ?? g.nodes[edge.to]?.title ?? "";

  // Breadth-first from the entry, so a first pass meets most predecessors before their successors.
  const order = [];
  const seen = new Set([g.entry]);
  for (const queue = [g.entry]; queue.length; ) {
    const id = queue.shift();
    order.push(id);
    for (const [, e] of edges) if (e.from === id && g.nodes[e.to] && !seen.has(e.to)) seen.add(e.to), queue.push(e.to);
  }

  /*
   * "Some way in showed it" counts a chapter's FIRST play only. A loop brings
   * a party back to a place knowing what the place (and the way back, "Back to
   * the Exchange") told it last time, and a scene that coins a name on its
   * first play would otherwise look like it cites one on the next. So:
   *
   *   - a place's own chapter is first played on the first arrival: its
   *     may-knowledge runs along paths that have not been to the place yet
   *     (`firstArrivalMay`);
   *   - a node variant is first played on some later arrival: its paths may
   *     pass through the place (whose other chapters count) but never through
   *     the variant itself (`firstPlayMay`).
   *
   * Both are computed once, from the graph and the text, before the fixed
   * point; what every way in guarantees (K) still counts every arrival.
   */
  const shownCache = new Map();
  const chapterShows = (cid) => {
    if (shownCache.has(cid)) return shownCache.get(cid);
    const chapter = byId.get(cid);
    let shown = new Set();
    if (!chapter) return shown;
    for (const { texts, cast } of chapterTexts(chapter)) {
      shown = union(shown, shownMain(texts, vocab));
      for (const c of cast) for (const n of nameTokens(c)) shown.add(n);
    }
    for (const sc of Object.values(chapter.scenes ?? {})) shown = union(shown, shownMain((sc.variants ?? []).map((v) => v.text), vocab));
    shownCache.set(cid, shown);
    return shown;
  };
  const playedAt = (node) => [node.chapter, ...(node.variants ?? []).map((v) => v.chapter)];
  /** Names a node's chapters show, leaving out one of them (a variant judged on its own). */
  const showsOfExcept = (node, except = null) =>
    playedAt(node).filter((cid) => cid !== except).reduce((acc, cid) => union(acc, chapterShows(cid)), new Set());
  const showsOf = new Map(nodes.map(([id, node]) => [id, showsOfExcept(node)]));
  const firstArrivalMay = (self) => {
    const arrive = new Map([[g.entry, new Set()]]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [, e] of edges) {
        if (e.from === self || !arrive.has(e.from) || !g.nodes[e.to]) continue;
        const leave = union(arrive.get(e.from), showsOf.get(e.from));
        const next = union(arrive.get(e.to) ?? new Set(), union(leave, shownMain([labelOf(e)], vocab)));
        if (!arrive.has(e.to) || next.size !== arrive.get(e.to).size) arrive.set(e.to, next), (changed = true);
      }
    }
    return arrive.get(self) ?? new Set();
  };
  const mayIn = new Map(order.map((id) => [id, firstArrivalMay(id)]));
  const firstPlayMay = (self, unplayed) => {
    const shows = (id) => (id === self ? showsOfExcept(g.nodes[id], unplayed) : showsOf.get(id));
    const arrive = new Map([[g.entry, new Set()]]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [, e] of edges) {
        if (!arrive.has(e.from) || !g.nodes[e.to]) continue;
        const leave = union(arrive.get(e.from), shows(e.from));
        const next = union(arrive.get(e.to) ?? new Set(), union(leave, shownMain([labelOf(e)], vocab)));
        if (!arrive.has(e.to) || next.size !== arrive.get(e.to).size) arrive.set(e.to, next), (changed = true);
      }
    }
    return arrive.get(self) ?? new Set();
  };
  const variantMay = new Map();
  for (const id of order) for (const v of g.nodes[id].variants ?? []) variantMay.set(`${id}/${v.chapter}`, firstPlayMay(id, v.chapter));

  let kin = new Map(); // node -> { K, M } on arrival
  let kend = new Map(); // node -> { K, M } on leaving
  let setters = new Map(); // journey flag or `item:ID` -> names every setter showed
  let dangling = new Map();
  let played = new Set();

  /*
   * Settled means nothing moved: what every way in guarantees (K), what some
   * way in may have shown (M), and the setters. A chapter's M is computed
   * before the loop (`firstArrivalMay`, `firstPlayMay`), so it cannot go stale
   * here; it is in the signature anyway, because a fixed point that ignored
   * half the state it carries would only be one by accident (PR #223 review).
   */
  const sig = () =>
    JSON.stringify([
      ...[kin, kend].map((m) => [...m].map(([k, v]) => [k, [...v.K].sort(), [...v.M].sort()]).sort()),
      [...setters].map(([k, v]) => [k, [...v].sort()]).sort(),
    ]);

  let settled = false;
  for (let round = 0; round < 60; round++) {
    const before = sig();
    const roundSetters = new Map();
    dangling = new Map();
    played = new Set();

    /** What a graph condition proves was shown, from the last settled knowledge. */
    const proves = (when) => {
      let out = new Set();
      if (!when) return out;
      for (const n of ids(when.completed)) out = union(out, kend.get(n)?.K ?? new Set());
      for (const n of ids(when.visited)) out = union(out, kin.get(n)?.K ?? new Set());
      for (const id of ids(when.traversed)) {
        const e = g.edges[id];
        if (e) out = union(union(out, kend.get(e.from)?.K ?? new Set()), shownMain([labelOf(e)], vocab));
      }
      if (when.flag) out = union(out, setters.get(when.flag) ?? new Set());
      return out;
    };

    for (const id of order) {
      const node = g.nodes[id];
      // Every way in that is known so far: an edge from a place with leaving knowledge.
      const ways = [];
      for (const [, e] of edges) {
        if (e.to !== id || !kend.has(e.from)) continue;
        const label = shownMain([labelOf(e)], vocab);
        ways.push({
          K: union(union(kend.get(e.from).K, label), proves(e.when)),
          M: union(kend.get(e.from).M, label),
        });
      }
      const start = id === g.entry ? [{ K: new Set(), M: new Set() }] : [];
      const meet = (list, extra = new Set()) =>
        list.length ? { K: union(intersect(list.map((w) => w.K)), extra), M: union(list.reduce((a, w) => union(a, w.M), new Set()), extra) } : null;
      const arrival = meet([...start, ...ways]);
      if (!arrival) continue;
      kin.set(id, arrival);

      const plays = [{ chapter: node.chapter, entry: { K: arrival.K, M: mayIn.get(id) } }];
      for (const v of node.variants ?? []) {
        const entry = meet([...(couldHoldAtStart(v.when, facts) ? start : []), ...ways], proves(v.when));
        if (entry) plays.push({ chapter: v.chapter, entry: { K: entry.K, M: variantMay.get(`${id}/${v.chapter}`) } });
      }

      const leaving = [];
      for (const { chapter: chapterId, entry } of plays) {
        const chapter = byId.get(chapterId);
        if (!chapter) continue;
        played.add(chapterId);
        // Journey flags and quest items may be held on arrival; each proves what its setters showed.
        const flagK = new Map();
        const maybeHeld = new Set();
        for (const f of journeyFlags) if (setters.has(f)) maybeHeld.add(f), flagK.set(f, setters.get(f));
        for (const q of quest) if (setters.has(q)) maybeHeld.add(q), flagK.set(q, setters.get(q));
        const res = analyseChapter(
          chapter,
          { K: entry.K, M: entry.M, flagK, maybeHeld, held: new Map() },
          { flagToSet, vocab, quest, itemIds, props },
        );
        mergeDangling(dangling, chapter.id, res.dangling);
        for (const [key, k] of res.setterK) if (journeyFlags.has(key) || quest.has(key)) meetInto(roundSetters, key, k);
        for (const end of res.endings) leaving.push({ K: end.K, M: end.M });
      }
      const left = meet(leaving);
      if (!left) continue;
      kend.set(id, left);
      // The graph's own setters: a completion rule's flag, an edge's flag.
      for (const rule of node.onComplete ?? []) {
        for (const eff of rule.effects ?? []) {
          if (eff.type === "setFlag" && eff.value !== false) meetInto(roundSetters, eff.flag, union(left.K, proves(rule.when)));
        }
      }
    }
    for (const [, e] of edges) {
      if (!kend.has(e.from)) continue;
      const at = union(union(kend.get(e.from).K, shownMain([labelOf(e)], vocab)), proves(e.when));
      for (const eff of e.effects ?? []) if (eff.type === "setFlag" && eff.value !== false) meetInto(roundSetters, eff.flag, at);
    }
    setters = roundSetters;
    if (sig() === before) {
      settled = true;
      break;
    }
  }

  return {
    findings: toFindings(dangling, appearances),
    /** The last round changed nothing (K, M or setters); false only if 60 rounds ran out. */
    settled,
    stranded: [],
    unreached: chapters.filter((c) => !played.has(c.id)).map((c) => c.id),
  };
}

// ---------------------------------------------------------------------------
// Allow-list

/** Reads the allow-list: `{ "chapter/scene/name": "reason" }`. */
export function loadAllowList(path = ALLOW_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Splits findings against an allow-list. `stale` are allow-list keys that no
 * longer match any finding (fix: delete the line); `noReason` are entries with
 * an empty reason. Both fail the test: a list nobody prunes stops being read.
 */
export function checkAllowList(findings, allow) {
  const have = new Set(findings.map((f) => f.key));
  return {
    unlisted: findings.filter((f) => !(f.key in allow)),
    allowed: findings.filter((f) => f.key in allow),
    stale: Object.keys(allow).filter((k) => !have.has(k) && !k.startsWith("$")),
    noReason: Object.entries(allow).filter(([k, v]) => !k.startsWith("$") && !String(v ?? "").trim()).map(([k]) => k),
  };
}

/** One finding, as the message a content author reads. */
export function describeFinding(f, limit = 6) {
  const where = f.elsewhere.length
    ? `also appears in: ${f.elsewhere.slice(0, limit).join(", ")}${f.elsewhere.length > limit ? ` (+${f.elsewhere.length - limit} more)` : ""}`
    : "appears nowhere else";
  return `${f.chapter} / ${f.scene}: "${f.name}" is used but some way in never showed it (${where})`;
}

// ---------------------------------------------------------------------------
// CLI

/**
 * The sweep's verdict over every campaign: the lines it prints and its exit
 * code. Fails closed: a campaign whose analysis did not settle (a graph that
 * ran out of rounds, `settled: false`) fails the run, because its findings
 * come from an incomplete fixed point and "clean" would be a guess.
 *
 * `results` is `[{ id, findings, stranded, unreached, settled? }]`; an
 * ordered campaign carries no `settled` and is always complete.
 */
export function verdict(results, allow, { all = false } = {}) {
  const findings = results.flatMap((r) => r.findings);
  const { unlisted, allowed, stale, noReason } = checkAllowList(findings, allow);
  const unsettled = results.filter((r) => r.settled === false).map((r) => r.id);
  const lines = [];
  if (all) for (const f of allowed) lines.push(`allowed  ${f.key}: ${allow[f.key]}`);
  for (const f of unlisted) lines.push(`DANGLING ${describeFinding(f)}\n         key: ${f.key}`);
  for (const k of stale) lines.push(`STALE    allow-list entry no longer matches a finding: ${k}`);
  for (const k of noReason) lines.push(`NOREASON allow-list entry has no reason: ${k}`);
  for (const id of unsettled) {
    lines.push(`UNSETTLED ${id}: the analysis did not reach a fixed point, so its findings are incomplete`);
  }
  for (const r of results) for (const s of r.stranded) lines.push(`note     ${r.id} index ${s.index}: no chapter for ${s.state}`);
  for (const r of results) for (const c of r.unreached) lines.push(`note     ${c} is reached by no history`);
  lines.push(
    `${results.length} campaigns (${results.map((r) => r.id).join(", ")}): ${findings.length} candidates, ${allowed.length} allow-listed, ${unlisted.length} new, ${stale.length} stale allow-list entries${unsettled.length ? `, ${unsettled.length} unsettled` : ""}.`,
  );
  const exitCode = unlisted.length || stale.length || noReason.length || unsettled.length ? 1 : 0;
  return { lines, exitCode, unlisted, allowed, stale, noReason, unsettled };
}

function main(argv) {
  const results = loadCampaigns().map(({ campaign, chapters }) => ({ id: campaign.id, ...analyse(campaign, chapters) }));
  const { lines, exitCode } = verdict(results, loadAllowList(), { all: argv.includes("--all") });
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
