import { expect, it } from "vitest";
import { applyEffects, applyIntent, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";
type Outcome = "success" | "failure" | "assisted";
const scored = new Set(["precision", "timing", "memory", "tracking", "sequence"]);
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
function walk(chapter: Chapter, initial: RunState, choose: (s: RunState) => string | undefined, outcome: Outcome = "success", battle: "victory" | "retreat" = "victory") {
  let state = initial;
  const trace = new Map<string, RunState>();
  const kinds = new Set<string>();
  let games = 0;
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps).toBeLessThan(100);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      // This route test plays story controls but enumerates declared combat
      // outcomes. The actual boards are exercised in rescue-combat.test.ts.
      const result = battle === "retreat" ? scene.onDefeat : scene.onVictory;
      const objectiveEffects = battle === "victory" ? scene.environment?.objectives?.[0]?.effects ?? [] : [];
      state = applyEffects(state, [...objectiveEffects, ...(result.effects ?? [])], context(chapter));
      const next = enterScene(state, result.goto, context(chapter));
      expect(next.error).toBeUndefined(); state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      games++; kinds.add(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, scored.has(state.prompt.spec.kind) ? outcome : "success");
    } else if (state.prompt?.kind === "choice") {
      const id = choose(state) ?? state.prompt.options[0]!.id;
      expect(offered(state, id), `${chapter.id}/${state.sceneId}: ${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else throw new Error(`Unexpected ${chapter.id}/${state.sceneId}: ${state.prompt?.kind}`);
  }
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
  expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
  expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
  expect(chapter.estimatedMinutes).toBe(30);
  return { state, trace, games, kinds };
}
const flats = chapters.get("riftlight-stuttering-flats")!;
const flatsRoutes = ["short", "shells"].flatMap(route => (route === "short" ? ["sling"] : ["sling", "ramp"]).flatMap(crossing =>
  ["visual", "sound"].flatMap(signal => (["success", "failure", "assisted"] as const).flatMap(outcome => [1, 2, 4].map(seats => ({ route, crossing, signal, outcome, seats }))))));
it.each(flatsRoutes)("flats: $route / $crossing / $signal / $outcome / $seats seats", route => {
  const result = walk(flats, start(flats, "manticore", "duskrunner", {}, route.seats), s => {
    const picks: Record<string, string> = { ground: route.route, signal: route.signal, crossing: route.crossing, record: route.outcome === "success" ? "picture" : "bank" };
    return picks[s.sceneId!];
  }, route.outcome);
  const short = route.route === "short";
  const left = route.crossing === "sling" && route.outcome === "failure";
  expect(result.state.flags.flats_short_route).toBe(short);
  expect(result.trace.has("lay_mat")).toBe(short);
  expect(result.trace.has("shell_markers")).toBe(!short);
  expect(offered(result.trace.get("crossing")!, "ramp")).toBe(!short);
  expect(offered(result.trace.get("crossing")!, "checked")).toBe(route.signal === "visual" && route.outcome === "success");
  expect(result.trace.has("crossing_ramp")).toBe(route.crossing === "ramp");
  expect(result.trace.has("ramp_return")).toBe(route.crossing === "ramp");
  expect(result.trace.has("crossing_recovery")).toBe(left);
  expect(result.state.flags.flats_sling_left === true).toBe(left);
  expect(result.state.narration.includes("sling stayed with the herder")).toBe(left);
  expect(result.state.flags.goat_returned_home).toBe(true);
  expect(result.state.flags.flats_rhythm_read).toBe(route.outcome === "success");
  expect(result.games).toBeGreaterThanOrEqual(10);
  expect(result.kinds.size).toBeGreaterThanOrEqual(6);
});
it.each([1, 2, 4])("a unicorn songkeeper saves specific jobs but still plays the rescue at %i seats", seats => {
  const result = walk(flats, start(flats, "unicorn", "songkeeper", {}, seats), s => {
    const picks: Record<string, string> = { ground: "short", approach: "songkeeper", dry_patch: "mend", crossing: "mended" };
    return picks[s.sceneId!];
  });
  expect(result.trace.has("calm_goat")).toBe(false);
  expect(result.trace.has("songkeeper_calm")).toBe(true);
  expect(result.trace.has("warm_goat")).toBe(false);
  expect(result.trace.has("mended_goat")).toBe(true);
  expect(result.trace.has("lift_balance")).toBe(true);
  expect(result.trace.has("crossing_mended")).toBe(true);
});
it("a bigfoot clears the packed rim but must still level the goat's lift", () => {
  const result = walk(flats, start(flats, "bigfoot", "thornguard"), s => s.sceneId === "lift" ? "bigfoot" : undefined);
  expect(result.trace.has("loosen_mud")).toBe(false);
  expect(result.trace.has("bigfoot_rim")).toBe(true);
  expect(result.trace.has("lift_balance")).toBe(true);
});
it("checked signals and Mend change an actual near-edge crossing result", () => {
  const outcomes = [];
  for (const id of ["crossing_sling", "crossing_checked", "crossing_mended"]) {
    let state = enterScene(start(flats, "unicorn", "songkeeper"), id, context(flats)).state;
    if (state.prompt?.kind !== "interaction") throw new Error("Expected interaction");
    const actor = state.prompt.actorId;
    const base = { openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt };
    const ready = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "start", relaxed: false } }, context(flats));
    expect(ready.error).toBeUndefined(); state = ready.state;
    const result = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "stop", position: .75 } }, context(flats));
    expect(result.error).toBeUndefined();
    if (result.state.prompt?.kind !== "interaction") throw new Error("Expected result");
    outcomes.push(result.state.prompt.outcome);
  }
  expect(outcomes).toEqual(["failure", "success", "success"]);
});
const bones = chapters.get("riftlight-bone-yard")!;
const boneRoutes = [false, true].flatMap(mats => ["line", "arches"].flatMap(route => ["stone", "plank", "brace"].flatMap(support =>
  ["clear", "seam"].flatMap(plan => (["victory", "retreat"] as const).flatMap(battle => [1, 2, 4].map(seats => ({ mats, route, support, plan, battle, seats })))))));
it.each(boneRoutes)("bones: mats $mats / $route / $support / $plan / $battle / $seats seats", route => {
  const result = walk(bones, start(bones, "manticore", route.support === "brace" ? "thornguard" : "duskrunner", {}, route.seats), s => {
    if (s.sceneId === "unbrace") return offered(s, "mats") ? "mats" : offered(s, "plank") ? "plank" : "loose";
    const picks: Record<string, string> = { limit: route.mats ? "carry" : "light", markers: route.route, support: route.support,
      plan: route.mats ? "mats" : route.plan, mat_plan: route.plan,
      exit_strip: route.battle === "victory" && route.route === "line" ? "line" : "guide",
      handoff: route.battle === "victory" ? "relay" : "keep",
    };
    return picks[s.sceneId!];
  }, "success", route.battle);
  const won = route.battle === "victory";
  expect(result.state.flags.bone_retreat === true).toBe(!won);
  expect(result.trace.has(route.plan === "seam" ? route.mats ? "fight_seam_mats" : "fight_seam" : route.mats ? "fight_mats" : "fight")).toBe(true);
  expect(result.trace.has("lay_board_mats")).toBe(route.mats);
  expect(result.trace.has("recover_mats")).toBe(route.mats && won);
  expect(result.state.flags.bone_mats_recovered === true).toBe(route.mats && won);
  expect(result.state.narration.includes("spare mats stay inside")).toBe(route.mats && !won);
  expect(result.trace.has("replace_plank")).toBe(route.support === "plank" && won);
  expect(result.state.flags.bone_plank_recovered === true).toBe(route.support === "plank" && won);
  expect(result.state.narration.includes("marked plank stays inside")).toBe(route.support === "plank" && !won);
  expect(result.trace.has("braced_support")).toBe(route.support === "brace");
  expect(result.trace.has("stone_support")).toBe(route.support === "stone");
  expect(result.trace.has("return_line")).toBe(won && route.route === "line");
  expect(result.trace.has("outer_rim")).toBe(!won || route.route === "arches");
  expect(result.state.flags.bone_account_shared).toBe(won);
  if (!won) {
    expect(result.trace.get("rescued")!.flags.bones_passage_done).not.toBe(true);
    const recovery = result.trace.get("unbrace")!;
    expect(offered(recovery, "mats")).toBe(false); expect(offered(recovery, "plank")).toBe(false);
    expect(offered(result.trace.get("exit_strip")!, "line")).toBe(false);
    expect(result.state.narration).toContain("longer rim route");
  }
  expect(result.games).toBeGreaterThanOrEqual(8);
  expect(result.kinds.size).toBeGreaterThanOrEqual(5);
});
