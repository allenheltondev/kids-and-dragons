import { describe, expect, it } from "vitest";
import { choiceAhead } from "./choice-ahead.js";
import type { Chapter } from "./types/chapter.js";

const scenes = {
  s_roll: { type: "check", stat: "quick", tn: 10, prompt: "Jump", onSuccess: { goto: "s_end" }, onFailure: { goto: "s_end" } },
  s_team: { type: "check", stat: "might", tn: 10, prompt: "Heave", roller: "all", onSuccess: { goto: "s_end" }, onFailure: { goto: "s_end" } },
  s_game: { type: "interaction", narration: "Play.", interaction: {}, choices: [] },
  s_fight: { type: "encounter", narration: "Wisps!" },
  s_auto: { type: "encounter", narration: "Wisps!", autoResolve: "victory" },
  s_step: { type: "story", narration: "On you go.", choices: [{ id: "on", label: "Go on", icon: "forward", goto: "s_roll" }] },
  s_step2: { type: "story", narration: "And on.", choices: [{ id: "on", label: "Go on", icon: "forward", goto: "s_step" }] },
  s_step3: { type: "story", narration: "And on.", choices: [{ id: "on", label: "Go on", icon: "forward", goto: "s_step2" }] },
  s_fork: {
    type: "story",
    narration: "Which way?",
    choices: [
      { id: "a", label: "A", icon: "forward", goto: "s_roll" },
      { id: "b", label: "B", icon: "forward", goto: "s_game" },
    ],
  },
  s_loop: { type: "story", narration: "Round.", choices: [{ id: "on", label: "Go on", icon: "forward", goto: "s_loop" }] },
  s_end: { type: "story", narration: "The end.", choices: [] },
} as unknown as Chapter["scenes"];
const chapter = { scenes };
const to = (goto: string) => choiceAhead(chapter, { goto });

describe("choiceAhead", () => {
  it("names the roll, the game or the fight a choice goes straight to", () => {
    expect(to("s_roll")).toEqual({ kind: "roll", stat: "quick" });
    expect(to("s_team")).toEqual({ kind: "roll", stat: "might", party: true });
    expect(to("s_game")).toEqual({ kind: "game" });
    expect(to("s_fight")).toEqual({ kind: "fight" });
  });

  it("does not promise a fight that resolves itself", () => {
    expect(to("s_auto")).toBeNull();
  });

  it("looks through beats with one way on, but only so far", () => {
    expect(to("s_step")).toEqual({ kind: "roll", stat: "quick" });
    expect(to("s_step2")).toEqual({ kind: "roll", stat: "quick" });
    expect(to("s_step3")).toBeNull();
  });

  it("stops at another decision, an ending, a loop or a missing scene", () => {
    expect(to("s_fork")).toBeNull();
    expect(to("s_end")).toBeNull();
    expect(to("s_loop")).toBeNull();
    expect(to("s_nowhere")).toBeNull();
  });
});
