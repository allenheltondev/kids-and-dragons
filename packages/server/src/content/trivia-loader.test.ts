/**
 * The Field Guide quiz's content reaches the server (docs/trivia.md §6.2):
 * every group file as one bank, in TRIVIA_GROUPS order, and the ladder.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentDir } from "../paths.ts";
import { makeChapter, makeItems, makeMap, makeRules } from "../test-support.ts";
import { clearContentCache, loadContent } from "./loader.ts";

const dirs: string[] = [];
afterEach(async () => {
  clearContentCache();
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function root(trivia: Record<string, unknown> | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kad-trivia-"));
  dirs.push(dir);
  const write = async (rel: string, body: unknown) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), JSON.stringify(body), "utf8");
  };
  await write("rules.json", makeRules());
  await write("items.json", makeItems());
  await write("chapters/bramblewood-01.json", makeChapter());
  await write("maps/thicket.json", makeMap());
  if (trivia) for (const [name, body] of Object.entries(trivia)) await write(`trivia/${name}.json`, body);
  return dir;
}

const question = (id: string, entry: string) => ({ id, entry, ask: "?", answer: "a", wrong: ["b", "c", "d", "e", "f"], also: [], link: "entry" });

describe("the quiz's content", () => {
  it("is every group's questions as one bank, in group order, and the ladder", async () => {
    const content = await loadContent(
      await root({
        others: { questions: [question("npc.faun.x", "npc.faun")] },
        creatures: { questions: [question("creature.a.x", "creature.a")] },
        ladder: { rungs: [{ at: 10, badge: { id: "trivia-10", name: "N", blurb: "B" } }], firstTry: [] },
      }),
    );
    expect(content.triviaBank()?.map((q) => q.id)).toEqual(["creature.a.x", "npc.faun.x"]);
    expect(content.triviaLadder()).toEqual({ rungs: [{ at: 10, badge: { id: "trivia-10", name: "N", blurb: "B" } }], firstTry: [] });
  });

  it("is none with no trivia folder", async () => {
    const content = await loadContent(await root(null));
    expect(content.triviaBank()).toBeNull();
    expect(content.triviaLadder()).toBeNull();
  });

  it("ships with the decided ladder", async () => {
    const content = await loadContent(contentDir());
    expect(content.triviaBank()).not.toBeNull();
    expect(content.triviaLadder()?.rungs.map((r) => r.at)).toEqual([10, 25, 50, 120, 175, 220]);
    expect(content.triviaLadder()?.firstTry.map((r) => r.at)).toEqual([25, 100]);
  });
});
