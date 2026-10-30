/**
 * Casting a whole people at once (docs/voice-cast.md): copy one character's voice to the others of their people
 * who have none a person chose, wherever it would not put two speakers on one voice in a chapter.
 *
 * Many characters are one of a kind (a dozen yetis, the fauns), and a kind often wants one sound. The sheet's rule
 * still holds: two speakers in one chapter never share a voice, so a peer who meets someone already on the voice,
 * or is in a chapter with the narrator's own, is skipped and named, not forced.
 *
 * Pure: a sheet in, a sheet changed and what happened out.
 */

import { approvedOn, voiceOf, type CastEntry, type CastSheet, type VoiceProvider } from "./sheet.ts";

export interface SharedVoice {
  /** Who now has the voice. */
  applied: string[];
  /** Who was left as they were, and why, in words for the page. */
  skipped: { id: string; why: string }[];
  /** Who had it already. */
  already: string[];
}

/** The others in this character's people, most lines first: everyone with a key like theirs but themselves, the narrator and the party. */
export function peersOf(sheet: CastSheet, keys: Readonly<Record<string, string | null>>, id: string): string[] {
  const mine = keys[id];
  if (!mine) return [];
  return Object.entries(sheet.speakers)
    .filter(([other, entry]) => other !== id && keys[other] === mine && entry.kind !== "narrator" && entry.kind !== "party")
    .sort(([a, x], [b, y]) => (y.lineCount ?? 0) - (x.lineCount ?? 0) || a.localeCompare(b))
    .map(([other]) => other);
}

/** A chapter a character shares with someone already on a voice, and who, or null if there is none. */
function clashWith(sheet: CastSheet, id: string, voice: string, provider: VoiceProvider): { who: string; chapter: string } | null {
  const entry = sheet.speakers[id]!;
  const narrator = sheet.speakers.narrator;
  if (narrator && voiceOf(narrator, provider) === voice) return { who: narrator.name, chapter: entry.chapters[0] ?? "every chapter" };
  for (const [other, theirs] of Object.entries(sheet.speakers)) {
    if (other === id || theirs.kind === "narrator" || theirs.kind === "party" || voiceOf(theirs, provider) !== voice) continue;
    const together = entry.chapters.find((chapter) => theirs.chapters.includes(chapter));
    if (together) return { who: theirs.name, chapter: together };
  }
  return null;
}

function give(entry: CastEntry, from: CastEntry, provider: VoiceProvider): void {
  if (provider === "elevenlabs") {
    const source = from.elevenlabs!;
    entry.elevenlabs = { voiceId: source.voiceId, ...(source.name ? { name: source.name } : {}) };
  } else {
    entry.gemini = { voice: from.gemini.voice };
  }
}

/**
 * Gives `from`'s voice to each of `peers` it can, in order. Changes the sheet in place. Someone a person approved a
 * voice for is never moved. A peer who would meet someone on that voice in a chapter, the narrator's included, is
 * left, and so is the next peer who meets the one just given it.
 */
export function shareVoice(sheet: CastSheet, from: string, peers: readonly string[], provider: VoiceProvider): SharedVoice {
  const source = sheet.speakers[from];
  if (!source) throw new Error(`nobody called ${from} in the sheet`);
  const voice = voiceOf(source, provider);
  if (voice === "") throw new Error(`${source.name} has no ${provider === "elevenlabs" ? "ElevenLabs" : "Gemini"} voice to share yet`);
  const result: SharedVoice = { applied: [], skipped: [], already: [] };
  for (const id of peers) {
    const peer = sheet.speakers[id];
    if (!peer || id === from) continue;
    if (voiceOf(peer, provider) === voice) {
      result.already.push(id);
      continue;
    }
    if (approvedOn(peer, provider)) {
      result.skipped.push({ id, why: `${peer.name} has a voice you approved` });
      continue;
    }
    const clash = clashWith(sheet, id, voice, provider);
    if (clash) {
      result.skipped.push({ id, why: `${peer.name} shares ${clash.chapter} with ${clash.who}, who has it` });
      continue;
    }
    give(peer, source, provider);
    result.applied.push(id);
  }
  return result;
}
