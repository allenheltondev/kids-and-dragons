/**
 * Script sidecars: who says which words (docs/voice-narration-plan.md §3).
 *
 * `content/voice/scripts/<chapterId>.json` cuts an authored line into spans by
 * speaker. The chapter JSON never changes, so the screen text stays the single
 * truth and Gemfall's pinned hashes do not move. This module is pure: the
 * sidecar and the authored lines in, a verdict out.
 *
 * A script entry is one of:
 *  - fresh:  its `source` hash is the authored text's today. Its lines, joined,
 *            must equal that text, or the script is broken.
 *  - stale:  the text changed since it was cut. Reported, never failed: the
 *            scene plays with the device voice until it is re-cut.
 *  - broken: unknown speaker, unknown delivery, lines that do not rebuild the
 *            text, or an address outside the chapter. These fail the gate.
 * An address with no entry means "the narrator reads it all", so a sidecar is
 * never required.
 */

import { createHash } from "node:crypto";

/** What a line may be told to sound like; each provider adapter maps it to its own controls. */
export const DELIVERIES = [
  "whisper",
  "excited",
  "hearty",
  "nervous",
  "sing-song",
  "gruff",
  "gentle",
  "sly",
  "proud",
  "sad",
] as const;
export type Delivery = (typeof DELIVERIES)[number];

export interface ScriptLine {
  /** A cast speaker id, optionally `id#who` to tell two of one kind apart in a scene. */
  by: string;
  text: string;
  delivery?: Delivery;
}

export interface ScriptEntry {
  /** `sha256:<hex>` of the authored text this was cut from, normalized. */
  source: string;
  lines: ScriptLine[];
  /** A draft is `false` until a person confirms it. Absent reads as reviewed. */
  reviewed?: boolean;
}

export type ScriptFile = Record<string, ScriptEntry | string>;

export type ScriptState = "fresh" | "stale" | "broken";

export interface ScriptProblem {
  at: string;
  message: string;
}

export interface ScriptReport {
  problems: ScriptProblem[];
  /** Addresses whose text changed since the script was cut. */
  stale: string[];
  /** Addresses that no longer name an authored line. */
  orphaned: string[];
  state: Record<string, ScriptState>;
}

/** Curly quotes to straight, whitespace collapsed: cosmetic edits do not stale a script. */
export function normalizeSpoken(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function sourceHash(text: string): string {
  return `sha256:${createHash("sha256").update(normalizeSpoken(text)).digest("hex")}`;
}

/** `<sigh>`, `[sighs]`, `<long pause>`: delivery beats, not on screen, so never part of the join. */
export function stripBeats(text: string): string {
  return text.replace(/<[a-z][a-z -]*>/gi, "").replace(/\[[a-z][a-z -]*\]/gi, "");
}

/**
 * What must match: the same words in the same order. Spacing is cosmetic and a
 * cut may fall between any two words, so fragments join with a space and every
 * run of whitespace is one. Word boundaries stay meaningful ("an ice dragon" is
 * not "a nice dragon"). Spaces beside a quotation mark are the one exception:
 * a cut at a quote leaves `"Hi,"says` or `"Hi," says` and both read the same.
 */
function words(text: string): string {
  return normalizeSpoken(text).replace(/\s*"\s*/g, '"');
}

export function joinedLines(entry: ScriptEntry): string {
  return entry.lines.map((line) => stripBeats(line.text)).join(" ");
}

export interface ScriptContext {
  chapter: string;
  /** Every authored line of the chapter by address, tokens unfilled (inventory.ts). */
  lines: ReadonlyMap<string, string>;
  /** The cast sheet's speaker ids (content/voice/cast.json). */
  speakers: ReadonlySet<string>;
}

export function scriptReport(file: Record<string, unknown>, context: ScriptContext): ScriptReport {
  const report: ScriptReport = { problems: [], stale: [], orphaned: [], state: {} };
  for (const [address, raw] of Object.entries(file)) {
    if (address.startsWith("$")) continue;
    const entry = raw as ScriptEntry;
    const fail = (message: string, at = address): void => {
      report.problems.push({ at, message });
      report.state[address] = "broken";
    };

    if (!address.startsWith(`${context.chapter}/`)) {
      fail(`address is not in chapter "${context.chapter}"`);
      continue;
    }
    for (const [i, line] of entry.lines.entries()) {
      const speaker = line.by.split("#")[0] ?? line.by;
      if (!context.speakers.has(speaker)) fail(`line ${String(i)} is by "${line.by}", who is not in the cast`, `${address}/lines/${String(i)}`);
    }

    const authored = context.lines.get(address);
    if (authored === undefined) {
      report.orphaned.push(address);
      continue;
    }
    if (entry.source !== sourceHash(authored)) {
      report.stale.push(address);
      report.state[address] ??= "stale";
      continue;
    }
    if (words(joinedLines(entry)) !== words(authored)) {
      fail("the lines, joined, do not equal the authored text; the audio would say something the screen does not");
      continue;
    }
    report.state[address] ??= "fresh";
  }
  return report;
}
