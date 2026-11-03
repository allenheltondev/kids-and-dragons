/**
 * Mud Where Ice Should Be (riftlight-saltrot-arrival), revised in November 2026
 * for the campaign rewrite (docs/campaigns/continental-rift/arc.md and
 * saltrot-arrival-review.md). These tests protect what the party's choices and
 * rolls change, not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step, teaches or acknowledges Attune,
 *   and asks the campaign question with this chapter's piece (glacier silt);
 * - a slow climb, a half-dug door, a soaked bag, a startled cousin and a loud
 *   spoon each cost something a later scene reads (a lost plan, Grandmother's
 *   trust, the river charm, the honeycake, the gentle way with the crabs);
 * - holding the bank against the crabs or leading them somewhere warm changes
 *   the tide and the ending; a lost fight costs the quick way up and continues;
 * - the arrival variants and the woken glacier fold read back exactly.
 *
 * Route walks play the real controls through the engine; the crab fight takes a
 * declared outcome there and is played on its board in the last test.
 */
import fs from "node:fs";
import path from "node:path";
import { applyEffects, applyIntent, currentActorId, enterScene, resolveEnemy } from "@kad/shared";
import type { Bestiary, EncounterMap, EngineContext, RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-saltrot-arrival")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
const ok = (choice: string) => choice.endsWith("_pass") || choice === "success" || choice === "won";
const head = (choice: string) => choice.split("_")[0]!;

type Route = {
  shells: "skip_pass" | "skip_fail" | "poke_pass" | "poke_fail";
  climb: "success" | "failure";
  door: "scoop_pass" | "scoop_fail" | "trench_pass" | "trench_fail";
  fen: "bag_pass" | "bag_fail" | "path_pass" | "path_fail";
  dab: "rope_pass" | "rope_fail" | "hum_pass" | "hum_fail";
  ossley: "chain_pass" | "chain_fail" | "planks_pass" | "planks_fail";
  camp: "story" | "gift";
  listen: "hum_pass" | "hum_fail" | "map_pass" | "map_fail" | "chime_pass" | "chime_fail";
  trail: "walk_pass" | "walk_fail" | "test_pass" | "charm_pass";
  crab: "hold_won" | "hold_lost" | "warm_pass" | "warm_fail";
  tide: "run_pass" | "run_fail" | "rope_pass" | "rope_fail";
  dash: "success" | "failure";
  seats: 1 | 2 | 4;
}

function walk(route: Route, flags: Record<string, boolean> = {}) {
  let state = start(chapter, "manticore", "duskrunner", flags, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    shells_a_check: face(route.shells), shells_b_check: face(route.shells),
    town_a_check: face(route.door), town_b_check: face(route.door),
    bag_check: face(route.fen), path_check: face(route.fen),
    puff_a: face(route.dab), puff_b: face(route.dab),
    ossley_a: face(route.ossley), ossley_b: face(route.ossley),
    hum_a_check: face(route.listen), hum_b_check: face(route.listen), hum_chime: face(route.listen),
    trail_a_check: face(route.trail), trail_b_check: face(route.trail), trail_charm_check: face(route.trail),
    crab_lead: face(route.crab), tide_a: face(route.tide), tide_b: face(route.tide),
  };
  const picks: Record<string, string> = {
    shells: head(route.shells) === "skip" ? "skip" : "poke", town: head(route.door), local: head(route.fen),
    puff: head(route.dab), ossley: head(route.ossley), camp: route.camp, lesson: head(route.listen),
    trail: { walk: "walk", test: "test", charm: "charm" }[head(route.trail)]!, crab_warn: head(route.crab) === "hold" ? "hold" : "warm",
    tide: head(route.tide),
  };
  // The town's welcome has stages to tap through; the walk takes the helping hand there.
  const games: Record<string, "success" | "failure" | "assisted"> = { shell_path: route.climb, tide_dash: route.dash, hatch_party: "assisted" };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const branch = route.crab === "hold_lost" ? scene.onDefeat : scene.onVictory;
      state = applyEffects(state, branch.effects ?? [], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, games[state.sceneId!] ?? "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      expect(want === undefined || offered(state, want), `${state.sceneId}: ${want}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: want ?? state.prompt.options[0]!.id }, chapter);
    } else {
      state = send(state, { type: "ADVANCE" }, chapter);
    }
  }
  trace.set(state.sceneId!, structuredClone(state));
  return { state, trace };
}

const product = <T extends Record<string, readonly unknown[]>>(axes: T) =>
  Object.entries(axes).reduce<Record<string, unknown>[]>((rows, [key, values]) =>
    rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);
const DEFAULT: Route = {
  shells: "skip_pass", climb: "success", door: "scoop_pass", fen: "bag_pass", dab: "rope_pass", ossley: "chain_pass", camp: "story",
  listen: "hum_pass", trail: "walk_pass", crab: "hold_won", tide: "run_pass", dash: "success", seats: 1,
};
// A slow climb hides the trench; a loud spoon hides the gentle way with the crabs; only a won bank leaves the run.
const valid = (r: Route) => !(r.climb === "failure" && head(r.door) === "trench")
  && !(r.listen.endsWith("_fail") && head(r.crab) === "warm")
  && !(head(r.tide) === "run" && r.crab !== "hold_won")
  && !(r.camp === "gift" && r.dab.endsWith("_fail"))
  && !(r.trail === "charm_pass" && r.fen.endsWith("_fail"));
const early = { shells: ["skip_pass", "skip_fail", "poke_pass", "poke_fail"], climb: ["success", "failure"],
  door: ["scoop_pass", "scoop_fail", "trench_pass", "trench_fail"], fen: ["bag_pass", "bag_fail", "path_pass", "path_fail"],
  dab: ["rope_pass", "rope_fail", "hum_pass", "hum_fail"], ossley: ["chain_pass", "chain_fail", "planks_pass", "planks_fail"], seats: [1, 2, 4] } as const;
const late = { door: ["scoop_pass", "scoop_fail"], camp: ["story", "gift"], listen: ["hum_pass", "hum_fail", "map_pass", "map_fail", "chime_pass", "chime_fail"],
  trail: ["walk_pass", "walk_fail", "test_pass", "charm_pass"], crab: ["hold_won", "hold_lost", "warm_pass", "warm_fail"],
  tide: ["run_pass", "run_fail", "rope_pass", "rope_fail"], dash: ["success", "failure"], seats: [1, 2, 4] } as const;
const rows = (axes: Record<string, readonly unknown[]>) => product(axes).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid);
const routes: Route[] = [
  ...pairwise(rows(early), Object.keys(early) as (keyof Route)[], { together: [["climb", "door"]] }),
  ...pairwise(rows(late), Object.keys(late) as (keyof Route)[], { together: [["listen", "crab", "tide"], ["door", "camp"]] }),
];

describe("every route through the Saltrot", () => {
  it.each(routes)("$shells $climb $door $fen $dab $ossley $camp $listen $trail $crab $tide $dash, $seats seats", route => {
    const { state, trace } = walk(route);
    const ending = state.narration;

    // The beat: the door is open, the party knows the silt came from the glacier.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.flags.attune_taught).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(ending).toContain("came down the river from the glacier");
    expect(ending).toContain("What is it? And can you put things right?");
    const heard = trace.get(route.listen.endsWith("_fail") ? "hum_off" : "hum_done")!;
    expect(heard.narration).toContain("toward the glacier");

    // A slipped shell bank hurts; a slow climb costs the clever plan at the door.
    expect(trace.get("shell_path")!.party.some(p => p.hp < p.character.maxHp)).toBe(!ok(route.shells));
    expect(offered(trace.get("town")!, "trench")).toBe(route.climb === "success");
    expect(trace.get("town")!.narration.includes("No time for clever plans")).toBe(route.climb === "failure");

    // A half-dug door is Grandmother Winkle's grudge until a gift changes her mind.
    const half = !ok(route.door);
    expect(trace.has(half ? "town_off" : "town_done")).toBe(true);
    expect(ending.includes("Tidepocket's door stands clear")).toBe(!half);
    expect(ending.includes("Half of Tidepocket's door is still under silt")).toBe(half && route.camp === "story");
    expect(ending.includes("Puddle may show you the bank")).toBe(route.camp === "gift");

    // Fen's charm, Dab's honeycake and Ossley's pay go only to the help that worked.
    expect(offered(trace.get("trail")!, "charm")).toBe(ok(route.fen));
    expect(offered(trace.get("camp")!, "gift")).toBe(ok(route.dab));
    expect((trace.get("camp")!.coins ?? 0) - (trace.get("ossley")!.coins ?? 0)).toBe(ok(route.ossley) ? 5 : 3);
    expect(trace.get(ok(route.dab) ? "puff_done" : "puff_off")!.narration).toContain("snowing on them");

    // Pip's loud spoon wakes the crabs and costs the gentle way.
    expect(offered(trace.get("crab_warn")!, "warm")).toBe(!route.listen.endsWith("_fail"));

    // Force or understand at the crabs: the quick run, and who sits where at the end.
    expect(offered(trace.get("tide")!, "run")).toBe(route.crab === "hold_won");
    expect(ending.includes("looking for a door to sit on")).toBe(route.crab === "hold_won");
    expect(ending.includes("squat on the warm bank")).toBe(route.crab === "hold_lost");
    expect(ending.includes("doze in their warm hollow")).toBe(head(route.crab) === "warm");
    expect(trace.has("crab_rescued")).toBe(route.crab === "hold_lost");
    expect(trace.has("tide_off")).toBe(!ok(route.tide));
  });
});

it("the arrival reads back the way the party came, and only that way", () => {
  const ways = { saltrot_arrival_ferry: "flat boat", saltrot_arrival_glacier: "cold glacier air", saltrot_arrival_whales: "cloud whales' distant song" } as const;
  for (const [flag, words] of Object.entries(ways)) {
    const arrival = start(chapter, "manticore", "duskrunner", { [flag]: true });
    for (const [other, text] of Object.entries(ways)) expect(arrival.narration.includes(text), `${flag}: ${other}`).toBe(other === flag);
    expect(arrival.narration).toContain("What's glacier silt doing on my mudflat?");
  }
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "kitsune", "starweaver", flags), "ending", context(chapter)).state.narration;
  expect(ending({ glacier_rift_woken: true })).toContain("could carry you back to the glacier");
  expect(ending({})).not.toContain("could carry you back to the glacier");
});

it("every authored outcome, for every species and class shortcut, reaches the beat", { timeout: 120_000 }, () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    for (const taught of [false, true]) {
      const { ends, visited } = allPaths(chapter, species, cls, taught ? { attune_taught: true } : {}, 1, 1);
      for (const end of ends) {
        expect(end.chapterOutcome).toBe("success");
        for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
        expect(end.flags.attune_taught).toBe(true);
        expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      }
      for (const id of ["crab_fight", "crab_done", "crab_rescued", "crab_led", "crab_nipped", "town_off", "hum_off"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
      expect(visited.has("town_brace")).toBe(cls === "thornguard");
      expect(visited.has("puff_song")).toBe(cls === "songkeeper");
      expect(visited.has("hum_star")).toBe(cls === "starweaver");
      expect(visited.has("trail_wing_check")).toBe(species === "griffin");
      expect(visited.has("crabs_leap_check")).toBe(species === "manticore");
    }
  }
});

it("Attune is taught on a first strand visit and acknowledged on a later one, on every way through the lesson", () => {
  for (const taught of [false, true]) {
    const lesson = enterScene(start(chapter, "kitsune", "starweaver", taught ? { attune_taught: true } : {}), "lesson", context(chapter)).state;
    expect(lesson.narration.includes("taught you before")).toBe(taught);
    expect(lesson.narration.includes("That is called Attune")).toBe(!taught);
    expect(lesson.narration).toContain("Pip");
    if (lesson.prompt?.kind !== "choice") throw new Error("Expected the lesson's choices");
    for (const option of lesson.prompt.options) expect(send(lesson, { type: "CHOOSE", choiceId: option.id }, chapter).flags.attune_taught).toBe(true);
  }
});

it("losing to the glassback crabs on the board costs the warm bank and the quick way up, and the story goes on", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const bestiary = JSON.parse(fs.readFileSync(path.join(root, "content/bestiary.json"), "utf8")) as Bestiary;
  const map = JSON.parse(fs.readFileSync(path.join(root, "content/maps/reedbank.json"), "utf8")) as EncounterMap;
  const local = structuredClone(chapter);
  const fight = local.scenes.crab_fight!;
  if (fight.type !== "encounter") throw new Error("Expected the crab fight");
  expect(fight.enemies.map(e => e.creature)).toEqual(["glassback_crab"]);
  fight.enemies = fight.enemies.map(e => { const loaded = resolveEnemy(e, bestiary); expect(loaded.problems).toEqual([]); return loaded.spec!; });
  const ctx: EngineContext = { ...context(local, 20), map: id => id === map.id ? map : null };
  let state = enterScene(start(local, "manticore", "duskrunner", {}, 2), "crab_fight", ctx).state;
  for (const p of state.party) state = applyIntent(state, { playerId: p.playerId, intent: { type: "READY", ready: true } }, ctx).state;
  expect(state.encounter).not.toBeNull();
  for (let turns = 0; state.encounter; turns++) {
    expect(turns).toBeLessThan(200);
    const actor = currentActorId(state.encounter)!;
    const member = state.party.find(p => p.character.id === actor)!;
    const result = applyIntent(state, { playerId: member.playerId, intent: { type: "END_TURN" } }, ctx);
    expect(result.error).toBeUndefined();
    state = result.state;
  }
  expect(state.sceneId).toBe("crab_rescued");
  expect(state.flags).toMatchObject({ saltrot_crabs_kept: true, saltrot_no_run: true });
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
  expect(state.party.some(p => p.character.inventory.some(i => i.itemId === "luckstone"))).toBe(false);
  state = send(state, { type: "CHOOSE", choiceId: "run" }, local);
  expect(state.sceneId).toBe("tide");
  expect(offered(state, "run")).toBe(false);
  expect(offered(state, "rope")).toBe(true);
});
