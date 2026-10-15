/**
 * US-spelling lint for player-facing text. The rules live here; the test in
 * spelling.test.mjs runs them over content and canon.
 *
 * `scanDocument` walks parsed JSON/YAML and checks string values, never
 * object keys and never id-shaped strings (`scene_harbour_wall`,
 * `check_rumours`, `bg/bramblewood/hedge_wall`), so an id may keep a British
 * word while the text a child reads may not.
 */

const OUR = "colour|favour|harbour|rumour|neighbour|honour|behaviour|armour|flavour|humour|parlour";

/** Each rule: a pattern for one family of words and how to respell a hit. */
export const RULES = [
  { re: new RegExp(`\\b\\w*(?:${OUR})\\w*\\b`, "gi"), fix: (w) => w.replace(/our/i, (m) => (m === "OUR" ? "OR" : m === "Our" ? "Or" : "or")) },
  { re: /\b\w*(?:centre|theatre|metre)[sd]?\b/gi, fix: (w) => w.replace(/(tre)([sd]?)$/i, (_, __, s) => "ter" + s) },
  { re: /\bgrey\w*\b/gi, fix: (w) => w.replace(/grey/i, (m) => (m[0] === "G" ? "Gray" : "gray")) },
  { re: /\b(?:travell|labell|yodell|cancell|jewell|marvell)\w*\b/gi, fix: (w) => w.replace(/ll/i, "l") },
  { re: /\b(?:realis|recognis|apologis|memoris|organis|practis)(?:e|es|ed|ing|ation|ations)\b/gi, fix: (w) => w.replace(/is(e|es|ed|ing|ation|ations)$/i, (_, s) => (/^practis/i.test(w) ? "ic" : "iz") + s) },
  { re: /\b(?:offence|defence|licence)s?\b/gi, fix: (w) => w.replace(/ce(?=s?$)/i, "se") },
  { re: /\b(?:re-)?catalogu(?:e|es|ed|ing)\b/gi, fix: (w) => w.replace(/ue(?=d|s|$)|u(?=ing)/i, "").replace(/(catalog)d$/i, "$1ed").replace(/(catalog)s$/i, "$1s") },
  { re: /\bjudgement\w*\b/gi, fix: (w) => w.replace(/ge(?=ment)/i, "g") },
  { re: /\bmum(?:s|my)?\b/gi, fix: (w) => w.replace(/mum/i, (m) => (m[0] === "M" ? "Mom" : "mom")) },
  { re: /\b(?:whilst|amongst)\b/gi, fix: (w) => (/^whilst$/i.test(w) ? "while" : "among") },
  { re: /\bcos(?:y|ier|iest|ily)\b/gi, fix: (w) => w.replace(/cos/i, (m) => (m[0] === "C" ? "Coz" : "coz")) },
];

/**
 * Documented exceptions. Matched phrases are blanked before scanning.
 * "Sunbloom Draught" keeps its spelling (the item's name). "afterwards" is
 * accepted; the rules above do not flag it, but it is listed so a future
 * broader rule will not.
 */
export const EXCEPTIONS = [/Sunbloom Draught/gi, /\bafterwards\b/gi];

/** Keys whose string values are ids, refs, or machine values, not text. */
const ID_KEYS = new Set(["id", "goto", "flag", "icon", "art", "figure", "entry", "asset_id", "itemId", "canon_id", "map", "src", "campaignId", "schema_version", "document_type", "updated"]);

/** Top-level YAML keys that are guidance to authors, not game text. */
const META_KEYS = new Set(["purpose", "agent_instructions", "controlled_values"]);

const ID_SHAPED = /^(?:[a-z0-9_.:/#]+|[a-z]+-\d+[a-z]*)$/;

export function checkText(text) {
  // Ids quoted in prose (comments, notes) are not words.
  let masked = text.replace(/\b\w+_\w+\b/g, (m) => " ".repeat(m.length));
  for (const ex of EXCEPTIONS) masked = masked.replace(ex, (m) => " ".repeat(m.length));
  const hits = [];
  for (const { re, fix } of RULES) {
    for (const m of masked.matchAll(re)) hits.push({ word: m[0], suggestion: fix(m[0]), index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Yields { path, key, value } for every scannable string under `node`. */
export function* textFields(node, path = "", key = "", topLevel = true) {
  if (typeof node === "string") {
    if (!ID_KEYS.has(key) && !ID_SHAPED.test(node)) yield { path, key, value: node };
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* textFields(node[i], `${path}[${i}]`, key, false);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (topLevel && META_KEYS.has(k)) continue;
      yield* textFields(v, path ? `${path}.${k}` : k, k, false);
    }
  }
}

function lineOf(raw, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) if (raw.charCodeAt(i) === 10) n++;
  return n;
}

/** Line numbers where `word` sits inside `value` as written in `raw`. */
function locate(raw, value, word, index) {
  const lines = new Set();
  // JSON: the escaped string appears verbatim, so land on the word inside it.
  const escaped = JSON.stringify(value).slice(1, -1);
  const inEscaped = escaped.indexOf(JSON.stringify(word).slice(1, -1), Math.max(0, index));
  if (inEscaped !== -1) {
    for (let at = raw.indexOf(escaped); at !== -1; at = raw.indexOf(escaped, at + 1)) {
      lines.add(lineOf(raw, at + inEscaped));
    }
  }
  if (lines.size === 0) {
    // YAML folds long text across lines; fall back to lines holding the word.
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    raw.split("\n").forEach((l, i) => re.test(l) && lines.add(i + 1));
  }
  return [...lines].sort((a, b) => a - b);
}

/** Returns one violation message per offending word. */
export function scanDocument(file, raw, doc) {
  const out = [];
  for (const { path, value } of textFields(doc)) {
    for (const { word, suggestion, index } of checkText(value)) {
      const lines = locate(raw, value, word, index);
      out.push(`${file}:${lines.join(",") || "?"} field ${path}: "${word}" -> use US spelling "${suggestion}"`);
    }
  }
  return out;
}
