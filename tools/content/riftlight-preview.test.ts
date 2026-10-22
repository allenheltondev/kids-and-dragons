import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runRiftlightPreview } from "./riftlight-preview.ts";

const roots: string[] = [];
function previewRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kad-riftlight-opening-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "saves"));
  fs.writeFileSync(path.join(root, "saves", "table.json"), "{}");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("keeps content and saves until the runner closes, then removes them", async () => {
  const root = previewRoot();
  let close!: () => void;
  const result = new Promise<void>((resolve) => { close = resolve; });
  const run = vi.fn().mockReturnValue({ result });
  const running = runRiftlightPreview(root, run);
  expect(run.mock.calls[0]![0]).toEqual([
    { command: "npm run dev:server", env: expect.objectContaining({ KAD_CONTENT_DIR: path.join(root, "content"), KAD_DATA_DIR: path.join(root, "saves") }) },
    { command: "npm run dev:client", env: expect.objectContaining({ VITE_LAUNCH_CAMPAIGN: "riftlight" }) },
  ]);
  expect(fs.existsSync(path.join(root, "saves/table.json"))).toBe(true);
  close();
  await running;
  expect(fs.existsSync(root)).toBe(false);
});

it("cleans up when launching throws or a failed command closes", async () => {
  for (const synchronous of [true, false]) {
    const root = previewRoot();
    const failure = new Error("spawn failed");
    const run = vi.fn().mockImplementation(() => {
      if (synchronous) throw failure;
      return { result: Promise.reject(failure) };
    });
    await expect(runRiftlightPreview(root, run)).rejects.toBe(failure);
    expect(fs.existsSync(root)).toBe(false);
  }
});

it("refuses to delete a directory outside the preview staging namespace", async () => {
  await expect(runRiftlightPreview(path.resolve(import.meta.dirname))).rejects.toThrow("Not a staged Riftlight preview");
});

it("Ctrl-C stops real command processes before deleting the staged saves", { timeout: 20_000 }, async () => {
  const root = previewRoot();
  const child = fork(path.join(import.meta.dirname, "fixtures/riftlight-preview-signal.mjs"), [root], {
    execArgv: ["--import", "tsx"], silent: true,
  });
  let output = "";
  child.stdout!.on("data", (chunk) => { output += String(chunk); });
  child.stderr!.on("data", (chunk) => { output += String(chunk); });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 10_000);
      child.once("message", () => { clearTimeout(timer); resolve(); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Preview exited early: ${output}`)); });
    });
    expect(fs.existsSync(root)).toBe(true);
    child.send("interrupt");
    expect(await closed, output).toBe(0);
    expect(fs.existsSync(root)).toBe(false);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
