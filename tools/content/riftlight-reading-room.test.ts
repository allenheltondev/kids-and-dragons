/**
 * The River in the Memory Ice (riftlight-reading-room), rewritten in November
 * 2026 to the pilot's bar (docs/campaigns/continental-rift/arc.md and
 * memory-paths-continuity-review.md). These tests protect what the party's
 * choices change, not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step, keeps only the Listening Chime
 *   and learns the Paths fragment (`fragment_paths_learned`), the chapter's
 *   only journey flag;
 * - the p1 is its own scene with the fact said plainly, and Elder Murmur's
 *   warning follows it;
 * - noise on the way in (a squeaky stair, a snapped icicle, a yelp, a dropped
 *   lamp or pebble) clouds the old wall and takes away the easy wait;
 * - ringing the chime at the ice (Pip's Olivia idea) is quick but costs the
 *   slow copy and frosts the old wall over;
 * - copying first cracks the slates; saving the slates first costs a rushed
 *   copy but gives Murmur a hundred years of proof;
 * - how the party crossed the wrong valley, and whether it saw the buried
 *   bridge, each give a different proof, and only a clean copy can use the
 *   crossing;
 * - a failed roll reroutes and costs something, and the chapter still reaches
 *   its beat.
 */
import { applyIntent, enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-reading-room")!;
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  stair: "tiptoe_pass" | "tiptoe_fail" | "sled_pass" | "sled_fail";
  icicle: "hat_pass" | "hat_fail" | "snap";
  way: "tunnel_success" | "tunnel_failure" | "ledge_pass" | "ledge_fail";
  floor: "drop" | "listen";
  wall: "ring" | "wait_success" | "wait_failure" | "best_success" | "best_failure";
  hush: "pass" | "fail";
  first: "copy_success" | "copy_failure" | "slow_success" | "slates_pass_success" | "slates_fail_failure";
  proof: "roll_pass" | "roll_fail" | "murmur" | "free";
  tuft: "help_pass" | "help_fail" | "hat";
  pip: "no" | "yes";
  rest: "tale" | "mend" | "pack";
  out: "pass" | "fail";
  high: boolean;
  coast: boolean;
  seats: 1 | 2 | 4;
}
const head = (s: string) => s.split("_")[0]!;
const won = (s: string) => /_(pass|success)$/.test(s);

/** Plays one route through the engine and keeps the state at every scene it passed. */
function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", { valley_crossed_high: route.high, fragment_coast_learned: route.coast }, route.seats);
  const trace = new Map<string, RunState>();
  const face = (pass: boolean) => (pass ? 20 : 1);
  const faces: Record<string, number> = {
    check_tiptoe: face(won(route.stair)), check_sled: face(won(route.stair)), check_icicle: face(route.icicle === "hat_pass"),
    check_ledge: face(route.way === "ledge_pass"), hush_pip: face(route.hush === "pass"), check_slates: face(route.first.startsWith("slates_pass")),
    check_match: face(route.proof !== "roll_fail"), check_tuft: face(route.tuft === "help_pass"), way_out: face(route.out === "pass"),
  };
  const games: Record<string, boolean> = {
    drips: route.way === "tunnel_success", wait_slow: route.wall.endsWith("success"), wait_long: route.wall.endsWith("success"),
    wait_knack: route.wall.endsWith("success"), copy_flash: route.first.endsWith("success"), copy_steady: true, copy_late: route.first.endsWith("success"),
  };
  const pick = (s: RunState): string => {
    const id = s.sceneId!;
    const first = (...ids: string[]) => ids.find(i => offered(s, i))!;
    if (id === "old_wall") return route.wall === "ring" ? "ring" : route.wall.startsWith("wait") ? "wait" : first("rhythm", "clear", "wait");
    if (id === "shaking") return route.first.startsWith("slates") ? "slates" : route.first === "slow_success" ? first("copy_slow", "copy") : "copy";
    if (id === "compare") return route.proof === "free" ? first("bridge", "high", "low", "slates", "match") : route.proof === "murmur" ? "murmur" : "match";
    if (id === "tuft_worry") return route.tuft === "hat" ? first("hat", "help") : "help";
    if (id === "rest") return route.rest === "mend" ? first("mend", "tale") : route.rest;
    const picks: Record<string, string> = { stair: head(route.stair), tuft: route.icicle === "snap" ? "snap" : "hat", ask_wall: head(route.way), listening_floor: route.floor, pip_idea: route.pip };
    if (picks[id]) return picks[id]!;
    if (s.prompt?.kind !== "choice") throw new Error("Expected a choice");
    return s.prompt.options[0]!.id;
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") state = finishInteraction(state, chapter, games[state.sceneId!] === false ? "failure" : "success");
    else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    else if (state.prompt?.kind === "choice") {
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
  stair: "tiptoe_pass", icicle: "hat_pass", way: "tunnel_success", floor: "listen", wall: "best_success", hush: "pass", first: "copy_success",
  proof: "free", tuft: "hat", pip: "no", rest: "tale", out: "pass", high: true, coast: false, seats: 1,
};
// The noise on the way in, and what it does to the old wall...
const way = { stair: ["tiptoe_pass", "tiptoe_fail", "sled_pass", "sled_fail"], icicle: ["hat_pass", "hat_fail", "snap"], way: ["tunnel_success", "tunnel_failure", "ledge_pass", "ledge_fail"],
  floor: ["drop", "listen"], wall: ["ring", "wait_success", "wait_failure", "best_success", "best_failure"], seats: [1, 2, 4] } as const;
// ...and the decisions after the river: force, priority, proof and Pip.
const after = { wall: ["ring", "best_success"], hush: ["pass", "fail"], first: ["copy_success", "copy_failure", "slow_success", "slates_pass_success", "slates_fail_failure"],
  proof: ["roll_pass", "roll_fail", "murmur", "free"], tuft: ["help_pass", "help_fail", "hat"], pip: ["no", "yes"], rest: ["tale", "mend", "pack"], out: ["pass", "fail"],
  high: [true, false], coast: [true, false], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(way), Object.keys(way), { together: [["stair", "icicle", "way", "floor"]] }),
  ...pairwise(product(after), Object.keys(after), { together: [["wall", "first", "proof"], ["first", "proof", "high", "coast"]] }),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route through the reading room", () => {
  it.each(routes)("$stair $icicle $way $floor $wall | $hush $first $proof | $tuft $pip $rest $out | high:$high coast:$coast, $seats seats", route => {
    const { state, trace } = walk(route);
    const cloudy = !won(route.stair) || route.icicle === "snap" || route.way === "tunnel_failure" || route.way === "ledge_fail" || route.floor === "drop";
    const forced = route.wall === "ring";
    const slatesFirst = route.first.startsWith("slates");

    // The beat: the river in the memory ice, and the Paths fragment, on every road.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.flags.fragment_paths_learned).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.has("old_river")).toBe(true);
    expect(trace.has("deep_sound")).toBe(true);

    // How you crossed the wrong valley is remembered at the door.
    expect(trace.get("pip_here")!.narration).toContain(route.high ? "You crossed high, over the rocks" : "You crossed low, by the water");

    // Noise clouds the old wall: the easy wait is gone, the hard one stays.
    expect(trace.get("room")!.narration.includes("pictures shiver and blur")).toBe(!won(route.stair));
    expect(offered(trace.get("old_wall"), "clear")).toBe(!cloudy);
    expect(offered(trace.get("old_wall"), "wait")).toBe(true);
    expect(offered(trace.get("old_wall"), "rhythm")).toBe(route.floor === "listen");
    expect(trace.has("snap_icicle")).toBe(route.icicle === "snap");
    expect(trace.has("yelp")).toBe(route.way === "tunnel_failure");
    expect(trace.has("lamp_fall")).toBe(route.way === "ledge_fail");
    if (route.icicle === "hat_fail") {
      const before = trace.get("check_icicle")!, after = trace.get("ask_wall")!;
      const total = (s: RunState) => s.party.reduce((n, p) => n + p.hp, 0);
      expect(total(after)).toBe(total(before) - 1);
    }

    // Force or understand at the old wall.
    expect(trace.has("ring_chime")).toBe(forced);
    expect(offered(trace.get("shaking"), "copy_slow")).toBe(!forced);
    expect(trace.get("old_river")!.narration.includes("In the chime's flash")).toBe(forced);
    expect(trace.get("rest")!.narration.includes(forced ? "frosted white" : "still clear")).toBe(true);
    if (route.wall.endsWith("failure")) {
      const before = trace.get(trace.has("wait_knack") ? "wait_knack" : trace.has("wait_slow") ? "wait_slow" : "wait_long")!;
      expect(trace.get("old_river")!.party.every((p, i) => p.hp === before.party[i]!.hp - 1)).toBe(true);
    }
    if (route.hush === "fail") expect(trace.get("shaking")!.party.some(p => p.hp < trace.get("hush_pip")!.party.find(q => q.playerId === p.playerId)!.hp)).toBe(true);

    // The river or the slates first.
    expect(trace.has("slates_broken")).toBe(!slatesFirst);
    expect(trace.has("copy_late")).toBe(slatesFirst);
    expect(offered(trace.get("compare"), "slates")).toBe(slatesFirst);
    expect(offered(trace.get("rest"), "mend")).toBe(!slatesFirst);
    expect(trace.get("rest")!.narration.includes(slatesFirst ? "stack of slates you saved" : "cracked slates out on a blanket")).toBe(true);

    // The proof: a clean copy can use the crossing; the bridge only if you saw it.
    const clean = trace.get("compare")!.narration.includes("Your copy is clear");
    expect(clean).toBe(route.first.endsWith("success"));
    expect(offered(trace.get("compare"), "high")).toBe(clean && route.high);
    expect(offered(trace.get("compare"), "low")).toBe(clean && !route.high);
    expect(offered(trace.get("compare"), "bridge")).toBe(route.coast);
    expect(trace.get("old_river")!.narration.includes("buried bridge")).toBe(route.coast);
    const unsure = route.proof === "murmur" || route.proof === "roll_fail";
    expect(trace.has("match_unsure")).toBe(unsure);
    expect(trace.get("pip_idea")!.narration.includes("His own sketch sits on Murmur's shelf")).toBe(unsure);
    expect(state.narration.includes("two rivers in it now")).toBe(trace.has("bridge_pattern"));

    // Flurry, and the wyrm news that leads on.
    const brave = route.tuft === "help_pass" || (route.tuft === "hat" && route.icicle === "hat_pass");
    expect(offered(trace.get("tuft_worry"), "hat")).toBe(route.icicle === "hat_pass");
    expect(state.narration.includes("ask that wyrm to move")).toBe(brave);
    expect(state.narration.includes("hides behind Murmur's scarves")).toBe(!brave);

    // Pip and Lady Olivia's idea.
    expect(state.narration.includes(route.pip === "yes" ? "The letter says RIVERS" : "Ask the river first?")).toBe(true);

    // The close: the piece, the chime and the campaign question, every time.
    expect(state.narration).toContain("A frost wyrm has curled up in your new room");
    expect(state.narration).toContain("leans down, toward the oldest ice");
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");
  });
});

it("every authored outcome, for every species and class way, reaches the beat and the Paths fragment", () => {
  for (const [species, cls, flags] of [
    ["manticore", "duskrunner", {}], ["griffin", "duskrunner", { valley_crossed_high: true }], ["unicorn", "songkeeper", { fragment_coast_learned: true }],
    ["kitsune", "starweaver", { valley_crossed_high: true, fragment_coast_learned: true }],
  ] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, flags, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.flags.fragment_paths_learned).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
    }
    expect(visited.has("glide")).toBe(species === "griffin");
    expect(visited.has("song_still")).toBe(cls === "songkeeper");
    expect(visited.has("bridge_pattern")).toBe("fragment_coast_learned" in flags);
    expect(visited.has("match_high")).toBe("valley_crossed_high" in flags);
    expect(visited.has("match_low")).toBe(!("valley_crossed_high" in flags));
    for (const id of ["match_unsure", "old_slates", "slates_broken", "copy_late", "ring_chime", "wait_long", "wait_slow", "wait_knack"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
  }
});

it("the chapter's discovery is one p1 scene, with the fact said plainly, and Murmur's warning beside it", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1);
  expect(p1.map(([id]) => id)).toEqual(["old_river"]);
  const river = chapter.scenes.old_river!;
  if (river.type !== "story") throw new Error("Expected a story scene");
  expect(river.narration).toContain("The memory ice shows the river leaving by a different valley.");
  expect(river.choices.map(c => c.goto)).toEqual(["deep_sound"]);
  const warning = chapter.scenes.deep_sound!;
  if (warning.type !== "story") throw new Error("Expected a story scene");
  expect(warning.narration).toContain("\"Do not shout near the old ice,\" she whispers. \"You don't know what you might wake.\"");
  // Witnessed, never explained: nobody is named, and the protected summer crevasse stays untouched.
  const text = JSON.stringify(chapter.scenes);
  for (const word of ["Corvane", "emperor", "Pangea", "crevasse", "summer"]) expect(text.toLowerCase()).not.toContain(word.toLowerCase());
});

it("sets only the Paths fragment of the journey flags, and the Coast callback has one real producer", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f))).toEqual(["fragment_paths_learned"]);
  const producers = [...chapters.values()].filter(c => JSON.stringify(c).includes('"type":"setFlag","flag":"fragment_coast_learned"')).map(c => c.id);
  expect(producers).toEqual(["riftlight-buried-bridge"]);
  expect(JSON.stringify(campaign.graph)).not.toContain('"flag":"fragment_coast_learned","value":true');
});

it("a quiet way in earns a wider window at the old wall than a noisy one", () => {
  const hits: Record<string, boolean[]> = {};
  for (const scene of ["wait_long", "wait_slow", "wait_knack"]) {
    hits[scene] = [];
    for (const position of [0.62, 0.7]) {
      let state = enterScene(start(chapter, "kitsune", "starweaver"), scene, context(chapter)).state;
      if (state.prompt?.kind !== "interaction") throw new Error("Expected interaction");
      const actor = state.prompt.actorId;
      const base = { openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt };
      state = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "start", relaxed: false } }, context(chapter)).state;
      const stopped = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "stop", position } }, context(chapter));
      expect(stopped.error).toBeUndefined();
      if (stopped.state.prompt?.kind !== "interaction") throw new Error("Expected result");
      hits[scene]!.push(stopped.state.prompt.outcome === "success");
    }
  }
  expect(hits).toEqual({ wait_long: [false, false], wait_slow: [true, false], wait_knack: [true, true] });
});
