#!/usr/bin/env node
/**
 * Casting from the voice bank, in steps — `npm run voice:library -- <step>`. Docs: docs/voice-species.md.
 *
 *   accents [--write]     everyone's accent from where their people live (free, offline; shows the changes unless --write)
 *   slots                 custom voices the plan allows and has in use
 *   shortlist             candidates for each row of the bank, a page to hear them, and first picks (read only, free)
 *   add [--yes]           puts the picks that are not on the account yet onto it (uses voice slots)
 *   assign [--approve]    writes the picks to every speaker on their row, in content/voice/cast.json
 *   listen                renders one real line per speaker to a local folder, to hear the tags on the voice (spends a little)
 *
 * Options: --picks FILE (default test-results/voice-shortlist/picks.json), --row ID (listen to one row),
 * --max-chars N (listen's cap, default 20000), --model ID.
 *
 * `listen` writes nothing but its own folder: no manifest, no bucket. `voice:generate` only renders approved voices.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addLibraryVoice, keysFromEnv, listVoices, searchLibrary, voiceSlots, type Fetch, type LibraryVoice } from "./bakeoff/providers";
import { loadProfiles } from "./cast/profile.ts";
import { accentsFor, applyAccents, assign, candidatesFor, castingProblems, firstPicks, libraryAccent, rowAccent, searchWords, settleAdded, shortlistPage, toAdd, type Casting, type Picks, type Placed, type Sheet } from "./casting";
import { ELEVENLABS, type CastSheet, type Provider } from "./desired";
import { readJson } from "./load";
import { makeBilledChars, makeSynthesizer, type DeliveryTables, type SynthOptions } from "./synth";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SHEET = path.join(ROOT, "content", "voice", "cast.json");
const CASTING = path.join(ROOT, "content", "voice", "casting.json");
const SHORTLIST = path.join(ROOT, "test-results", "voice-shortlist");
const LISTEN = path.join(ROOT, "test-results", "voice-listen");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    write: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    approve: { type: "boolean", default: false },
    picks: { type: "string", default: path.join(SHORTLIST, "picks.json") },
    row: { type: "string" },
    "max-chars": { type: "string", default: "20000" },
    model: { type: "string", default: ELEVENLABS.model },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const sheet = JSON.parse(fs.readFileSync(SHEET, "utf8")) as Sheet;
const casting = readJson(CASTING) as unknown as Casting;
const writeSheet = (): void => fs.writeFileSync(SHEET, `${JSON.stringify(sheet, null, 2)}\n`);

const problems = castingProblems(sheet, casting);
if (problems.length > 0) fail(`content/voice/casting.json does not match the sheet:\n  ${problems.join("\n  ")}`);

function placed(): Placed {
  const profiles = loadProfiles(ROOT, sheet as never) as Record<string, { people?: string | null; homeland?: { places?: { biome?: string }[] } | null }>;
  return Object.fromEntries(
    Object.entries(profiles).map(([id, profile]) => [id, { people: profile.people ?? null, biomes: (profile.homeland?.places ?? []).flatMap((place) => (place.biome ? [place.biome] : [])) }]),
  );
}

const keys = keysFromEnv();
const http: Fetch = (url, init) => fetch(url, init) as never;
function needKey(): void {
  if (keys.elevenlabs === undefined) fail("No ElevenLabs key. Set ELEVENLABS_API_KEY.");
}
const readPicks = (): Picks => {
  if (!fs.existsSync(values.picks)) fail(`No picks at ${values.picks}. Run the shortlist step first.`);
  return JSON.parse(fs.readFileSync(values.picks, "utf8")) as Picks;
};

async function accents(): Promise<void> {
  const changes = applyAccents(sheet, accentsFor(sheet, casting, placed()));
  for (const change of changes) console.log(`  ${change.id.padEnd(28)} ${(change.from ?? "(sheet default)").padEnd(34)} -> ${change.to}`);
  console.log(`${String(changes.length)} accents ${values.write ? "written" : "would change. Add --write to save them."}`);
  if (values.write) writeSheet();
}

async function slots(): Promise<void> {
  needKey();
  const { used, limit, tier } = await voiceSlots(keys, http);
  console.log(`${String(used)} of ${String(limit)} custom voices in use${tier ? ` (${tier})` : ""}: ${String(limit - used)} free.`);
}

async function shortlist(): Promise<void> {
  needKey();
  const accentOf = accentsFor(sheet, casting, placed());
  const account = await listVoices("elevenlabs", keys, http);
  const barred = new Set(casting.locked.flatMap((id) => sheet.speakers[id]?.elevenlabs?.voiceId ?? []));
  // The library reads a phrase as one wish and mostly finds nothing for it, so each word is asked on its own (once per
  // gender and accent, however many rows share it) and the ranking does the choosing.
  const asked = new Map<string, LibraryVoice[]>();
  const ask = async (search: string, gender: string, accent: string): Promise<LibraryVoice[]> => {
    const key = `${search}|${gender}|${accent}`;
    if (!asked.has(key)) asked.set(key, (await searchLibrary(keys, { search, gender, accent, language: "en", pageSize: 100 }, http)).voices);
    return asked.get(key)!;
  };
  const rows = [];
  for (const row of casting.voices) {
    const accent = rowAccent(row, sheet, accentOf);
    const gender = row.gender === "any" ? "" : row.gender;
    const library: LibraryVoice[] = [];
    for (const search of [row.search, ...searchWords(row), ""]) library.push(...(await ask(search, gender, libraryAccent(accent))));
    const candidates = candidatesFor(row, account, library, barred, libraryAccent(accent));
    const lines = row.speakers.reduce((sum, id) => sum + (sheet.speakers[id]?.lineCount ?? 0), 0);
    rows.push({ row, accent, lines, candidates, names: row.speakers.map((id) => sheet.speakers[id]?.name ?? id) });
    console.log(`  ${row.id.padEnd(30)} ${String(candidates.length)} candidates`);
  }
  const { used, limit } = await voiceSlots(keys, http);
  const picks = firstPicks(rows, limit - used);
  fs.mkdirSync(SHORTLIST, { recursive: true });
  fs.writeFileSync(path.join(SHORTLIST, "shortlist.json"), `${JSON.stringify(rows, null, 2)}\n`);
  fs.writeFileSync(path.join(SHORTLIST, "picks.json"), `${JSON.stringify(picks, null, 2)}\n`);
  fs.writeFileSync(path.join(SHORTLIST, "index.html"), shortlistPage(rows, picks));
  const empty = rows.filter(({ row }) => picks[row.id] === undefined).map(({ row }) => row.id);
  console.log(`${String(Object.keys(picks).length)} of ${String(rows.length)} rows have a first pick. Hear them: ${path.join(SHORTLIST, "index.html")}`);
  if (empty.length > 0) console.log(`No pick, so design these on the cast page: ${empty.join(", ")}`);
}

async function add(): Promise<void> {
  needKey();
  const picks = readPicks();
  const wanted = toAdd(picks, await listVoices("elevenlabs", keys, http));
  const { used, limit } = await voiceSlots(keys, http);
  console.log(`${String(wanted.length)} voices to add; ${String(limit - used)} slots free.`);
  for (const [id, pick] of wanted) console.log(`  ${id.padEnd(30)} ${pick.name}`);
  if (wanted.length > limit - used) fail("That is more than the plan has room for. Pick account voices for some rows, or raise the plan.");
  if (!values.yes) {
    console.log("Nothing added. Add --yes to put them on the account.");
    return;
  }
  for (const [id, pick] of wanted) {
    const voiceId = await addLibraryVoice(keys, { ownerId: pick.ownerId!, voiceId: pick.voiceId, name: id }, http);
    settleAdded(picks, pick.voiceId, { voiceId, name: id });
    // Saved after each one, so a failure halfway leaves the file saying what is on the account.
    fs.writeFileSync(values.picks, `${JSON.stringify(picks, null, 2)}\n`);
    console.log(`  added ${id}`);
  }
  fs.writeFileSync(values.picks, `${JSON.stringify(picks, null, 2)}\n`);
}

async function assignPicks(): Promise<void> {
  const picks = readPicks();
  const waiting = Object.entries(picks).filter(([, pick]) => pick.ownerId !== undefined).map(([id]) => id);
  if (waiting.length > 0) fail(`Not on the account yet, so nothing can speak with them: ${waiting.join(", ")}. Run the add step first.`);
  const { assigned, unpicked } = assign(sheet, casting, picks, { approve: values.approve });
  writeSheet();
  console.log(`${String(assigned.length)} speakers given a voice${values.approve ? " and approved" : ", unapproved"}.`);
  if (unpicked.length > 0) console.log(`Rows with no pick: ${unpicked.join(", ")}`);
}

async function listen(): Promise<void> {
  needKey();
  const maxChars = Number(values["max-chars"]);
  if (!(maxChars >= 0)) fail("--max-chars takes a number.");
  const tables = readJson(path.join(import.meta.dirname, "bakeoff", "cast.json")) as unknown as DeliveryTables;
  const provider: Provider = { provider: ELEVENLABS.provider, model: values.model };
  const options: SynthOptions = { provider: provider as never, cast: sheet as unknown as CastSheet, tables: { delivery: tables.delivery, beats: tables.beats }, keys, fetch: http };
  const synth = makeSynthesizer(options);
  const billed = makeBilledChars(options);
  let chars = 0;
  let made = 0;
  for (const row of casting.voices) {
    if (values.row !== undefined && row.id !== values.row) continue;
    for (const id of row.speakers) {
      const entry = sheet.speakers[id];
      const text = entry?.lines?.find((line) => !/\{\w+\}/.test(line.text))?.text;
      if (entry?.elevenlabs?.voiceId === undefined || text === undefined) continue;
      const segment = { key: `listen-${id}`, by: id, text };
      chars += billed(segment);
      if (chars > maxChars) fail(`Stopped at the ${String(maxChars)} character cap after ${String(made)} clips.`);
      const said = await synth(segment);
      const folder = path.join(LISTEN, row.id);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${id}.${said.ext}`), said.audio);
      made += 1;
      console.log(`  ${row.id}/${id}`);
    }
  }
  console.log(`${String(made)} clips, ${String(chars)} characters, in ${LISTEN}`);
}

const steps: Record<string, () => Promise<void>> = { accents, slots, shortlist, add, assign: assignPicks, listen };
const step = steps[positionals[0] ?? ""];
if (step === undefined) fail(`Name a step: ${Object.keys(steps).join(", ")}.`);
await step();
