/**
 * What to ask ElevenLabs' voice design for, worked out from the cast sheet (docs/voice-cast.md, "Designing a voice").
 * The description is the character as the sheet knows them (who they are, how they sound, a man's or a woman's voice,
 * their accent and the direction a person gave) and the sample text is their own lines, so the previews say things
 * this character really says. Both are only a starting point: the page lets a person edit them before anything is spent.
 */

import { DESIGN_LIMITS } from "../bakeoff/providers.ts";
import type { CastEntry, CastSheet } from "./sheet.ts";

export interface DesignBrief {
  description: string;
  text: string;
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The notes without the character's name: the opening "Old Wick," goes, and any other mention (their whole name, another
 * name they go by, or a capitalised word of it) becomes "they". The voice is to be of their kind, not of anyone's name.
 */
function withoutNames(text: string, entry: CastEntry): string {
  const names = [entry.name, ...entry.aliases].map(clean).filter((name) => name.length >= 3);
  const words = names.flatMap((name) => name.split(" ")).filter((word) => /^[A-Z]/.test(word) && word.length >= 4);
  const all = [...new Set([...names, ...words])].sort((a, b) => b.length - a.length).map(escape);
  let out = clean(text);
  if (all.length > 0) {
    out = out.replace(new RegExp(`^(?:${all.join("|")})(?:\\s+(?:${all.join("|")}))*\\s*[,;:]?\\s*`, "i"), "");
    out = out.replace(new RegExp(`\\b(?:${all.join("|")})\\b`, "gi"), "they");
  }
  return out || clean(text);
}

/** A man's or a woman's voice: what a person set, else what the narration's pronouns say. */
function voiceKind(entry: CastEntry): string | null {
  if (entry.gender === "female") return "woman's";
  if (entry.gender === "male") return "man's";
  if (/^she\b/i.test(entry.pronouns ?? "")) return "woman's";
  if (/^he\b/i.test(entry.pronouns ?? "")) return "man's";
  return null;
}

/**
 * A description of the voice. It never carries the character's name: the voice should be of their kind, and a name
 * the model might take for a real person is a way to get a voice that sounds like one. It is a storyteller's
 * character voice for children, so it asks for clear and warm and never a child's voice.
 */
export function designDescription(sheet: CastSheet, entry: CastEntry): string {
  const kind = voiceKind(entry);
  const accent = entry.accent ?? sheet.accent;
  const parts = [
    `${kind ? `A ${kind} voice` : "A voice"} for a character in a children's storybook: ${sentence(withoutNames(entry.who, entry))}`,
    entry.direction ? sentence(withoutNames(entry.direction, entry)) : "",
    // The sheet's own accent is a whole sentence ("General American, the way a warm American storyteller reads aloud").
    `Accent: ${clean(accent.split(",")[0]!)}.`,
    "An adult performer's voice, warm and clear, easy for an eight-year-old to follow, expressive without ever being scary.",
  ].filter(Boolean);
  let text = parts.join(" ");
  // The notes are the part that can run long: they give way before the rest does.
  if (text.length > DESIGN_LIMITS.description.max) {
    const notes = withoutNames(entry.who, entry);
    const rest = text.length - notes.length;
    text = text.replace(notes, clip(notes, Math.max(80, DESIGN_LIMITS.description.max - rest - 20)));
  }
  while (text.length < DESIGN_LIMITS.description.min) text += " Warm and clear.";
  return clip(text, DESIGN_LIMITS.description.max);
}

/** The words the previews say: their own lines from the game, joined up to what the voice design needs, with the stand-in line if they have too few. */
export function designText(entry: CastEntry, standIn: string): string {
  const spoken: string[] = [];
  let length = 0;
  for (const line of entry.lines.filter((l) => l.text.length >= 12)) {
    const text = clean(line.text);
    if (length + text.length > DESIGN_LIMITS.text.max) break;
    spoken.push(text);
    length += text.length + 1;
    if (length >= DESIGN_LIMITS.text.min) break;
  }
  let text = spoken.join(" ");
  if (text.length < DESIGN_LIMITS.text.min) text = `${text} ${standIn.replace("{name}", entry.name)}`.trim();
  while (text.length < DESIGN_LIMITS.text.min) text += ` ${standIn.replace("{name}", entry.name)}`;
  return clip(text, DESIGN_LIMITS.text.max);
}

export function designBrief(sheet: CastSheet, entry: CastEntry, standIn: string): DesignBrief {
  return { description: designDescription(sheet, entry), text: designText(entry, standIn) };
}

/** Whether a description and sample text are inside what ElevenLabs takes. Returns the problem, or null. */
export function designProblem(description: string, text: string): string | null {
  const { description: d, text: t } = DESIGN_LIMITS;
  if (description.length < d.min || description.length > d.max) return `The description must be ${d.min} to ${d.max} characters (it is ${description.length}).`;
  if (text.length < t.min || text.length > t.max) return `The sample text must be ${t.min} to ${t.max} characters (it is ${text.length}).`;
  return null;
}
