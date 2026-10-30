/**
 * The cast review, as something to take away (docs/voice-cast.md): every
 * approval and rejection on the voice sheet, with the listener's notes.
 *
 * Two forms of the same thing:
 *  - Markdown, for people: what's settled, what was turned down and why,
 *    what's left, and which voices keep being rejected;
 *  - JSON, for tools and agents: every speaker's status, voice and full
 *    decision history.
 * The sheet itself stays the source of truth; this is a report of it.
 */

import { voiceClashes, type CastEntry, type CastSheet, type Decision } from "./sheet.ts";

/** A provider's decisions, oldest first: one with no provider is a Gemini one, as every decision was before ElevenLabs. */
const decisionsOn = (entry: CastEntry, provider: "gemini" | "elevenlabs"): Decision[] => (entry.history ?? []).filter((d) => (d.provider ?? "gemini") === provider);
/** The review is of the game's voices, which are Gemini's: ElevenLabs decisions are listed apart, in the JSON. */
const geminiHistory = (entry: CastEntry): Decision[] => decisionsOn(entry, "gemini");
const latest = (entry: CastEntry): Decision | undefined => geminiHistory(entry).at(-1);
const rejections = (entry: CastEntry): Decision[] => geminiHistory(entry).filter((d) => d.decision === "rejected");
const cell = (text: string | undefined): string => (text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const day = (iso: string): string => iso.slice(0, 10);

export interface ReviewJson {
  generated: string;
  accent: string;
  summary: { speakers: number; approved: number; rejectedNowRetrying: number; untouched: number; clashes: number };
  rejectedVoices: Record<string, number>;
  speakers: {
    id: string;
    name: string;
    kind: CastEntry["kind"];
    status: CastEntry["status"];
    voice: string;
    chapters: number;
    /** Lines the game gives them to speak, so a review can start with whoever has the most. */
    lines: number;
    notes?: string;
    direction?: string;
    /** Gemini's decisions: what `status` and `voice` are about. */
    history: Decision[];
    /** The voice picked on ElevenLabs and the decisions about it, when there is any: apart from Gemini's. */
    elevenlabs?: { voiceId?: string; name?: string; approved: boolean; history: Decision[] };
  }[];
}

export function reviewJson(sheet: CastSheet, generated = new Date().toISOString()): ReviewJson {
  const entries = Object.entries(sheet.speakers);
  const rejectedVoices: Record<string, number> = {};
  for (const [, entry] of entries) for (const d of rejections(entry)) rejectedVoices[d.voice] = (rejectedVoices[d.voice] ?? 0) + 1;
  return {
    generated,
    accent: sheet.accent,
    summary: {
      speakers: entries.length,
      approved: entries.filter(([, e]) => e.status === "approved").length,
      rejectedNowRetrying: entries.filter(([, e]) => e.status !== "approved" && latest(e)?.decision === "rejected").length,
      untouched: entries.filter(([, e]) => geminiHistory(e).length === 0).length,
      clashes: voiceClashes(sheet).length,
    },
    rejectedVoices,
    speakers: entries.map(([id, e]) => ({
      id,
      name: e.name,
      kind: e.kind,
      status: e.status,
      voice: e.gemini.voice,
      chapters: e.chapters.length,
      lines: e.lineCount ?? 0,
      ...(e.notes ? { notes: e.notes } : {}),
      ...(e.direction ? { direction: e.direction } : {}),
      history: geminiHistory(e),
      ...(e.elevenlabs || decisionsOn(e, "elevenlabs").length
        ? { elevenlabs: { ...(e.elevenlabs?.voiceId ? { voiceId: e.elevenlabs.voiceId } : {}), ...(e.elevenlabs?.name ? { name: e.elevenlabs.name } : {}), approved: e.elevenlabs?.approved === true, history: decisionsOn(e, "elevenlabs") } }
        : {}),
    })),
  };
}

export function reviewMarkdown(sheet: CastSheet, generated = new Date().toISOString()): string {
  const json = reviewJson(sheet, generated);
  const entries = Object.entries(sheet.speakers).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const approved = entries.filter(([, e]) => e.status === "approved");
  const retrying = entries.filter(([, e]) => e.status !== "approved" && latest(e)?.decision === "rejected");
  const untouched = entries.filter(([, e]) => e.status !== "approved" && geminiHistory(e).length === 0);
  const clashes = voiceClashes(sheet);
  const out: string[] = [];

  out.push("# Cast voice review", "");
  out.push(`From \`content/voice/cast.json\`, ${day(generated)}. Accent for everyone: ${sheet.accent}.`, "");
  out.push(
    `- **${String(json.summary.approved)}** of ${String(json.summary.speakers)} speakers approved`,
    `- **${String(retrying.length)}** rejected and now on another voice, waiting to be heard again`,
    `- **${String(untouched.length)}** not reviewed yet`,
    `- **${String(clashes.length)}** chapter${clashes.length === 1 ? "" : "s"} with two speakers on one voice`,
    "",
  );

  out.push(`## Approved (${String(approved.length)})`, "");
  if (approved.length === 0) out.push("None yet.", "");
  else {
    out.push("| Character | Voice | Notes | Turned down first |", "|---|---|---|---|");
    for (const [, e] of approved) {
      const approval = [...geminiHistory(e)].reverse().find((d) => d.decision === "approved");
      const before = rejections(e).map((d) => d.voice).join(", ");
      out.push(`| ${cell(e.name)} | ${e.gemini.voice} | ${cell(approval?.notes ?? e.notes)} | ${before || "—"} |`);
    }
    out.push("");
  }

  out.push(`## Rejected, now trying another voice (${String(retrying.length)})`, "");
  if (retrying.length === 0) out.push("None.", "");
  for (const [id, e] of retrying) {
    out.push(`- **${e.name}** (\`${id}\`) is now on **${e.gemini.voice}**. Turned down:`);
    for (const d of rejections(e)) out.push(`  - ${d.voice}${d.notes ? `: "${cell(d.notes)}"` : ""}${d.model ? ` (heard on ${d.model})` : ""}, ${day(d.at)}`);
  }
  if (retrying.length) out.push("");

  const tally = Object.entries(json.rejectedVoices).sort((a, b) => b[1] - a[1]);
  if (tally.length) {
    out.push("## Voices rejected most", "", "A voice turned down for several characters may be the wrong fit for this game, not just for them.", "");
    for (const [voice, count] of tally) out.push(`- ${voice}: ${String(count)}`);
    out.push("");
  }

  if (clashes.length) {
    out.push("## Two speakers on one voice", "");
    for (const clash of clashes) out.push(`- ${clash.chapter}: ${clash.voice} for ${clash.speakers.map((id) => sheet.speakers[id]?.name ?? id).join(" and ")}`);
    out.push("");
  }

  out.push(`## Not reviewed yet (${String(untouched.length)})`, "");
  out.push(untouched.length ? untouched.map(([, e]) => `${e.name} (${e.gemini.voice})`).join(", ") : "Everyone has been heard.", "");
  return `${out.join("\n").trimEnd()}\n`;
}
