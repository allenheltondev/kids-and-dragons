/**
 * The Borrowed Ruins (riftlight-bone-yard), rewritten in November 2026 as the
 * pilot for the campaign rewrite (docs/campaigns/continental-rift/arc.md and
 * bone-yard-review.md). These tests protect what the party's choices change,
 * not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step and the party leaves with only
 *   the Listening Chime (the Bone Yard returns whatever is taken);
 * - shoving the arch or helping it along changes the fight, the carving and
 *   Puddle's channel at the ending;
 * - letting Pip keep the chip puts him in the swarm, offers a rescue, and the
 *   chip goes home by itself;
 * - a failed roll reroutes and costs something, and the chapter still reaches
 *   its beat; a lost fight costs the drawing and the short way, and continues;
 * - the chapter sets no journey flag, and points at the convergence only for a
 *   party that carries another key's piece.
 *
 * Route walks play the real story controls through the engine: votes, dice at
 * a chosen face and interactions with real actions. Fights take a declared
 * outcome here; the boards themselves are played turn by turn in
 * riftlight-rescue-combat.test.ts.
 */
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-bone-yard")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  crossing: "rib_pass" | "rib_fail" | "wade_pass" | "wade_fail";
  crawler: "hum_pass" | "hum_fail" | "sneak_success" | "sneak_failure";
  pip: "talk_pass" | "talk_fail" | "let";
  look: "stair_pass" | "stair_fail" | "doors_pass" | "doors_fail";
  carving: "success" | "failure";
  opinion: "amazing" | "home";
  dam: "shove_pass" | "shove_fail" | "help_success" | "help_failure";
  court: "tear" | "pip";
  battle: "closed" | "scattered" | "lost";
  escape: "float" | "rim";
  tide: "leave_pass" | "leave_fail" | "watch_pass" | "watch_fail";
  give: "puddle" | "pip";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice.endsWith("_pass") || choice.endsWith("_success");
const head = (choice: string) => choice.split("_")[0]!;

/** Plays one route through the engine and keeps the state at every scene it passed. */
function walk(route: Route, flags: Record<string, boolean> = {}) {
  let state = start(chapter, "manticore", "duskrunner", flags, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_rib: face(route.crossing), check_wade: face(route.crossing), check_hum: face(route.crawler),
    check_pip: route.pip === "talk_pass" ? 20 : 1, check_stair: face(route.look), check_doors: face(route.look),
    check_shove: face(route.dam), catch_pip: 20, check_rim: 20, hurry_out: face(route.tide), check_tide: face(route.tide),
  };
  const picks: Record<string, string> = {
    rule: head(route.crossing), ruins_edge: head(route.crawler), pip_chip: route.pip === "let" ? "let" : "talk", explore: head(route.look),
    pip_idea: route.opinion, dam: head(route.dam), rest: head(route.tide), drawing: route.give, swarmed: route.escape,
    court_quick: route.court, court_grown: route.court,
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const branch = route.battle === "lost" ? scene.onDefeat : scene.onVictory;
      const won = route.battle === "closed" ? scene.environment?.objectives?.[0]?.effects ?? [] : [];
      const rescue = scene.environment?.rescue;
      const freed = route.battle !== "lost" && rescue && !Array.isArray(rescue) ? rescue.effects ?? [] : [];
      state = applyEffects(state, [...won, ...freed, ...(branch.effects ?? [])], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      const played = { carvings: route.carving, watch_lean: route.dam, sneak: route.crawler }[state.sceneId as "carvings"];
      state = finishInteraction(state, chapter, played === undefined || ok(played) || played === "success" ? "success" : "failure");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      const id = want && offered(state, want) ? want : state.prompt.options[0]!.id;
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
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
  crossing: "rib_pass", crawler: "hum_pass", pip: "talk_pass", look: "stair_pass", carving: "success", opinion: "home",
  dam: "help_success", court: "tear", battle: "closed", escape: "rim", tide: "leave_pass", give: "puddle", seats: 1,
};
// The decisions that change the fight and the ending, with the axes that meet in them in every combination...
const decisions = { pip: ["talk_pass", "talk_fail", "let"], dam: ["shove_pass", "shove_fail", "help_success", "help_failure"], court: ["tear", "pip"],
  battle: ["closed", "scattered", "lost"], escape: ["float", "rim"], tide: ["leave_pass", "leave_fail", "watch_pass", "watch_fail"],
  give: ["puddle", "pip"], seats: [1, 2, 4] } as const;
// ...and the early rolls and games, whose costs and reroutes are their own.
const early = { crossing: ["rib_pass", "rib_fail", "wade_pass", "wade_fail"], crawler: ["hum_pass", "hum_fail", "sneak_success", "sneak_failure"],
  look: ["stair_pass", "stair_fail", "doors_pass", "doors_fail"], carving: ["success", "failure"], opinion: ["amazing", "home"], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(decisions), Object.keys(decisions), { together: [["pip", "dam", "court", "battle"], ["dam", "battle", "escape"]] }),
  ...pairwise(product(early), Object.keys(early)),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route through the Borrowed Ruins", () => {
  it.each(routes)("$crossing $crawler $pip $look $carving $opinion $dam $court $battle/$escape $tide $give, $seats seats", route => {
    const { state, trace } = walk(route);
    const chip = route.pip !== "talk_pass";
    const forced = route.dam.startsWith("shove");
    const open = route.dam === "shove_pass" || route.dam === "help_success";
    const lost = route.battle === "lost";

    // The beat: the party reaches the end, every goal step ticked, nothing taken.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.has("same_stone")).toBe(true);

    // A failed crossing or crawler check costs something and reroutes.
    const crossed = trace.get("skull")!;
    expect(crossed.party.some(p => p.hp < p.character.maxHp)).toBe(!ok(route.crossing));
    expect(trace.has("crawler_tail")).toBe(!ok(route.crawler));
    expect(trace.get("rest")!.narration.includes("wearing her lunch")).toBe(!ok(route.crawler));
    expect(trace.has("doorway_nest")).toBe(!ok(route.look));
    expect(trace.has("doorway_step")).toBe(route.look === "doors_pass");
    expect(trace.has("stair_top")).toBe(route.look === "stair_pass");

    // Pip and the chip.
    expect(offered(trace.get(forced ? "court_quick" : "court_grown")!, "pip")).toBe(chip);
    const pulled = chip && route.court === "pip";
    expect(trace.has(forced ? (pulled ? "fight_quick_pip" : "fight_quick") : (pulled ? "fight_grown_pip" : "fight_grown"))).toBe(true);
    expect(trace.get("tide_turns")!.narration.includes("climbs out, hops down the path")).toBe(chip);
    if (!lost) expect(trace.get("court_after")!.narration.includes("kept his notebook")).toBe(chip && !pulled);
    expect(trace.get("dam")!.narration.includes(route.opinion === "amazing" ? "Lady Olivia would shove it" : "Can you ask an arch?")).toBe(true);

    // Force or understand: the fight, the carving and the channel.
    const fight = chapter.scenes[forced ? "fight_quick" : "fight_grown"]!;
    if (fight.type !== "encounter") throw new Error("Expected a fight");
    expect(fight.environment!.objectives![0]).toMatchObject({ kind: "close", turns: forced ? 2 : 3 });
    if (forced) expect(trace.get(route.dam === "shove_pass" ? "shoved" : "cracked")!.narration).toContain("drew it first");
    if (!lost) expect(trace.get("puddle_court")!.narration.includes("scraped arch")).toBe(forced);
    const ending = state.narration;
    expect(ending.includes("creeping back toward Puddle's channel")).toBe(route.dam === "shove_pass");
    expect(ending.includes("half of the cracked arch")).toBe(route.dam === "shove_fail");
    expect(ending.includes("it will stay that way")).toBe(route.dam === "help_success");
    expect(ending.includes("By morning it will run")).toBe(route.dam === "help_failure");

    // The fight's outcomes.
    expect(ending.includes("The tear still flickers")).toBe(route.battle !== "closed");
    expect(trace.has("swarmed")).toBe(lost);
    expect(trace.has("puddle_court")).toBe(!lost);
    if (lost) {
      expect(offered(trace.get("swarmed")!, "float")).toBe(open);
      expect(trace.has("float_out")).toBe(open && route.escape === "float");
      expect(ending).toContain("belongs to the crawlers");
      expect(trace.get("drawing")!.narration).toContain("still under three crawlers");
    } else {
      expect(ending).not.toContain("belongs to the crawlers");
    }

    // The tide and who keeps the carving.
    expect(trace.has("check_tide")).toBe(head(route.tide) === "watch");
    expect(trace.get("watch_tide")?.narration.includes("points straight upriver") ?? false).toBe(head(route.tide) === "watch");
    expect(trace.has("cut_off")).toBe(route.tide === "leave_fail");
    const out = trace.get("tide_turns")!;
    expect(out.party.some(p => p.hp < p.character.maxHp)).toBe(route.tide === "watch_fail");
    expect(ending.includes("Pip is running to find the Riftseekers")).toBe(route.give === "pip");
    expect(trace.has(route.give === "pip" ? "to_pip" : "to_puddle")).toBe(true);
    expect(ending).toContain("Something is moving the land.");
  });
});

it("every authored outcome, for every species and class shortcut, reaches the beat with nothing taken", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, {}, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
    }
    for (const id of ["court_after", "swarmed", "check_rim", "float_out", "same_stone", "cut_off"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
    expect(visited.has("fly_over")).toBe(species === "griffin");
    expect(visited.has("bigfoot_lift")).toBe(species === "bigfoot");
    expect(visited.has("manticore_talk")).toBe(species === "manticore");
    expect(visited.has("lullaby")).toBe(cls === "songkeeper");
  }
});

it("a bigfoot's lift is still a forced arch: quick fight, scraped carving, a channel that creeps shut", () => {
  let state = start(chapter, "bigfoot", "thornguard");
  state = enterScene(state, "dam", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: "bigfoot" }, chapter);
  expect(state.sceneId).toBe("bigfoot_lift");
  expect(state.flags).toMatchObject({ bones_forced: true, bones_channel_open: true });
  expect(state.flags.bones_channel_lasting).toBeUndefined();
  state = send(state, { type: "CHOOSE", choiceId: "in" }, chapter);
  expect(state.sceneId).toBe("court_quick");
});

it("sets no journey flag, and points at the convergence only for a party carrying another key's piece", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set<string>();
  const json = JSON.stringify(chapter);
  for (const m of json.matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)) written.add(m[1]!);
  for (const f of written) expect(journey.has(f), f).toBe(false);
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "kitsune", "starweaver", flags), "ending", context(chapter)).state;
  expect(ending({}).narration).not.toContain("another piece");
  expect(ending({ fragment_paths_learned: true }).narration).toContain("another piece");
  expect(ending({ fragment_sky_learned: true }).narration).toContain("another piece");
  expect(ending({ fragment_paths_learned: true, fragment_sky_learned: true }).narration.match(/another piece/g)).toHaveLength(1);
  for (const n of [ending({}).narration]) {
    expect(n).toContain("Old Ossley");
    expect(n).toContain("What is it? And can you put things right?");
  }
});

it("the chapter's discovery is one p1 scene, on every path, with the match said plainly", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1);
  expect(p1.map(([id]) => id)).toEqual(["same_stone"]);
  const narration = (p1[0]![1] as { narration: string }).narration;
  expect(narration).toContain("buried bridge");
  expect(narration).toContain("came from the same old place");
  const { ends } = allPaths(chapter, "manticore", "duskrunner");
  expect(ends.every(e => e.flags.bones_read_carvings)).toBe(true);
});

it("losing the fight is never a setback and never a retry", () => {
  const fights = Object.entries(chapter.scenes).filter(([, s]) => s.type === "encounter") as [string, Extract<Chapter["scenes"][string], { type: "encounter" }>][];
  expect(fights.map(([id]) => id).sort()).toEqual(["fight_grown", "fight_grown_pip", "fight_quick", "fight_quick_pip"]);
  for (const [, fight] of fights) {
    expect(fight.autoResolve).toBeUndefined();
    expect(fight.onDefeat.goto).toBe("swarmed");
    expect(fight.onDefeat.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "setFlag", flag: "bones_retreat" }),
      expect.objectContaining({ type: "setFlag", flag: "bones_drawing_lost" }),
    ]));
    expect(fight.onVictory.goto).toBe("court_after");
  }
  expect(Object.values(chapter.scenes).filter(s => s.type === "story" && s.choices.length === 0)).toHaveLength(1);
});
