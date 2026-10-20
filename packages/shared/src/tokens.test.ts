/**
 * Class tokens (#314): the names, the notches, the spare tokens in the pack,
 * and the one deed track a hero sees, against the shipped rules.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCharacter } from "./character.js";
import { CLASS_TOKENS, deedTrack, notchesFor, rankTitle } from "./tokens.js";
import type { ClassId, ItemCatalog, RulesContent } from "./types/domain.js";
import { makeCharacter } from "./test-fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const RULES = JSON.parse(readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;
const ITEMS: ItemCatalog = {};

describe("the tokens", () => {
  it("has the gear of the lore for every shipped class, never the words 'class token'", () => {
    expect(Object.keys(CLASS_TOKENS).sort()).toEqual(Object.keys(RULES.classes).sort());
    expect(CLASS_TOKENS).toEqual({
      thornguard: { name: "thorn bracer" },
      duskrunner: { name: "dusk hood" },
      starweaver: { name: "star circlet" },
      songkeeper: { name: "song bell" },
    });
  });

  it("cuts one notch per rank, and titles the rank the way the sheet does", () => {
    expect([undefined, "none", "apprentice", "expert", "master"].map((r) => notchesFor(r as never))).toEqual([0, 0, 1, 2, 3]);
    expect(rankTitle(RULES.classes.starweaver, "apprentice")).toBe("Starweaver Apprentice");
    expect(rankTitle(RULES.classes.thornguard, "none")).toBe("Thornguard");
  });
});

describe("spare tokens in the pack", () => {
  it("are absent for a hero who has only worn one class, so she resolves exactly as before", () => {
    expect(resolveCharacter(makeCharacter({ class: "thornguard", rank: "expert" }), RULES, ITEMS)).not.toHaveProperty("spares");
  });

  it("are every class she has worn and taken off, with its rank, in rules order", () => {
    const hero = makeCharacter({ class: "starweaver", rank: "apprentice" });
    hero.committed.mastery.songkeeper = { rank: "expert", deeds: { song_hearts: 3 } };
    hero.committed.mastery.thornguard = { rank: "none", deeds: {} };
    const resolved = resolveCharacter(hero, RULES, ITEMS);
    expect(resolved.class).toBe("starweaver");
    expect(resolved.spares).toEqual([
      { class: "thornguard", rank: "none" },
      { class: "songkeeper", rank: "expert" },
    ]);
  });
});

describe("the one deed track (docs/class-mastery.md §6, rule 6)", () => {
  const track = (klass: ClassId, rank: Parameters<typeof deedTrack>[1], deeds: Record<string, number>, party: number) =>
    deedTrack(RULES.classes[klass], rank, deeds, party);

  it("shows a one-track rank's deeds whatever the table", () => {
    expect(track("duskrunner", "none", { new_target: 2 }, 1)).toEqual({
      next: "apprentice",
      steps: [{ deed: "new_target", label: "Hit a monster you have not hit yet this fight", have: 2, need: 3 }],
    });
  });

  it("with nothing yet, shows a hero alone the alone track and a table the friends one", () => {
    expect(track("thornguard", "none", {}, 1)!.steps.map((s) => s.deed)).toEqual(["hold_ground"]);
    expect(track("thornguard", "none", {}, 3)!.steps.map((s) => s.deed)).toEqual(["brace_friend"]);
  });

  it("follows whichever track is further along, so the pips never go backward when a friend joins", () => {
    expect(track("thornguard", "none", { hold_ground: 1 }, 4)!.steps.map((s) => s.deed)).toEqual(["hold_ground"]);
    expect(track("starweaver", "apprentice", { glimmer_made: 4, burst_two: 2 }, 1)!.steps.map((s) => s.deed)).toEqual(["glimmer_made"]);
  });

  it("asks for every deed of a two-deed rank, story deed and all", () => {
    expect(track("thornguard", "expert", { bramble_wall_fight: 1 }, 2)!.steps).toEqual([
      { deed: "bramble_wall_fight", label: "Grow a Bramble Wall in a fight", have: 1, need: 3 },
      { deed: "class_story", label: "Do something only your class can", have: 0, need: 1 },
    ]);
  });

  it("is null at Master, with every notch cut", () => {
    expect(track("songkeeper", "master", {}, 1)).toBeNull();
  });
});
