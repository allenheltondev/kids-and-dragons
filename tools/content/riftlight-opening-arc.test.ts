/**
 * Riftlight's three opening chapters, revised in November 2026 onto the
 * campaign arc (docs/campaigns/continental-rift/arc.md, "Opening"). These tests
 * protect what the arc needs every party to carry out of the opening, and what
 * the party's choices change, not how many scenes, votes or games there are:
 *
 * - the Exchange: the tear is its own p1 scene, the early ship is a clue the
 *   sky strand can read back, and a good throw, a fed crew, hauling or wedging
 *   the crates each change a later task;
 * - the glacier: every party hears where the snow came from, sees snow walk
 *   back uphill and hears the melt has been strange since the mountain woke;
 *   carrying the kid in or humming it in, the tin, and a cracked note all cost
 *   or open something later;
 * - the departure: every route passes Orin's map and the campaign question,
 *   Olivia's "Imagine if we could use them!" and the chime leaning toward the
 *   glacier; rushing the hay or marking the bank, and ringing the chime hard or
 *   listening, each have a cost a later scene reads.
 *
 * Route walks play the real controls through the engine: votes, dice at a
 * chosen face and interactions with real actions. The exhaustive walks (every
 * choice and both dice faces, for every species and class) are in
 * riftlight-opening.test.ts.
 */
import type { Chapter, RunState } from "@kad/shared";
import { enterScene } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, answerClassPlace, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const exchange = chapters.get("riftlight-exchange-rift")!;
const glacier = chapters.get("riftlight-glacier-survival")!;
const departure = chapters.get("riftlight-riftseekers-departure")!;
const journeyFlags = new Set(campaign.graph!.flags);

type Outcome = "success" | "failure" | "assisted";
interface Plan { picks?: Record<string, string>; faces?: Record<string, number>; plays?: Record<string, Outcome>; flags?: Record<string, boolean>; seats?: number; hp?: number }
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some((o) => o.id === id);
const options = (s: RunState) => (s.prompt?.kind === "choice" ? s.prompt.options.map((o) => o.id) : []);
const count = (s: RunState, item: string) => s.party.flatMap((p) => p.character.inventory).filter((e) => e.itemId === item).length;
const holds = (s: RunState, item: string) => count(s, item) > 0;
const hp = (s: RunState) => s.party.map((p) => p.hp);

/** Plays one route through the engine; returns the end and the state on arrival at every scene passed. */
function walk(chapter: Chapter, plan: Plan, defaults: Record<string, string> = {}) {
  let state = start(chapter, "manticore", "duskrunner", plan.flags ?? {}, plan.seats ?? 1);
  if (plan.hp !== undefined) for (const member of state.party) member.hp = plan.hp;
  const trace = new Map<string, RunState>();
  const picks = { ...defaults, ...plan.picks };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${chapter.id}/${state.sceneId}`).toBeLessThan(90);
    state = answerClassPlace(state, chapter);
    if (!trace.has(state.sceneId!)) trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") state = play(state, chapter, plan.plays?.[state.sceneId!] ?? "success");
    else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter, plan.faces?.[state.sceneId!] ?? 20);
    else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      state = send(state, { type: "CHOOSE", choiceId: want && offered(state, want) ? want : state.prompt.options[0]!.id }, chapter);
    } else state = send(state, { type: "ADVANCE" }, chapter);
  }
  trace.set(state.sceneId!, structuredClone(state));
  return { state, trace };
}

/**
 * Real controls only. A relay, cooperation, balance or play game cannot fail in the engine,
 * so asking one for a miss throws instead of inventing a branch no party can take (PR #606 review).
 */
function play(state: RunState, chapter: Chapter, outcome: Outcome) {
  return finishInteraction(state, chapter, outcome);
}

/** True when no ending can be reached from the entry without passing `scene`: every route walks through it. */
function everyRoutePasses(chapter: Chapter, scene: string) {
  const seen = new Set<string>();
  const pending = [chapter.entry];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === scene || seen.has(id)) continue;
    seen.add(id);
    const s = chapter.scenes[id]! as unknown as Record<string, unknown> & { choices?: { goto: string }[] };
    const next = [...(s.choices ?? []).map((c) => c.goto), ...["onSuccess", "onFailure", "onAssisted", "onVictory", "onDefeat"].flatMap((k) => (s[k] as { goto?: string } | undefined)?.goto ?? [])];
    if (s.outcome || (s.choices && s.choices.length === 0 && next.length === 0)) return false;
    pending.push(...next);
  }
  return true;
}

const narration = (chapter: Chapter, scene: string) => (chapter.scenes[scene] as { narration?: string }).narration ?? "";

describe("every opening chapter keeps its beat on every route", () => {
  it.each([exchange, glacier, departure])("$id: every success ending ticks every goal step", (chapter) => {
    // One party here; riftlight-opening.test.ts walks every species and class through the same chapters.
    for (const [species, cls] of [["manticore", "duskrunner"]] as const) {
      for (const end of allPaths(chapter, species, cls).ends) {
        expect(end.chapterOutcome).toBe("success");
        for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string], `${chapter.id}: ${step.id}`).toBe(true);
        expect(end.party.every((p) => !p.down && p.hp > 0)).toBe(true);
      }
    }
  }, 120_000); // Exhaustive walks; CI runs them under load.

  it.each([exchange, glacier, departure])("$id: scene 1 asks the goal's question in the story's own words", (chapter) => {
    const opening = narration(chapter, chapter.entry);
    expect(chapter.goal!.text.endsWith("?")).toBe(true);
    expect(opening).toMatch(/\?/);
    expect(opening.length).toBeLessThanOrEqual(600);
  });

  it("has at most one p1 on any route, and it is the arc's", () => {
    const p1 = (chapter: Chapter) => Object.entries(chapter.scenes).filter(([, s]) => (s as { priority?: number }).priority === 1).map(([id]) => id);
    expect(p1(exchange)).toEqual(["shimmer"]);
    expect(p1(glacier)).toEqual([]);
    expect(p1(departure)).toEqual(["map_wrong"]);
    expect(everyRoutePasses(exchange, "shimmer")).toBe(true);
    expect(everyRoutePasses(departure, "map_wrong")).toBe(true);
  });
});

describe("the Exchange: where is the snow coming from?", () => {
  const DEFAULTS = { quay_rest: "on", morning: "ship", ship: "quay", fish: "follow", gull: "tracks", noodle_counter: "ask", awning_plan: "tie", delivery: "sacks", landing_steps: "climb", quay: "study", crate_plan: "wedge", gap: "climb", shimmer: "kid", pull: "catch" };

  it("the tear is its own scene, with the answer to the question in its narration", () => {
    expect(narration(exchange, "shimmer")).toContain("where the snow on the quay comes from");
    expect(narration(exchange, "white")).toMatch(/snow on the quay came from/);
  });

  it("the early ship is a clue every party that meets Captain Thimble hears, and the sky strand reads", () => {
    const { state, trace } = walk(exchange, { picks: { morning: "ship" } }, DEFAULTS);
    expect(state.flags.noticed_the_sky_ship).toBe(true);
    expect(trace.get("ship")!.narration).toMatch(/due tomorrow\. We docked today/);
    expect(trace.get("ship")!.narration).toContain("washing");
    const sky = chapters.get("riftlight-sky-islands-arrival")!;
    expect(JSON.stringify(sky.scenes.ferry_in)).toContain("noticed_the_sky_ship");
    expect(walk(exchange, { picks: { morning: "gull" } }, DEFAULTS).state.flags.noticed_the_sky_ship).toBeUndefined();
  });

  it("a good throw lets the pilot tie up to the low ring without a roll; a miss does not", () => {
    for (const play of ["success", "failure"] as const) {
      const { trace, state } = walk(exchange, { plays: { barge_toss: play }, picks: { delivery: "snug" } }, DEFAULTS);
      const at = trace.get("delivery")!;
      expect(offered(at, "snug")).toBe(play === "success");
      expect(state.flags.found_barge_mooring).toBe(play === "success" ? true : undefined);
      expect(state.flags.barge_rope_caught).toBeFalsy();
    }
  });

  it("feeding the crews earns a honeycake that can tempt the kid at the tear", () => {
    for (const play of ["success", "failure"] as const) {
      const { trace } = walk(exchange, { plays: { sack_chain: play }, picks: { noodle_counter: "ask", shimmer: "food" } }, DEFAULTS);
      expect(count(trace.get("quay_rest")!, "honeycake") - count(trace.get("sack_chain")!, "honeycake")).toBe(play === "success" ? 1 : 0);
      // A party with nothing to share has no way to tempt the kid.
      const empty = walk(exchange, { plays: { sack_chain: play }, picks: { noodle_counter: "ask", awning_plan: "tie", shimmer: "food" }, faces: { awning_tie: 1 } }, DEFAULTS).trace;
      expect(holds(empty.get("shimmer")!, "honeycake") || holds(empty.get("shimmer")!, "supper_bundle")).toBe(empty.has("kid_food"));
      if (!holds(empty.get("sack_chain")!, "honeycake") && !holds(empty.get("sack_chain")!, "supper_bundle")) expect(empty.has("kid_food")).toBe(play === "success");
    }
  });

  it("hauling the crates by force leaves a stack nobody can climb; wedging them pinches the gap shut", () => {
    const hauled = walk(exchange, { picks: { crate_plan: "haul" } }, DEFAULTS).trace;
    expect(options(hauled.get("gap")!)).toEqual(["squeeze", "crawl"]);
    expect(hauled.get("gap")!.narration).toContain("Climbing it would bring it down");
    const wedged = walk(exchange, { picks: { crate_plan: "wedge" } }, DEFAULTS).trace;
    expect(options(wedged.get("gap")!)).toEqual(["climb", "crawl"]);
    expect(wedged.get("gap")!.narration).toContain("There is no room to squeeze now");
    const slid = walk(exchange, { picks: { crate_plan: "haul" }, faces: { crate_haul: 1 } }, DEFAULTS).trace;
    expect(slid.has("crates_slid")).toBe(true);
    expect(options(slid.get("gap")!)).toEqual(["squeeze", "climb", "crawl"]);
    for (const trace of [hauled, wedged, slid]) {
      const past = trace.get("shimmer")!;
      expect(past.flags.crates_forced).toBeFalsy();
      expect(past.flags.crates_wedged).toBeFalsy();
      expect(options(trace.get("pull")!)).toContain("anchor");
    }
  });

  it("warming the kid at the ridge is free play that cannot fail, so it carries no hidden cost", () => {
    // A play game only ever succeeds in the engine (PR #606 review): its onFailure used to
    // promise a lost heart that no party could ever pay.
    const lee = exchange.scenes.ridge_lee!;
    if (lee.type !== "interaction") throw new Error("Expected interaction");
    expect(lee.interaction.kind).toBe("play");
    expect(lee.onFailure).toEqual(lee.onSuccess);
    expect(lee.onSuccess.effects ?? []).toEqual([]);
  });

  it("carrying the kid through the gusts is a timing game whose miss really drifts the party", () => {
    const walkScene = exchange.scenes.ridge_walk!;
    if (walkScene.type !== "interaction") throw new Error("Expected interaction");
    expect(walkScene.interaction.kind).toBe("timing");
    expect(walkScene.onFailure.goto).toBe("ridge_drift");
    expect(walkScene.onSuccess.goto).not.toBe("ridge_drift");
  });
});

describe("the glacier: can we get the kid home and find somewhere warm?", () => {
  const DEFAULTS = { hall: "continue", shelter: "bank", prints: "read", drift: "probe", cairn: "dig", tracks: "truth", channel: "stone", settle: "count", herd: "hum", hall_table: "dry", seam_response: "hum", changing: "travelers", ledge_look: "poles" };

  it("every party learns the snow came from here, sees it walk back uphill, and hears the melt is strange since the mountain woke", () => {
    expect(narration(glacier, "arrival")).toContain("where the snow on the quay came from");
    expect(narration(glacier, "drift")).toMatch(/drifts up it, back toward the ridge, like it is walking home/);
    expect(narration(glacier, "changing")).toContain("The melt has been strange since the mountain woke");
    for (const scene of ["drift", "changing", "arrival", "departure"]) expect(everyRoutePasses(glacier, scene), scene).toBe(true);
    for (const pick of ["truth", "herd"]) {
      const { trace } = walk(glacier, { picks: { tracks: pick } }, DEFAULTS);
      const told = trace.get(pick === "truth" ? "tell_rift" : "ask_help")!;
      expect(told.narration).toMatch(/that is where my snow went/i);
    }
    // Never which Gemfall ending: the mountain woke in every timeline.
    expect(JSON.stringify(glacier.scenes)).not.toMatch(/titan|Hollow Gate|Last Ring/i);
  });

  it("telling the herder about the fold earns a honeycake; asking for help earns her warm blanket", () => {
    const told = walk(glacier, { picks: { tracks: "truth" } }, DEFAULTS).trace.get("herder_gift")!;
    expect(holds(told, "honeycake")).toBe(true);
    const start = walk(glacier, { picks: { tracks: "herd" } }, DEFAULTS).trace;
    expect(holds(start.get("herder_gift")!, "honeycake")).toBe(false);
    expect((glacier.scenes.ask_help as { onEnter: { type: string }[] }).onEnter.map((e) => e.type)).toEqual(["heal"]);
  });

  it("carrying the kid in costs bruises; humming it in costs nothing and the hall hears you; a squeak costs a cold wait", () => {
    // Start low, so the hall's rest does not hide the bruise.
    const carried = walk(glacier, { hp: 5, picks: { herd: "carry" } }, DEFAULTS).trace;
    const hummed = walk(glacier, { hp: 5, picks: { herd: "hum" } }, DEFAULTS).trace;
    const squeaked = walk(glacier, { hp: 5, picks: { herd: "hum" }, faces: { hum_door: 1 } }, DEFAULTS).trace;
    expect(hp(carried.get("herd")!)).toEqual(hp(hummed.get("herd")!));
    expect(hp(carried.get("hall")!)[0]).toBe(hp(hummed.get("hall")!)[0]! - 1);
    expect(hp(squeaked.get("hall")!)[0]).toBe(hp(hummed.get("hall")!)[0]! - 1);
    expect(hummed.get("hall")!.narration).toContain("You hummed at the door!");
    expect(carried.get("hall")!.narration).not.toContain("You hummed at the door!");
    expect(hummed.get("hall_table")!.flags.hummed_at_door).toBeFalsy();
  });

  it("a wobbly note cracks the seam: the herder will not let you hum at it again, and the note is still learned", () => {
    for (const play of ["success", "failure"] as const) {
      const { trace, state } = walk(glacier, { plays: { note_try: play } }, DEFAULTS);
      expect(offered(trace.get("seam_response")!, "hum")).toBe(play === "success");
      expect(state.flags.learned_glacier_note).toBe(true);
      expect(state.flags.tested_singing_seam).toBe(true);
      expect(state.flags.note_cracked).toBeFalsy();
    }
  });

  it("a stuck tin keeps its coins for the next lost traveler", () => {
    const opened = walk(glacier, { picks: { cairn: "dig" } }, DEFAULTS).trace.get("tracks")!;
    const stuck = walk(glacier, { picks: { cairn: "dig" }, faces: { cairn_dig: 1 } }, DEFAULTS).trace.get("tracks")!;
    expect((opened.coins ?? 0) - (stuck.coins ?? 0)).toBe(4);
    const buried = walk(glacier, { hp: 5, plays: { crust_hold: "failure" } }, DEFAULTS).trace;
    expect(hp(buried.get("cairn")!)[0]).toBe(hp(buried.get("crust_hold")!)[0]! - 1);
  });

  it("closes on the question with its piece added, and greets the travelers for the departure", () => {
    const close = narration(glacier, "departure");
    expect(close).toMatch(/why is a glacier spilling onto a harbor/);
    expect(close).toMatch(/griffin/);
    expect(close).toMatch(/unicorn/);
  });
});

describe("the departure: what are these travelers looking for, and where do we start?", () => {
  const DEFAULTS = { map: "tell", fellowship: "lift", olivia: "help", test_chime: "listen", trial_read: "still", lookout: "climb", tea: "seren", supplies: "save", prep: "ice", camp: "set_out" };

  it("every route meets all three Riftseekers, reads Orin's map, hears the campaign question, Olivia's idea and sees the chime lean", () => {
    for (const scene of ["map", "fellowship", "map_wrong", "olivia", "chime", "chime_lean", "set_out"]) {
      expect(everyRoutePasses(departure, scene), scene).toBe(true);
    }
    expect(narration(departure, "map")).toMatch(/Orin Vale.*Lady Olivia.*Seren Wisp/s);
    expect(narration(departure, "map_wrong")).toContain("Something is moving the land. What is it? And can we put things right?");
    expect(narration(departure, "map_wrong")).toMatch(/does not match my map/);
    expect(narration(departure, "olivia")).toContain("Imagine if we could use them!");
    expect(narration(departure, "chime_lean")).toMatch(/points up at the high glacier/);
    expect(narration(departure, "set_out")).toContain("Something is moving the land. What is it? And can you put things right?");
    for (const exit of ["Cairnstep", "openings", "Ashspan Bridge"]) expect(narration(departure, "set_out")).toContain(exit);
    // Witnessed, never explained, and nobody named.
    expect(JSON.stringify(departure.scenes)).not.toMatch(/Corvane|emperor|Pangea|old king|moving the land on purpose/i);
  });

  it.each([
    ...pairwise(
      [{}].flatMap(() => ["help_pass", "help_fail", "routes_pass", "routes_fail"].flatMap((hay) =>
        ["ring", "listen_pass", "listen_fail"].flatMap((chime) => [1, 3].map((seats) => ({ hay, chime, seats }))))),
      ["hay", "chime", "seats"],
    ),
  ])("rushing or marking ($hay) and ringing or listening ($chime), $seats seats", ({ hay, chime, seats }) => {
    const pass = (s: string) => s.endsWith("_pass");
    const { state, trace } = walk(departure, {
      seats,
      picks: { olivia: hay.split("_")[0]!, test_chime: chime.split("_")[0]!, lookout: "chalk", supplies: "thanks" },
      faces: { haul_supper: pass(hay) ? 20 : 1, chalk_route: pass(hay) ? 20 : 1, listen_chime: pass(chime) ? 20 : 1 },
    }, DEFAULTS);

    // The beat, on every route: the chime, the question, a road.
    expect(state.chapterOutcome).toBe("success");
    expect(state.party[0]!.character.questItems).toEqual(["listening_chime"]);
    for (const step of departure.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    for (const scene of ["map_wrong", "chime_lean", "trial_report", "route", "parting", "set_out"]) expect(trace.has(scene), scene).toBe(true);

    // Rushing the hay feeds the herd today: her thanks and a full herd, but a fall in the soft ice costs warmth.
    const rushed = hay.startsWith("help");
    expect(offered(trace.get("supplies")!, "thanks")).toBe(rushed);
    expect(trace.has("herder_thanks")).toBe(rushed);
    if (rushed) expect(holds(trace.get("prep")!, "river_charm")).toBe(true);
    expect(trace.get("send_off")!.narration).toContain(rushed ? "too full to chew" : "the slow, safe way");
    if (rushed) expect(hp(trace.get("chime")!)[0]).toBe(hp(trace.get("haul_supper")!)[0]! - (pass(hay) ? 0 : 1));
    // Marking the bank well opens the safe way to look out; a wobbly line does not.
    const marked = hay === "routes_pass";
    expect(offered(trace.get("lookout")!, "chalk")).toBe(marked);
    expect(trace.has("lookout_chalk")).toBe(marked);
    if (marked) expect(trace.get("tarp")!.flags.saw_thin_ice).toBe(true);

    // Ringing hard (or Olivia doing it when listening fails) costs the hall's song and a snow slide; Orin asks you to listen first.
    const rang = chime !== "listen_pass";
    expect(trace.has("ring_hard")).toBe(rang);
    if (chime === "listen_fail") expect(trace.get("ring_hard")!.narration).toContain("Here, let me!");
    expect(hp(trace.get("chime_lean")!)[0]).toBe(hp(trace.get("test_chime")!)[0]! - (rang ? 1 : 0));
    expect(trace.get("trial_report")!.narration.includes("That is why we listen before we ring.")).toBe(rang);
    expect(trace.get("parting")!.narration.includes("Next time, listen first.")).toBe(rang);

    // The chapter sets no journey flag of its own.
    for (const [flag, value] of Object.entries(state.flags)) if (value) expect(journeyFlags.has(flag), flag).toBe(false);
  });

  it("a failed check reroutes with a cost and still reaches the beat", () => {
    const { state, trace } = walk(departure, { faces: { corner_hunt: 1, map_spot: 1, haul_supper: 1, listen_chime: 1, trial_ear: 1, lookout_climb: 1, tarp: 1 } }, DEFAULTS);
    expect(state.chapterOutcome).toBe("success");
    expect(hp(trace.get("map_spread")!)[0]).toBe(hp(trace.get("corner_hunt")!)[0]! - 1);
    expect(trace.get("map_wrong")!.flags.saw_thin_ice).toBeUndefined();
    expect(trace.get("map_wrong")!.narration).toContain("Orin points with his pencil instead");
    expect(state.party[0]!.character.questItems).toEqual(["listening_chime"]);
    const sharp = walk(departure, {}, DEFAULTS).trace;
    expect(sharp.get("map_wrong")!.flags.saw_thin_ice).toBe(true);
  });

  it("Seren recognizes the carried reading flag, without claiming a party read when it did not", () => {
    for (const read of [false, true]) {
      const state = start(departure, "manticore", "duskrunner", read ? { starweaver_read_first_rift: true } : {});
      const result = enterScene(state, "seren", context(departure));
      expect(result.error).toBeUndefined();
      expect(result.state.narration.includes("Seren turns to the hero who saw it.")).toBe(read);
    }
  });

  it("the goat is a callback only for a party that told it", () => {
    for (const pick of ["tell", "ask"]) {
      const { trace } = walk(departure, { picks: { map: pick } }, DEFAULTS);
      expect(trace.get("map_wrong")!.narration.includes("a goat walked through the air")).toBe(pick === "tell");
      expect(trace.get("map_wrong")!.flags.departure_told_goat).toBe(pick === "tell" ? true : undefined);
    }
  });
});
