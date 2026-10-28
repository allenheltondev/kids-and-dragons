#!/usr/bin/env node
/**
 * Jump to any scene of any chapter — `npm run play:jump`.
 *
 *   npm run play:jump -- --list                              every campaign's chapters
 *   npm run play:jump -- --list riftlight-stuttering-flats   that chapter's scenes, by kind
 *   npm run play:jump -- riftlight-stuttering-flats sling    a TV and two phones at "sling",
 *                                                            one composite PNG of all three
 *   npm run play:jump -- riftlight-stuttering-flats sling --players 4 --flag flats_rhythm_read
 *   npm run play:jump -- gemfall-03a --record 4000           every frame for 4s, then stop
 *   npm run play:jump -- riftlight-finale --open             visible browsers, kept open (Ctrl-C)
 *
 * Options:
 *   --players N        1 to 4 phones (default 2)
 *   --travel           a Travel Mode table (no TV)
 *   --flag NAME        a route flag the chapter starts holding; NAME=false to hold it false
 *   --fact NAME=VALUE  a graph campaign's world fact (numbers and true/false are parsed)
 *   --start            also tap "We're ready" for a story interaction, and shoot it running
 *   --record MS        capture composites for MS milliseconds (after --start, if given)
 *   --every MS         time between recorded frames (default 250)
 *   --reduced-motion   every device asks for reduced motion
 *   --out DIR          where the PNGs go (default test-results/playtest)
 *   --open             show the browsers and keep the table open until Ctrl-C
 *
 * It starts the dev server itself when nothing answers at localhost:5173, and stops it after.
 * The table is a throwaway household; nothing it does reaches anyone's saved journey. See
 * tools/playtest/table.ts for the library the scripts under it use.
 */
import fs from "node:fs";
import path from "node:path";
import { openTable } from "./table.ts";
import { near, parse } from "./args.ts";
import type { Chapter } from "../../packages/shared/src/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONTENT = process.env.KAD_CONTENT_DIR ?? path.join(ROOT, "content");

function printHelp(): void {
  const source = fs.readFileSync(import.meta.filename, "utf8");
  console.log(source.slice(source.indexOf("/**") + 3, source.indexOf("*/")).replace(/^ \* ?/gm, "").trim());
}

function chapters(): Map<string, Chapter> {
  const dir = path.join(CONTENT, "chapters");
  return new Map(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    const chapter = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Chapter;
    return [chapter.id, chapter];
  }));
}

function sceneKind(scene: Chapter["scenes"][string]): string {
  const s = scene as { type: string; interaction?: { kind: string }; choices?: unknown[] };
  if (s.type === "interaction") return `interaction:${s.interaction?.kind ?? "?"}`;
  if (s.type === "story" && Array.isArray(s.choices) && s.choices.length === 0) return "ending";
  return s.type;
}

function list(id: string | undefined, all: Map<string, Chapter>): void {
  if (!id) {
    const byCampaign = new Map<string, Chapter[]>();
    for (const chapter of all.values()) byCampaign.set(chapter.campaignId, [...(byCampaign.get(chapter.campaignId) ?? []), chapter]);
    for (const [campaign, list] of [...byCampaign].sort()) {
      console.log(`\n${campaign}`);
      for (const chapter of list.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))) {
        const games = Object.values(chapter.scenes).filter((scene) => scene.type === "interaction").length;
        console.log(`  ${chapter.id.padEnd(36)} ${chapter.title}${games ? `  (${games} games)` : ""}`);
      }
    }
    return;
  }
  const chapter = all.get(id);
  if (!chapter) throw new Error(`no chapter "${id}". Did you mean: ${near(id, [...all.keys()]).join(", ")}?`);
  console.log(`${chapter.id} — ${chapter.title} (entry: ${chapter.entry})`);
  for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
    const cue = (scene as { interaction?: { cue?: string } }).interaction?.cue;
    console.log(`  ${sceneId.padEnd(30)} ${sceneKind(scene).padEnd(24)}${cue ? ` ${cue}` : ""}`);
  }
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  const all = chapters();
  if (args.list) return list(args.positional[0], all);
  const [chapterId, sceneId] = args.positional;
  if (!chapterId) { printHelp(); process.exit(1); }
  const chapter = all.get(chapterId);
  if (!chapter) throw new Error(`no chapter "${chapterId}". Did you mean: ${near(chapterId, [...all.keys()]).join(", ")}?`);
  if (sceneId && !chapter.scenes[sceneId]) {
    throw new Error(`no scene "${sceneId}" in ${chapterId}. Did you mean: ${near(sceneId, Object.keys(chapter.scenes)).join(", ")}? (--list ${chapterId} shows them all)`);
  }

  const table = await openTable({
    chapterId, ...(sceneId ? { sceneId } : {}),
    players: args.players, mode: args.travel ? "travel" : "party",
    ...(Object.keys(args.flags).length ? { flags: args.flags } : {}),
    ...(Object.keys(args.facts).length ? { facts: args.facts } : {}),
    headed: args.open, reducedMotion: args.reducedMotion,
    log: (line) => console.log(line),
  });
  const stop = async () => { await table.close(); process.exit(0); };
  process.on("SIGINT", () => void stop());
  try {
    await table.settle();
    const at = sceneId ?? chapter.entry;
    const kind = sceneKind(chapter.scenes[at]!);
    console.log(`scene ${at} (${kind})`);
    console.log(`  ${await table.snap(`${chapterId} ${at} ready`, args.out)}`);
    if (args.start) {
      const state = await table.state();
      if (state.prompt?.kind !== "interaction") console.log("  --start: this scene is not a story interaction; nothing to start");
      else {
        const lead = await table.lead();
        await lead.getByRole("button", { name: "We’re ready" }).click();
        await table.tv.waitForTimeout(900);
        console.log(`  ${await table.snap(`${chapterId} ${at} started`, args.out)}`);
      }
    }
    if (args.record > 0) {
      const frames = await table.record(`${chapterId} ${at}`, () => table.tv.waitForTimeout(args.record), { ...(args.out ? { dir: args.out } : {}), everyMs: args.every });
      console.log(`  ${frames.length} frames: ${path.dirname(frames[0] ?? "")}/${path.basename(frames[0] ?? "").replace(/-\d+\.png$/, "-NNN.png")}`);
    }
    if (args.open) {
      console.log(`\nroom ${table.code} is open in the browsers. Ctrl-C closes it.`);
      await new Promise(() => undefined);
    }
  } finally {
    if (!args.open) await table.close();
  }
}

// `--list | head` closes the pipe early; that is the reader being done, not a failure.
process.stdout.on("error", (error: NodeJS.ErrnoException) => { if (error.code === "EPIPE") process.exit(0); throw error; });

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
