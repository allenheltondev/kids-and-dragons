/**
 * The Temple in the Squall (riftlight-squall-temple), the Wandering Sky's
 * strand end, rewritten in November 2026 to the Borrowed Ruins pilot's bar
 * (docs/campaigns/continental-rift/arc.md and squall-temple-review.md). These
 * tests protect what the party's choices change:
 *
 * - every success ending ticks every goal step and keeps only the chime;
 * - what the island sent ahead (a warning in time, a late warning, or the
 *   welcome song) changes who is outside and which preparation is already
 *   done, and Tumble's saved letters put her in the story;
 * - the bell or the keepers first: the silent bell brings the whole swarm;
 * - push or let it settle, and win or lose the landing fight: only a settled
 *   island sets temple_island_settled, only a lost fight sets temple_damaged;
 * - a failed roll reroutes and costs something, and the chapter still ends on
 *   its beat; a lost fight robs the bell or breaks the landing, and goes on.
 *
 * Fights take a declared outcome here; riftlight-temple-combat.test.ts plays
 * the boards turn by turn.
 */
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-squall-temple")!;
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
type Battle = "objective" | "driven" | "lost";

interface Route {
  message: "prepared" | "late" | "welcome";
  letters: boolean;
  skiff: "pass" | "fail";
  first: "bell" | "keepers";
  bell: Battle;
  rescue: "chain_pass" | "chain_fail" | "climb_pass" | "climb_fail" | "tumble";
  knot: "knot_pass" | "knot_fail" | "stay";
  reach: "jump_pass" | "jump_fail" | "plank_pass" | "plank_fail" | "tumble";
  pip: "shove" | "watch";
  talk: "brave" | "ask";
  plan: "push" | "settle";
  prep: "ready" | "pass" | "fail";
  battle: Battle;
  home: "hum_pass" | "hum_fail" | "sweep_pass" | "sweep_fail";
  line: "pulled" | "home";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice.endsWith("_pass") || choice === "pass";
const head = (choice: string) => choice.split("_")[0]!;
const messageFlags = (m: Route["message"]): Record<string, boolean> => m === "prepared" ? { island_warning_sent: true } : m === "late" ? { island_warning_sent: true, island_relay_delayed: true } : {};

/** Plays one route through the engine and keeps the state at every scene it passed. */
function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", { ...messageFlags(route.message), island_messages_saved: route.letters }, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_skiff: face(route.skiff), tower_stairs: 20, check_chain: face(route.rescue), check_climb: face(route.rescue), check_knot: face(route.knot),
    check_jump: face(route.reach), check_plank: face(route.reach), check_hop: 20,
    check_poles: face(route.prep), check_cushions: face(route.prep), check_hum: face(route.home), check_sweep: face(route.home),
  };
  const ready = route.prep === "ready";
  const picks: Record<string, string> = {
    first: route.first, landing: head(route.rescue), keepers_in: head(route.knot), pip_gone: head(route.reach), pip_found: route.pip,
    towels: route.talk, rest: route.plan, push_plan: ready ? "ready" : "haul", shelter_plan: ready ? "cleared" : "pad",
    crawlers_home: head(route.home), farewell: route.line,
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const battle = state.sceneId === "fight_bell" ? route.bell : route.battle;
      const branch = battle === "lost" ? scene.onDefeat : scene.onVictory;
      const won = battle === "objective" ? scene.environment?.objectives?.[0]?.effects ?? [] : [];
      state = applyEffects(state, [...won, ...(branch.effects ?? [])], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      let want = picks[state.sceneId!];
      if (state.sceneId === "bell_rung" || state.sceneId === "clapper_gone") want = offered(state, "hall") ? "hall" : "landing";
      if (state.sceneId === "approach_push" || state.sceneId === "approach_shelter") want = offered(state, "dizzy") ? "dizzy" : "go";
      expect(!want || offered(state, want), `${state.sceneId}/${want}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: want ?? state.prompt.options[0]!.id }, chapter);
    } else {
      expect(state.prompt?.kind, state.sceneId!).not.toBe("interaction");
      state = send(state, { type: "ADVANCE" }, chapter);
    }
  }
  trace.set(state.sceneId!, structuredClone(state));
  return { state, trace };
}

const product = <T extends Record<string, readonly unknown[]>>(axes: T) =>
  Object.entries(axes).reduce<Record<string, unknown>[]>((rows, [key, values]) =>
    rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);
const valid = (r: Route) =>
  (r.rescue !== "tumble" || r.letters) && (r.reach !== "tumble" || r.letters) &&
  (r.prep !== "ready" || (r.plan === "push" ? r.message === "prepared" : r.message === "welcome"));
const DEFAULT: Route = {
  message: "late", letters: false, skiff: "pass", first: "bell", bell: "objective", rescue: "chain_pass", knot: "stay", reach: "jump_pass",
  pip: "watch", talk: "brave", plan: "push", prep: "pass", battle: "objective", home: "hum_pass", line: "pulled", seats: 1,
};
const matrix = (axes: Record<string, readonly unknown[]>, together?: string[][]) =>
  pairwise(product(axes).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid) as unknown as Record<string, unknown>[], Object.keys(axes), { together }) as unknown as Route[];
const routes: Route[] = [
  // What the island sent, which job comes first, and the two fights.
  ...matrix({ message: ["prepared", "late", "welcome"], letters: [false, true], first: ["bell", "keepers"], bell: ["objective", "driven", "lost"],
    plan: ["push", "settle"], prep: ["ready", "pass", "fail"], battle: ["objective", "driven", "lost"], seats: [1, 2, 4] },
    [["message", "plan", "prep"], ["first", "bell", "plan", "battle"]]),
  // The rescues, Pip on the island, and the crawlers going home.
  ...matrix({ message: ["prepared", "late", "welcome"], letters: [false, true], skiff: ["pass", "fail"], first: ["bell", "keepers"],
    rescue: ["chain_pass", "chain_fail", "climb_pass", "climb_fail", "tumble"], knot: ["knot_pass", "knot_fail", "stay"],
    reach: ["jump_pass", "jump_fail", "plank_pass", "plank_fail", "tumble"], pip: ["shove", "watch"], talk: ["brave", "ask"],
    home: ["hum_pass", "hum_fail", "sweep_pass", "sweep_fail"], line: ["pulled", "home"], seats: [1, 2, 4] }),
];

describe("every route through the temple in the squall", () => {
  it.each(routes)("$message letters:$letters $first/$bell $rescue $knot $reach $pip $talk $plan/$prep/$battle $home $line, $seats seats", route => {
    const { state, trace } = walk(route);
    const prepared = route.message === "prepared";
    const bellRang = route.first === "bell" && route.bell !== "lost";
    const lost = route.battle === "lost";

    // The beat: the temple safe or closed for repairs, every keeper dry, the squall seen through.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.get("tear")!.narration).toContain("far away on the coast");
    expect(trace.get("tear")!.narration).toContain("toward the glacier");

    // What the island sent ahead.
    const arrival = trace.get("arrival")!.narration;
    expect(arrival.includes("came in time")).toBe(prepared);
    expect(arrival.includes("only just got here")).toBe(route.message === "late");
    expect(arrival.includes("welcome song")).toBe(route.message === "welcome");
    if (trace.has("bell_rung") || trace.has("clapper_gone")) expect(offered(trace.get("bell_rung") ?? trace.get("clapper_gone"), "hall")).toBe(prepared);
    expect(trace.has("keepers_soaked")).toBe(route.first === "bell" && !prepared);
    if (trace.has("push_plan")) expect(offered(trace.get("push_plan"), "ready")).toBe(prepared);
    if (trace.has("shelter_plan")) expect(offered(trace.get("shelter_plan"), "cleared")).toBe(route.message === "welcome");
    expect(trace.has(route.plan === "push" ? "check_poles" : "check_cushions")).toBe(route.prep !== "ready");

    // Tumble is in the story only if her letters were saved on the lookout.
    expect(trace.get("tear")!.narration.includes("Tumble the courier")).toBe(route.letters);
    expect(offered(trace.get("pip_gone"), "tumble")).toBe(route.letters);
    if (trace.has("landing")) expect(offered(trace.get("landing"), "tumble")).toBe(route.letters);
    expect(state.narration.includes(route.letters ? "waited all evening" : "letters finally dry")).toBe(true);

    // The bell or the keepers first: the keepers' party loses the bell, unless the knot holds, and meets the whole swarm.
    expect(trace.has("landing")).toBe(route.first === "keepers");
    expect(trace.has("fight_bell")).toBe(route.first === "bell");
    expect(trace.has("clapper_gone")).toBe(route.first === "bell" && route.bell === "lost");
    expect(offered(trace.get(route.plan === "push" ? "approach_push" : "approach_shelter"), "dizzy")).toBe(bellRang);
    const swarm = !bellRang;
    expect(trace.has(`fight_${route.plan === "push" ? "push" : "shelter"}${swarm ? "_swarm" : ""}`)).toBe(true);
    const heard = bellRang || (route.first === "keepers" && route.knot === "knot_pass");
    expect(state.narration.includes("bell was silent tonight")).toBe(!heard);

    // Pip's push and what you tell him.
    expect(trace.get("rest")!.narration.includes(route.pip === "watch" ? "It's tired." : "All together this time.")).toBe(true);
    expect(state.narration.includes("just as he promised")).toBe(route.talk === "ask");

    // Push or settle, win or lose: the contract flags.
    expect(state.flags.temple_damaged === true).toBe(lost);
    expect(state.flags.temple_island_settled === true).toBe(!lost && route.plan === "settle");
    expect(trace.has("damaged")).toBe(lost);
    expect(trace.has("pushed")).toBe(!lost && route.plan === "push");
    expect(trace.has("settled")).toBe(!lost && route.plan === "settle");
    if (trace.has("settled")) {
      const soft = route.prep === "ready" || route.prep === "pass";
      expect(trace.get("settled")!.narration.includes("not one board cracks")).toBe(soft);
      expect(trace.get("settled")!.narration.includes("rail bends flat")).toBe(!soft);
    }
    if (!lost) expect(trace.get(route.plan === "push" ? "pushed" : "settled")!.narration.includes("clatter back toward their tear")).toBe(route.battle === "objective");
    expect(state.narration.includes("closed for repairs")).toBe(lost);
    expect(state.narration.includes("drifts on, still pulled")).toBe(!lost && route.plan === "push");
    expect(state.narration.includes("a neighbor that knocks")).toBe(!lost && route.plan === "settle");

    // The crawlers go home, all but one if the hum or the broom slips.
    expect(state.flags.temple_crawler_stays === true).toBe(route.home.endsWith("_fail"));
    expect(state.narration.includes("bell crawler clicks goodbye")).toBe(route.home.endsWith("_fail"));
    expect(trace.has(route.line === "pulled" ? "clove_pulled" : "clove_home")).toBe(true);

    // The close asks the campaign question with the temple's piece, and points down the graph's exits.
    expect(state.narration).toContain("the pull reaches everywhere");
    expect(state.narration).toContain("Cairnstep");
    expect(state.narration).toContain("What is it? And can you put things right?");
  });
});

it("every authored outcome, for every species and class shortcut, reaches the beat", () => {
  for (const [species, cls, flags] of [["manticore", "duskrunner", {}], ["kitsune", "starweaver", { island_warning_sent: true }], ["bigfoot", "thornguard", { island_messages_saved: true }], ["griffin", "songkeeper", { island_warning_sent: true, island_relay_delayed: true }]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, flags, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
    }
    for (const id of ["clapper_gone", "keepers_soaked", "keepers_in", "damaged", "pushed", "settled", "pip_watch"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
    expect(visited.has("foxfire")).toBe(species === "kitsune");
    expect(visited.has("brace")).toBe(cls === "thornguard");
    expect(visited.has("fly_pip")).toBe(species === "griffin");
    expect(visited.has("tumble_lift")).toBe("island_messages_saved" in flags);
  }
});

it("writes only the contract's two temple flags, where the finale reads them", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["temple_damaged", "temple_island_settled"]);
  const fights = Object.entries(chapter.scenes).filter(([id, s]) => s.type === "encounter" && id !== "fight_bell") as [string, Extract<Chapter["scenes"][string], { type: "encounter" }>][];
  expect(fights.map(([id]) => id).sort()).toEqual(["fight_push", "fight_push_swarm", "fight_shelter", "fight_shelter_swarm"]);
  for (const [id, fight] of fights) {
    expect(fight.onDefeat.goto).toBe("damaged");
    expect(fight.onDefeat.effects).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setFlag", flag: "temple_damaged" })]));
    expect(JSON.stringify(fight.onDefeat)).not.toContain("temple_island_settled");
    expect(fight.onVictory.goto).toBe(id.startsWith("fight_push") ? "pushed" : "settled");
    expect(JSON.stringify(fight.onVictory).includes("temple_island_settled")).toBe(id.startsWith("fight_shelter"));
  }
  // Never a setback, never a retry: one ending, and every fight goes on.
  expect(Object.values(chapter.scenes).filter(s => s.type === "story" && s.choices.length === 0)).toHaveLength(1);
});

it("the ending points at the convergence only for a party carrying another key's piece", () => {
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "kitsune", "starweaver", flags), "ending", context(chapter)).state.narration;
  expect(ending({})).not.toContain("another piece");
  expect(ending({ fragment_paths_learned: true })).toContain("another piece");
  expect(ending({ fragment_coast_learned: true })).toContain("another piece");
});
