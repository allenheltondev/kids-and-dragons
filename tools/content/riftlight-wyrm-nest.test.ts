/**
 * A Room Already Taken (riftlight-wyrm-nest), rewritten in November 2026 to
 * the pilot's bar (docs/campaigns/continental-rift/arc.md and
 * wyrm-nest-review.md). These tests protect what the party's choices change:
 *
 * - every success ending ticks every goal step, keeps only the Listening Chime,
 *   gives the readers a room and asks the campaign question;
 * - `wyrm_ally` is set exactly when the party chose to move the wyrm and then
 *   showed it the way home on the board; driving it off and losing never set it;
 * - force (pots, a crack in the ceiling, the deep sound answering) and
 *   understand (Flurry's blankets or the builders' sacks, a wary wyrm needing
 *   longer) each cost something the ending reads back;
 * - a poked wyrm, a flickering opening, the sacks or a botched sneak make the
 *   wyrm wary and take away the short hold; banging in time rattles it;
 * - a failed roll reroutes and costs something; a lost fight robs Flurry of
 *   her room and the builders of their tools, and the chapter still ends with
 *   the readers in a room.
 *
 * The fights take a declared outcome here; the boards are played turn by turn
 * in riftlight-strand-combat.test.ts.
 */
import { applyEffects, enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-wyrm-nest")!;
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  door: "chip_pass" | "chip_fail" | "squeeze_pass" | "squeeze_fail";
  tail: "pass" | "fail";
  pip: "talk_pass" | "talk_fail" | "grab_pass" | "grab_fail";
  look: "rope_pass" | "rope_fail" | "through_pass" | "through_fail";
  hide: "blocks_pass" | "blocks_fail" | "snowman_pass" | "snowman_fail";
  rest: "lore" | "tuft";
  plan: "pots_pass" | "pots_fail" | "roar_pass" | "blankets_success" | "blankets_failure" | "sacks";
  fight: "best" | "plain";
  battle: "held" | "driven" | "lost";
  after: "pass" | "fail";
  goodnight: boolean;
  carry: "carry_pass" | "carry_fail" | "tray_pass" | "tray_fail";
  wall: "read" | "rest";
  seats: 1 | 2 | 4;
}
const head = (s: string) => s.split("_")[0]!;
const won = (s: string) => /_(pass|success)$/.test(s);
const moving = (r: Route) => ["blankets_success", "blankets_failure", "sacks"].includes(r.plan);

function walk(route: Route, flags: Record<string, boolean> = {}, species: "manticore" | "kitsune" = "manticore", cls: "duskrunner" | "starweaver" = "duskrunner") {
  let state = start(chapter, species, cls, flags, route.seats);
  const trace = new Map<string, RunState>();
  const face = (pass: boolean) => (pass ? 20 : 1);
  const faces: Record<string, number> = {
    check_chip: face(won(route.door)), check_squeeze: face(won(route.door)), check_tail: face(route.tail === "pass"),
    check_pip: face(won(route.pip)), check_grab: face(won(route.pip)), check_rope: face(won(route.look)), check_through: face(won(route.look)),
    check_blocks: face(won(route.hide)), check_snowman: face(won(route.hide)), check_pots: face(won(route.plan)), check_roar: face(won(route.plan)),
    neighbor: face(route.after === "pass"), empty_room: face(route.after === "pass"), storeroom: face(route.after === "pass"),
    check_carry: face(won(route.carry)), check_tray: face(won(route.carry)),
  };
  const pick = (s: RunState): string => {
    const id = s.sceneId!;
    if (id === "deep_groan") return route.fight === "best" && offered(s, "clang") ? "clang" : "fight";
    if (id === "nest_made") return route.fight === "best" && offered(s, "calm") ? "calm" : "show";
    if (id === "room_won") return route.goodnight && offered(s, "goodbye") ? "goodbye" : "room";
    if (id === "opening") return cls === "starweaver" && offered(s, "read") ? "read" : head(route.look);
    const picks: Record<string, string> = {
      frozen_tunnel: head(route.door), pip_poke: head(route.pip) === "talk" ? "talk" : "grab", hide: head(route.hide), rest: route.rest,
      plan: moving(route) ? "move" : "drive", drive_prep: head(route.plan), move_prep: head(route.plan) === "sacks" ? "sacks" : "blankets",
      readers_come: head(route.carry), tuft_room: route.wall,
    };
    if (picks[id]) return picks[id]!;
    if (s.prompt?.kind !== "choice") throw new Error("Expected a choice");
    return s.prompt.options[0]!.id;
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const battle = route.battle === "held" && !scene.environment?.objectives?.length ? "driven" : route.battle;
      const branch = battle === "lost" ? scene.onDefeat : scene.onVictory;
      const held = battle === "held" ? scene.environment!.objectives![0]!.effects ?? [] : [];
      state = applyEffects(state, [...held, ...(branch.effects ?? [])], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, state.sceneId === "sneak_nest" && route.plan === "blankets_failure" ? "failure" : "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const id = pick(state);
      expect(offered(state, id), `${state.sceneId}/${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else state = send(state, { type: "ADVANCE" }, chapter);
  }
  trace.set(state.sceneId!, structuredClone(state));
  return { state, trace };
}

const product = <T extends Record<string, readonly unknown[]>>(axes: T) =>
  Object.entries(axes).reduce<Record<string, unknown>[]>((rows, [key, values]) =>
    rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);
const DEFAULT: Route = {
  door: "chip_pass", tail: "pass", pip: "talk_pass", look: "rope_pass", hide: "blocks_pass", rest: "lore", plan: "blankets_success",
  fight: "best", battle: "held", after: "pass", goodnight: true, carry: "carry_pass", wall: "read", seats: 1,
};
// The road in: everything that can make the wyrm wary before the plan...
const early = { door: ["chip_pass", "chip_fail", "squeeze_pass", "squeeze_fail"], tail: ["pass", "fail"], pip: ["talk_pass", "talk_fail", "grab_pass", "grab_fail"],
  look: ["rope_pass", "rope_fail", "through_pass", "through_fail"], hide: ["blocks_pass", "blocks_fail", "snowman_pass", "snowman_fail"], rest: ["lore", "tuft"],
  plan: ["blankets_success", "pots_pass"], seats: [1, 2, 4] } as const;
// ...and the plan, the fight and what follows it.
const late = { pip: ["talk_pass", "talk_fail"], look: ["rope_pass", "rope_fail"], plan: ["pots_pass", "pots_fail", "roar_pass", "blankets_success", "blankets_failure", "sacks"],
  fight: ["best", "plain"], battle: ["held", "driven", "lost"], after: ["pass", "fail"], goodnight: [true, false],
  carry: ["carry_pass", "carry_fail", "tray_pass", "tray_fail"], wall: ["read", "rest"], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(early), Object.keys(early)),
  ...pairwise(product(late), Object.keys(late), { together: [["pip", "look", "plan", "fight"], ["plan", "fight", "battle"]] }),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route through the wyrm's nest", () => {
  it.each(routes)("$door $tail $pip $look $hide $rest | $plan $fight $battle | $after $carry $wall, $seats seats", route => {
    const { state, trace } = walk(route);
    const move = moving(route);
    const hard = !won(route.pip) || !won(route.look) || route.plan === "sacks" || route.plan === "blankets_failure";
    const clang = route.plan === "pots_pass" || route.plan === "roar_pass";
    const lost = route.battle === "lost";
    const ally = move && route.battle === "held";

    // The beat: the readers have a room, whatever became of the wyrm.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.has("readers_come")).toBe(true);
    expect(trace.has("tuft_room")).toBe(true);

    // The world state the finale reads.
    expect(state.flags.wyrm_ally === true).toBe(ally);
    expect(state.narration.includes("the wyrm snores in its hollow")).toBe(ally);
    expect(state.narration.includes("The wyrm is gone from the glacier.")).toBe(!ally && !lost);
    expect(state.narration.includes("keeps its nest in Flurry's room")).toBe(lost);

    // Early misses cost something real.
    if (!won(route.door)) expect(trace.get("the_nest")!.party.reduce((n, p) => n + p.hp, 0)).toBe(trace.get("frozen_tunnel")!.party.reduce((n, p) => n + p.hp, 0) - 1);
    expect(trace.get("rest")!.narration.includes("glues her broken stool")).toBe(route.tail === "fail");
    expect(trace.has("pip_pokes")).toBe(!won(route.pip));
    expect(trace.has("flicker")).toBe(route.look === "rope_fail");
    expect(trace.has("slipped")).toBe(route.look === "through_fail");
    expect(trace.get("plan")!.narration.includes("The wyrm is wary now")).toBe(!won(route.pip) || !won(route.look));
    expect(trace.get("plan")!.narration.includes("push a wyrm, and it pushes back")).toBe(route.rest === "lore");

    // Force: loud, a crack, the deep sound; a good clang rattles the wyrm.
    expect(trace.has("deep_groan")).toBe(!move);
    if (!move) {
      expect(offered(trace.get("deep_groan"), "clang")).toBe(clang);
      expect(trace.has("fight_drive_clang")).toBe(clang && route.fight === "best");
      expect(trace.get("readers_come")!.narration).toContain("crack in the ceiling");
      expect(state.narration).toContain("LOUD WORKS");
    }

    // Understand: the nest costs Flurry's blankets or the builders' sacks, and a wary wyrm takes longer.
    if (move) {
      expect(offered(trace.get("nest_made"), "calm")).toBe(!hard);
      expect(trace.has("fight_move")).toBe(!hard && route.fight === "best");
      expect(trace.has("fight_move_long")).toBe(hard || route.fight === "plain");
      const room = trace.get("tuft_room")!.narration;
      expect(room.includes("There are no blankets")).toBe(route.plan !== "sacks");
      expect(room.includes("where their work sacks are")).toBe(route.plan === "sacks");
      expect(state.narration).toContain("SHOW, DON'T PUSH");
      expect(trace.has("deep_groan")).toBe(false);
    }

    // After the fight.
    expect(trace.has("nest_kept")).toBe(lost);
    expect(trace.has("storeroom")).toBe(lost);
    expect(trace.has("empty_room")).toBe(!lost);
    expect(trace.has("neighbor")).toBe(ally && route.goodnight);
    if (lost) {
      expect(trace.get("readers_come")!.narration).toContain("Smaller,");
      expect(trace.get("tuft_room")!.narration).toContain("The storeroom is very small.");
    }
    if (ally) expect(trace.get("readers_come")!.narration).toContain("It looks comfortable");
    expect(trace.has(route.wall === "read" ? "new_wall" : "walls_rest")).toBe(true);
    expect(trace.get("murmur_last")!.narration.includes("drawn the picture from the ice")).toBe(route.wall === "read");

    // The close: the campaign question, the chime and the ways on.
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");
    expect(state.narration).toContain("The Listening Chime leans toward the heart of the glacier.");
    expect(state.narration).toContain("the griffins at the Cairnstep will come");
    expect(state.narration).toContain("the reading room waits");
    expect(state.narration).not.toContain("another piece");
  });
});

it("a starweaver reads the opening instead of hanging on the rope, beside the ungated ways", () => {
  const { trace } = walk({ ...DEFAULT, look: "rope_fail" }, {}, "kitsune", "starweaver");
  expect(offered(trace.get("opening"), "read")).toBe(true);
  expect(offered(trace.get("opening"), "rope")).toBe(true);
  expect(offered(trace.get("opening"), "through")).toBe(true);
  expect(trace.has("star_read")).toBe(true);
  expect(trace.has("check_rope")).toBe(false);
  expect(trace.has("flicker")).toBe(false);
  expect(offered(trace.get("nest_made"), "calm")).toBe(true);
  const { trace: other } = walk(DEFAULT);
  expect(offered(other.get("opening"), "read")).toBe(false);
});

it("every authored outcome, for every species and class way, gives the readers a room", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["kitsune", "starweaver"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, {}, 1, 1);
    expect(ends.some(e => e.flags.wyrm_ally)).toBe(true);
    expect(ends.some(e => e.flags.nest_lost)).toBe(true);
    expect(ends.some(e => e.flags.nest_won && !e.flags.wyrm_ally)).toBe(true);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
      // Only a party that chose to move the wyrm can make it a neighbor.
      if (end.flags.wyrm_ally) expect(end.flags.nest_move).toBe(true);
    }
    expect(visited.has("star_read")).toBe(cls === "starweaver");
  }
});

it("the wyrm is the chapter's only journey flag, and a lost fight never sets it", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f))).toEqual(["wyrm_ally"]);
  const fights = Object.entries(chapter.scenes).filter(([, s]) => s.type === "encounter") as [string, Extract<(typeof chapter.scenes)[string], { type: "encounter" }>][];
  expect(fights.map(([id]) => id).sort()).toEqual(["fight_drive", "fight_drive_clang", "fight_move", "fight_move_long"]);
  for (const [id, fight] of fights) {
    expect(fight.autoResolve).toBeUndefined();
    expect(fight.onDefeat.goto).toBe("nest_kept");
    expect(JSON.stringify(fight.onDefeat)).not.toContain("wyrm_ally");
    const sets = JSON.stringify(fight.environment?.objectives ?? []).includes('"flag":"wyrm_ally"');
    expect(sets, id).toBe(id.startsWith("fight_move"));
  }
  const text = JSON.stringify(chapter.scenes).toLowerCase();
  for (const word of ["corvane", "emperor", "pangea", "crevasse"]) expect(text).not.toContain(word);
});

it("points at the convergence only for a party carrying another key's piece", () => {
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "kitsune", "starweaver", flags), "ending", context(chapter)).state.narration;
  expect(ending({})).not.toContain("another piece");
  expect(ending({ fragment_coast_learned: true })).toContain("Master Orin Vale will want to lay them side by side.");
  expect(ending({ fragment_sky_learned: true })).toContain("Master Orin Vale will want to lay them side by side.");
  expect(ending({ fragment_coast_learned: true, fragment_sky_learned: true }).match(/another piece/g)).toHaveLength(1);
});
