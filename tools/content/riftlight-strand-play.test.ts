import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
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
// Measured on the full product: every scene, flag and outcome here depends on at most two axes, except the
// shelf (kit + battle + table), so pairs are enough with that triple kept whole. KAD_FULL_MATRIX=1 runs all.
it.each(pairwise(nestCases, ["kit", "bed", "battle", "table", "outcome", "seats"], { together: [["kit", "battle", "table"]] }))("nest $kit/$bed/$battle/table:$table/$outcome/$seats", route => {
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
