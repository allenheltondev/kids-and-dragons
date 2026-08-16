#!/usr/bin/env node
/**
 * The chapter viewer — `npm run content:graph`.
 *
 * Roadmap chapter 6 asks for a "local chapter editor: visual scene graph,
 * branch inspection, dead-end and orphan-scene detection". Two thirds of that
 * already existed and one third of it was invisible:
 *
 *   - Detection ships inside `npm run content:validate` and has since chapter 0
 *     (`chapter-graph.ts` — DEAD_END, UNREACHABLE_SCENE, UNKNOWN_GOTO,
 *     MISSING_BRANCH, NO_ENDING, and the item checks). Its own header says the
 *     authoring tool would run the same function "to draw dead ends and orphans
 *     in its editor". There was no editor, so nothing ever did.
 *   - Layout is `chapter-map.ts`, pure and tested without a browser.
 *
 * This is the part that produces something you can look at: one self-contained
 * HTML file per chapter, written to `.graph/`, opened in a browser. Click a
 * scene to inspect it — narration, choices with their gates, effects, enemies.
 *
 * ---------------------------------------------------------------------------
 * WHY A GENERATED FILE AND NOT A ROUTE IN THE APP
 *
 * The obvious alternative is a `/editor` page in the client, and the reason
 * against it is the same reason the playtest drawer *is* in the client: they
 * are used at different moments. Playtesting happens with the game running, so
 * it has to be where the game is. Reading a chapter happens before the game is
 * running, usually beside the JSON file in an editor — and it should not need a
 * dev server, a room, or three characters to look at.
 *
 * Self-contained by the same rule the rest of the tooling follows: no CDN, no
 * fetch, no build step. Regenerate and refresh.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT
 *
 * It does not edit. The roadmap line says "editor" and this reads; the chapter
 * is still authored in a text editor beside it. That is a real gap and it is
 * named here rather than papered over — but the value in "editor" was never
 * the text box (JSON in an editor with a schema attached is already a good
 * writing surface), it was seeing the shape of what you wrote, which is what
 * this does.
 *
 * Exits zero regardless of what the chapter contains. `content:validate`
 * already fails a build over the same findings; this one is for looking.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chapterMap, validateChapter } from "@kad/shared";
import type { Chapter, ItemCatalog } from "@kad/shared";
import { page } from "./graph-page.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, ".graph");

const tty = process.stdout.isTTY;
const RED = tty ? "[31m" : "";
const GREEN = tty ? "[32m" : "";
const YELLOW = tty ? "[33m" : "";
const DIM = tty ? "[2m" : "";
const BOLD = tty ? "[1m" : "";
const OFF = tty ? "[0m" : "";

// --- Run --------------------------------------------------------------------

function readJson<T>(...segments: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...segments), "utf8")) as T;
}

const items = readJson<ItemCatalog>("content", "items.json");
const chapterDir = path.join(ROOT, "content", "chapters");
const files = fs
  .readdirSync(chapterDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

fs.mkdirSync(OUT, { recursive: true });

console.log(`${BOLD}Kids & Dragons — chapter graphs${OFF}`);

for (const file of files) {
  const chapter = readJson<Chapter>("content", "chapters", file);
  const map = chapterMap(chapter);
  const issues = validateChapter(chapter, items);
  const out = path.join(OUT, `${chapter.id}.html`);
  fs.writeFileSync(out, page(chapter, map, issues), "utf8");

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const verdict =
    errors > 0
      ? `${RED}${String(errors)} errors${OFF}`
      : warnings > 0
        ? `${YELLOW}${String(warnings)} warnings${OFF}`
        : `${GREEN}clean${OFF}`;

  console.log(
    `  ${chapter.id.padEnd(18)} ${DIM}${String(map.nodes.length)} scenes, ${String(map.edges.length)} edges, ` +
      `${String(map.depth)} deep${OFF}  ${verdict}`,
  );
  console.log(`  ${DIM}${path.relative(ROOT, out)}${OFF}`);
}

console.log(
  `\n${DIM}Open them in a browser. Nothing here fails a build — ${"`content:validate`"} already` +
    ` gates on the same findings.${OFF}`,
);
