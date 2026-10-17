import { describe, expect, it } from "vitest";
import { fightEndingIcon, fightEndingLine } from "./fight-ending-copy";

describe("how a fight that fought back ended (#220)", () => {
  const none = { freed: [], lost: [], done: [] };
  it("names the ending, then who was freed or lost and what got done", () => {
    expect(fightEndingLine({ ...none, outcome: "escaped", freed: ["Pip"] })).toBe("You got out through the rift. You freed Pip.");
    expect(fightEndingLine({ ...none, outcome: "timedOut", lost: ["Pip", "Moss"] })).toBe(
      "The rift closed and threw you out. Pip and Moss were lost to the rift.",
    );
    expect(fightEndingLine({ ...none, outcome: "victory", byObjective: "Close the tear", done: ["Close the tear", "Hold the stones"] })).toBe(
      "You won by finishing: Close the tear. Done: Hold the stones.",
    );
    expect(fightEndingLine({ ...none, outcome: "defeat" })).toBe("The fight went the monsters' way, and the story carried on.");
  });
  it("gives each ending its own shape", () => {
    const icons = (["victory", "defeat", "escaped", "timedOut"] as const).map((outcome) => fightEndingIcon({ ...none, outcome }));
    expect(new Set(icons).size).toBe(4);
  });
});
