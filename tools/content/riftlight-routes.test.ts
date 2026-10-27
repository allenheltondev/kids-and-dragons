import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, chapterFlagWrites, completeVisit, enterScene, lintCampaignGraph, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { campaign, chapters, context, start, allPaths } from "./riftlight-test-support.ts";
import { stageRiftlightOpening } from "./riftlight-preview.ts";
import { runValidator } from "./run-validator.ts";
import { chapterFlagsFrom } from "./journey-graph.ts";

it.each([
  ["kitsune", "starweaver"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"],
  ["griffin", "duskrunner"], ["dragonling", "duskrunner"], ["manticore", "duskrunner"],
] as const)("the route chapters continue on every branch for a %s %s", (species, cls) => {
  for (const chapter of chapters.values()) if (chapter.index >= 4) allPaths(chapter, species, cls);
}, 60_000); // Every route chapter walked for one party; the opening chapters are now full-length, and CI runs this under load.

it.each([...chapters.values()].filter((chapter) => chapter.index >= 4))("$id: every scene is reachable across class and species options", (chapter) => {
  const visited = new Set<string>();
  for (const [species, cls] of [["kitsune", "starweaver"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["griffin", "duskrunner"], ["manticore", "duskrunner"]] as const) {
    for (const scene of allPaths(chapter, species, cls).visited) visited.add(scene);
  }
  if (chapter.id === "riftlight-the-wrong-valley") {
    for (const scene of allPaths(chapter, "manticore", "duskrunner", { stone_route_priority: true }).visited) visited.add(scene);
  }
  if (chapter.id === "riftlight-the-island-due-back") {
    for (const scene of allPaths(chapter, "manticore", "duskrunner", { sky_followup_promised: true, whales_guided: true }).visited) visited.add(scene);
    for (const scene of allPaths(chapter, "manticore", "duskrunner", { whales_guided: true }).visited) visited.add(scene);
  }
  if (chapter.id === "riftlight-hidden-glacier-rift") {
    // A returning party, with the opening already awake, may walk straight back to the fold.
    for (const scene of allPaths(chapter, "manticore", "duskrunner", { glacier_rift_woken: true }).visited) visited.add(scene);
  }
  if (chapter.id === "riftlight-convergence") {
    for (const scene of allPaths(chapter, "manticore", "duskrunner", { orin_chime_shared: true, olivia_trusted: true }).visited) visited.add(scene);
  }
  if (chapter.id === "riftlight-finale") {
    for (const scene of allPaths(chapter, "manticore", "duskrunner", {
      fragment_paths_learned: true, fragment_coast_learned: true, fragment_sky_learned: true,
      three_fragments_ready: true, wyrm_ally: true, olivia_ally: true,
    }).visited) visited.add(scene);
  }
  expect([...visited].sort(), chapter.id).toEqual(Object.keys(chapter.scenes).sort());
}, 20_000); // Exhaustive walks across six party/history configurations run under V8 coverage in CI.

it.each([1, 2, 3])("the river never downs a three-person party starting at %i HP", (hp) => {
  const chapter = chapters.get("riftlight-headwaters-washout")!;
  const { ends } = allPaths(chapter, "manticore", "duskrunner", {}, 3, hp);
  for (const end of ends) {
    for (const member of end.party) { expect(member.hp).toBeGreaterThanOrEqual(1); expect(member.down).toBe(false); }
    expect(campaign.routeSets!.river_exit!.filter((f) => end.flags[f])).toHaveLength(1);
  }
  expect(ends.some((end) => end.flags.ossley_rescued)).toBe(true);
  for (const end of ends.filter((state) => state.flags.ossley_rescued)) {
    expect(end.party.some((member) => member.character.inventory.some((item) => item.itemId === "supper_bundle"))).toBe(true);
  }
});

it("nonlethal story damage floors at one, does not revive, and does not change ordinary damage", () => {
  const chapter = chapters.get("riftlight-headwaters-washout")!;
  for (const hp of [0, 1, 2, 3]) {
    const state = start(chapter, "manticore", "duskrunner");
    state.party[0]!.hp = hp; state.party[0]!.down = hp === 0;
    const safe = applyEffects(state, [{ type: "damage", amount: 5, to: "party", nonlethal: true }], context(chapter));
    expect(safe.party[0]!.hp).toBe(hp === 0 ? 0 : 1);
    expect(safe.party[0]!.down).toBe(hp === 0);
    const ordinary = applyEffects(state, [{ type: "damage", amount: 5, to: "party" }], context(chapter));
    expect(ordinary.party[0]!.hp).toBe(0); expect(ordinary.party[0]!.down).toBe(true);
  }
});

it("ending route guarantees remove phantom softlocks without hiding a missing route", () => {
  const graph = parseCampaignGraph(campaign).graph!;
  const options = { routeSets: campaign.routeSets, chapterFlags: chapterFlagsFrom(chapters) };
  expect(lintCampaignGraph(graph, options).findings).toEqual([]);
  const shelf = structuredClone(chapters.get("riftlight-ice-shelf-traverse")!);
  expect(chapterFlagWrites(shelf).requiredOneOf).toEqual(["traverse_failed", "traverse_made"]);
  shelf.scenes.rest_river!.onEnter = [{ type: "setFlag", flag: "traverse_failed" }, { type: "setFlag", flag: "traverse_failed", value: false }];
  expect(chapterFlagWrites(shelf).requiredOneOf).toBeUndefined();
  const broken = new Map(chapters); broken.set(shelf.id, shelf);
  expect(lintCampaignGraph(graph, { ...options, chapterFlags: chapterFlagsFrom(broken) }).findings.some((f) => f.code === "STRANDED")).toBe(true);
}, 60_000); // Two full-campaign searches, including the deliberately broken graph, under V8 coverage.

it("the linked glacier rift grants only one Riftspark and preserves a way back", () => {
  const graph = parseCampaignGraph(campaign).graph!;
  const first = { ...startJourney(graph), node: "hidden-glacier-rift", chapter: "riftlight-hidden-glacier-rift", flags: { glacier_rift_woken: true }, visits: { "hidden-glacier-rift": 1 } };
  const done = completeVisit(graph, first, { node: first.node, visit: first.visit, chapterId: first.chapter, outcome: "success", flags: first.flags }, campaign);
  if (!done.ok) throw new Error(done.message);
  const outward = takeExit(graph, done.journey, { edge: "glacier-to-saltrot", visit: 1 }, campaign);
  if (!outward.ok) throw new Error(outward.message);
  expect(outward.journey.buffs?.some((b) => b.id === "riftspark")).toBe(true);
  const coast = outward.journey;
  const finished = completeVisit(graph, coast, { node: coast.node, visit: coast.visit, chapterId: coast.chapter, outcome: "success", flags: coast.flags ?? {}, buffs: [] }, campaign);
  if (!finished.ok) throw new Error(finished.message);
  const back = takeExit(graph, finished.journey, { edge: "saltrot-to-glacier", visit: coast.visit }, campaign);
  if (!back.ok) throw new Error(back.message);
  expect(back.journey.node).toBe("hidden-glacier-rift");
  expect(back.journey.buffs?.some((b) => b.id === "riftspark")).not.toBe(true);
  const chapter = chapters.get("riftlight-hidden-glacier-rift")!;
  const returning = start(chapter, "manticore", "duskrunner", { glacier_rift_woken: true });
  expect(enterScene(returning, "chime", context(chapter)).state.narration).toContain("still ready");
  expect(enterScene(returning, "sing", context(chapter)).state.narration).toContain("does not need another note");
});

it("a background-only story biome needs explicit scene art rather than tactical tiles", { timeout: 20_000 }, () => {
  const root = stageRiftlightOpening();
  try {
    const file = path.join(root, "content/chapters/riftlight-buried-bridge.json");
    const chapter = JSON.parse(fs.readFileSync(file, "utf8"));
    chapter.biome="bramblewood";
    fs.writeFileSync(file, JSON.stringify(chapter));
    // This assertion concerns chapter art, not every route in the campaign.
    // Keep the shipping validator and assets, but give it a small valid route.
    const campaignFile = path.join(root, "content/campaigns", `${campaign.id}.json`);
    const fixture = JSON.parse(fs.readFileSync(campaignFile, "utf8"));
    // Retain all four class rooms as well as the chapter under test.
    const kept = [...chapters.values()].filter(c => c.index <= 3 || c.id === chapter.id || Object.values(c.scenes).some(s => "classPlace" in s)).map(c => c.id);
    for (const id of fixture.chapters) {
      if (!kept.includes(id)) fs.rmSync(path.join(root, "content/chapters", `${id}.json`));
    }
    fixture.chapters = kept;
    fixture.graph = { version: 1, entry: kept[0], flags: fixture.graph.flags,
      nodes: Object.fromEntries(kept.map((id, i) => [id, { chapter: id, ...(i === kept.length - 1 ? { ending: { title: "Art fixture" } } : {}) }])),
      edges: Object.fromEntries(kept.slice(1).map((id, i) => [`next_${i}`, { from: kept[i], to: id, kind: "forward" }])) };
    fs.writeFileSync(campaignFile, JSON.stringify(fixture));
    // A new graph, so a new proof, written as an author would (content:proofs).
    const baseline = runValidator(root, ["--write-proofs"]);
    expect(baseline.ok, baseline.output).toBe(true);
    delete chapter.scenes[chapter.entry].art;
    fs.writeFileSync(file, JSON.stringify(chapter));
    const result = runValidator(root);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('biome "bramblewood"'))).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("Attune is taught on the first regional visit and acknowledged on later visits", () => {
  for (const id of ["riftlight-sky-islands-arrival", "riftlight-saltrot-arrival"]) {
    const chapter = chapters.get(id)!;
    for (const taught of [false, true]) {
      const state = start(chapter, "kitsune", "starweaver", taught ? { attune_taught: true } : {});
      const result = enterScene(state, "lesson", context(chapter));
      expect(result.state.narration.includes("taught you before")).toBe(taught);
    }
  }
});

it("the route scenes keep diagnostic colors and finale secrets out of shared narration", () => {
  for (const chapter of chapters.values()) {
    expect(JSON.stringify(chapter.scenes), chapter.id).not.toMatch(/\b(amber|blue|green|violet)\b|summer crevasse|the (kind|sort|type) of thing that/i);
    if (chapter.id !== "riftlight-finale") expect(JSON.stringify(chapter.scenes), chapter.id).not.toMatch(/\b(Corvane|Pangea|emperor)\b/i);
  }
});
