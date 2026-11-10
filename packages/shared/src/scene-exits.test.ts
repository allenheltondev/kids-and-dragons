import { describe, expect, it } from "vitest";

import { sceneEdges } from "./chapter-graph.js";
import { isEndingScene, sceneExits, SCENE_BRANCH_KEYS } from "./scene-exits.js";
import type { Scene } from "./types/chapter.js";

/** Authored JSON, so the cases are written as JSON and not held to the union. */
const scene = (json: Record<string, unknown>): Scene => json as unknown as Scene;

const summary = (s: Scene): [via: string, to: string, at: string][] => sceneExits(s).map((exit) => [exit.via, exit.to, exit.at]);

describe("sceneExits", () => {
  it("lists a story, choice-point or rest scene's choices, in order, with their pointers", () => {
    for (const type of ["story", "choice_point", "rest"]) {
      const s = scene({
        type,
        narration: "A fork in the path.",
        choices: [
          { id: "left", label: "Left", icon: "arrow", goto: "glade", effects: [{ type: "setFlag", flag: "went_left" }] },
          { id: "right", label: "Right", icon: "arrow", goto: "brook" },
        ],
      });
      expect(summary(s)).toEqual([
        ["choice", "glade", "/choices/0"],
        ["choice", "brook", "/choices/1"],
      ]);
      const [left, right] = sceneExits(s);
      expect(left).toMatchObject({ via: "choice", index: 0, choice: { id: "left" }, effects: [{ type: "setFlag", flag: "went_left" }] });
      expect(right?.effects).toEqual([]);
    }
  });

  it("lists the branches a check, an interaction and an encounter have, and only the ones present", () => {
    const branch = (goto: string) => ({ goto });
    expect(summary(scene({ type: "check", onSuccess: branch("won"), onFailure: branch("lost") }))).toEqual([
      ["onSuccess", "won", "/onSuccess"],
      ["onFailure", "lost", "/onFailure"],
    ]);
    expect(summary(scene({ type: "interaction", onSuccess: branch("won"), onFailure: branch("lost") }))).toEqual([
      ["onSuccess", "won", "/onSuccess"],
      ["onFailure", "lost", "/onFailure"],
    ]);
    expect(summary(scene({ type: "interaction", onSuccess: branch("won"), onFailure: branch("lost"), onAssisted: branch("helped") })).map(([via]) => via)).toEqual([
      "onSuccess",
      "onFailure",
      "onAssisted",
    ]);
    expect(summary(scene({ type: "encounter", onVictory: branch("won"), onDefeat: branch("lost") })).map(([via]) => via)).toEqual(["onVictory", "onDefeat"]);
    // An environmental fight's other endings (#201) are exits like the first two.
    expect(summary(scene({ type: "encounter", onVictory: branch("won"), onDefeat: branch("lost"), onEscape: branch("fled"), onTimeout: branch("late") }))).toEqual([
      ["onVictory", "won", "/onVictory"],
      ["onDefeat", "lost", "/onDefeat"],
      ["onEscape", "fled", "/onEscape"],
      ["onTimeout", "late", "/onTimeout"],
    ]);
  });

  it("carries a branch's effects, and the branch itself for its narration", () => {
    const [won] = sceneExits(scene({ type: "check", onSuccess: { goto: "won", narration: "It gives.", effects: [{ type: "grantCoins", amount: 2 }] }, onFailure: { goto: "lost" } }));
    expect(won).toMatchObject({ via: "onSuccess", effects: [{ type: "grantCoins", amount: 2 }], branch: { narration: "It gives." } });
  });

  it("reads a scene by its type: a key its type does not have is not an exit", () => {
    // The schema refuses both; a walker must still agree with the engine about them.
    expect(summary(scene({ type: "story", choices: [], onSuccess: { goto: "elsewhere" } }))).toEqual([]);
    expect(summary(scene({ type: "check", onSuccess: { goto: "a" }, onFailure: { goto: "b" }, choices: [{ id: "c", goto: "c" }], onVictory: { goto: "d" } })).map(([, to]) => to)).toEqual(["a", "b"]);
  });

  it("lists a branch whose goto is missing, so a graph check can say so", () => {
    expect(sceneExits(scene({ type: "check", onSuccess: {}, onFailure: { goto: "lost" } })).map((exit) => exit.to)).toEqual([undefined, "lost"]);
  });

  it("gives a scene of an unknown type, or with no choices at all, no exits and does not throw", () => {
    expect(sceneExits(scene({ type: "cutscene", choices: [{ id: "on", goto: "next" }] }))).toEqual([]);
    expect(sceneExits(scene({ type: "story" }))).toEqual([]);
    expect(sceneExits(scene({}))).toEqual([]);
  });

  it("names every branch key some type has, once", () => {
    expect([...SCENE_BRANCH_KEYS].sort()).toEqual(["onAssisted", "onDefeat", "onEscape", "onFailure", "onSuccess", "onTimeout", "onVictory"]);
  });
});

describe("isEndingScene", () => {
  it("is a scene that leads nowhere", () => {
    expect(isEndingScene(scene({ type: "rest", choices: [] }))).toBe(true);
    expect(isEndingScene(scene({ type: "rest", choices: [{ id: "on", goto: "next" }] }))).toBe(false);
    expect(isEndingScene(scene({ type: "check", onSuccess: { goto: "a" }, onFailure: { goto: "b" } }))).toBe(false);
  });
});

describe("sceneEdges", () => {
  it("is the same exits, labeled for a message", () => {
    expect(sceneEdges(scene({ type: "story", choices: [{ id: "left", goto: "glade" }] }))).toEqual([{ to: "glade", via: 'choice "left"' }]);
    expect(sceneEdges(scene({ type: "encounter", onVictory: { goto: "won" }, onDefeat: { goto: "lost" }, onTimeout: { goto: "late" } }))).toEqual([
      { to: "won", via: "onVictory" },
      { to: "lost", via: "onDefeat" },
      { to: "late", via: "onTimeout" },
    ]);
  });
});
