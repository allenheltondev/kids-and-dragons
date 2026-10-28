import { expect, it } from "vitest";
import { completeVisit, parseCampaignGraph, startJourney, takeExit, takeRiftAction } from "@kad/shared";
import { allPaths, campaign, chapters, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-the-island-due-back")!;
const graph = parseCampaignGraph(campaign).graph!;

// Complete routes through the real engine. These are reproducible simulations,
// not human elapsed-time observations.
function walk(preferences: Record<string, string>, face: number, flags: Record<string, boolean> = {}, faces: Record<string, number> = {}) {
  let state = start(chapter, "manticore", "duskrunner", flags, 3);
  for (const p of state.party) p.hp = 1;
  const trace = new Map<string, { narration: string; choices: string[] }>();
  let checks = 0, decisions = 0, steps = 0, activities = 0;
  while (state.phase !== "chapter_complete") {
    expect(++steps).toBeLessThan(150);
    const options = state.prompt?.kind === "choice" ? state.prompt.options : [];
    if (!trace.has(state.sceneId!)) {
      trace.set(state.sceneId!, { narration: state.narration, choices: options.map((o) => o.id) });
      if (options.length >= 2 && chapter.scenes[state.sceneId!]!.type !== "check") decisions++;
    }
    if (state.prompt?.kind === "choice") {
      const id = preferences[state.sceneId!] ?? options[0]!.id;
      expect(options.some((o) => o.id === id), state.sceneId ?? undefined).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter, face);
    } else if (state.prompt?.kind === "roll") {
      checks++;
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? face);
    } else if (state.prompt?.kind === "interaction") {
      activities++;
      const canMiss = ["precision", "timing", "sequence", "memory", "tracking"].includes(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, canMiss && (faces[state.sceneId!] ?? face) === 1 ? "failure" : "success");
    } else state = send(state, { type: "ADVANCE" }, chapter, face);
  }
  trace.set(state.sceneId!, { narration: state.narration, choices: [] });
  const words = [...trace.values()].reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  return { state, trace, metrics: { scenes: trace.size, words, wordsMin: words, checks, decisions, encounters: 0, activities } };
}

it.each([false, true])("the actual whale opening produces the correct island approach: scattered=%s", (scattered) => {
  const initial = { ...startJourney(graph), node: "whale-road", chapter: "riftlight-whale-road", visits: { "whale-road": 1 } };
  const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: 1, outcome: "success", flags: {} }, campaign);
  if (!done.ok) throw new Error(done.message);
  const opened = takeRiftAction(graph, done.journey, { action: "open", edge: "whales-to-coast", way: scattered ? "olivia" : "guide", visit: 1 }, campaign);
  if (!opened.ok) throw new Error(opened.message);
  const entered = takeExit(graph, opened.journey, { edge: "whales-to-island", visit: 1 }, campaign);
  if (!entered.ok) throw new Error(entered.message);
  const result = walk({}, 20, entered.journey.flags);
  expect(result.trace.get("arrival")!.narration.includes("scattered cloud whales")).toBe(scattered);
  expect(result.trace.get("arrival")!.narration.includes("whales you guided clear")).toBe(!scattered);
  expect(result.trace.get("sightings")!.choices.includes("sightings_whales")).toBe(!scattered);
  expect(result.state.flags.olivia_trusted === true).toBe(scattered);
});

it.each([
  { name: "letters, verified evidence and public warning", face: 20, station: false, share: true, warn: true },
  { name: "working station and private notes", face: 20, station: true, share: false, warn: true },
  { name: "wet letters, keeper-assisted evidence and inspection first", face: 1, station: false, share: false, warn: false },
  { name: "steady station and shared incomplete evidence", face: 1, station: true, share: true, warn: false },
])("preserves $name through an entire played engine route", (route) => {
  const { state, trace, metrics } = walk({ priority: route.station ? "option_2" : "option_1", bearings: "relay", record: route.share ? "option_1" : "option_2", departure: route.warn ? "option_1" : "option_2" }, route.face);
  expect(state.flags.fragment_sky_learned).toBe(true);
  expect(state.flags.island_messages_saved).toBe(!route.station && route.face === 20);
  expect(state.flags.island_station_ready).toBe(route.station);
  expect(state.flags.island_land_match).toBe(route.face === 20);
  expect(state.flags.island_record_shared).toBe(route.share);
  expect(state.flags.island_warning_sent).toBe(route.warn);
  expect(trace.has("letters")).toBe(!route.station);
  expect(trace.has("station")).toBe(route.station);
  expect(trace.get("comparison")!.choices.includes("comparison_clear")).toBe(route.face === 20);
  expect(trace.get("landing")!.narration).toContain(route.face === 20 ? "checked alignment" : "second lookout");
  expect(trace.get("return")!.narration).toContain(route.share ? "shared copy" : "private sketch");
  expect(trace.get("return")!.narration).toContain(route.warn ? "first message is the course warning" : "first message asks for another reader");

  expect(metrics.checks).toBe(1);
  expect(chapter.estimatedMinutes).toBe(30);
  expect(state.party.every((p) => p.hp === 1 && !p.down)).toBe(true);
  expect(state.party.flatMap((p) => p.character.questItems)).toEqual(["listening_chime"]);
});

it.each(["batches", "borrow"])("a failed landing lets the party choose %s with a different relay cost", (recovery) => {
  const { state, trace, metrics } = walk({ landing_recovery: recovery }, 20, {}, { landing_1_check: 1 });
  expect(trace.has("landing_recovery")).toBe(true);
  expect(trace.has("landing_batches")).toBe(recovery === "batches");
  expect(trace.has("landing_borrow")).toBe(recovery === "borrow");
  expect(state.flags.island_messages_saved).toBe(true); // Dry letters stay dry even if their messenger waits.
  expect(state.flags.island_relay_delayed).toBe(recovery === "batches");
  expect(trace.get("departure")!.narration.includes("will leave after your party finishes")).toBe(recovery === "batches");
  expect(trace.get("departure")!.narration.includes("offers to carry this authorized message")).toBe(recovery === "borrow");
  expect(trace.get("return")!.narration.includes("later than a light-kit crossing")).toBe(recovery === "batches");
  expect(state.flags.fragment_sky_learned).toBe(true);

  expect(metrics.checks).toBe(1); // Recovery adds a plan, not a reroll.
});

it.each(["keeper", "pip"])("failed comparison leaves discovery to the party's %s-assisted follow-up", (helper) => {
  const { state, trace } = walk({ comparison_recovery: helper }, 20, {}, { comparison_1_check: 1 });
  const discovery = helper === "keeper" ? "comparison_recover_scale_done" : "comparison_recover_view_done";
  expect(trace.has("comparison_recovery")).toBe(true);
  expect(trace.get(discovery)!.narration).toContain("the land was joined here");
  expect(state.flags.island_land_match).toBe(false); // Do not turn a failed roll into independent success.
  expect(state.flags.fragment_sky_learned).toBe(true);
  expect(trace.get("return")!.narration).toContain("follow-up your party made with help");
  for (const [id, scene] of trace) {
    if (id === discovery) break;
    expect(scene.narration, id).not.toMatch(/land was joined|joined land|joined stretch|ground all the way across/i);
  }
});

it.each(["option_1", "option_2", "comparison_clear"])("successful %s comparison reveals the discovery after the test", (method) => {
  const { state, trace } = walk({ comparison: method }, 20);
  const discovery = method === "option_2" ? "comparison_2_done" : "comparison_1_done";
  expect(trace.get(discovery)!.narration).toContain("the land was joined here");
  expect(state.flags.island_land_match).toBe(true);
  for (const [id, scene] of trace) {
    if (id === discovery) break;
    expect(scene.narration, id).not.toMatch(/land was joined|joined land|joined stretch|ground all the way across/i);
  }
});

it("every branch reaches the clue without turning an incomplete test into a verified one", () => {
  const paths = allPaths(chapter, "manticore", "duskrunner", { whales_scattered: true });
  expect(paths.ends.every((s) => s.flags.fragment_sky_learned)).toBe(true);
  expect(paths.ends.some((s) => !s.flags.island_carving_clear && !s.flags.island_land_match)).toBe(true);
});

it("returning through the island does not replay the clue or reset its consequences", () => {
  const played = walk({ priority: "option_2" }, 20).state;
  const initial = { ...startJourney(graph), node: "the-island-due-back", chapter: chapter.id, visits: { "the-island-due-back": 1 }, flags: played.flags };
  const done = completeVisit(graph, initial, { node: initial.node, chapterId: chapter.id, visit: 1, outcome: "success", flags: played.flags }, campaign);
  if (!done.ok) throw new Error(done.message);
  const back = takeExit(graph, done.journey, { edge: "island-to-whales", visit: 1 }, campaign);
  if (!back.ok) throw new Error(back.message);
  if (back.duplicate) throw new Error("Expected a fresh return crossing");
  expect(back.arrival).toBe("new"); // This fixture has not completed the whale chapter yet.
  const whale = completeVisit(graph, back.journey, { node: "whale-road", chapterId: "riftlight-whale-road", visit: back.journey.visit, outcome: "success", flags: played.flags }, campaign);
  if (!whale.ok) throw new Error(whale.message);
  const again = takeExit(graph, whale.journey, { edge: "whales-to-island", visit: whale.journey.visit }, campaign);
  if (!again.ok) throw new Error(again.message);
  if (again.duplicate) throw new Error("Expected a fresh island revisit");
  expect(again.arrival).toBe("pass");
  expect(again.journey.flags?.island_station_ready).toBe(true);
  expect(again.journey.completions?.["the-island-due-back"]).toBe(1);
});
