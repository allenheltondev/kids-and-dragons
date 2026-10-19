/** Stage the authored opening without publishing an unfinished campaign. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import concurrently from "concurrently";
import { fileURLToPath } from "node:url";
import type { Campaign, Chapter, ItemCatalog } from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const RIFTLIGHT_DRAFT = path.join(ROOT, "content/drafts/riftlight");

/** Caller owns the returned temporary directory. Shipped files are read only. */
export function stageRiftlightOpening(options: { unlockPreview?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kad-riftlight-opening-"));
  fs.cpSync(path.join(ROOT, "schemas"), path.join(root, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(root, "assets"));
  fs.copyFileSync(path.join(ROOT, "assets/manifest.json"), path.join(root, "assets/manifest.json"));
  const world = path.join(ROOT, "assets/world");
  const stagedWorld = path.join(root, "assets/world");
  try {
    fs.symlinkSync(world, stagedWorld, "junction");
  } catch (error) {
    // Restricted Windows sessions can deny junctions. A private copy keeps
    // the preview usable and remains owned by the temporary directory.
    if (!["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    fs.cpSync(world, stagedWorld, { recursive: true });
  }
  const content = path.join(root, "content");
  fs.cpSync(path.join(ROOT, "content"), content, {
    recursive: true,
    filter: (source) => path.relative(path.join(ROOT, "content"), source).split(path.sep)[0] !== "drafts",
  });
  const campaign = JSON.parse(fs.readFileSync(path.join(RIFTLIGHT_DRAFT, "opening-preview.campaign.json"), "utf8")) as Campaign;
  // Only the throwaway local preview skips Gemfall. The authored declaration
  // and tests retain the real prerequisite; production content is never edited.
  if (options.unlockPreview) delete campaign.requires;
  fs.writeFileSync(path.join(content, "campaigns", `${campaign.id}.json`), JSON.stringify(campaign, null, 2) + "\n");
  const items = JSON.parse(fs.readFileSync(path.join(content, "items.json"), "utf8")) as ItemCatalog;
  for (const id of campaign.chapters) {
    const file = `${id}.json`;
    const chapter = JSON.parse(fs.readFileSync(path.join(RIFTLIGHT_DRAFT, "chapters", file), "utf8")) as Chapter;
    fs.copyFileSync(path.join(RIFTLIGHT_DRAFT, "chapters", file), path.join(content, "chapters", file));
    for (const [prop, definition] of Object.entries(chapter.props ?? {})) {
      if (prop in items) throw new Error(`Draft prop collides with shipped item: ${prop}`);
      items[prop] = definition;
    }
  }
  fs.writeFileSync(path.join(content, "items.json"), JSON.stringify(items, null, 2) + "\n");
  return root;
}

/** The runner handles signals and settles only after its commands close. */
export async function runRiftlightPreview(root: string, run = concurrently): Promise<void> {
  // Refuse cleanup of an arbitrary directory, even if called with a bad path.
  const target = path.resolve(root);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("kad-riftlight-opening-")) {
    throw new Error(`Not a staged Riftlight preview: ${target}`);
  }
  try {
    // The API forwards Ctrl-C/SIGTERM to the command trees and waits for them;
    // a separate CLI child could leave its parent exiting before cleanup.
    const env = { KAD_CONTENT_DIR: path.join(root, "content"), KAD_DATA_DIR: path.join(root, "saves"),
      VITE_LAUNCH_CAMPAIGN: "riftlight-opening-preview" };
    await run([{ command: "npm run dev:server", env }, { command: "npm run dev:client", env }], {
      cwd: ROOT,
      killOthersOn: ["success", "failure"],
    }).result;
  } finally {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = stageRiftlightOpening({ unlockPreview: true });
  console.log("Riftlight route preview: seventeen story nodes; the northern path reaches the memory reading room.");
  console.log("Gemfall lock skipped for this preview. Saves are isolated from your normal games.");
  runRiftlightPreview(root).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
