import { afterEach, describe, expect, it, vi } from "vitest";

import { setSpeaker, setUnspokenNames, speak } from "./speak.js";
import { NAME_BEARING_SURFACES, withoutNames } from "./spoken-names.js";

afterEach(() => {
  setSpeaker(null);
  setUnspokenNames([]);
});

describe("withoutNames (#552)", () => {
  const party = ["Ana", "Bo", "Cy"];

  it.each([
    ["Ana chose: Climb the wall.", "Hero chose: Climb the wall."],
    ["Ana's turn.", "Hero's turn."],
    ["It is Ana’s roll.", "It is hero's roll."],
    ["Bo hits the bog troll.", "Hero hits the bog troll."],
    ["The troll swings at Bo and misses.", "The troll swings at hero and misses."],
    ["Ana, Bo and Cy found it.", "Heroes found it."],
    ["Ana, Bo, and Cy found it.", "Heroes found it."],
    ["Ana and Bo's map.", "Heroes' map."],
    ["Ana, tap Roll.", "Hero, tap Roll."],
    ["Well done, Ana!", "Well done, hero!"],
    ["Ana wants to give Bo a Sunbloom Draught.", "Hero wants to give hero a Sunbloom Draught."],
    ["The path ends at a wall of thorns.", "The path ends at a wall of thorns."],
  ])("%s → %s", (shown, said) => {
    expect(withoutNames(shown, party)).toBe(said);
  });

  it("matches whole words only, and the longest name first", () => {
    expect(withoutNames("Anabel waves at Banana.", ["Ana", "Anabel"])).toBe("Hero waves at Banana.");
  });

  it("leaves a lowercase word alone for a capitalised name, but catches the name lowercased as typed", () => {
    expect(withoutNames("A rose grows by the gate. Rose waves.", ["Rose"])).toBe("A rose grows by the gate. Hero waves.");
    expect(withoutNames("zed waves. Zed grins.", ["zed"])).toBe("Hero waves. Hero grins.");
  });

  it("handles names with regex characters and letters outside ASCII", () => {
    expect(withoutNames("Zoë (the brave) waves. J.D. grins.", ["Zoë", "J.D."])).toBe("Hero (the brave) waves. Hero grins.");
  });

  it("is the text itself with no names", () => {
    expect(withoutNames("Ana waves.", [])).toBe("Ana waves.");
    expect(withoutNames("Ana waves.", ["  "])).toBe("Ana waves.");
  });

  it("rewords every example it lists, so the list says what is really heard", () => {
    for (const { shows } of NAME_BEARING_SURFACES) {
      expect(withoutNames(shows, ["Ana", "Bo"])).not.toMatch(/\b(Ana|Bo)\b/);
    }
  });
});

describe("speak() never says a party name (#552)", () => {
  it("rewords the line before any speaker hears it", () => {
    const heard = vi.fn();
    setSpeaker(heard);
    setUnspokenNames(["Zephyrine Quillfeather"]);
    speak("Zephyrine Quillfeather chose: Open the door.", { source: "narration" });
    expect(heard).toHaveBeenCalledWith("Hero chose: Open the door.", { source: "narration" });
    expect(JSON.stringify(heard.mock.calls)).not.toContain("Zephyrine");
  });

  it("forgets names the client replaces", () => {
    const heard = vi.fn();
    setSpeaker(heard);
    setUnspokenNames(["Zephyrine"]);
    setUnspokenNames(["Bo"]);
    speak("Zephyrine waves at Bo.");
    expect(heard).toHaveBeenCalledWith("Zephyrine waves at hero.", undefined);
  });
});
