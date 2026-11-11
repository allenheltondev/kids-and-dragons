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

interface ClueGame {
  clues: string[];
  options?: { id: string; label: string }[];
}

/** Every interaction in a chapter that is solved from written clues, archived ones included. */
function clueGames(chapter: Record<string, unknown>): ClueGame[] {
  return [...objects(chapter)].filter((object) => Array.isArray(object.clues)) as unknown as ClueGame[];
}

/** The ids of the scenes those games are in. */
function clueGameIds(chapter: Record<string, unknown>): string[] {
  const scenes = { ...(chapter.resumeInteractions as Record<string, { interaction?: { clues?: unknown } }> | undefined), ...(chapter.scenes as Record<string, { interaction?: { clues?: unknown } }>) };
  return Object.entries(scenes).filter(([, scene]) => Array.isArray(scene.interaction?.clues)).map(([id]) => id);
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
    // In a game solved from clues, an option's label is what the clues name, so it is play.
    const named = new Set<unknown>(clueGames(chapter).flatMap((game) => game.options ?? []));
    let rewritten = 0;
    for (const object of objects(chapter)) {
      for (const key of Object.keys(object)) {
        if (!PRESENTATION_KEYS.has(key) || (key === "label" && named.has(object))) continue;
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

  // The review on the change that introduced the pins: a sequence game is solved from its clues,
  // and `interactionClues` deals them to phones by their place in the list. With `clues` treated as
  // words, emptying the list, reordering it, or rewording a clue to contradict the answer left
  // the pin where it was.
  const withClues = chapters.filter((file) => clueGames(read(file)).length > 0);

  it("finds Gemfall's clue games, the ones the review named among them", () => {
    const games = chapters.flatMap((file) => clueGameIds(read(file)).map((id) => `${file.replace(/^chapters\/|\.json$/g, "")}/${id}`));
    expect(games).toEqual(expect.arrayContaining(["gemfall-07h/interaction_price_clues", "gemfall-03a/interaction_markers"]));
    expect(games.filter((game) => game.startsWith("gemfall-08/")).length).toBeGreaterThanOrEqual(2);
    expect(withClues.length).toBeGreaterThanOrEqual(10);
  });

  it.each(withClues)("%s: a clue game's clues cannot be removed, reordered or reworded without moving its pin", (file) => {
    const before = playDigest(JSON.stringify(read(file)));
    const edits: [string, (game: ClueGame) => void][] = [
      ["every clue removed", (game) => (game.clues = [])],
      ["one clue dropped", (game) => game.clues.pop()],
      ["the clues reordered", (game) => game.clues.reverse()],
      ["a clue reworded", (game) => (game.clues[0] = `${game.clues[0]} Or the other way round.`)],
      ["an option the clues name, renamed", (game) => (game.options![0]!.label = `${game.options![0]!.label} (renamed)`)],
    ];
    for (const [name, edit] of edits) {
      const chapter = read(file);
      const game = clueGames(chapter)[0]!;
      expect(game.clues.length, `${file}: its first clue game has clues`).toBeGreaterThan(1);
      edit(game);
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
