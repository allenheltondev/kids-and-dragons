/** Stage the authored opening without publishing an unfinished campaign. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
  fs.symlinkSync(path.join(ROOT, "assets/world"), path.join(root, "assets/world"), "junction");
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = stageRiftlightOpening({ unlockPreview: true });
  console.log("Riftlight opening preview: three authored nodes; stops before the regional fork.");
  console.log("Gemfall lock skipped for this preview. Saves are isolated from your normal games.");
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/concurrently/dist/bin/index.js"),
    "--kill-others", "npm run dev:server", "npm run dev:client"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, KAD_CONTENT_DIR: path.join(root, "content"), KAD_DATA_DIR: path.join(root, "saves"),
      VITE_LAUNCH_CAMPAIGN: "riftlight-opening-preview" },
  });
  // Keep the temporary files while the dev processes are using them. A new
  // invocation gets a new content tree and new saves; no normal save is touched.
  child.on("error", (error) => { console.error(error); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
