/**
 * The bake-off's samples, resolved against content/ (docs/voice-bakeoff.md).
 *
 * A sample names an address, never a copy of the words: the text is read from
 * the chapter at run time, and the script that splits it into voices must
 * join back to exactly that text. So the bake-off always renders what the
 * table would hear, and an edit to a chapter shows up here as a mismatch to
 * fix, not as audio of words the game no longer says.
 */

import fs from "node:fs";
import path from "node:path";
import { numberWord, partyPhrase } from "../../../packages/shared/src/narration.ts";
import { inventory, type VoiceLine } from "../inventory.ts";

export interface ScriptLine {
  by: string;
  text: string;
  delivery?: string;
}

export interface SampleSpec {
  id: string;
  tier: string;
  title: string;
  tests: string;
  address: string;
  group?: string;
  tokens?: { party?: number; facets?: number };
  script?: ScriptLine[];
}

export interface SampleFile {
  tiers: Record<string, string>;
  samples: SampleSpec[];
}

export interface Sample extends Omit<SampleSpec, "script"> {
  /** The authored words, tokens unfilled, as content/ has them now. */
  source: string;
  /** Who says what, tokens filled: what is sent and heard. */
  lines: ScriptLine[];
  speakers: string[];
}

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

function readDir(dir: string): Record<string, unknown>[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Record<string, unknown>);
}

/** Every voiceable line in content/, by address. */
export function contentLines(root = ROOT): Map<string, VoiceLine> {
  const content = path.join(root, "content");
  const lines = inventory(
    { chapters: readDir(path.join(content, "chapters")), campaigns: readDir(path.join(content, "campaigns")) },
    { facetsMax: 6 },
  );
  return new Map(lines.map((line) => [line.address, line]));
}

export function readSampleFile(file = path.join(import.meta.dirname, "samples.json")): SampleFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as SampleFile;
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** `{party}` and `{facets}` as the engine fills them for this sample's party. */
export function fillSampleTokens(text: string, tokens: SampleSpec["tokens"]): string {
  return text
    .replace(/\{party\}/g, () => partyPhrase(tokens?.party ?? 1))
    .replace(/\{facets\}/g, () => numberWord(tokens?.facets ?? 0));
}

/**
 * Resolves every sample, or says exactly which ones no longer match content/.
 * Problems are returned, not thrown, so a test can list them all at once.
 */
export function resolveSamples(file: SampleFile, lines: ReadonlyMap<string, VoiceLine>): { samples: Sample[]; problems: string[] } {
  const samples: Sample[] = [];
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const spec of file.samples) {
    if (ids.has(spec.id)) problems.push(`${spec.id}: the id is used twice`);
    ids.add(spec.id);
    if (!(spec.tier in file.tiers)) problems.push(`${spec.id}: tier "${spec.tier}" is not one of ${Object.keys(file.tiers).join(", ")}`);
    const line = lines.get(spec.address);
    if (line === undefined) {
      problems.push(`${spec.id}: nothing voiceable at ${spec.address}`);
      continue;
    }
    const script = spec.script ?? [{ by: "narrator", text: line.text }];
    if (squash(script.map((part) => part.text).join(" ")) !== squash(line.text)) {
      problems.push(`${spec.id}: the script no longer joins to the words at ${spec.address}. Re-cut it from:\n    ${line.text}`);
      continue;
    }
    for (const token of ["party", "facets"] as const) {
      if (line.text.includes(`{${token}}`) && spec.tokens?.[token] === undefined) problems.push(`${spec.id}: the words use {${token}}; give it a value in tokens`);
    }
    const { script: _script, ...rest } = spec;
    const filled = script.map((part) => ({ ...part, text: fillSampleTokens(part.text, spec.tokens) }));
    samples.push({ ...rest, source: line.text, lines: filled, speakers: [...new Set(filled.map((part) => part.by))] });
  }
  return { samples, problems };
}
