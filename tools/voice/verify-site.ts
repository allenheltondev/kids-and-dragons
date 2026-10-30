#!/usr/bin/env node
/**
 * Every clip the manifests play is on the site about to serve them —
 * `node tools/voice/verify-site.ts <site-url>`, run by `deploy.sh` before it
 * uploads `content/` (docs/voice-narration-plan.md §4, `voice:verify`).
 *
 * The manifests deploy with the content, and a browser fetches each clip they
 * name from `/voice/`. A clip the site lacks would be a 404 mid-sentence, so the
 * deploy stops here and the previous content keeps serving. So does a clip the
 * site would not answer for: here, unknown is not good enough. No manifests, or
 * manifests that play nothing yet, is the ordinary state and passes at once.
 *
 * Plain `node`, no dependencies (sources.ts says why). `npm run voice:verify`
 * runs the rest of the gate, from git, in CI.
 */

import fs from "node:fs";
import path from "node:path";
import { isClipKey } from "../../packages/shared/src/voice-clips.ts";
import { checkSources, SiteClipSource } from "./sources.ts";

/** Every well-formed clip a manifest in `dir` plays, with the length it says. Malformed ones are `voice:verify`'s to fail. */
export function clipsIn(dir: string): { clips: Map<string, number>; unreadable: string[] } {
  const clips = new Map<string, number>();
  const unreadable: string[] = [];
  if (!fs.existsSync(dir)) return { clips, unreadable };
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    } catch {
      unreadable.push(name);
      continue;
    }
    for (const variants of Object.values((manifest ?? {}) as Record<string, unknown>)) {
      for (const entry of Object.values((variants ?? {}) as Record<string, unknown>)) {
        if (!Array.isArray(entry)) continue;
        for (const clip of entry as { clip?: unknown; ms?: unknown }[]) {
          if (typeof clip?.clip === "string" && isClipKey(clip.clip) && typeof clip.ms === "number") clips.set(clip.clip, clip.ms);
        }
      }
    }
  }
  return { clips, unreadable };
}

export type Fetcher = ConstructorParameters<typeof SiteClipSource>[1];

/**
 * The deploy's verdict, as the lines to print and the exit code. Stricter than
 * `voice:verify`: a lookup that never got an answer (a timeout, a 5xx after
 * retries) fails here too, because this is the last check before the manifests
 * go live, and "could not tell" is not "confirmed there".
 */
export async function verifySite(site: string, dir: string, fetcher?: Fetcher): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const { clips, unreadable } = clipsIn(dir);
  for (const name of unreadable) lines.push(`FAIL  content/voice/manifest/${name}: not valid JSON`);
  if (clips.size === 0) {
    lines.push(`voice clips: no manifest plays any yet; nothing to look up at ${site}`);
    return { code: unreadable.length > 0 ? 1 : 0, lines };
  }
  const found = await checkSources(clips, [fetcher === undefined ? new SiteClipSource(site) : new SiteClipSource(site, fetcher)]);
  for (const note of found.notes.slice(0, 10)) lines.push(`FAIL  ${note.at}: ${note.message}`);
  if (found.notes.length > 10) lines.push(`FAIL  …and ${String(found.notes.length - 10)} more that could not be checked`);
  for (const failure of found.failures) lines.push(`FAIL  ${failure.at}: ${failure.message}`);
  const unknown = clips.size - found.checked;
  const broken = found.failures.length + unreadable.length;
  lines.push(`voice clips: ${String(found.checked)} of ${String(clips.size)} looked up at ${site}, ${String(broken)} broken, ${String(unknown)} unanswered`);
  if (unknown > 0) lines.push("The deploy stops until every clip is confirmed: rerun it once the site answers.");
  return { code: broken > 0 || unknown > 0 ? 1 : 0, lines };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = process.argv[2];
  if (site === undefined || !/^https?:\/\//.test(site)) {
    console.error("usage: node tools/voice/verify-site.ts <https://site>");
    process.exit(2);
  }
  const { code, lines } = await verifySite(site, path.resolve(import.meta.dirname, "..", "..", "content", "voice", "manifest"));
  for (const line of lines) console.log(line);
  process.exit(code);
}
