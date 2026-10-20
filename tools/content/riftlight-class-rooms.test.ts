/**
 * Riftlight's four class rooms (#315, docs/class-mastery.md §2), walked
 * through the real engine by the continuity walker: every choice and both
 * dice extremes, with the heroes keeping their class at each room, and again
 * with them switching. The server's own switch is in
 * packages/server/src/handlers/riftlight-class-rooms.test.ts.
 */
import { describe, expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import type { ClassId, RunState } from "@kad/shared";
import { answerClassPlace, allPaths, chapters, context, send, start } from "./riftlight-test-support.ts";

const ROOMS = [
  { chapter: "riftlight-exchange-rift", rest: "quay_rest", door: "roof", room: "rookery", back: "down", lesson: "rookery_lesson", class: "duskrunner", met: "met_the_crows", teacher: "crows" },
  { chapter: "riftlight-glacier-survival", rest: "hall", door: "glass_door", room: "conservatory", back: "back", lesson: "conservatory_sing", class: "songkeeper", met: "met_aunt_bellow", teacher: "Aunt Bellow" },
  { chapter: "riftlight-riftseekers-departure", rest: "camp", door: "hut", room: "dojo", back: "back", lesson: "dojo_pillows", class: "thornguard", met: "met_master_dunnick", teacher: "Master Dunnick" },
  { chapter: "riftlight-saltrot-arrival", rest: "flats_rest", door: "stilts", room: "academy", back: "back", lesson: "academy_stars", class: "starweaver", met: "met_professor_nettle", teacher: "Professor Nettle" },
] as const;

/** A class that is not the room's, so the walker's hero has something to decide. */
const other = (cls: ClassId): ClassId => (cls === "duskrunner" ? "thornguard" : "duskrunner");

describe("Riftlight's class rooms", () => {
  it.each(ROOMS)("$room is a side room off $rest, and every way out of it leads back there", (r) => {
    const chapter = chapters.get(r.chapter)!;
    const scenes = chapter.scenes;
    const room = scenes[r.room]!;
    expect(room.type === "story" && room.classPlace).toBe(r.class);
    expect(scenes[r.rest]!.type).toBe("rest");
    // The only way in is the rest's door.
    const choicesOf = (id: string) => (scenes[id] as { choices?: { id: string; goto: string }[] }).choices ?? [];
    const into = Object.keys(scenes).filter((id) => choicesOf(id).some((c) => c.goto === r.room));
    expect(into).toEqual([r.rest]);
    const door = choicesOf(r.rest).find((c) => c.id === r.door);
    expect(door).toMatchObject({ goto: r.room });
    expect(door).not.toHaveProperty("when");
    expect(Object.keys(door!).filter((k) => k.startsWith("requires"))).toEqual([]);
    // A few scenes, then back to the rest: the room and its lesson, nothing more.
    const outOf = (id: string) => (scenes[id]!.type === "story" ? (scenes[id] as { choices: { goto: string }[] }).choices.map((c) => c.goto) : []);
    expect(new Set(outOf(r.room))).toEqual(new Set([r.lesson, r.rest]));
    expect(outOf(r.lesson)).toEqual([r.rest]);
  });

  it.each(ROOMS)("the walker answers KEEP_CLASS in the $room and every path still finishes", (r) => {
    const chapter = chapters.get(r.chapter)!;
    const cls = other(r.class);
    const { visited, ends } = allPaths(chapter, "manticore", cls, {}, 2);
    expect(visited.has(r.room)).toBe(true);
    expect(visited.has(r.lesson)).toBe(true);
    for (const end of ends) {
      expect(end.party.map((m) => m.character.class)).toEqual([cls, cls]);
      expect(end.classPlace).toBeUndefined();
    }
  });

  it.each(ROOMS)("the walker switches to $class in the $room and every path still finishes", (r) => {
    const chapter = chapters.get(r.chapter)!;
    const cls = other(r.class);
    const { visited, ends } = allPaths(chapter, "manticore", cls, {}, 2, undefined, "switch");
    expect(visited.has(r.room)).toBe(true);
    const worn = new Set(ends.map((end) => end.party.map((m) => m.character.class).join()));
    // Through the room, both heroes wear its class; past the rest without it, neither changed.
    expect(worn).toEqual(new Set([`${r.class},${r.class}`, `${cls},${cls}`]));
  });

  it.each(ROOMS)("a hero who already wears $class owes the $room nothing", (r) => {
    const chapter = chapters.get(r.chapter)!;
    const own = start(chapter, "manticore", r.class);
    const inRoom = send(enterRest(own, r), { type: "CHOOSE", choiceId: r.door }, chapter);
    expect(inRoom.classPlace).toEqual({ class: r.class, answers: {} });
    // Nothing to answer: the way on is open at once.
    expect(answerClassPlace(inRoom, chapter)).toBe(inRoom);
    expect(send(inRoom, { type: "CHOOSE", choiceId: r.back }, chapter).sceneId).toBe(r.rest);
  });

  it.each(ROOMS)("the $room introduces its teacher on the first visit, and reads shorter only once that visit set $met", (r) => {
    const chapter = chapters.get(r.chapter)!;
    const first = answerClassPlace(send(walkToRest(r), { type: "CHOOSE", choiceId: r.door }, chapter), chapter);
    expect(first.sceneId).toBe(r.room);
    expect(first.flags[r.met]).toBeUndefined();
    expect(first.narration).toContain(r.teacher);
    const back = send(first, { type: "CHOOSE", choiceId: r.back }, chapter);
    expect(back.flags[r.met]).toBe(true);
    const again = answerClassPlace(send(back, { type: "CHOOSE", choiceId: r.door }, chapter), chapter);
    expect(again.sceneId).toBe(r.room);
    expect(again.narration).toContain(r.teacher);
    expect(again.narration!.length).toBeLessThan(first.narration!.length);
  });

  it("every Rookery scene says \"don't mess with us\", on every visit", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    for (const id of ["rookery", "rookery_lesson"]) {
      const scene = chapter.scenes[id] as { narration: string; variants?: { text: string }[] };
      for (const text of [scene.narration, ...(scene.variants ?? []).map((v) => v.text)]) {
        expect(text, id).toMatch(/NO MESSING\. \(WITH US\.\)|don't mess with us|don't get messed with/i);
      }
    }
  });

  it("the rooms never count the party and keep the house style", () => {
    for (const r of ROOMS) {
      const scenes = chapters.get(r.chapter)!.scenes;
      for (const id of [r.rest, r.room, r.lesson]) {
        const scene = scenes[id] as { narration: string; variants?: { text: string }[] };
        const prose = [scene.narration, ...(scene.variants ?? []).map((v) => v.text)].join(" ");
        expect(prose, id).not.toMatch(/\b(both|two|three|four) of you\b|\ball (two|three|four)\b/i);
        expect(prose, id).not.toMatch(/—|–/);
        expect(prose, id).not.toMatch(/colour|favourite|honour|centre|grey\b/i);
      }
    }
  });
});

/** Straight to the room's rest scene, as if the party had walked there. */
function enterRest(state: RunState, r: (typeof ROOMS)[number]) {
  const result = enterScene(state, r.rest, context(chapters.get(r.chapter)!));
  expect(result.error).toBeUndefined();
  return result.state;
}

function walkToRest(r: (typeof ROOMS)[number]) {
  return enterRest(start(chapters.get(r.chapter)!, "manticore", other(r.class)), r);
}
