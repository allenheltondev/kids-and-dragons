#!/usr/bin/env node
/** Advisory mention sweep, not a presence detector. See content/README.md. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const words = (s) => s.replace(/[_-]/g, " ").toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names from the manifest plus chapter-local nameplates (including generic stand-ins).
 * Ambiguous names retain all figures: an existing matching figure satisfies a mention.
 * Single-word names aren't guessed from full names; that would conflate people.
 */
export function castVocabulary(manifest, chapter) {
  const names = new Map();
  function add(name, figure) {
    const alias = words(name).replace(/^the /, "");
    if (!alias) return;
    if (!names.has(alias)) names.set(alias, new Set());
    names.get(alias).add(figure);
  }
  for (const entry of manifest.castFigures ?? []) add(entry.name, `cast/${entry.id}`);
  for (const entry of [...(manifest.entities ?? []), ...(manifest.stageFigures ?? [])]) {
    add(entry.name ?? entry.id, `entities/${entry.id}`);
  }
  for (const scene of Object.values(chapter.scenes)) {
    for (const member of scene.cast ?? []) if (member.name) add(member.name, member.figure);
  }
  return [...names].map(([name, figures]) => ({ name, figures: [...figures].sort() }));
}

function prose(scene) {
  const fields = [];
  const add = (at, text) => { if (text) fields.push({ at, text }); };
  add("narration", scene.narration);
  add("prompt", scene.prompt);
  for (const [i, variant] of (scene.variants ?? []).entries()) add(`variants[${i}].text`, variant.text);
  for (const [i, choice] of (scene.choices ?? []).entries()) add(`choices[${i}].label`, choice.label);
  for (const key of ["onSuccess", "onFailure", "onVictory", "onDefeat"]) add(`${key}.narration`, scene[key]?.narration);
  return fields;
}

export function reportCast(chapter, manifest) {
  const vocabulary = castVocabulary(manifest, chapter);
  const findings = [];
  for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
    // Encounters draw their enemies on the board and cannot take a story cast.
    if (scene.type === "encounter") continue;
    const cast = scene.cast ?? [];
    for (const { at, text } of prose(scene)) {
      const normalized = words(text);
      const matches = vocabulary.flatMap((entry) => {
        const pattern = new RegExp(`(?<![a-z0-9])${escape(entry.name)}(?![a-z0-9])`, "g");
        return [...normalized.matchAll(pattern)].map((match) => ({ ...entry, start: match.index, end: match.index + match[0].length }));
      });
      for (const match of matches) {
        // "Oldest Archivist" must not also demand the generic "Archivist".
        if (matches.some((other) => other.start <= match.start && other.end >= match.end && other.name.length > match.name.length)) continue;
        if (cast.some((member) => match.figures.includes(member.figure))) continue;
        if (findings.some((f) => f.scene === sceneId && f.at === at && f.name === match.name)) continue;
        findings.push({ chapter: chapter.id, scene: sceneId, at, name: match.name, figures: match.figures, castCount: cast.length, atCap: cast.length >= 3, text });
      }
    }
  }
  return findings;
}

export function main(args) {
  const allowed = new Set(["--json", "--chapter"]);
  let prefix = "";
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`);
    if (args[i] === "--chapter") {
      prefix = args[++i];
      if (!prefix || prefix.startsWith("--")) throw new Error("--chapter requires a chapter ID prefix");
    }
  }
  const read = (file) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
  const manifest = read("assets/manifest.json");
  const files = readdirSync(path.join(ROOT, "content/chapters")).filter((f) => f.endsWith(".json") && f.startsWith(prefix)).sort();
  if (!files.length) throw new Error(`No chapters match: ${prefix}`);
  const findings = files.flatMap((f) => reportCast(read(`content/chapters/${f}`), manifest));
  if (args.includes("--json")) console.log(JSON.stringify({ chapters: files.length, findings }, null, 2));
  else {
    console.log("Cast mention candidates: review physical presence before adding cast. Mentions, variants and cap limits need human judgment.");
    for (const f of findings) console.log(`${f.chapter}/${f.scene} ${f.at}: ${f.name} -> ${f.figures.join(" | ")}${f.atCap ? " [3-slot cap]" : ""}`);
    console.log(`${files.length} chapters; ${findings.length} candidates. Advisory only.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
