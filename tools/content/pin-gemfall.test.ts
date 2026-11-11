/**
 * Gemfall's play pins against the real chapters (tools/content/pin-gemfall.ts): the pins on
 * disk are the content's, every chapter can be reworded without moving its pin, and none can
 * have a check, an exit or an effect changed without moving it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESENTATION_KEYS } from "../../packages/shared/src/play-shape";
import { movedPins, PINS_FILE, playDigest, readPins, takePins, writePins } from "./pin-gemfall";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const chapters = Object.keys(takePins(ROOT)).filter((file) => file.startsWith("chapters/"));
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "content", file), "utf8")) as Record<string, unknown>;

/** Every object in a file, depth first. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* objects(item);
  else if (typeof value === "object" && value !== null) {
    yield value as Record<string, unknown>;
    for (const child of Object.values(value)) yield* objects(child);
  }
}

describe("Gemfall's play pins", () => {
  it("are the pins of the content as it stands: the campaign file and its sixteen chapters", () => {
    const now = takePins(ROOT);
    expect(Object.keys(now)).toHaveLength(17);
    expect(movedPins(readPins(ROOT), now)).toEqual([]);
  });

  it.each(chapters)("%s: every word, picture and voice can change without moving its pin", (file) => {
    const chapter = read(file);
    const before = playDigest(JSON.stringify(chapter));
    let rewritten = 0;
    for (const object of objects(chapter)) {
      for (const key of Object.keys(object)) {
        if (!PRESENTATION_KEYS.has(key)) continue;
        object[key] = typeof object[key] === "string" ? `${object[key]} (reworded)` : null;
        rewritten++;
      }
    }
    expect(rewritten).toBeGreaterThan(20);
    expect(playDigest(JSON.stringify(chapter))).toBe(before);
  });

  it.each(chapters)("%s: no check, exit or effect can change without moving its pin", (file) => {
    const before = playDigest(JSON.stringify(read(file)));
    const edits: [string, (o: Record<string, unknown>) => boolean][] = [
      ["a check's difficulty", (o) => typeof o.tn === "number" && ((o.tn = (o.tn as number) + 1), true)],
      ["where something leads", (o) => typeof o.goto === "string" && ((o.goto = `${o.goto as string}_elsewhere`), true)],
      ["an effect's amount", (o) => typeof o.type === "string" && typeof o.amount === "number" && ((o.amount = (o.amount as number) + 1), true)],
      ["a flag an effect sets", (o) => o.type === "setFlag" && ((o.flag = `${String(o.flag)}_other`), true)],
    ];
    for (const [name, edit] of edits) {
      const chapter = read(file);
      let done = false;
      for (const object of objects(chapter)) {
        if (edit(object)) {
          done = true;
          break;
        }
      }
      // Every Gemfall chapter has exits and effects; a chapter with no check has nothing to edit there.
      if (!done) {
        expect(name, `${file} has no ${name} to edit`).toBe("a check's difficulty");
        continue;
      }
      expect(playDigest(JSON.stringify(chapter)), `${file}: ${name}`).not.toBe(before);
    }
  });

  it("no effect anywhere in the game's content carries a field the pin would drop", () => {
    const dir = path.join(ROOT, "content", "chapters");
    const found: string[] = [];
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const chapter = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const object of objects(chapter)) {
        for (const list of [object.effects, object.onEnter]) {
          if (!Array.isArray(list)) continue;
          for (const effect of list as Record<string, unknown>[]) {
            for (const key of Object.keys(effect)) if (PRESENTATION_KEYS.has(key)) found.push(`${name}: effect ${String(effect.type)} has "${key}"`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe("content:pin, run as a command", () => {
  const cli = path.join(ROOT, "tools", "content", "pin-gemfall.ts");

  it("says nothing moved, and writes nothing, on the content as committed", () => {
    const before = fs.readFileSync(path.join(ROOT, PINS_FILE), "utf8");
    const result = spawnSync(process.execPath, [cli, "--check"], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/all 17 Gemfall pins match/);
    expect(fs.readFileSync(path.join(ROOT, PINS_FILE), "utf8")).toBe(before);
  }, 60_000);

  it("names a changed, a new and a removed file", () => {
    const now = { "chapters/a.json": "1", "chapters/b.json": "2", "chapters/c.json": "3" };
    const pinned = { "chapters/a.json": "1", "chapters/b.json": "x", "chapters/d.json": "4" };
    expect(movedPins(pinned, now)).toEqual([
      { file: "chapters/b.json", what: "changed" },
      { file: "chapters/c.json", what: "new" },
      { file: "chapters/d.json", what: "gone" },
    ]);
  });

  it("writes one line per file, so branches changing different chapters do not collide", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kad-pins-"));
    fs.mkdirSync(path.join(tmp, path.dirname(PINS_FILE)), { recursive: true });
    writePins(tmp, { "chapters/a.json": "1", "chapters/b.json": "2" });
    const lines = fs.readFileSync(path.join(tmp, PINS_FILE), "utf8").split("\n");
    expect(lines.filter((line) => line.includes("chapters/"))).toHaveLength(2);
    expect(readPins(tmp)).toEqual({ "chapters/a.json": "1", "chapters/b.json": "2" });
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
