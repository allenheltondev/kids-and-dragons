/**
 * Drafting script sidecars (docs/voice-narration-plan.md §3, "Drafting scripts").
 *
 * Pure: an authored line and who says each of its quotes in, script lines out.
 * Who says what is never decided here. It comes from the cast sheet's own
 * attributor (`attributeLines` in tools/voice/cast/sheet.ts), so the sheet's
 * line counts, `voice:untagged` and the scripts always agree about a quote.
 *
 *  - The narrator gets every span outside quotation marks.
 *  - A quote goes to the speaker its speech tag names. A quote nobody is tagged
 *    for (including the sheet's guess for a scene's only speaker) stays with
 *    the narrator and is listed as needing a person.
 *  - Every span is a slice of the authored text, so the lines, joined, always
 *    rebuild it (the `content:validate` join check).
 *  - A draft is `reviewed: false`. Re-drafting touches only missing and stale
 *    entries: a fresh entry, reviewed or not, is never rewritten.
 */

import type { LineQuote } from "./cast/sheet";
import { scriptReport, sourceHash, type ScriptEntry, type ScriptFile, type ScriptLine } from "./script";

/** A quote the drafter left with the narrator, and why. */
export interface NeedsPerson {
  address: string;
  words: string;
  /** The cast sheet's guess (the scene's only speaker), when it has one. */
  guess?: string;
  reason: "untagged" | "guess" | "uncast";
  /** For `uncast`: who the tag named. */
  named?: string;
}

export interface Cut {
  lines: ScriptLine[];
  /** Quotes given to a cast speaker. */
  attributed: number;
  needsPerson: NeedsPerson[];
}

const NARRATOR = "narrator";

/**
 * Cuts one authored line at its quotes. `quotes` are positions in `text`
 * (attributeLines); `speakers` are the cast sheet's ids.
 */
export function cutLine(address: string, text: string, quotes: readonly LineQuote[], speakers: ReadonlySet<string>): Cut {
  const cut: Cut = { lines: [], attributed: 0, needsPerson: [] };
  const spans: { by: string; start: number; end: number }[] = [];
  let at = 0;
  for (const quote of [...quotes].sort((a, b) => a.start - b.start)) {
    // A quote the attributor read across a variant's join, or out of order, is the narrator's.
    if (quote.start < at || quote.end > text.length || !/^["“]/.test(text.slice(quote.start, quote.end))) continue;
    let by = NARRATOR;
    if (quote.id === null) {
      cut.needsPerson.push({ address, words: quote.words, reason: quote.guess === undefined ? "untagged" : "guess", ...(quote.guess !== undefined ? { guess: quote.guess } : {}) });
    } else if (!speakers.has(quote.id)) {
      cut.needsPerson.push({ address, words: quote.words, reason: "uncast", named: quote.id });
    } else {
      by = quote.id;
      cut.attributed += 1;
    }
    if (quote.start > at) spans.push({ by: NARRATOR, start: at, end: quote.start });
    spans.push({ by, start: quote.start, end: quote.end });
    at = quote.end;
  }
  if (at < text.length) spans.push({ by: NARRATOR, start: at, end: text.length });

  // One speaker's neighbouring spans are one line: the narrator's text around a quote left with them, or two quotes in a row.
  const merged: { by: string; start: number; end: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && last.by === span.by) last.end = span.end;
    else merged.push({ ...span });
  }
  for (const span of merged) {
    const words = text.slice(span.start, span.end).trim();
    if (words !== "") cut.lines.push({ by: span.by, text: words });
  }
  return cut;
}

/** A draft entry for a line, or null when nobody but the narrator speaks in it (no entry means the narrator reads it all). */
export function draftEntry(address: string, text: string, quotes: readonly LineQuote[], speakers: ReadonlySet<string>): Cut & { entry: ScriptEntry | null } {
  const cut = cutLine(address, text, quotes, speakers);
  const voiced = cut.lines.some((line) => line.by !== NARRATOR);
  return { ...cut, entry: voiced ? { source: sourceHash(text), reviewed: false, lines: cut.lines } : null };
}

export interface RefreshInput {
  chapter: string;
  /** The chapter's recorded lines by address, in order (tokens unfilled). */
  lines: ReadonlyMap<string, string>;
  /** Who says each quote, by address (attributeLines). Lines with no quotes may be left out. */
  quotes: ReadonlyMap<string, readonly LineQuote[]>;
  speakers: ReadonlySet<string>;
}

export interface Refresh {
  file: ScriptFile;
  /** Addresses given a new draft. */
  drafted: string[];
  /** Stale entries re-cut (a subset of `drafted`, or of `dropped`). */
  recut: string[];
  /** Stale entries a person had reviewed: their review is gone with the words it was for. */
  reviewedLost: string[];
  /** Stale entries with no one but the narrator left to speak: removed, so the narrator reads the line. */
  dropped: string[];
  /** Fresh entries left exactly as they were. */
  kept: string[];
  /** Entries that are broken today (a person's edit, or a speaker taken off the cast): left for a person. */
  broken: string[];
  /** Entries for addresses the chapter no longer has: left for `content:validate` to report. */
  orphaned: string[];
  /** Quotes given to a speaker in the entries drafted this time. */
  attributed: number;
  needsPerson: NeedsPerson[];
}

export const SCRIPT_COMMENT =
  "Who says which words in this chapter (docs/voice-narration-plan.md section 3). Drafted by `npm run voice:script`; a line with no entry is read by the narrator. A person checks each draft and sets `reviewed` to true; re-drafting only touches missing and stale entries.";

/** Drafts what is missing or stale in a chapter's sidecar and leaves everything else alone. */
export function refreshScript(previous: ScriptFile, input: RefreshInput): Refresh {
  const out: Refresh = { file: {}, drafted: [], recut: [], reviewedLost: [], dropped: [], kept: [], broken: [], orphaned: [], attributed: 0, needsPerson: [] };
  const context = { chapter: input.chapter, lines: input.lines, speakers: input.speakers };
  const report = scriptReport(previous as Record<string, unknown>, context);
  const entries = new Map<string, ScriptEntry>();
  for (const [address, entry] of Object.entries(previous)) if (!address.startsWith("$") && typeof entry === "object") entries.set(address, entry);

  out.file.$comment = typeof previous.$comment === "string" ? previous.$comment : SCRIPT_COMMENT;
  for (const [address, text] of input.lines) {
    const old = entries.get(address);
    const state = old === undefined ? undefined : report.state[address];
    if (old !== undefined && state !== "stale") {
      out.file[address] = old;
      (state === "fresh" ? out.kept : out.broken).push(address);
      continue;
    }
    const draft = draftEntry(address, text, input.quotes.get(address) ?? [], input.speakers);
    out.needsPerson.push(...draft.needsPerson);
    if (old !== undefined) {
      out.recut.push(address);
      if (old.reviewed !== false) out.reviewedLost.push(address);
    }
    if (draft.entry === null) {
      if (old !== undefined) out.dropped.push(address);
      continue;
    }
    out.file[address] = draft.entry;
    out.drafted.push(address);
    out.attributed += draft.attributed;
  }
  for (const [address, entry] of entries) {
    if (input.lines.has(address)) continue;
    out.file[address] = entry;
    out.orphaned.push(address);
  }
  return out;
}

/** Whether a refresh changed anything worth writing. */
export function changed(refresh: Refresh): boolean {
  return refresh.drafted.length > 0 || refresh.dropped.length > 0;
}
