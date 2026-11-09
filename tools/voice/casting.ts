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

/** Words that say one thing: the library says `old` and `middle_aged` where a row says elderly or middle-aged. */
const SAME: Record<string, string> = { older: "old", elderly: "old", ancient: "old", grandmother: "old", youthful: "young", middle: "middle_aged", aged: "middle_aged" };
const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[a-z_]+/g) ?? []).map((word) => SAME[word] ?? word);

/** The search words a row asks for, one at a time: the library reads a whole phrase as one wish and mostly finds nothing. */
export const searchWords = (row: CastingVoice): string[] => [...new Set(wordsOf(row.search).filter((word) => !["male", "female", "man", "woman", "middle_aged"].includes(word)))];

/** Never for a table of eight-year-olds, whatever else fits. */
const UNFIT = /horror|scary|creepy|terrif|asmr|seduct|sensual|sexy|erotic|demon|villain/i;
/** Voices made to sell or to post: they read stories flat. */
const SALES = /advertis|commercial|\bugc\b|\bads?\b|sales|news/i;
/** Voices made to tell stories or play characters. */
const STORY = /characters_animation|narrative_story|storytell|character/i;

const ageOf = (words: Set<string>): "young" | "old" | undefined => (words.has("young") ? "young" : words.has("old") ? "old" : undefined);

/**
 * How well a voice suits a row: a point per search word its own description has, a point for being made for stories or
 * characters, a point off for being made for ads, two off for the wrong age. A voice unfit for children scores nothing.
 */
export function fit(row: CastingVoice, voice: { name: string; about?: string }): number {
  const description = `${voice.name} ${voice.about ?? ""}`;
  if (UNFIT.test(description)) return -Infinity;
  const said = new Set(wordsOf(description));
  const wanted = new Set(wordsOf(row.search));
  let score = [...wanted].filter((word) => said.has(word)).length;
  if (STORY.test(description)) score += 1;
  if (SALES.test(description)) score -= 1;
  const want = ageOf(wanted);
  const is = ageOf(said);
  if (want !== undefined && is !== undefined && want !== is) score -= 2;
  return score;
}

const genderFits = (row: CastingVoice, gender: VoiceInfo["gender"]): boolean => row.gender === "any" || gender === undefined || gender === (row.gender === "male" ? "m" : "f");

/**
 * The voices worth hearing for a row, best first, by how well each fits; an account voice wins a tie, since it spends
 * no slot, then the library voice most people added. Never a voice in `barred` (the narrator's), nor one unfit for children.
 */
export function candidatesFor(row: CastingVoice, account: readonly VoiceInfo[], library: readonly LibraryVoice[], barred: ReadonlySet<string>, count = 8): Candidate[] {
  const scored: { candidate: Candidate; score: number; added: number }[] = [];
  const seen = new Set<string>(barred);
  for (const voice of account) {
    if (seen.has(voice.id) || !genderFits(row, voice.gender)) continue;
    const score = fit(row, voice);
    if (score <= 0) continue;
    seen.add(voice.id);
    scored.push({ candidate: { voiceId: voice.id, name: voice.name, about: voice.about ?? "", ...(voice.preview ? { preview: voice.preview } : {}) }, score: score + 0.5, added: Infinity });
  }
  for (const voice of library) {
    if (seen.has(voice.id) || !genderFits(row, voice.gender)) continue;
    const score = fit(row, voice);
    if (score === -Infinity) continue;
    seen.add(voice.id);
    const candidate: Candidate = {
      voiceId: voice.id,
      name: voice.name,
      about: voice.about ?? "",
      ownerId: voice.ownerId,
      ...(voice.preview ? { preview: voice.preview } : {}),
      ...(voice.added === undefined ? {} : { added: voice.added }),
      ...(voice.noticeDays === undefined ? {} : { noticeDays: voice.noticeDays }),
    };
    scored.push({ candidate, score, added: voice.added ?? 0 });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.added - a.added || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, count)
    .map(({ candidate }) => candidate);
}

export type Picks = Record<string, Candidate>;

/**
 * One pick per row, the best candidate no earlier row has: two rows on one voice would be one sound. Rows with most
 * lines choose first, and spend the plan's free `slots` on library voices; once those are gone a row takes only a voice
 * the account already has.
 */
export function firstPicks(rows: readonly { row: CastingVoice; lines: number; candidates: readonly Candidate[] }[], slots = Infinity): Picks {
  const picks: Picks = {};
  const used = new Set<string>();
  let free = slots;
  for (const { row, candidates } of [...rows].sort((a, b) => b.lines - a.lines || a.row.id.localeCompare(b.row.id))) {
    const pick = candidates.find((candidate) => !used.has(candidate.voiceId) && (candidate.ownerId === undefined || free > 0));
    if (pick === undefined) continue;
    picks[row.id] = pick;
    used.add(pick.voiceId);
    if (pick.ownerId !== undefined) free -= 1;
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
