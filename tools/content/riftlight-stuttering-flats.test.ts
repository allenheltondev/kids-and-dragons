/**
 * The Stuttering Flats (riftlight-stuttering-flats), rewritten in November 2026
 * for the campaign rewrite (docs/campaigns/continental-rift/arc.md and
 * stuttering-flats-review.md). These tests protect what the party's choices and
 * rolls change, not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step and sends the goat home, with
 *   only the chime carried, and asks the campaign question with this piece;
 * - reading the blink, ringing the chime, hauling or floating the goat each
 *   change the crossing's options (the long blink, the held door, the float);
 * - a missed crossing reroutes through the herder stepping onto the flats, and
 *   a second miss costs her boot; a missed grab costs Puddle's lunch, a missed
 *   shout costs Fen's net; the ending reads them back;
 * - the close sets up The Borrowed Ruins: the Bone Yard, introduced in words,
 *   and something landing on Puddle's home channel.
 */
import { enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-stuttering-flats")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
const ok = (choice: string) => choice.endsWith("_pass") || choice.endsWith("_success") || choice === "pass";
const head = (choice: string) => choice.split("_")[0]!;

type Route = {
  read: "watch_success" | "watch_failure" | "toss_pass" | "toss_fail";
  chime: "ring" | "quiet";
  reach: "hop_pass" | "hop_fail" | "wade_pass" | "wade_fail";
  calm: "talk_pass" | "talk_fail" | "horns_pass" | "horns_fail";
  free: "haul_pass" | "haul_fail" | "float_success" | "float_failure";
  grab: "pass" | "fail";
  fen: "shout_pass" | "shout_fail" | "run_pass" | "run_fail";
  edge: "pass" | "fail";
  cross: "rhythm_success" | "rhythm_failure" | "crest_success" | "crest_failure" | "jump_pass" | "jump_fail" | "float_success" | "float_failure" | "ring";
  bolt: "push_pass" | "push_fail" | "call_pass" | "call_fail";
  hare: "scoop_pass" | "scoop_fail" | "trail_pass" | "trail_fail";
  sign: "picture" | "bank";
  seats: 1 | 2 | 4;
}

function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", {}, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_toss: face(route.read), check_hop: face(route.reach), check_wade: face(route.reach),
    check_talk: face(route.calm), check_horns: face(route.calm), check_haul: face(route.free), catch_goat: face(route.grab),
    check_shout: face(route.fen), check_run: face(route.fen), lead_edge: face(route.edge), check_jump: face(route.cross),
    check_push: face(route.bolt), check_call_blink: face(route.bolt), check_scoop: face(route.hare), check_trail: face(route.hare),
  };
  const picks: Record<string, string> = {
    read: head(route.read), chime: route.chime, reach: head(route.reach), calm: head(route.calm), free_choice: head(route.free),
    rest: head(route.fen), crossing: head(route.cross), goat_bolts: head(route.bolt), hare: head(route.hare), warning: route.sign,
  };
  const games: Record<string, string> = { watch_blink: route.read, float_dig: route.free, cross_rhythm: route.cross, cross_crest: route.cross, cross_float: route.cross };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      const played = games[state.sceneId!];
      state = finishInteraction(state, chapter, played === undefined || ok(played) ? "success" : "failure");
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
  read: "watch_success", chime: "quiet", reach: "hop_pass", calm: "talk_pass", free: "float_success", grab: "pass", fen: "shout_pass",
  edge: "pass", cross: "crest_success", bolt: "push_pass", hare: "scoop_pass", sign: "picture", seats: 1,
};
// A rung chime sinks the goat past hauling; the long blink needs a read rhythm; the float needs a high tide;
// the held door needs the chime rung before.
const valid = (r: Route) => !(r.chime === "ring" && head(r.free) === "haul")
  && !(head(r.cross) === "rhythm" && !ok(r.read))
  && !(head(r.cross) === "float" && head(r.free) !== "float")
  && !(r.cross === "ring" && r.chime !== "ring");
const decisions = { read: ["watch_success", "watch_failure", "toss_pass", "toss_fail"], chime: ["ring", "quiet"],
  free: ["haul_pass", "haul_fail", "float_success", "float_failure"],
  cross: ["rhythm_success", "rhythm_failure", "crest_success", "crest_failure", "jump_pass", "jump_fail", "float_success", "float_failure", "ring"],
  bolt: ["push_pass", "push_fail", "call_pass", "call_fail"], seats: [1, 2, 4] } as const;
const others = { reach: ["hop_pass", "hop_fail", "wade_pass", "wade_fail"], calm: ["talk_pass", "talk_fail", "horns_pass", "horns_fail"],
  grab: ["pass", "fail"], fen: ["shout_pass", "shout_fail", "run_pass", "run_fail"], edge: ["pass", "fail"],
  hare: ["scoop_pass", "scoop_fail", "trail_pass", "trail_fail"], sign: ["picture", "bank"], seats: [1, 2, 4] } as const;
const rows = (axes: Record<string, readonly unknown[]>) => product(axes).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid);
const routes: Route[] = [
  ...pairwise(rows(decisions), Object.keys(decisions) as (keyof Route)[], { together: [["read", "chime", "free", "cross"], ["cross", "bolt"]] }),
  ...pairwise(rows(others), Object.keys(others) as (keyof Route)[]),
];

describe("every route across the stuttering flats", () => {
  it.each(routes)("$read $chime $reach $calm $free $grab $fen $edge $cross $bolt $hare $sign, $seats seats", route => {
    const { state, trace } = walk(route);
    const ending = state.narration;

    // The beat: the goat is home through an opening that will not hold still.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.get("read")!.narration).toContain("unstable");
    expect(ending).toContain("moved things try to go home");
    expect(ending).toContain("What is it? And can you put things right?");

    // Reading the blink earns the long-blink crossing.
    const crossing = trace.get("crossing")!;
    expect(offered(crossing, "rhythm")).toBe(ok(route.read));

    // Ringing the chime holds the door later, and sinks the goat past hauling now.
    const rung = route.chime === "ring";
    expect(offered(trace.get("free_choice")!, "haul")).toBe(!rung);
    expect(trace.get("free_choice")!.narration.includes("since the chime rang")).toBe(rung);
    expect(offered(crossing, "ring")).toBe(rung);

    // Haul (force) or float (understand): a limping goat, or a wet crossing with Puddle as a raft.
    const hauled = head(route.free) === "haul";
    expect(offered(crossing, "float")).toBe(!hauled);
    expect(crossing.narration.includes("She's limping")).toBe(hauled);
    expect(trace.get("rest")!.narration.includes("tide is creeping up the bank")).toBe(!hauled);
    expect(ending.includes("limping home to her kid")).toBe(hauled);

    // A missed crossing brings the herder onto the mud, and a second miss keeps her boot.
    const missed = route.cross !== "ring" && !ok(route.cross);
    expect(trace.has("goat_bolts")).toBe(missed);
    expect(trace.has("goat_home")).toBe(!missed);
    expect(ending.includes("A yeti's boot stands in the mud")).toBe(missed && !ok(route.bolt));

    // A missed grab costs Puddle's lunch; a missed shout costs Fen's net.
    expect(trace.has("goat_ran")).toBe(route.grab === "fail");
    expect(trace.get("rest")!.narration.includes("the goat ate it")).toBe(route.grab === "fail");
    expect(ending.includes("a yeti has my net")).toBe(!ok(route.fen));
    expect(ending.includes(route.sign === "picture" ? "Not going near that, then." : "sits in the waiting spot")).toBe(true);

    // The close points at the Bone Yard, and the chime keeps leaning north.
    expect(trace.get("last_blink")!.narration).toContain("north, toward the glacier");
    expect(trace.get("warning")!.narration).toContain("Bone Yard, where old bones lie in the mud");
    expect(trace.get("goat_home")?.narration ?? trace.get("herder_home")?.narration ?? trace.get("herder_boot")!.narration).toContain("kid");
  });
});

it("every authored outcome, for every species and class shortcut, gets the goat home", { timeout: 120_000 }, () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, {}, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
    }
    for (const id of ["goat_bolts", "herder_boot", "goat_ran", "fen_net", "cross_chime", "cross_float", "boot_lost", "kicked"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
    expect(visited.has("fly_goat")).toBe(species === "griffin");
    expect(visited.has("bigfoot_lift")).toBe(species === "bigfoot");
    expect(visited.has("cross_mend")).toBe(species === "unicorn");
    expect(visited.has("calm_song")).toBe(cls === "songkeeper");
    expect(visited.has("read_star")).toBe(cls === "starweaver");
    expect(visited.has("check_dash")).toBe(cls === "duskrunner");
  }
});

it("a unicorn's Mend answers a hauled goat's limp at the crossing", () => {
  const limping = enterScene(start(chapter, "unicorn", "songkeeper", { flats_limping: true, flats_goat_free: true }), "crossing", context(chapter)).state;
  expect(offered(limping, "mend")).toBe(true);
  const sound = enterScene(start(chapter, "unicorn", "songkeeper", { flats_tide_high: true, flats_goat_free: true }), "crossing", context(chapter)).state;
  expect(offered(sound, "mend")).toBe(false);
  const mended = send(limping, { type: "CHOOSE", choiceId: "mend" }, chapter);
  expect(mended.flags.flats_limping).toBe(false);
});

it("sets no journey flag", () => {
  const journey = new Set(campaign.graph!.flags);
  for (const m of JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)) expect(journey.has(m[1]!), m[1]).toBe(false);
});
