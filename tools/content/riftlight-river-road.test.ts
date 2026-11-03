/**
 * The road out of the glacier, revised in November 2026 against the campaign arc
 * (docs/campaigns/continental-rift/arc.md): The Path Beside the River
 * (riftlight-ice-shelf-traverse), The Note Under the Ice
 * (riftlight-hidden-glacier-rift) and The River Chooses a Road
 * (riftlight-headwaters-washout). These tests protect what the party's choices
 * change and the contract the graph reads, not how many scenes or checks there are:
 *
 * - every success ending ticks every goal step and keeps the Listening Chime;
 * - the shelf sets exactly one of `traverse_made` / `traverse_failed`, and a
 *   failed crossing goes into the river with nobody letting go;
 * - watching the river breathe costs warmth and buys a safer crossing; a missed
 *   throw at Grumble loses the clip-on at Old Clank;
 * - the hidden rift wakes only when the party sings, the leaving ending stays
 *   unsolved, and prying the seam makes the waking song harder than answering it;
 * - the washout sets exactly one `river_exit` member on every path, Ossley only
 *   on a late rescue; kicking for the bank pays at the ledge and reading the river
 *   pays at the tree; a missed hop costs the honeycake, a lost fight the loop.
 *
 * Routes play the real story controls through the engine: votes, dice at a chosen
 * face and interactions with real actions. The drake fight takes a declared outcome
 * here; its board is played in riftlight-washout-fight.test.ts.
 */
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const shelf = chapters.get("riftlight-ice-shelf-traverse")!;
const hidden = chapters.get("riftlight-hidden-glacier-rift")!;
const washout = chapters.get("riftlight-headwaters-washout")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some((o) => o.id === id);
const hp = (s: RunState) => s.party.reduce((sum, m) => sum + m.hp, 0);
const holdsChime = (s: RunState) => s.party.some((m) => m.character.questItems.includes("listening_chime"));
const holds = (s: RunState, item: string) => s.party.some((m) => m.character.inventory.some((i) => i.itemId === item));

interface Plan {
  /** Choice id to take at a scene; otherwise the first offered. */
  picks?: Record<string, string>;
  /** Die face for a check scene; otherwise 20. */
  faces?: Record<string, number>;
  /** Interaction outcome at a scene; otherwise success. */
  games?: Record<string, "success" | "failure" | "assisted">;
  fight?: "won" | "lost";
  flags?: Record<string, boolean>;
  seats?: number;
  /** Stop on arriving at this scene, before acting. */
  until?: string;
}

/** Plays one route through the engine, keeping the state at every scene it passed. */
function play(chapter: Chapter, plan: Plan = {}) {
  let state = start(chapter, "manticore", "duskrunner", plan.flags ?? {}, plan.seats ?? 1);
  const trace = new Map<string, RunState>();
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${chapter.id}/${state.sceneId}`).toBeLessThan(120);
    const id = state.sceneId!;
    trace.set(id, structuredClone(state));
    if (id === plan.until) break;
    const scene = chapter.scenes[id]!;
    if (scene.type === "encounter") {
      const branch = plan.fight === "lost" ? scene.onDefeat : scene.onVictory;
      state = applyEffects(state, branch.effects ?? [], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, plan.games?.[id] ?? "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, plan.faces?.[id] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const pick = plan.picks?.[id] ?? state.prompt.options[0]!.id;
      expect(offered(state, pick), `${chapter.id}/${id} offers ${pick}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: pick }, chapter);
    } else throw new Error(`${chapter.id}/${id}: unexpected prompt ${state.prompt?.kind}`);
  }
  return { state, trace };
}

function goalTicked(chapter: Chapter, end: RunState) {
  for (const step of chapter.goal!.steps) {
    const flags = [step.flag].flat().filter(Boolean) as string[];
    expect(flags.some((f) => end.flags[f]), `${chapter.id}: ${step.id} at ${end.sceneId}`).toBe(true);
  }
}

describe("the ice shelf", () => {
  it("every ending ticks the goal, keeps the chime and sets exactly one shelf outcome", () => {
    const { ends } = allPaths(shelf, "manticore", "duskrunner");
    expect(new Set(ends.map((e) => e.sceneId))).toEqual(new Set(["rest_safe", "rest_river"]));
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      goalTicked(shelf, end);
      expect(holdsChime(end)).toBe(true);
      expect(campaign.routeSets!.ice_shelf!.filter((f) => end.flags[f])).toEqual([end.sceneId === "rest_safe" ? "traverse_made" : "traverse_failed"]);
    }
  }, 60_000);

  it("Skerry asks the question in scene 1 and the shelf shows the river moved, with the chime leaning glacier-ward", () => {
    const { trace } = play(shelf);
    expect(trace.get("shelf")!.narration).toContain("see what the river did");
    const gap = trace.get("gap")!.narration;
    expect(gap).toContain("walk straight into the river");
    expect(gap).toContain("toward the glacier");
    expect((shelf.scenes.gap as { priority?: number }).priority).toBe(2);
  });

  it("watching the river breathe costs warmth and buys a safer crossing; going now does not", () => {
    const now = play(shelf, { picks: { watch: "now" }, until: "ready" }).state;
    const wait = play(shelf, { picks: { watch: "wait" }, until: "ready" }).state;
    expect(hp(wait)).toBe(hp(now) - 1);
    expect(offered(wait, "breath")).toBe(true);
    expect(offered(now, "breath")).toBe(false);
    const crossed = play(shelf, { picks: { watch: "wait", ready: "breath" } });
    expect(crossed.state.sceneId).toBe("rest_safe");
    expect(crossed.trace.get("across")!.narration).toContain("crossed on its breath");
  });

  it("a missed throw at Grumble loses the clip-on at Old Clank, and a slack line loses the tight-line crossing", () => {
    const caught = play(shelf, { until: "ready" }).state;
    const missed = play(shelf, { games: { ring_throw: "failure", hold_line: "failure" }, until: "ready" }).state;
    expect(offered(caught, "ring")).toBe(true);
    expect(offered(caught, "tight")).toBe(true);
    expect(offered(missed, "ring")).toBe(false);
    expect(offered(missed, "tight")).toBe(false);
  });

  it("a failed crossing goes into the river together, and the chapter still succeeds toward the washout", () => {
    const { state, trace } = play(shelf, { picks: { ready: "together" }, faces: { cross: 1 } });
    expect(state.sceneId).toBe("rest_river");
    expect(state.chapterOutcome).toBe("success");
    expect(state.flags.traverse_failed).toBe(true);
    expect(state.flags.traverse_made).not.toBe(true);
    expect(trace.get("fall")!.narration).toContain("Nobody lets go");
  });

  it("knocking the icicles down is quick but a miss bruises; listening plays the drip game", () => {
    const knocked = play(shelf, { picks: { icicles: "knock" }, faces: { knock: 1 }, until: "gust" });
    expect(knocked.trace.has("drip_run")).toBe(false);
    const before = hp(knocked.trace.get("knock")!);
    expect(hp(knocked.state)).toBe(before - 1);
    const listened = play(shelf, { picks: { icicles: "dash" }, until: "gust" });
    expect(listened.trace.has("drip_run")).toBe(true);
  });

  it("what the party tells Skerry for the herder is what the ending says", () => {
    expect(play(shelf, { picks: { across: "open" } }).state.narration).toContain("New rings by morning");
    expect(play(shelf, { picks: { across: "long" } }).state.narration).toContain("The goats will sulk");
  });
});

describe("the hidden rift", () => {
  it("only singing wakes the opening; leaving goes home unsolved, and both succeed", () => {
    const { ends } = allPaths(hidden, "manticore", "duskrunner");
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      goalTicked(hidden, end);
      expect(holdsChime(end)).toBe(true);
      expect(Boolean(end.flags.glacier_rift_woken), end.sceneId!).toBe(end.sceneId === "ready");
    }
    expect(new Set(ends.map((e) => e.sceneId))).toEqual(new Set(["ready", "leave"]));
  }, 60_000);

  it("the chime answers the opening by itself, for every party", () => {
    const { trace } = play(hidden);
    expect(trace.get("passage")!.narration).toContain("answering the fold's low one");
    expect(trace.get("ridge")!.narration).toContain("toward the oldest ice");
  });

  it("answering the seam lets the fold take the note gently; prying it makes the song harder and is remembered", () => {
    const answered = play(hidden, { picks: { seam_back: "answer" }, until: "decide" }).state;
    const pried = play(hidden, { picks: { seam_back: "pry" }, until: "decide" }).state;
    const missed = play(hidden, { picks: { seam_back: "answer" }, games: { seam_echo: "failure" }, until: "decide" }).state;
    expect(offered(answered, "sing")).toBe(true);
    expect(offered(answered, "sing_hard")).toBe(false);
    for (const harder of [pried, missed]) {
      expect(offered(harder, "sing_hard")).toBe(true);
      expect(offered(harder, "sing")).toBe(false);
    }
    expect((hidden.scenes.hold as { tn: number }).tn).toBeLessThan((hidden.scenes.hold_hard as { tn: number }).tn);
    expect(pried.narration).toContain("flinched");
    const woken = play(hidden, { picks: { seam_back: "pry", decide: "sing_hard" }, faces: { hold_hard: 1 } });
    expect(woken.state.flags.glacier_rift_woken).toBe(true);
    expect(woken.trace.has("sing_wobble")).toBe(true);
  });

  it("spotting the kid in the mounds offers the easy catch; losing it costs the herder's lunch", () => {
    expect(offered(play(hidden, { until: "kid" }).state, "scoop")).toBe(true);
    expect(offered(play(hidden, { games: { holes: "failure" }, until: "kid" }).state, "scoop")).toBe(false);
    const missed = play(hidden, { games: { holes: "failure" }, picks: { kid: "rope" }, faces: { kid_a: 1 }, until: "crack" }).state;
    expect(holds(missed, "supper_bundle")).toBe(false);
    const caught = play(hidden, { until: "crack" }).state;
    expect(holds(caught, "supper_bundle")).toBe(true);
  });
});

describe("the washout", () => {
  it("every ending ticks the goal and sets exactly one river exit; Ossley only on a rescue", () => {
    const { ends } = allPaths(washout, "manticore", "duskrunner");
    const exits = new Map([["early", "river_escaped_early"], ["middle", "river_escaped_middle"], ["late", "river_escaped_late"], ["rescued", "river_escaped_late"], ["rift_end", "river_took_rift"]]);
    expect(new Set(ends.map((e) => e.sceneId))).toEqual(new Set(exits.keys()));
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      goalTicked(washout, end);
      expect(holdsChime(end)).toBe(true);
      expect(campaign.routeSets!.river_exit!.filter((f) => end.flags[f])).toEqual([exits.get(end.sceneId!)]);
      expect(Boolean(end.flags.ossley_rescued)).toBe(end.sceneId === "rescued");
    }
  }, 60_000);

  it("kicking for the bank pays at the ledge; reading the river pays at the tree", () => {
    const kicked = play(washout, { picks: { ride: "kick" }, until: "ledge" }).state;
    const floated = play(washout, { picks: { ride: "feet" }, until: "ledge" }).state;
    expect(offered(kicked, "near")).toBe(true);
    expect(offered(floated, "near")).toBe(false);
    const missLedge = { faces: { knob_toss: 1, grab: 1 }, games: { knob_toss: "failure" as const }, picks: { ledge: "grab" } };
    const atTreeFloated = play(washout, { ...missLedge, picks: { ...missLedge.picks, ride: "feet" }, until: "tree_choice" }).state;
    const atTreeKicked = play(washout, { ...missLedge, picks: { ...missLedge.picks, ride: "kick" }, until: "tree_choice" }).state;
    expect(offered(atTreeFloated, "lane")).toBe(true);
    expect(offered(atTreeKicked, "lane")).toBe(false);
    const near = play(washout, { picks: { ride: "kick", ledge: "near" }, games: { knob_toss: "failure" } });
    expect(near.state.flags.river_escaped_early).toBe(true);
  });

  it("a missed hop between floes costs the dry honeycake", () => {
    expect(holds(play(washout, { until: "snag" }).state, "honeycake")).toBe(true);
    expect(holds(play(washout, { games: { floe_hop: "failure" }, until: "snag" }).state, "honeycake")).toBe(false);
  });

  it("losing to the drake costs the spare loop, and the ride goes on", () => {
    const won = play(washout, { picks: { snag: "loop" }, until: "ledge" }).state;
    const lost = play(washout, { picks: { snag: "loop" }, fight: "lost", until: "ledge" }).state;
    expect(offered(won, "loop")).toBe(true);
    expect(offered(lost, "loop")).toBe(false);
    expect(lost.sceneId).toBe("ledge");
  });

  it("Skerry flies above the river and the chime pulls upstream for every party", () => {
    const { trace } = play(washout);
    expect(trace.get("current")!.narration).toContain("Skerry");
    expect(trace.get("floe_rest")!.narration).toContain("back toward the glacier");
    const cast = (id: string) => (washout.scenes[id] as { cast?: { name?: string }[] }).cast?.map((c) => c.name) ?? [];
    expect(cast("current")).toContain("Skerry");
    expect(cast("late")).toEqual(["Old Ossley", "Skerry"]);
  });
});
