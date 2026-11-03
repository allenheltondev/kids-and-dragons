/**
 * The River Takes Another Valley (riftlight-the-wrong-valley), rewritten in
 * November 2026 to the pilot's bar (docs/campaigns/continental-rift/arc.md and
 * memory-paths-continuity-review.md). These tests protect consequences, not
 * counts:
 *
 * - every success ending ticks every goal step, sets wrong_valley_witnessed,
 *   and asks the campaign question with the old-course piece added;
 * - lost time (any slow look, slip or failed plan on the way up) takes the
 *   calm warnings off the table, and a missed jump loses Hummock's lantern;
 * - walling off the old valley floods the low ice and the oldest marker, and
 *   the river comes back without the wall anyway; watching it run keeps the
 *   order of the pools for the reading room;
 * - valley_crossed_high records the crossing actually completed, including a
 *   fall onto the other route, and the account says which;
 * - the account sets up the reading room's comparison.
 */
import { enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-the-wrong-valley")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  snow: "pass" | "fail";
  look: "map_pass" | "map_fail" | "climb_pass" | "climb_fail" | "plan_pass" | "plan_fail";
  bank: "pass" | "fail";
  down: "board_pass" | "board_fail" | "trail_pass" | "trail_fail";
  river: "wall_pass" | "wall_fail" | "watch_success" | "watch_failure";
  cross: "low_pass" | "low_fail" | "high_pass" | "high_fail";
  jump: "success" | "failure";
  // A relay cannot be missed in the engine, so the stone arrow always stands once it is built.
  warn: "light_success" | "light_failure" | "arrow_success" | "run_pass" | "run_fail";
  driver: "haul_pass" | "haul_fail" | "guide_pass" | "guide_fail";
  dusk: "pass" | "fail";
  night: "sleep" | "moon_pass" | "moon_fail";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice === "pass" || choice === "success" || choice.endsWith("_pass") || choice.endsWith("_success");
const head = (choice: string) => choice.split("_")[0]!;

function walk(route: Route) {
  let state = start(chapter, "manticore", "songkeeper", { stone_route_priority: head(route.look) === "plan" }, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    snowbank: face(route.snow), check_map: face(route.look), check_climb: face(route.look), check_plan: face(route.look),
    bank_path: face(route.bank), check_board: face(route.down), check_trail: face(route.down), check_wall: face(route.river),
    check_ice: face(route.cross), check_wade: face(route.cross), check_high: face(route.cross), check_sledge: head(route.warn) === "run" ? face(route.warn) : 20,
    check_haul: face(route.driver), check_guide: face(route.driver), dusk: face(route.dusk), check_moon: face(route.night),
  };
  const picks: Record<string, string> = {
    look: head(route.look), down_valley: head(route.down), pip_dam: head(route.river), crossing: head(route.cross),
    crossing_flooded: head(route.cross) === "low" ? "wade" : "high",
    lantern_post: head(route.warn), driver: head(route.driver), rest: route.night === "sleep" ? "sleep" : "moon",
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      const played = { follow_water: route.river, hummock_jump: route.jump, light_lantern: route.warn, stone_arrow: route.warn }[state.sceneId as "follow_water"];
      state = finishInteraction(state, chapter, played === undefined || ok(played) ? "success" : "failure");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      const fallback = state.sceneId === "lantern_post" ? "run" : state.prompt.options[0]!.id;
      state = send(state, { type: "CHOOSE", choiceId: want && offered(state, want) ? want : fallback }, chapter);
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
  snow: "pass", look: "map_pass", bank: "pass", down: "board_pass", river: "watch_success", cross: "low_pass", jump: "success",
  warn: "light_success", driver: "haul_pass", dusk: "pass", night: "sleep", seats: 1,
};
// The road up the valley, where any slip costs time...
const upriver = { snow: ["pass", "fail"], look: ["map_pass", "map_fail", "climb_pass", "climb_fail", "plan_pass", "plan_fail"], bank: ["pass", "fail"],
  down: ["board_pass", "board_fail", "trail_pass", "trail_fail"], warn: ["light_success", "light_failure", "arrow_success", "run_pass", "run_fail"], seats: [1, 2, 4] } as const;
// ...and the decisions that change the crossing, the warning and the account.
const decisions = { river: ["wall_pass", "wall_fail", "watch_success", "watch_failure"], cross: ["low_pass", "low_fail", "high_pass", "high_fail"],
  jump: ["success", "failure"], warn: ["light_success", "light_failure", "arrow_success", "run_pass", "run_fail"],
  driver: ["haul_pass", "haul_fail", "guide_pass", "guide_fail"], dusk: ["pass", "fail"], night: ["sleep", "moon_pass", "moon_fail"], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(upriver), Object.keys(upriver)),
  ...pairwise(product(decisions), Object.keys(decisions), { together: [["river", "cross", "jump", "warn"]] }),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route down the wrong valley", () => {
  it.each(routes)("$snow $look $bank $down | $river $cross jump:$jump $warn $driver dusk:$dusk $night, $seats seats", route => {
    const { state, trace } = walk(route);
    const late = route.snow === "fail" || !ok(route.look) || route.bank === "fail" || !ok(route.down) || route.river === "wall_fail" || route.river === "watch_failure";
    const flooded = route.river === "wall_pass";
    const forced = head(route.river) === "wall";
    // Low is the ice shelf (waded, if the wall flooded it); a fall from either way lands on the other.
    const tookLow = head(route.cross) === "low";
    const high = tookLow ? !ok(route.cross) : ok(route.cross);

    // The beat: across the river that ran down the dry valley, the sledge warned, the change witnessed.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.flags.wrong_valley_witnessed).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.has("old_road")).toBe(true);
    expect(state.narration).toContain("went back down a valley it ran long ago");
    expect(state.narration).toContain("leans north, toward the glacier");
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");

    // Force or understand.
    expect(trace.has("walled")).toBe(flooded);
    expect(trace.has("wall_burst")).toBe(route.river === "wall_fail");
    expect(trace.has("understood")).toBe(!forced);
    expect(trace.has("crossing_flooded")).toBe(flooded);
    expect(trace.has("crossing")).toBe(!flooded);
    expect(trace.has("check_wade")).toBe(flooded && tookLow);
    expect(trace.get("river_back")!.narration.includes("didn't need our wall")).toBe(forced);
    expect(state.narration.includes("under your wall's water")).toBe(flooded);
    expect(trace.get("account")!.narration.includes("round, long, long, falls")).toBe(route.river === "watch_success");

    // The crossing actually completed is the one recorded, and the account says it.
    expect(state.flags.valley_crossed_high).toBe(high);
    expect(trace.get("account")!.narration.includes(high ? "by the high rocks" : "by the low ice shelf")).toBe(true);

    // Lost time and a missed jump take the calm warnings away.
    const post = trace.get("lantern_post")!;
    expect(offered(post, "light")).toBe(route.jump === "success");
    expect(offered(post, "arrow")).toBe(!late);
    expect(offered(post, "run")).toBe(true);
    const calm = (head(route.warn) === "light" && route.jump === "success") || (head(route.warn) === "arrow" && !late);
    expect(trace.has("warning_lit")).toBe(calm && ok(route.warn));
    expect(trace.has("check_sledge")).toBe(!(calm && ok(route.warn)));
    expect(trace.get("river_back")!.narration.includes("hang a new one tomorrow")).toBe(route.jump === "failure");

    // What the sledge, the surge and the moonlight leave in the account.
    expect(trace.get("rest")!.narration.includes("careful half cup")).toBe(!ok(route.driver));
    expect(trace.get("account")!.narration.includes("draws both rivers again")).toBe(route.dusk === "fail");
    expect(trace.get("account")!.narration.includes("moonlit pools")).toBe(route.night === "moon_pass");
    expect(trace.get("account")!.narration).toContain("has it ever run there before?");
  });
});

it("valley_crossed_high overwrites a stale value with the crossing actually made, falls included", () => {
  const cases = [["low", 20, false], ["low", 1, true], ["high", 20, true], ["high", 1, false]] as const;
  for (const [way, face, high] of cases) {
    let state = enterScene(start(chapter, "manticore", "duskrunner", { valley_crossed_high: !high }), "crossing", context(chapter)).state;
    state = send(state, { type: "CHOOSE", choiceId: way }, chapter);
    state = send(state, { type: "ROLL" }, chapter, face);
    expect(state.sceneId).toBe(high ? "across_high" : "across_low");
    expect(state.flags.valley_crossed_high).toBe(high);
    expect(state.flags.valley_crossed).toBe(true);
  }
});

it("a thornguard can hold the low ice, beside the ungated ways, and only while the ice is above water", () => {
  for (const flooded of [false, true]) {
    const state = enterScene(start(chapter, "bigfoot", "thornguard"), flooded ? "crossing_flooded" : "crossing", context(chapter)).state;
    expect(offered(state, "hold")).toBe(!flooded);
    expect(offered(state, "high")).toBe(true);
    expect(offered(state, flooded ? "wade" : "low")).toBe(true);
    if (flooded) continue;
    const held = send(state, { type: "CHOOSE", choiceId: "hold" }, chapter);
    expect(held.sceneId).toBe("hold_ice");
    expect(send(held, { type: "CHOOSE", choiceId: "over" }, chapter).flags.valley_crossed_high).toBe(false);
  }
  expect(offered(enterScene(start(chapter, "manticore", "duskrunner"), "crossing", context(chapter)).state, "hold")).toBe(false);
});

it("every authored outcome, for every class, reaches the beat with the contract flags set", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["bigfoot", "thornguard"], ["kitsune", "starweaver"]] as const) {
    for (const carried of [false, true]) {
      const { ends, visited } = allPaths(chapter, species, cls, { stone_route_priority: carried }, 1, 1);
      for (const end of ends) {
        for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
        expect(end.flags.wrong_valley_witnessed).toBe(true);
        expect(typeof end.flags.valley_crossed_high).toBe("boolean");
        expect(end.party[0]!.down).toBe(false);
      }
      expect(ends.some(e => e.flags.valley_crossed_high === true)).toBe(true);
      expect(ends.some(e => e.flags.valley_crossed_high === false)).toBe(true);
      expect(visited.has("check_plan")).toBe(carried);
      expect(visited.has("hold_ice")).toBe(cls === "thornguard");
    }
  }
});

it("the old course is one p2 on every path, and the chapter leaves the reading room its p1", () => {
  const priority = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority);
  expect(priority.map(([id, s]) => [id, (s as { priority: number }).priority])).toEqual([["old_road", 2]]);
  const narration = (chapter.scenes.old_road as { narration: string }).narration;
  expect(narration).toContain("running down a road it ran long, long ago");
  expect(narration).toContain("toward the glacier");
});

it("journey flags: only valley_crossed_high and wrong_valley_witnessed leave the chapter", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set<string>();
  for (const m of JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)) written.add(m[1]!);
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["valley_crossed_high", "wrong_valley_witnessed"]);
  expect(JSON.stringify(chapter)).toContain("stone_route_priority");
});
