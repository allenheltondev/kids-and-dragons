#!/usr/bin/env node
/**
 * Every clip the manifests play is on the site about to serve them —
 * `node tools/voice/verify-site.ts <site-url>`, run by `deploy.sh` before it
 * uploads `content/` (docs/voice-narration-plan.md §4, `voice:verify`).
 *
 * The manifests deploy with the content, and a browser fetches each clip they
 * name from `/voice/`. A clip the site lacks would be a 404 mid-sentence, so the
 * deploy stops here and the previous content keeps serving. No manifests, or
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = process.argv[2];
  if (site === undefined || !/^https?:\/\//.test(site)) {
    console.error("usage: node tools/voice/verify-site.ts <https://site>");
    process.exit(2);
  }
  const dir = path.resolve(import.meta.dirname, "..", "..", "content", "voice", "manifest");
  const { clips, unreadable } = clipsIn(dir);
  for (const name of unreadable) console.log(`FAIL  content/voice/manifest/${name}: not valid JSON`);
  if (clips.size === 0) {
    console.log(`voice clips: no manifest plays any yet; nothing to look up at ${site}`);
    process.exit(unreadable.length > 0 ? 1 : 0);
  }
  const found = await checkSources(clips, [new SiteClipSource(site)]);
  for (const note of found.notes.slice(0, 10)) console.log(`note  ${note.at}: ${note.message}`);
  if (found.notes.length > 10) console.log(`note  …and ${String(found.notes.length - 10)} more that could not be checked`);
  for (const failure of found.failures) console.log(`FAIL  ${failure.at}: ${failure.message}`);
  const broken = found.failures.length + unreadable.length;
  console.log(`voice clips: ${String(found.checked)} of ${String(clips.size)} looked up at ${site}, ${String(broken)} broken`);
  process.exit(broken > 0 ? 1 : 0);
}
