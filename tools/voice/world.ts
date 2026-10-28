/**
 * Everything `voice:status` and `voice:generate` read, loaded one way, so the
 * two can never disagree about which clips exist: the same inventory, cast,
 * scripts, lexicon and delivery tables go into the same `desiredClips` call.
 */

import fs from "node:fs";
import path from "node:path";
import { desiredClips, GEMINI, type CastSheet, type Desired, type Provider } from "./desired";
import { inventory } from "./inventory";
import { classify, type ClassifiedLine } from "./lines";
import { CONTENT, loadContent, readJson, reachableFacets } from "./load";
import { groupOf, type Lock, type Manifest } from "./manifest";
import type { ScriptFile } from "./script";
import type { DeliveryTables } from "./synth";

function readIfExists<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (readJson(file) as T) : fallback;
}

function readDirIfExists<T>(dir: string): Map<string, T> {
  const out = new Map<string, T>();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) out.set(name.slice(0, -5), readJson(path.join(dir, name)) as T);
  return out;
}

/** content/voice/lexicon.json (schemas/voice-lexicon.schema.json). */
export interface LexiconFile {
  words: Record<string, { say: string; ipa?: string; note?: string; reviewed?: boolean }>;
}

/** The lexicon as `spokenForm` takes it: each word and what to say for it. */
export function respellings(file: LexiconFile): Record<string, string> {
  return Object.fromEntries(Object.entries(file.words).map(([word, entry]) => [word, entry.say]));
}

export const MANIFEST_DIR = path.join(CONTENT, "voice", "manifest");

export interface World {
  facetsMax: number;
  cast: CastSheet;
  scripts: Map<string, ScriptFile>;
  manifests: Map<string, Manifest>;
  lock: Lock;
  lexicon: Record<string, string>;
  tables: DeliveryTables;
  /** Every spoken line, grouped by the manifest file that would hold it. */
  groups: Map<string, ClassifiedLine[]>;
}

export function loadWorld(options: { withChoices?: boolean } = {}): World {
  const content = loadContent();
  const facetsMax = reachableFacets(content);
  const lineOptions = { facetsMax };
  const lines = classify(inventory(content, lineOptions), lineOptions).filter((line) => options.withChoices === true || line.kind !== "choice");
  const groups = new Map<string, ClassifiedLine[]>();
  for (const line of lines) groups.set(groupOf(line), [...(groups.get(groupOf(line)) ?? []), line]);
  const tables = readJson(path.join(import.meta.dirname, "bakeoff", "cast.json")) as unknown as DeliveryTables;
  return {
    facetsMax,
    cast: readJson(path.join(CONTENT, "voice", "cast.json")) as unknown as CastSheet,
    scripts: readDirIfExists<ScriptFile>(path.join(CONTENT, "voice", "scripts")),
    manifests: readDirIfExists<Manifest>(MANIFEST_DIR),
    lock: readIfExists<Lock>(path.join(CONTENT, "voice", "voice.lock.json"), { approved: {} }),
    lexicon: respellings(readIfExists<LexiconFile>(path.join(CONTENT, "voice", "lexicon.json"), { words: {} })),
    tables: { delivery: tables.delivery, beats: tables.beats },
    groups,
  };
}

export function desire(world: World, name: string, provider: Provider = GEMINI): Desired {
  return desiredClips(world.groups.get(name) ?? [], {
    cast: world.cast,
    scripts: world.scripts,
    provider,
    lexicon: world.lexicon,
    deliveries: world.tables.delivery,
  });
}
