/**
 * Casting the game by voice bank (docs/voice-species.md): which accent everyone takes from where their people live,
 * which voices are worth hearing for each row of the bank, and writing the choices onto the sheet.
 *
 * Pure: a sheet and a casting in, what to do out. `voice:library` (library.ts) does the reading, the provider calls
 * and the writing.
 */

import type { LibraryVoice, VoiceInfo } from "./bakeoff/providers";
import { accentFor } from "./cast/accents.ts";

export interface CastingVoice {
  /** The name the voice is saved under on the account, so the pickers find it. */
  id: string;
  gender: "male" | "female" | "any";
  /** Whose accent these speakers take when canon does not place them. */
  people?: string;
  /** A Voice Design prompt, for a row the library cannot fill. */
  prompt: string;
  /** Words to look for in the library. */
  search: string;
  speakers: string[];
}

export interface Casting {
  /** Speakers never recast and never given an accent here. */
  locked: string[];
  /** Who belongs to a people their figure does not say (the Skywardens are an order; Tamsin's figure is a griffin). */
  peopleOf: Record<string, string>;
  voices: CastingVoice[];
  noVoice: string[];
}

export interface SheetSpeaker {
  name?: string;
  kind?: string;
  speaks?: boolean;
  lineCount?: number;
  accent?: string;
  elevenlabs?: { voiceId?: string; name?: string; approved?: boolean };
  lines?: { text: string; address?: string }[];
  [field: string]: unknown;
}

export interface Sheet {
  speakers: Record<string, SheetSpeaker>;
  [field: string]: unknown;
}

/** Where canon puts a speaker: their people and their people's places, first place first. */
export type Placed = Readonly<Record<string, { people?: string | null; biomes: readonly string[] }>>;

export interface AccentChange {
  id: string;
  from: string | undefined;
  to: string;
}

const rowOf = (casting: Casting, id: string): CastingVoice | undefined => casting.voices.find((voice) => voice.speakers.includes(id));

/** What each speaker's accent should be. Everyone on a row of the bank gets one; the locked, the party and the voiceless get none. */
export function accentsFor(sheet: Sheet, casting: Casting, placed: Placed): Map<string, string> {
  // The places of a people, from anyone canon places, for a speaker known only by their row of the bank.
  const placesOf = new Map<string, readonly string[]>();
  for (const { people, biomes } of Object.values(placed)) if (people && biomes.length > 0 && !placesOf.has(people)) placesOf.set(people, biomes);
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(sheet.speakers)) {
    const row = rowOf(casting, id);
    if (row === undefined || casting.locked.includes(id) || entry.kind === "party") continue;
    const people = casting.peopleOf[id] ?? placed[id]?.people ?? row.people;
    const biomes = casting.peopleOf[id] === undefined && placed[id]?.biomes.length ? placed[id].biomes : (people ? placesOf.get(people) : undefined) ?? [];
    out.set(id, accentFor(id, people, biomes));
  }
  return out;
}

/** Puts those accents on the sheet, whatever was typed by hand, and says what moved. Changes the sheet in place. */
export function applyAccents(sheet: Sheet, accents: ReadonlyMap<string, string>): AccentChange[] {
  const changes: AccentChange[] = [];
  for (const [id, to] of accents) {
    const entry = sheet.speakers[id];
    if (entry === undefined || entry.accent === to) continue;
    changes.push({ id, from: entry.accent, to });
    entry.accent = to;
  }
  return changes;
}

/** The accent most of a row's lines are spoken in, which is what its voice should suit. */
export function rowAccent(row: CastingVoice, sheet: Sheet, accents: ReadonlyMap<string, string>): string | undefined {
  const weight = new Map<string, number>();
  for (const id of row.speakers) {
    const accent = accents.get(id);
    if (accent !== undefined) weight.set(accent, (weight.get(accent) ?? 0) + 1 + (sheet.speakers[id]?.lineCount ?? 0));
  }
  return [...weight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/** The library's own accent label: it has no word for Appalachian, so an American region rides on a tag over a neutral American voice. */
export function libraryAccent(accent: string | undefined): string {
  if (accent === undefined) return "american";
  if (/cockney|english|received|yorkshire|welsh/i.test(accent) && !/inuit/i.test(accent)) return "british";
  if (/australian/i.test(accent)) return "australian";
  return "american";
}

export interface Candidate {
  voiceId: string;
  name: string;
  about: string;
  preview?: string;
  /** Set for a library voice: not on the account until it is added. */
  ownerId?: string;
  added?: number;
  noticeDays?: number;
}

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** How many of the row's search words a voice's own description has. */
function fit(row: CastingVoice, voice: { name: string; about?: string }): number {
  const said = new Set(wordsOf(`${voice.name} ${voice.about ?? ""}`));
  return wordsOf(row.search).filter((word) => said.has(word)).length;
}

const genderFits = (row: CastingVoice, gender: VoiceInfo["gender"]): boolean => row.gender === "any" || gender === undefined || gender === (row.gender === "male" ? "m" : "f");

/**
 * The voices worth hearing for a row, best first: what the account already has when it fits (no slot spent), then the
 * library by how well it matches and how many people added it. Never a voice in `barred` (the narrator's).
 */
export function candidatesFor(row: CastingVoice, account: readonly VoiceInfo[], library: readonly LibraryVoice[], barred: ReadonlySet<string>, count = 3): Candidate[] {
  const fromAccount = account
    .filter((voice) => !barred.has(voice.id) && genderFits(row, voice.gender) && fit(row, voice) > 0)
    .sort((a, b) => fit(row, b) - fit(row, a) || a.name.localeCompare(b.name))
    .slice(0, 1)
    .map((voice): Candidate => ({ voiceId: voice.id, name: voice.name, about: voice.about ?? "", ...(voice.preview ? { preview: voice.preview } : {}) }));
  const taken = new Set(fromAccount.map((voice) => voice.voiceId));
  const fromLibrary = library
    .filter((voice) => !barred.has(voice.id) && !taken.has(voice.id) && genderFits(row, voice.gender))
    .sort((a, b) => fit(row, b) - fit(row, a) || (b.added ?? 0) - (a.added ?? 0) || a.name.localeCompare(b.name))
    .map(
      (voice): Candidate => ({
        voiceId: voice.id,
        name: voice.name,
        about: voice.about ?? "",
        ownerId: voice.ownerId,
        ...(voice.preview ? { preview: voice.preview } : {}),
        ...(voice.added === undefined ? {} : { added: voice.added }),
        ...(voice.noticeDays === undefined ? {} : { noticeDays: voice.noticeDays }),
      }),
    );
  return [...fromAccount, ...fromLibrary].slice(0, count);
}

export type Picks = Record<string, Candidate>;

/** One pick per row, the best candidate no earlier row has: two rows on one voice would be one sound. Rows with most lines choose first. */
export function firstPicks(rows: readonly { row: CastingVoice; lines: number; candidates: readonly Candidate[] }[]): Picks {
  const picks: Picks = {};
  const used = new Set<string>();
  for (const { row, candidates } of [...rows].sort((a, b) => b.lines - a.lines || a.row.id.localeCompare(b.row.id))) {
    const pick = candidates.find((candidate) => !used.has(candidate.voiceId));
    if (pick === undefined) continue;
    picks[row.id] = pick;
    used.add(pick.voiceId);
  }
  return picks;
}

/** The picks not on the account yet: each one takes a voice slot. */
export function toAdd(picks: Picks, account: readonly VoiceInfo[]): [string, Candidate][] {
  const have = new Set(account.map((voice) => voice.id));
  const names = new Map(account.map((voice) => [voice.name, voice.id]));
  return Object.entries(picks).filter(([id, pick]) => pick.ownerId !== undefined && !have.has(pick.voiceId) && !names.has(id));
}

/**
 * Gives every speaker on a picked row that row's voice. Changes the sheet in place. The locked are never touched; a
 * speaker already on the voice keeps their approval. `approve` is for picks a person has heard.
 */
export function assign(sheet: Sheet, casting: Casting, picks: Picks, options: { approve: boolean }): { assigned: string[]; unpicked: string[] } {
  const assigned: string[] = [];
  const unpicked: string[] = [];
  for (const row of casting.voices) {
    const pick = picks[row.id];
    if (pick === undefined) {
      unpicked.push(row.id);
      continue;
    }
    for (const id of row.speakers) {
      const entry = sheet.speakers[id];
      if (entry === undefined || casting.locked.includes(id)) continue;
      const approved = options.approve || (entry.elevenlabs?.voiceId === pick.voiceId && entry.elevenlabs.approved === true);
      entry.elevenlabs = { voiceId: pick.voiceId, name: pick.name, ...(approved ? { approved: true } : {}) };
      assigned.push(id);
    }
  }
  return { assigned, unpicked };
}

/** What is wrong with a casting against the sheet: anyone in two places or none, or a locked speaker on a row. */
export function castingProblems(sheet: Sheet, casting: Casting): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [where, ids] of [...casting.voices.map((voice): [string, string[]] => [voice.id, voice.speakers]), ["noVoice", casting.noVoice] as [string, string[]]]) {
    for (const id of ids) {
      if (sheet.speakers[id] === undefined) problems.push(`${where} names ${id}, who is not on the sheet`);
      if (casting.locked.includes(id)) problems.push(`${where} names ${id}, who is locked`);
      if (seen.has(id)) problems.push(`${id} is on both ${seen.get(id)!} and ${where}`);
      seen.set(id, where);
    }
  }
  for (const id of Object.keys(sheet.speakers)) if (!seen.has(id) && !casting.locked.includes(id)) problems.push(`${id} is on the sheet but nowhere in the casting`);
  return problems;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A page to hear each row's candidates and save the choices as picks.json. The first candidate starts chosen. */
export function shortlistPage(rows: readonly { row: CastingVoice; accent: string | undefined; names: string[]; candidates: readonly Candidate[] }[], picks: Picks): string {
  const sections = rows.map(({ row, accent, names, candidates }) => {
    const options = candidates.map((candidate) => {
      const chosen = picks[row.id]?.voiceId === candidate.voiceId ? " checked" : "";
      const value = escapeHtml(JSON.stringify(candidate));
      const where = candidate.ownerId === undefined ? "on your account" : `library, added by ${String(candidate.added ?? 0)}${candidate.noticeDays ? `, ${String(candidate.noticeDays)} days' notice` : ""}`;
      const audio = candidate.preview ? `<audio controls preload="none" src="${escapeHtml(candidate.preview)}"></audio>` : "<em>no sample</em>";
      return `<label><input type="radio" name="${escapeHtml(row.id)}" value="${value}"${chosen}> <b>${escapeHtml(candidate.name)}</b> <small>${escapeHtml(where)}. ${escapeHtml(candidate.about)}</small>${audio}</label>`;
    });
    const none = `<label><input type="radio" name="${escapeHtml(row.id)}" value=""${picks[row.id] === undefined ? " checked" : ""}> None of these</label>`;
    return `<section><h2>${escapeHtml(row.id)}</h2><p>${escapeHtml(accent ?? "no accent")} · ${escapeHtml(names.join(", "))}</p>${options.join("")}${none}</section>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Voice shortlist</title><style>
:root{color-scheme:light dark}body{font:16px system-ui;max-width:860px;margin:0 auto;padding:16px}
section{border-top:1px solid #8886;padding:8px 0}h2{font-size:18px;margin:8px 0 0}p{margin:4px 0 8px;opacity:.75}
label{display:block;margin:8px 0}small{opacity:.75}audio{display:block;width:100%;margin-top:4px}
button{position:sticky;top:8px;font:inherit;padding:8px 16px}
</style><h1>Voice shortlist</h1><button id="save">Save picks.json</button>${sections.join("")}<script>
document.getElementById("save").onclick=()=>{const picks={};for(const input of document.querySelectorAll("input:checked"))if(input.value)picks[input.name]=JSON.parse(input.value);
const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([JSON.stringify(picks,null,2)],{type:"application/json"}));link.download="picks.json";link.click();};
</script>`;
}
