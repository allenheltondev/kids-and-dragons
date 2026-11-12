#!/usr/bin/env node
/**
 * A chapter's script review packet, and a check of its sidecar — for reviewing
 * script drafts (docs/voice-narration-plan.md §3, "Drafting scripts").
 *
 *   npx tsx tools/voice/review-packet.ts --chapter gemfall-02 [--out DIR]   # write the packet
 *   npx tsx tools/voice/review-packet.ts --chapter gemfall-02 --check       # check the sidecar
 *
 * The packet lists every recorded line with a quotation mark in it: the scene's cast, the
 * authored words, the source hash an entry needs, and the sidecar's current cut (or none, which
 * means the narrator reads it all), with the chapter's speaker roster at the top. `--check` runs
 * the same script check `content:validate` does, for one chapter, and counts what is reviewed.
 * Reads files and calls nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { CastSheet } from "./cast/sheet";
import { inventory } from "./inventory";
import { refuseNameBearing } from "./lines";
import { CONTENT, loadContent, readJson, reachableFacets } from "./load";
import { scriptReport, sourceHash, type ScriptEntry } from "./script";

const { values } = parseArgs({
  options: {
    chapter: { type: "string", multiple: true },
    out: { type: "string" },
    check: { type: "boolean", default: false },
  },
});

const content = loadContent();
const facetsMax = reachableFacets(content);
const cast = readJson(path.join(CONTENT, "voice", "cast.json")) as unknown as CastSheet;
const speakers = new Set(Object.keys(cast.speakers));
let failed = false;

for (const chapterId of values.chapter ?? []) {
  const chapter = content.chapters.find((c) => c.id === chapterId);
  if (!chapter) {
    console.error(`No chapter "${chapterId}".`);
    process.exit(2);
  }
  const lines = new Map<string, string>();
  for (const line of inventory({ chapters: [chapter], campaigns: [] }, { facetsMax })) {
    if (line.kind === "choice") continue;
    try {
      refuseNameBearing(line);
    } catch {
      continue;
    }
    lines.set(line.address, line.text);
  }
  const file = path.join(CONTENT, "voice", "scripts", `${chapterId}.json`);
  const sidecar = fs.existsSync(file) ? (readJson(file) as Record<string, ScriptEntry | string>) : {};

  if (values.check) {
    const report = scriptReport(sidecar, { chapter: chapterId, lines, speakers });
    const entries = Object.entries(sidecar).filter(([k]) => !k.startsWith("$")) as [string, ScriptEntry][];
    const reviewed = entries.filter(([, e]) => e.reviewed !== false).length;
    for (const p of report.problems) console.log(`BROKEN ${p.at}: ${p.message}`);
    for (const a of report.stale) console.log(`STALE ${a} (source hash does not match the text)`);
    for (const a of report.orphaned) console.log(`ORPHAN ${a} (no such line)`);
    console.log(`${chapterId}: ${String(entries.length)} entries, ${String(reviewed)} reviewed, ${String(report.problems.length)} broken, ${String(report.stale.length)} stale`);
    if (report.problems.length || report.stale.length) failed = true;
    continue;
  }

  const scenes = (chapter.scenes ?? {}) as Record<string, { cast?: { name?: string; figure?: string }[] }>;
  const roster = Object.entries(cast.speakers)
    .filter(([id, s]) => id === "narrator" || id === "party" || (s.chapters ?? []).includes(chapterId))
    .map(([id, s]) => {
      const x = s as unknown as Record<string, unknown>;
      const aliases = (x.aliases as string[] | undefined)?.length ? ` aka ${(x.aliases as string[]).join(", ")}` : "";
      return `- ${id}: ${String(x.name)}${aliases} (${String(x.kind)}, ${String(x.gender ?? "?")}) ${String(x.who ?? "")}`;
    });
  const out: string[] = [`# ${chapterId} script review packet`, "", "## Speakers cast in this chapter (use these ids in `by`)", ...roster, ""];
  const guide = (chapter.voiceGuide as { npcVoices?: Record<string, string> } | undefined)?.npcVoices;
  if (guide) out.push("## The chapter's voice notes", ...Object.entries(guide).map(([k, v]) => `- ${k}: ${v}`), "");
  out.push("## Lines with quotes", "");
  let n = 0;
  for (const [address, text] of lines) {
    if (!/["“”]/.test(text)) continue;
    n += 1;
    const scene = address.split("/")[1] ?? "";
    const castNames = (scenes[scene]?.cast ?? []).map((c) => c.name ?? c.figure).join("; ") || "(none listed)";
    const entry = sidecar[address];
    out.push(`### ${address}`, `scene cast: ${castNames}`, `source: ${sourceHash(text)}`, `text: ${text}`);
    if (entry && typeof entry === "object") {
      out.push(`current cut${entry.source === sourceHash(text) ? "" : " (STALE)"}:`);
      for (const l of entry.lines) out.push(`  - ${l.by}${l.delivery ? ` [${l.delivery}]` : ""}: ${l.text}`);
    } else out.push("current cut: none (the narrator reads it all)");
    out.push("");
  }
  const dest = path.join(values.out ?? ".", `${chapterId}.md`);
  fs.writeFileSync(dest, `${out.join("\n")}\n`);
  console.log(`${chapterId}: ${String(n)} lines with quotes -> ${dest}`);
}
if (failed) process.exit(1);
