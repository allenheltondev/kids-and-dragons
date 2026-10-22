/**
 * Class places: every graph campaign reaches all four (#313).
 *
 * The reach itself is judged on small in-memory graphs. Two cases then run the
 * real gate (`content:validate`) over a copy of the content with the Continental
 * Rift slice dropped in, so the wiring, the exit code and the message are shown
 * too, not just the function.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { classPlaceReach, classPlaceVerdict, loadAllowList } from "./class-places.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLASSES = ["thornguard", "duskrunner", "starweaver", "songkeeper"];

/** A chapter: a story entry, a rest scene, and a room per `rooms` entry, each reached by `via`. */
function chapter(id, rooms = [], { via = {}, fromStory = [] } = {}) {
  const scenes = {
    start: { type: "story", narration: "A door.", choices: [{ id: "on", label: "Go on", icon: "door", goto: "camp" }] },
    camp: {
      type: "rest",
      narration: "A fire.",
      choices: [
        ...rooms.filter((c) => !fromStory.includes(c)).map((c) => ({ id: `to_${c}`, label: `Visit ${c}`, icon: "door", goto: `room_${c}`, ...(via[c] ?? {}) })),
        { id: "leave", label: "Leave", icon: "door", goto: "end" },
      ],
    },
    end: { type: "story", narration: "Done.", choices: [], outcome: "success" },
  };
  for (const c of fromStory) scenes.start.choices.push({ id: `to_${c}`, label: c, icon: "door", goto: `room_${c}` });
  for (const c of rooms) scenes[`room_${c}`] = { type: "story", narration: "A room.", classPlace: c, choices: [{ id: "back", label: "Back", icon: "door", goto: "camp" }] };
  return { id, entry: "start", scenes };
}

/** A two-place graph campaign; `edge` bends the way from a to b. */
function campaign(edge = {}) {
  return {
    id: "fixture",
    chapters: ["ch-a", "ch-b"],
    graph: {
      entry: "a",
      nodes: { a: { chapter: "ch-a" }, b: { chapter: "ch-b" } },
      edges: { "a-b": { from: "a", to: "b", kind: "forward", ...edge }, "b-a": { from: "b", to: "a", kind: "return" } },
    },
  };
}

const reach = (c, chapters) => classPlaceReach(c, chapters, CLASSES);
const verdict = (c, chapters, allow) => classPlaceVerdict(c.id, reach(c, chapters), allow);

describe("class place reach", () => {
  it("passes when all four are reachable", () => {
    const c = campaign();
    const v = verdict(c, [chapter("ch-a", ["thornguard", "starweaver"]), chapter("ch-b", ["duskrunner", "songkeeper"])]);
    expect(v.errors).toEqual([]);
  });

  it("fails a campaign missing one, and names the class", () => {
    const c = campaign();
    const v = verdict(c, [chapter("ch-a", ["thornguard", "starweaver"]), chapter("ch-b", ["duskrunner"])]);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatch(/^songkeeper: no scene/);
  });

  it("fails a room reachable only through a gated choice", () => {
    for (const gate of [{ requiresClass: "thornguard" }, { requiresSpecies: "fox" }, { requiresFlag: "k" }, { requiresItem: "key" }, { when: { partySize: { min: 2 } } }]) {
      const c = campaign();
      const v = verdict(c, [chapter("ch-a", CLASSES, { via: { songkeeper: gate } }), chapter("ch-b")]);
      expect(v.errors, JSON.stringify(gate)).toHaveLength(1);
      expect(v.errors[0]).toMatch(/^songkeeper: the only way to ch-a\/room_songkeeper is gated/);
    }
  });

  it("fails a room in a place whose only way in is gated or locked", () => {
    const chapters = [chapter("ch-a"), chapter("ch-b", CLASSES)];
    for (const edge of [{ when: { flag: "k" } }, { when: { facts: { river: "high" } } }, { locked: true }]) {
      const v = verdict(campaign(edge), chapters);
      expect(v.errors.map((e) => e.split(":")[0]).sort(), JSON.stringify(edge)).toEqual([...CLASSES].sort());
    }
  });

  it("fails a place whose only way in is a rift with a lifecycle rule", () => {
    const chapters = [chapter("ch-a"), chapter("ch-b", CLASSES)];
    const rifts = [
      { opensWhen: { flag: "special_choice" } },
      { opensWhen: { facts: { river: "high" } } },
      { lasts: { unit: "visits", count: 3 } },
      { unstable: { flicker: { open: 1, shut: 1 } } },
      { linkedTo: "b-a" },
      { actions: { close: { requires: { anyItem: ["key"] } } } },
    ];
    for (const rift of rifts) {
      const v = verdict(campaign({ rift }), chapters);
      expect(v.errors.map((e) => e.split(":")[0]).sort(), JSON.stringify(rift)).toEqual([...CLASSES].sort());
    }
  });

  it("counts a rift that only reveals, is one-way or is limited to n crossings as open", () => {
    const chapters = [chapter("ch-a"), chapter("ch-b", CLASSES)];
    for (const rift of [{}, { oneWay: true }, { persistent: true }, { reveal: "when-open" }, { uses: 1 }, { uses: 2, oneWay: true }]) {
      expect(verdict(campaign({ rift }), chapters).errors, JSON.stringify(rift)).toEqual([]);
    }
  });

  it("counts Riftlight's one-use, one-way rift as open, and the rooms beyond it", () => {
    // Read from the shipped campaign so the test follows it: its only way out of the Exchange.
    const draft = JSON.parse(readFileSync(join(REPO, "content", "campaigns", "riftlight.json"), "utf8"));
    const { when, locked, rift } = draft.graph.edges["exchange-to-glacier"];
    expect(rift.uses).toBe(1);
    expect([when, locked, rift.opensWhen, rift.lasts, rift.unstable, rift.linkedTo, rift.actions]).toEqual(Array(7).fill(undefined));
    const chapters = [chapter("ch-a"), chapter("ch-b", CLASSES)];
    expect(verdict(campaign({ rift }), chapters).errors).toEqual([]);
  });

  it("counts a `completed` gate on a place any party can reach", () => {
    const c = campaign({ when: { completed: "a" } });
    expect(verdict(c, [chapter("ch-a"), chapter("ch-b", CLASSES)]).errors).toEqual([]);
  });

  it("passes a room reachable from two places, one of them ungated", () => {
    const gatedHere = chapter("ch-a", CLASSES, { via: { songkeeper: { requiresFlag: "k" } } });
    const openThere = chapter("ch-b", ["songkeeper"]);
    expect(verdict(campaign(), [gatedHere, openThere]).errors).toEqual([]);
  });

  it("fails a room that is gated in one place and out of reach in the other", () => {
    const gatedHere = chapter("ch-a", CLASSES, { via: { songkeeper: { requiresFlag: "k" } } });
    const openThere = chapter("ch-b", ["songkeeper"]);
    // ch-b's only way in is gated, so its open room is not guaranteed either.
    expect(verdict(campaign({ when: { flag: "k" } }), [gatedHere, openThere]).errors).toHaveLength(1);
  });

  it("fails a class place that no rest scene leads to", () => {
    const c = campaign();
    const v = verdict(c, [chapter("ch-a", CLASSES, { fromStory: ["duskrunner"] }), chapter("ch-b")]);
    expect(v.errors).toContainEqual(expect.stringMatching(/^duskrunner: ch-a\/room_duskrunner is a class place but no rest scene leads to it/));
  });

  it("is quiet about an allow-listed campaign that has a gap, and loud once it has none", () => {
    const c = campaign();
    const gap = verdict(c, [chapter("ch-a"), chapter("ch-b")], { fixture: "no rooms until #315" });
    expect(gap.errors).toEqual([]);
    expect(gap.warnings).toHaveLength(4);
    const full = verdict(c, [chapter("ch-a", CLASSES), chapter("ch-b")], { fixture: "no rooms until #315" });
    expect(full.errors[0]).toMatch(/remove the entry/);
  });

  it("never lets a campaign without an allow-list entry pass incomplete", () => {
    expect(verdict(campaign(), [chapter("ch-a"), chapter("ch-b")]).errors).toHaveLength(4);
  });

  it("ships an allow-list whose entries each carry a reason", () => {
    for (const [id, reason] of Object.entries(loadAllowList())) expect(reason.trim(), id).not.toBe("");
  });
});

describe("content:validate over a graph campaign", { timeout: 60_000 }, () => {
  const temps = [];
  afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** A copy of the content with the Continental Rift slice as a shipped campaign; `edit` bends its chapters. */
  function run(edit) {
    const dir = mkdtempSync(join(tmpdir(), "kad-class-places-"));
    temps.push(dir);
    cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
    cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
    cpSync(join(REPO, "assets", "world"), join(dir, "assets", "world"), { recursive: true });
    cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"));
    const fx = join(REPO, "packages", "shared", "src", "fixtures");
    const camp = JSON.parse(readFileSync(join(fx, "continental-rift.campaign.json"), "utf8"));
    writeFileSync(join(dir, "content", "campaigns", "continental-rift-slice.json"), JSON.stringify(camp));
    cpSync(join(fx, "continental-rift", "ice-shelf.map.json"), join(dir, "content", "maps", "cr_ice_shelf.json"));
    const chapters = {};
    for (const id of new Set([...Object.values(camp.graph.nodes).flatMap((n) => [n.chapter, ...(n.variants ?? []).map((v) => v.chapter)])])) {
      chapters[id] = JSON.parse(readFileSync(join(fx, "continental-rift", "chapters", `${id}.json`), "utf8"));
    }
    edit?.(chapters);
    for (const [id, ch] of Object.entries(chapters)) writeFileSync(join(dir, "content", "chapters", `${id}.json`), JSON.stringify(ch));
    try {
      // A new graph, so a new proof, written as an author would (content:proofs).
      const out = execFileSync(process.execPath, [join(REPO, "tools", "content", "validate.mjs"), "--write-proofs"], {
        env: { ...process.env, KAD_CONTENT_ROOT: dir, NO_COLOR: "1" },
        encoding: "utf8",
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  /** Give the Marsh a rest scene with a room for each class in `classes`. */
  const withRooms = (classes) => (chapters) => {
    const marsh = chapters["cr-marsh"];
    const reeds = marsh.scenes.scene_reeds;
    marsh.scenes.scene_camp = {
      type: "rest",
      narration: "A boggart banks a fire of wet reeds.",
      choices: [...classes.map((c) => ({ id: `to_${c}`, label: `Visit the ${c} room`, icon: "door", goto: `room_${c}` })), { id: "on", label: "Go on", icon: "door", goto: "scene_mud" }],
    };
    reeds.choices[0].goto = "scene_camp";
    for (const c of classes) {
      marsh.scenes[`room_${c}`] = { type: "story", narration: "A room.", classPlace: c, choices: [{ id: "back", label: "Back", icon: "door", goto: "scene_camp" }] };
    }
  };

  it("fails a graph campaign with no class places, naming each class", () => {
    const result = run();
    expect(result.code).not.toBe(0);
    for (const c of CLASSES) expect(result.out).toContain(`CLASS_PLACE: ${c}: no scene`);
  });

  it("passes one with all four", () => {
    const result = run(withRooms(CLASSES));
    expect(result.out).not.toContain("CLASS_PLACE");
    expect(result.code, result.out).toBe(0);
  });

  it("names the one that is missing", () => {
    const result = run(withRooms(CLASSES.slice(0, 3)));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("CLASS_PLACE: songkeeper: no scene");
    expect(result.out).not.toContain("CLASS_PLACE: thornguard");
  });
});
