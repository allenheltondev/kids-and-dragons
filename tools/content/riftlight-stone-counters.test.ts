import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import { allPaths, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-stone-counters")!;
const routes = ["ramp", "carry", "brace"].flatMap(cart => ["lower", "upper"].flatMap(sign =>
  ["drain", "gravel"].flatMap(runoff => ["route", "carving"].flatMap(page =>
    [1, 2, 4].map(seats => ({ cart, sign, runoff, page, seats }))))));

it.each(routes)("$cart / $sign sign / $runoff / $page page at $seats seats changes later work", route => {
  const cls = route.cart === "brace" ? "thornguard" : "starweaver";
  let state = start(chapter, "manticore", cls, {}, route.seats);
  const visited = new Set<string>();
  const kinds = new Set<string>();
  let activities = 0;
  let steps = 0;
  while (state.phase !== "chapter_complete") {
    expect(++steps).toBeLessThan(70);
    visited.add(state.sceneId!);
    if (state.prompt?.kind === "interaction") {
      activities++;
      kinds.add(state.prompt.spec.kind);
      // Actual misses keep the evidence honest and leave the chapter playable.
      const failure = route.page === "carving" && ["timing", "precision", "memory"].includes(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, failure ? "failure" : "success");
    } else if (state.prompt?.kind === "choice") {
      const preferred: Record<string, string> = {
        cart_plan: route.cart, camp: "plan", warning: route.sign, runoff: route.runoff,
        stone_priority: route.page,
        motion: cls === "starweaver" ? "attune" : "measure",
        evidence_decision: state.flags.stone_hollow_clear ? "exact" : "landmarks",
      };
      state = send(state, { type: "CHOOSE", choiceId: preferred[state.sceneId!] ?? state.prompt.options[0]!.id }, chapter);
    } else throw new Error(`Unexpected prompt ${state.sceneId}: ${state.prompt?.kind}`);
  }
  expect(chapter.estimatedMinutes).toBe(30);

  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
  expect(visited.has(route.sign === "lower" ? "upper_cart" : "lower_neighbor")).toBe(true);
  expect(visited.has(route.sign === "lower" ? "lower_neighbor" : "upper_cart")).toBe(false);
  expect(visited.has("jar_relay")).toBe(route.cart === "carry");
  expect(visited.has("cart_balance")).toBe(route.cart !== "carry");
  expect(visited.has("ramp_setup")).toBe(route.cart === "ramp");
  expect(visited.has("braced_ramp")).toBe(route.cart === "brace");
  expect(visited.has(route.page === "route" ? "route_copy" : "carving_copy")).toBe(true);
  expect(state.flags.stone_route_priority).toBe(route.page === "route");
  expect(state.narration).toContain(route.sign === "lower" ? "larger upper sign" : "larger lower warning");
  expect(state.narration).toContain(route.cart === "carry" ? "passing line again" : "reusable ramp");
  if (!state.flags.stone_hollow_clear) expect(state.narration).toContain("missing detail stays missing");
});

it("every branch still teaches the route and completes the water delivery", () => {
  for (const cls of ["duskrunner", "starweaver", "thornguard"] as const) {
    const { ends } = allPaths(chapter, "manticore", cls);
    for (const end of ends) for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
  }
});

it("the road-priority page unlocks a genuinely easier later comparison", () => {
  const valley = chapters.get("riftlight-the-wrong-valley")!;
  for (const carried of [false, true]) {
    const state = enterScene(start(valley, "manticore", "duskrunner", { stone_route_priority: carried }), "look_again", context(valley)).state;
    expect(state.prompt?.kind === "choice" && state.prompt.options.some(q => q.id === "road_plan")).toBe(carried);
  }
  expect(valley.scenes.road_plan_check).toMatchObject({ type: "check", tn: 8 });
  expect(valley.scenes.look_again_1_check).toMatchObject({ type: "check", tn: 12 });
});

it("special class approaches change work using supported mechanics", () => {
  expect(chapter.scenes.braced_ramp).toMatchObject({ choices: [{ goto: "cart_balance" }] });
  expect(chapter.scenes.motion_attuned).toMatchObject({ interaction: { kind: "timing", width: 0.6 } });
});
