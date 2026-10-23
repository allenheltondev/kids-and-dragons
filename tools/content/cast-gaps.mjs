#!/usr/bin/env node
/**
 * The cast report: `npm run content:cast [-- --json] [--chapter <prefix>]`.
 *
 * A scene whose words name someone the chapter casts elsewhere, but whose own
 * `cast` leaves them off. Cast is for who is physically there (content/README.md,
 * "Who is on stage"), so a name in a scene that is only a mention is fine;
 * this is a reading list for a person to settle each one, never a gate, like
 * `content:pacing`. It is how the Riftlight audit (#429) keeps from drifting.
 *
 * A name is a `cast` entry's `name` anywhere in the same chapter (nameplates
 * like "Noodle seller" count). A scene's words are its narration, prompt,
 * choice labels and narration variants. Each finding says whether the scene
 * still has a free slot: a full stage (MAX_CAST) means casting them needs
 * somebody else out, which is a call for the author.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The most a scene casts (schemas/chapter.schema.json `cast.maxItems`). */
export const MAX_CAST = 3;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name a chapter casts, in the order first met. */
export function castNames(chapter) {
  const names = new Set();
  for (const scene of Object.values(chapter.scenes ?? {})) {
    for (const member of scene.cast ?? []) if (member.name) names.add(member.name);
  }
  return [...names];
}

/** What the scene says aloud or shows to be read: where a name can turn up. */
export function sceneWords(scene) {
  return [
    scene.narration,
    scene.prompt,
    ...(scene.choices ?? []).map((choice) => choice.label),
    ...(scene.variants ?? []).map((variant) => variant.text),
  ]
    .filter((text) => typeof text === "string")
    .join("\n");
}

/** Scenes naming a cast member of the chapter that they do not cast. */
export function castGaps(chapter) {
  const names = castNames(chapter);
  const gaps = [];
  for (const [sceneId, scene] of Object.entries(chapter.scenes ?? {})) {
    if (["encounter", "combat"].includes(scene.type)) continue; // the board draws its own ground
    const here = new Set((scene.cast ?? []).map((member) => member.name));
    const words = sceneWords(scene);
    const missing = names.filter(
      (name) => !here.has(name) && new RegExp(`(?<![\\w'’])${escape(name)}(?![\\w])`, "i").test(words),
    );
    if (missing.length === 0) continue;
    gaps.push({ scene: sceneId, names: missing, cast: [...here], room: MAX_CAST - here.size });
  }
  return gaps;
}

export function loadChapters(dir = join(root, "content", "chapters")) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")));
}

export function main(argv = process.argv.slice(2), out = (line) => console.log(line)) {
  const json = argv.includes("--json");
  const at = argv.indexOf("--chapter");
  const prefix = at >= 0 ? argv[at + 1] : "";
  const report = loadChapters()
    .filter((chapter) => chapter.id.startsWith(prefix ?? ""))
    .map((chapter) => ({ chapter: chapter.id, gaps: castGaps(chapter) }))
    .filter((entry) => entry.gaps.length > 0);
  if (json) return out(JSON.stringify(report, null, 2));
  if (report.length === 0) return out("Every scene that names a cast member casts them.");
  for (const { chapter, gaps } of report) {
    out(`\n${chapter}  (${gaps.length} scene${gaps.length === 1 ? "" : "s"})`);
    for (const gap of gaps) {
      const room = gap.room > 0 ? `${gap.room} free` : "stage full";
      out(`  ${gap.scene}: names ${gap.names.join(", ")}  [${room}]`);
    }
  }
  out("\nA reading list, not a gate: cast who is there, not who is only mentioned.");
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
