/**
 * Play Riftlight locally without finishing Gemfall first: the shipped content,
 * staged into a temporary root with saves of its own, so the real campaign and
 * your normal games are untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import concurrently from "concurrently";
import { fileURLToPath } from "node:url";
import type { Campaign } from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "../..");
/** Riftlight's design notes, and the continuity contract its tests read. */
export const RIFTLIGHT_DESIGN = path.join(ROOT, "docs/campaigns/continental-rift");
export const RIFTLIGHT_CAMPAIGN = "riftlight";

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
  fs.cpSync(path.join(ROOT, "content"), content, { recursive: true });
  // Only the throwaway local preview skips Gemfall. The shipped campaign keeps
  // its prerequisite.
  if (options.unlockPreview) {
    const file = path.join(content, "campaigns", `${RIFTLIGHT_CAMPAIGN}.json`);
    const campaign = JSON.parse(fs.readFileSync(file, "utf8")) as Campaign;
    delete campaign.requires;
    fs.writeFileSync(file, JSON.stringify(campaign, null, 2) + "\n");
  }
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
      VITE_LAUNCH_CAMPAIGN: RIFTLIGHT_CAMPAIGN };
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
  console.log("Riftlight preview: all 24 story nodes and three glacier endings.");
  console.log("Gemfall lock skipped for this preview. Saves are isolated from your normal games.");
  runRiftlightPreview(root).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
