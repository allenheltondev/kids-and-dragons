import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { expect, it } from "vitest";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";
type Outcome = "success" | "failure" | "assisted";
type Battle = "objective" | "driven" | "retreat";
const scored = new Set(["memory", "sequence", "timing", "precision", "tracking"]);
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
function walk(chapter: Chapter, initial: RunState, choose: (s: RunState) => string | undefined, outcome: Outcome, battle: Battle) {
  let state = initial;
  const trace = new Map<string, RunState>();
  for (let count = 0; state.phase !== "chapter_complete"; count++) {
    expect(count, `${chapter.id}/${state.sceneId}`).toBeLessThan(85);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      // Story/control coverage enumerates declared battle results. The actual
      // objective, drive-off and defeat mechanics are tested separately.
      const branch = battle === "retreat" ? scene.onDefeat : scene.onVictory;
      state = applyEffects(state, [...(battle === "objective" ? scene.environment?.objectives?.[0]?.effects ?? [] : []), ...(branch.effects ?? [])], context(chapter));
      const entered = enterScene(state, branch.goto, context(chapter));
      expect(entered.error).toBeUndefined(); state = entered.state;
    } else if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, scored.has(state.prompt.spec.kind) ? outcome : "success");
    } else if (state.prompt?.kind === "choice") {
      const choice = choose(state) ?? state.prompt.options[0]!.id;
      expect(offered(state, choice), `${state.sceneId}/${choice}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: choice }, chapter);
    } else throw Error(`Unexpected ${state.sceneId}/${state.prompt?.kind}`);
  }
  expect(state.chapterOutcome).toBe("success");
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.label).toBe(true);
  expect(state.party.every(p => p.hp > 0 && !p.down)).toBe(true);
  expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
  expect(chapter.estimatedMinutes).toBe(30);
  return { state, trace };
}
const nest = chapters.get("riftlight-wyrm-nest")!;
const nestCases = ["portable", "fixed"].flatMap(kit => ["snow", "slab"].flatMap(bed =>
  (["objective", "driven", "retreat"] as const).flatMap(battle => [false, true].flatMap(table =>
    (["success", "failure", "assisted"] as const).flatMap(outcome => [1, 2, 4].map(seats => ({ kit, bed, battle, table, outcome, seats })))))));
it.each(nestCases)("nest $kit/$bed/$battle/table:$table/$outcome/$seats", route => {
  const { state, trace } = walk(nest, start(nest, "manticore", "duskrunner", {}, route.seats), s => {
    const fixed: Record<string, string> = { supplies: route.kit, cold_opening: "view", bed: route.bed, offer: route.bed === "snow" ? "continue_soft" : "continue" };
    if (s.sceneId === "shelves") {
      if (offered(s, "portable_old")) return "portable_old";
      return !route.table && offered(s, "plan_1") ? "plan_1" : "plan_2";
    }
    if (s.sceneId === "slab_route") return offered(s, "recover") ? "recover" : "leave";
    if (s.sceneId === "readers") return offered(s, "signals") ? "signals" : "markers";
    return fixed[s.sceneId!];
  }, route.outcome, route.battle);
  const retreat = route.battle === "retreat", ally = route.battle === "objective";
  expect(state.flags.wyrm_ally === true).toBe(ally);
  expect(state.flags.wyrm_nest_kept === true).toBe(retreat);
  const shelves = trace.get("shelves")!;
  expect(offered(shelves, "plan_1")).toBe(route.kit === "fixed" && !retreat);
  expect(offered(shelves, "portable_old")).toBe(route.kit === "portable" && retreat);
  expect(trace.has("unpack_shelf")).toBe(!(route.kit === "portable" && retreat) && (route.table || route.kit === "portable" || retreat));
  expect(trace.has("reader_step")).toBe(route.bed === "slab" && !ally);
  expect(offered(trace.get("slab_route")!, "recover")).toBe(route.bed === "slab" && !ally);
  expect(trace.has("hollow_help")).toBe(route.outcome === "failure");
  expect(trace.has("readers_check")).toBe(route.outcome === "success");
  expect(trace.has("readers_markers")).toBe(route.outcome !== "success");
  expect(state.narration.includes("give up their free morning")).toBe(retreat);
  expect(state.narration.includes("unused resting slab has become")).toBe(route.bed === "slab" && !ally);
});
it.each([1, 2, 4])("starweaver replaces the survey task without skipping the nest at %i seats", seats => {
  const result = walk(nest, start(nest, "kitsune", "starweaver", {}, seats), s => s.sceneId === "cold_opening" ? "starweaver" : undefined, "success", "retreat");
  expect(result.trace.has("hollow_attuned")).toBe(true);
  expect(result.trace.has("hollow_view")).toBe(false);
  expect(result.trace.has("bed_snow")).toBe(true);
  expect(result.trace.has("fight")).toBe(true);
  expect(result.trace.has("shelves_check")).toBe(true);
});
const temple = chapters.get("riftlight-squall-temple")!;
const templeCases = [false, true].flatMap(warning => ["rope", "cover", "brace"].flatMap(prep => ["push", "shelter"].flatMap(plan =>
  ["plan_1", "plan_2"].flatMap(record => (["success", "failure", "assisted"] as const).flatMap(outcome =>
    (["objective", "retreat"] as const).flatMap(battle => [1, 2, 4].map(seats => ({ warning, prep, plan, record, outcome, battle, seats }))))))));
it.each(templeCases)("temple warning:$warning/$prep/$plan/$record/$outcome/$battle/$seats", route => {
  const { state, trace } = walk(temple, start(temple, "manticore", route.prep === "brace" ? "thornguard" : "duskrunner", { island_warning_sent: route.warning }, route.seats), s => {
    const picks: Record<string, string> = { people: route.warning ? "warned" : "move", screen: route.seats === 1 ? "flat" : "tie", gear: route.prep, plan: route.plan, roof: route.plan === "push" ? "pole" : "basin", record: route.record };
    if (s.sceneId === "push_plan" || s.sceneId === "shelter_plan") return offered(s, "rope") ? "rope" : offered(s, "cover") ? "cover" : "ordinary";
    if (s.sceneId === "repair") return offered(s, "pack") ? "pack" : "leave";
    if (s.sceneId === "watch") return route.record === "plan_1" ? "signals" : "map";
    return picks[s.sceneId!];
  }, route.outcome, route.battle);
  const rope = route.prep === "rope" && route.outcome !== "failure";
  const cover = route.prep !== "rope";
  const fight = `fight_${route.plan}${rope ? "_rope" : cover ? "_cover" : ""}`;
  expect(trace.has(fight)).toBe(true);
  expect(trace.has("people_check") || trace.has("screen_relay")).toBe(!route.warning);
  expect(trace.has("short_line")).toBe(route.prep === "rope" && route.outcome === "failure");
  expect(trace.has("shelter_check")).toBe(route.prep === "cover");
  expect(trace.has("shelter_braced")).toBe(route.prep === "brace");
  expect(trace.has("repair_1")).toBe(route.battle === "retreat");
  expect(offered(trace.get("repair")!, "pack")).toBe(route.battle !== "retreat");
  expect(state.flags.temple_repair_gear_left === true).toBe(route.battle === "retreat");
  expect(state.flags.temple_damaged === true).toBe(route.battle === "retreat");
  expect(state.flags.temple_island_settled === true).toBe(route.battle !== "retreat" && route.plan === "shelter");
  expect(state.flags.temple_island_diverted === true).toBe(route.battle !== "retreat" && route.plan === "push");
  expect(trace.has("watch_signals")).toBe(route.record === "plan_1");
  expect(trace.has("watch_help")).toBe(route.record === "plan_1" && route.outcome !== "success");
  expect(trace.has("watch_map_help")).toBe(route.record === "plan_2" && route.outcome === "failure");
  expect(trace.get("ending")!.narration.includes("landing stays closed for repairs")).toBe(route.battle === "retreat");
  expect(trace.get("ending")!.narration.includes("spare boards and line stay")).toBe(route.battle === "retreat");
});
