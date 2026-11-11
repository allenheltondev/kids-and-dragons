#!/usr/bin/env node
/**
 * Re-takes Gemfall's play pins: `npm run content:pin`.
 *
 * Gemfall is pinned (CLAUDE.md, "Gemfall is pinned"): a change to how it plays has to be
 * deliberate. Each of its files has a pin in
 * `packages/server/src/fixtures/gemfall-play-pins.json`, a hash of the file with what is only
 * shown or said taken out (`packages/shared/src/play-shape.ts`). Rewording a line, adding a
 * painting or retuning a voice moves no pin. Changing a scene's exits, a check, an effect, a
 * gate or a fight does, and `gemfall-compat.test.ts` fails until this is run.
 *
 *   npm run content:pin              re-take the pins and say which files moved
 *   npm run content:pin -- --check   say which would move, write nothing, exit 1 if any
 *
 * Run it when you changed how Gemfall plays on purpose, and say why in the commit. If it
 * reports a file you did not mean to change, that is the pin doing its job.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson, playShape } from "../../packages/shared/src/play-shape.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PINS_FILE = "packages/server/src/fixtures/gemfall-play-pins.json";
const CAMPAIGN = "campaigns/gemfall.json";

export interface PlayPins {
  $comment: string;
  files: Record<string, string>;
}

/** The hash a file is pinned by: its play shape, in canonical JSON. */
export function playDigest(text: string): string {
  return createHash("sha256").update(canonicalJson(playShape(JSON.parse(text)))).digest("hex");
}

/** The campaign file and every chapter it lists, each with its digest as the content stands. */
export function takePins(root: string): Record<string, string> {
  const content = path.join(root, "content");
  const campaign = JSON.parse(fs.readFileSync(path.join(content, CAMPAIGN), "utf8")) as { chapters: string[] };
  const files = [CAMPAIGN, ...campaign.chapters.map((id) => `chapters/${id}.json`)].sort();
  return Object.fromEntries(files.map((file) => [file, playDigest(fs.readFileSync(path.join(content, file), "utf8"))]));
}

export function readPins(root: string): Record<string, string> {
  const file = path.join(root, PINS_FILE);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as PlayPins).files : {};
}

/** Files whose pin differs from the content, in either direction, with what happened to each. */
export function movedPins(pinned: Record<string, string>, now: Record<string, string>): { file: string; what: "changed" | "new" | "gone" }[] {
  const files = [...new Set([...Object.keys(pinned), ...Object.keys(now)])].sort();
  return files.flatMap((file) => {
    if (pinned[file] === now[file]) return [];
    return [{ file, what: pinned[file] === undefined ? ("new" as const) : now[file] === undefined ? ("gone" as const) : ("changed" as const) }];
  });
}

export function writePins(root: string, files: Record<string, string>): void {
  const pins: PlayPins = {
    $comment:
      "Gemfall's play pins: a hash of each file with what is only shown or said taken out (packages/shared/src/play-shape.ts). " +
      "Re-take with npm run content:pin after a deliberate change to how Gemfall plays, and say why in the commit. " +
      "One line per file, so two branches that change different chapters do not collide here.",
    files,
  };
  fs.writeFileSync(path.join(root, PINS_FILE), `${JSON.stringify(pins, null, 2)}\n`);
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  const now = takePins(REPO_ROOT);
  const moved = movedPins(readPins(REPO_ROOT), now);
  if (moved.length === 0) {
    console.log(`content:pin: all ${Object.keys(now).length} Gemfall pins match; nothing about how it plays has changed.`);
  } else {
    console.log(`content:pin: ${moved.length} of ${Object.keys(now).length} Gemfall file(s) ${check ? "would move" : "moved"}:`);
    for (const { file, what } of moved) console.log(`  ${what.padEnd(7)} content/${file}`);
    if (check) {
      console.log("  Nothing written. Run npm run content:pin if the change to how Gemfall plays is deliberate.");
      process.exitCode = 1;
    } else {
      writePins(REPO_ROOT, now);
      console.log(`  Wrote ${PINS_FILE}. Say why in the commit.`);
    }
  }
}
