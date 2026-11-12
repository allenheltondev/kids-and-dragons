/**
 * The art manifest's growing lists are kept in order.
 *
 *   npm run art:sort              put them in order (rewrites assets/manifest.json)
 *   npm run art:sort -- --check   say what is out of order, and exit 1 (the gate; art:verify runs it)
 *
 * assets/manifest.json is one file that every piece of art is declared in, so every art
 * branch edits it. The lists in it used to grow at the end: two branches that each added a
 * scene painting both added a line after the same last line, and git calls that a conflict
 * though the two have nothing to do with each other. Of 164 changes to the manifest, 42 added
 * to `sceneIllustrations` and 36 to `castFigures`, nearly all at the end.
 *
 * Kept in order, two branches' new entries land on different lines unless they happen to
 * sort next to each other, and git merges them without help, on GitHub too. For the pairs
 * that do land together there is a merge driver (tools/art/merge-manifest.ts) that merges
 * these lists entry by entry.
 *
 * The order is plain string order of each entry's key, the order `[...keys].sort()` gives:
 * the string itself in a list of strings, the `id` in a list of objects, the member's name
 * in an object. Nothing reads these lists in order (they are sets: what is declared), which
 * is what makes sorting them safe. A list whose order means something is not in
 * SORTED_LISTS and must not be added to it.
 *
 * The manifest is formatted by hand (`"canvas": { "width": 512, "height": 192 }`), so this
 * never re-serializes it. It moves each entry's own text, byte for byte, into the place
 * another entry held, and leaves everything between the entries where it was.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MANIFEST_FILE = "assets/manifest.json";

/** The lists kept in order, each by where it is in the manifest. */
export const SORTED_LISTS: readonly (readonly string[])[] = [
  ["castFigures"],
  ["coatMasks", "paintings"],
  ["entities"],
  ["paintedIcons", "ids"],
  ["sceneIllustrations"],
  ["stageFigures"],
  ["storyPlates", "ids"],
  ["storyProps", "ids"],
  ["storyProps", "motions"],
];

export const listName = (listPath: readonly string[]): string => listPath.join(".");

/** One entry of a list: its key, and where its own text is in the file. */
export interface Entry {
  key: string;
  start: number;
  end: number;
}

/** A list found in the manifest's text. `open` and `close` are its brackets. */
export interface ListSpan {
  path: readonly string[];
  kind: "array" | "object";
  open: number;
  close: number;
  entries: Entry[];
}

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// --- Reading where things are in JSON text, without changing a byte of it -------------------

const isSpace = (c: string | undefined): boolean => c === " " || c === "\n" || c === "\r" || c === "\t";

function skipSpace(text: string, at: number): number {
  while (isSpace(text[at])) at++;
  return at;
}

function stringEnd(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  throw new Error("a string that never closes");
}

/** Where the value starting at `at` ends. */
function valueEnd(text: string, at: number): number {
  const first = text[at];
  if (first === '"') return stringEnd(text, at);
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      const c = text[i];
      if (c === '"') i = stringEnd(text, i) - 1;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) return i + 1;
    }
    throw new Error("a bracket that never closes");
  }
  let i = at;
  while (i < text.length && !isSpace(text[i]) && text[i] !== "," && text[i] !== "]" && text[i] !== "}") i++;
  return i;
}

interface Member {
  /** An object member's name; undefined in an array. */
  name: string | undefined;
  /** Where the member starts: its name in an object, its value in an array. */
  start: number;
  valueStart: number;
  end: number;
}

/** The members of the object or array whose opening bracket is at `open`. */
function membersOf(text: string, open: number): { close: number; members: Member[] } {
  const isObject = text[open] === "{";
  const closer = isObject ? "}" : "]";
  const members: Member[] = [];
  let at = skipSpace(text, open + 1);
  while (text[at] !== closer) {
    if (at >= text.length) throw new Error("a bracket that never closes");
    const start = at;
    let name: string | undefined;
    if (isObject) {
      const nameEnd = stringEnd(text, at);
      name = JSON.parse(text.slice(at, nameEnd)) as string;
      at = skipSpace(text, skipSpace(text, nameEnd) + 1);
    }
    const end = valueEnd(text, at);
    members.push({ name, start, valueStart: at, end });
    at = skipSpace(text, end);
    if (text[at] === ",") at = skipSpace(text, at + 1);
  }
  return { close: at, members };
}

function keyOf(text: string, member: Member, listPath: readonly string[], index: number): string {
  if (member.name !== undefined) return member.name;
  const value = JSON.parse(text.slice(member.valueStart, member.end)) as unknown;
  if (typeof value === "string") return value;
  const id = value !== null && typeof value === "object" ? (value as { id?: unknown }).id : undefined;
  if (typeof id === "string") return id;
  throw new Error(`${listName(listPath)}[${index}] is neither a string nor an object with an id, so it has no place in an ordered list`);
}

/**
 * The list at `listPath` in the manifest's text, or undefined when the manifest has none.
 * The text must be JSON that parses (`JSON.parse` it first; this trusts it).
 */
export function findList(text: string, listPath: readonly string[]): ListSpan | undefined {
  let at = skipSpace(text, 0);
  for (const segment of listPath) {
    if (text[at] !== "{") return undefined;
    const found = membersOf(text, at).members.find((m) => m.name === segment);
    if (!found) return undefined;
    at = found.valueStart;
  }
  if (text[at] !== "[" && text[at] !== "{") throw new Error(`${listName(listPath)} is not a list`);
  const { close, members } = membersOf(text, at);
  return {
    path: listPath,
    kind: text[at] === "[" ? "array" : "object",
    open: at,
    close,
    entries: members.map((m, index) => ({ key: keyOf(text, m, listPath, index), start: m.start, end: m.end })),
  };
}

// --- The check ------------------------------------------------------------------------------

export interface OrderProblem {
  list: string;
  problem: "order" | "duplicate" | "missing";
  detail: string;
}

/** What is wrong with the order of the manifest's lists. Empty when nothing is. */
export function orderProblems(text: string, lists: readonly (readonly string[])[] = SORTED_LISTS): OrderProblem[] {
  JSON.parse(text);
  const problems: OrderProblem[] = [];
  for (const listPath of lists) {
    const list = listName(listPath);
    const found = findList(text, listPath);
    if (!found) {
      problems.push({ list, problem: "missing", detail: `${MANIFEST_FILE} has no ${list}: if it was renamed or removed, change SORTED_LISTS in tools/art/manifest-order.ts to match` });
      continue;
    }
    const keys = found.entries.map((e) => e.key);
    const twice = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
    for (const key of twice) problems.push({ list, problem: "duplicate", detail: `${list} declares "${key}" more than once` });
    const sorted = [...keys].sort(byKey);
    const moved = keys.filter((key, index) => key !== sorted[index]).length;
    if (moved > 0) {
      const at = keys.findIndex((key, index) => index > 0 && byKey(keys[index - 1]!, key) > 0);
      problems.push({ list, problem: "order", detail: `${list} is out of order: "${keys[at]}" comes after "${keys[at - 1]}" (${moved} of ${keys.length} out of place)` });
    }
  }
  return problems;
}

// --- The fix --------------------------------------------------------------------------------

export interface SortResult {
  text: string;
  /** How many entries changed place, per list that had any. */
  moved: Record<string, number>;
}

/**
 * The manifest with its lists in order. Each entry's text moves whole; what is between the
 * entries (commas, line breaks, indentation) stays where it was, so the file's layout and
 * every byte outside these lists are untouched.
 */
export function sortLists(text: string, lists: readonly (readonly string[])[] = SORTED_LISTS): SortResult {
  JSON.parse(text);
  const moved: Record<string, number> = {};
  let out = text;
  for (const listPath of lists) {
    // Found in the text as it now stands. (Putting a list in order never changes its length,
    // so the lists after it have not moved; this just does not lean on that.)
    const found = findList(out, listPath);
    if (!found || found.entries.length < 2) continue;
    const entries = found.entries;
    const sorted = entries.map((entry, index) => ({ entry, index })).sort((a, b) => byKey(a.entry.key, b.entry.key) || a.index - b.index);
    const count = sorted.filter((s, index) => s.index !== index).length;
    if (count === 0) continue;
    moved[listName(listPath)] = count;
    const pieces: string[] = [out.slice(0, entries[0]!.start)];
    sorted.forEach(({ entry }, slot) => {
      pieces.push(out.slice(entry.start, entry.end));
      if (slot < entries.length - 1) pieces.push(out.slice(entries[slot]!.end, entries[slot + 1]!.start));
    });
    pieces.push(out.slice(entries[entries.length - 1]!.end));
    out = pieces.join("");
  }
  return { text: out, moved };
}

// --- The merge ------------------------------------------------------------------------------

/** A three-way line merge: the merged text, and how many conflicts it holds (markers and all). */
export type TextMerge = (base: string, ours: string, theirs: string) => { text: string; conflicts: number };

export interface ManifestMerge {
  text: string;
  /** What could not be merged, in words. Empty when the merge is clean. */
  conflicts: string[];
}

const placeholder = (listPath: readonly string[]): string => `@@kad-list:${listName(listPath)}@@`;

interface Side {
  /** The manifest with each list's contents replaced by a placeholder. */
  skeleton: string;
  lists: Map<string, { entries: Map<string, string>; lead: string; between: string | undefined; tail: string } | undefined>;
}

function takeApart(text: string, lists: readonly (readonly string[])[]): Side {
  JSON.parse(text);
  const side: Side = { skeleton: text, lists: new Map() };
  const spans = lists.map((listPath) => findList(text, listPath)).filter((span): span is ListSpan => span !== undefined);
  for (const listPath of lists) if (!spans.some((span) => span.path === listPath)) side.lists.set(listName(listPath), undefined);
  // From the last in the file to the first, so cutting one leaves the others where they were found.
  for (const span of [...spans].sort((a, b) => b.open - a.open)) {
    const { entries } = span;
    // Merged by key, an entry declared twice would be quietly dropped to one. That is not
    // this merge's call: refuse, and let the caller fall back and report it.
    const twice = entries.find((entry, index) => entries.findIndex((other) => other.key === entry.key) !== index);
    if (twice) throw new Error(`${listName(span.path)} declares "${twice.key}" more than once`);
    const first = entries[0];
    const last = entries[entries.length - 1];
    side.lists.set(listName(span.path), {
      entries: new Map(entries.map((e) => [e.key, text.slice(e.start, e.end)])),
      lead: first ? text.slice(span.open + 1, first.start) : text.slice(span.open + 1, span.close),
      between: entries.length > 1 ? text.slice(first!.end, entries[1]!.start) : undefined,
      tail: last ? text.slice(last.end, span.close) : "",
    });
    side.skeleton = side.skeleton.slice(0, span.open + 1) + placeholder(span.path) + side.skeleton.slice(span.close);
  }
  return side;
}

const sameJson = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  if (a === b) return true;
  // An entry is a value, or an object's `"name": value`: either way it parses inside braces
  // or brackets, and two texts that parse alike differ only in spacing.
  const parse = (raw: string): string => JSON.stringify(JSON.parse(raw.startsWith('"') && /^"(?:[^"\\]|\\.)*"\s*:/.test(raw) ? `{${raw}}` : `[${raw}]`));
  return parse(a) === parse(b);
};

/**
 * Merges two versions of the manifest that grew from `base`. Everything outside the ordered
 * lists is merged by line, as git would. Each ordered list is merged entry by entry: an
 * entry one side added, changed or removed is taken from that side; one both sides changed
 * is merged by line where its lines allow, and otherwise is a conflict, with ours kept. The
 * merged lists come out in order whatever order they came in, so a branch cut before the
 * lists were sorted merges cleanly with one cut after. The result has Unix line endings
 * whatever came in: that is how the file is stored (.gitattributes), and git stores what a
 * merge driver writes without converting it.
 */
export function mergeManifests(base: string, ours: string, theirs: string, mergeText: TextMerge, lists: readonly (readonly string[])[] = SORTED_LISTS): ManifestMerge {
  const unix = (text: string): string => text.replace(/\r\n/g, "\n");
  const [b, o, t] = [takeApart(unix(base), lists), takeApart(unix(ours), lists), takeApart(unix(theirs), lists)];
  const conflicts: string[] = [];

  const skeleton = mergeText(b.skeleton, o.skeleton, t.skeleton);
  if (skeleton.conflicts > 0) conflicts.push(`${skeleton.conflicts} conflict(s) outside the ordered lists, marked in the file`);
  let text = skeleton.text;

  for (const listPath of lists) {
    const list = listName(listPath);
    const [inBase, inOurs, inTheirs] = [b.lists.get(list), o.lists.get(list), t.lists.get(list)];
    const keys = new Set([...(inBase?.entries.keys() ?? []), ...(inOurs?.entries.keys() ?? []), ...(inTheirs?.entries.keys() ?? [])]);
    const merged = new Map<string, string>();
    for (const key of [...keys].sort(byKey)) {
      const [was, mine, theirOwn] = [inBase?.entries.get(key), inOurs?.entries.get(key), inTheirs?.entries.get(key)];
      let kept: string | undefined;
      if (sameJson(mine, theirOwn) || sameJson(theirOwn, was)) kept = mine;
      else if (sameJson(mine, was)) kept = theirOwn;
      else {
        // Both changed it, differently. Lines that do not overlap still merge.
        const lines = was !== undefined && mine !== undefined && theirOwn !== undefined ? mergeText(`${was}\n`, `${mine}\n`, `${theirOwn}\n`) : undefined;
        if (lines && lines.conflicts === 0) kept = lines.text.replace(/\n$/, "");
        else {
          kept = mine;
          const what = mine === undefined ? "ours removed it and theirs changed it; it stays removed" : theirOwn === undefined ? "theirs removed it and ours changed it; ours is kept" : "both sides changed it differently; ours is kept";
          conflicts.push(`${list} "${key}": ${what}`);
        }
      }
      if (kept !== undefined) merged.set(key, kept);
    }

    const mark = placeholder(listPath);
    if (!text.includes(mark)) {
      // The merged manifest has no such list: one side removed it, or neither has it.
      if (merged.size > 0 && (inOurs || inTheirs)) conflicts.push(`${list}: one side removed the list and the other still has entries in it; they are not in the merged file`);
      continue;
    }
    // Laid out the way a side that has entries lays it out: ours first.
    const layouts = [inOurs, inTheirs, inBase].filter((l): l is NonNullable<typeof l> => l !== undefined);
    const shaped = layouts.find((l) => l.between !== undefined) ?? layouts.find((l) => l.entries.size > 0);
    let inner: string;
    if (merged.size === 0) inner = "";
    else if (!shaped) inner = [...merged.values()].join(", ");
    else inner = shaped.lead + [...merged.values()].join(shaped.between ?? `,${shaped.lead}`) + shaped.tail;
    text = text.split(mark).join(inner);
  }
  return { text, conflicts };
}

// --- Run as a command -----------------------------------------------------------------------

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const fileAt = args.indexOf("--file");
  const file = fileAt >= 0 && args[fileAt + 1] ? path.resolve(args[fileAt + 1]!) : path.join(REPO_ROOT, MANIFEST_FILE);
  const shown = path.relative(process.cwd(), file) || file;
  try {
    const before = fs.readFileSync(file, "utf8");
    if (args.includes("--check")) {
      const problems = orderProblems(before);
      for (const p of problems) console.error(`  ${p.detail}`);
      if (problems.some((p) => p.problem === "order")) console.error(`\nart:sort: ${shown} has lists out of order. Run \`npm run art:sort\` and commit the result.`);
      else if (problems.length > 0) console.error(`\nart:sort: ${shown} needs a fix by hand (above).`);
      else console.log(`art:sort: ${SORTED_LISTS.length} lists of ${shown} are in order`);
      process.exitCode = problems.length > 0 ? 1 : 0;
    } else {
      const { text, moved } = sortLists(before);
      if (text !== before) fs.writeFileSync(file, text);
      for (const [list, count] of Object.entries(moved)) console.log(`  ${list}: ${count} entries moved`);
      console.log(text === before ? `art:sort: ${shown} was already in order` : `art:sort: put ${shown} in order`);
      const left = orderProblems(text);
      for (const p of left) console.error(`  ${p.detail}`);
      process.exitCode = left.length > 0 ? 1 : 0;
    }
  } catch (error) {
    console.error(`art:sort: ${shown}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
