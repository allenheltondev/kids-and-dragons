/**
 * The four "road out" chapters after their November 2026 revision
 * (docs/campaigns/continental-rift/arc.md, road-out-review.md): Frostfang Shore,
 * the Cairnstep, Boundary Stone Bank and Ashspan Bridge. Each asks its goal as a
 * question in scene 1, carries a piece of the clue trail on every road (a p2 and
 * the Listening Chime leaning toward the glacier), offers a force-or-understand
 * choice whose costs reach later scenes, and closes on the campaign question.
 * These walks go through the real engine; they test consequences, not counts.
 */
import { describe, expect, it } from "vitest";
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, ClassId, RunState, SpeciesId } from "@kad/shared";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

type Outcome = "success" | "failure" | "assisted";
interface Script {
  /** The choice to make at a scene; otherwise the first option offered. */
  choose?: Record<string, string>;
  /** Scenes whose roll or game fails; every other roll succeeds and every game is won. */
  fail?: string[];
  /** Interaction scenes settled by assistance rather than played. */
  assist?: string[];
  /** Fights lost; every other fight is won. */
  lose?: string[];
  flags?: Record<string, boolean>;
  species?: SpeciesId;
  cls?: ClassId;
  seats?: number;
}

/** Only these story interactions can be missed; the rest (cooperate, balance, play) always succeed. */
const FAILABLE = new Set(["timing", "precision", "memory", "sequence", "tracking", "relay"]);

/** Plays a chapter start to finish through the engine, recording each scene's words and offered choices. */
function play(chapter: Chapter, script: Script = {}) {
  let state = start(chapter, script.species ?? "manticore", script.cls ?? "duskrunner", script.flags ?? {}, script.seats ?? 1);
  const words: Record<string, string> = {};
  const offered: Record<string, string[]> = {};
  const path: string[] = [];
  const hp: Record<string, number> = {};
  for (let step = 0; state.phase !== "chapter_complete"; step++) {
    expect(step, `${chapter.id}: runaway walk`).toBeLessThan(120);
    const id = state.sceneId!;
    path.push(id);
    words[id] = state.narration ?? "";
    hp[id] = state.party[0]!.hp;
    const scene = chapter.scenes[id]!;
    if (scene.type === "encounter") {
      const branch = script.lose?.includes(id) ? scene.onDefeat : scene.onVictory;
      state = enterScene(applyEffects(state, branch.effects ?? [], context(chapter)), branch.goto, context(chapter)).state;
    } else if (state.prompt?.kind === "interaction") {
      const outcome: Outcome = script.fail?.includes(id) && FAILABLE.has(state.prompt.spec.kind) ? "failure" : script.assist?.includes(id) ? "assisted" : "success";
      state = finishInteraction(state, chapter, outcome);
    } else if (state.prompt?.kind === "choice") {
      offered[id] = state.prompt.options.map((o) => o.id);
      const pick = script.choose?.[id] ?? state.prompt.options[0]!.id;
      expect(offered[id], `${chapter.id}/${id} offers ${pick}`).toContain(pick);
      state = send(state, { type: "CHOOSE", choiceId: pick }, chapter);
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, script.fail?.includes(id) ? 1 : 20);
    } else throw new Error(`${chapter.id}/${id}: unexpected ${state.prompt?.kind}`);
  }
  path.push(state.sceneId!);
  words[state.sceneId!] = state.narration ?? "";
  return { state, words, offered, path, hp, visited: new Set(path) };
}

function goalTicked(chapter: Chapter, state: RunState) {
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], `${chapter.id}: ${step.flag}`).toBe(true);
}

/** Scenes that cannot be avoided: with this scene removed, no ending is reachable. */
function onEveryRoad(chapter: Chapter, sceneId: string) {
  const exits = (id: string): string[] => {
    const s = chapter.scenes[id]!;
    if (s.type === "check") return [s.onSuccess.goto, s.onFailure.goto];
    if (s.type === "interaction") return [s.onSuccess.goto, s.onFailure.goto, ...(s.onAssisted ? [s.onAssisted.goto] : [])];
    if (s.type === "encounter") return [s.onVictory.goto, s.onDefeat.goto];
    return (s.choices ?? []).map((c) => c.goto);
  };
  const seen = new Set([chapter.entry]);
  const queue = [chapter.entry];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === sceneId) continue;
    for (const to of exits(id)) if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
  return Object.entries(chapter.scenes).filter(([, s]) => "outcome" in s && s.outcome).every(([id]) => !seen.has(id));
}

const ROAD_OUT = [
  { id: "riftlight-frostfang-shore", question: "Can we find a dry way uphill", chime: "chime", clue: "river_line", clueWords: "It has never come this high" },
  { id: "riftlight-cairnstep-pass", question: "Is this pass real? Does it belong on the map?", chime: "notch", clue: "old_page", clueWords: "nothing around it that is here now" },
  { id: "riftlight-boundary-stone-bank", question: "Why did the river shove the stones?", chime: "lean", clue: "clue", clueWords: "Nobody's count matches the eruption" },
  { id: "riftlight-ashspan-bridge", question: "Can we get everyone across? And the bridge mended?", chime: "span_stone", clue: "span_stone", clueWords: "No rock like that for a hundred miles" },
] as const;

describe("the road out: what every chapter keeps", () => {
  it.each(ROAD_OUT)("$id asks its question in scene 1, plainly and briefly", ({ id, question }) => {
    const chapter = chapters.get(id)!;
    expect(chapter.goal!.text.endsWith("?")).toBe(true);
    expect(chapter.estimatedMinutes).toBe(30);
    const opening = start(chapter, "manticore", "duskrunner").narration!;
    expect(opening).toContain(question);
    expect(opening.length).toBeLessThan(620);
  });

  it.each(ROAD_OUT)("$id: the chime leans toward the glacier and the clue is found, on every road", ({ id, chime, clue, clueWords }) => {
    const chapter = chapters.get(id)!;
    expect(onEveryRoad(chapter, chime)).toBe(true);
    expect(onEveryRoad(chapter, clue)).toBe(true);
    expect(chapter.scenes[clue]).toMatchObject({ priority: 2 });
    const plain = play(chapter);
    expect(plain.words[chime]).toMatch(/Listening Chime/);
    expect(plain.words[chime]).toMatch(/toward the glacier/);
    expect(plain.words[clue]).toContain(clueWords);
    // At most one p1 on any road: these chapters have none.
    expect(Object.values(chapter.scenes).some((s) => "priority" in s && s.priority === 1)).toBe(false);
  });

  it.each(ROAD_OUT)("$id closes on the campaign question with tonight's piece added", ({ id }) => {
    const chapter = chapters.get(id)!;
    const { state } = play(chapter);
    expect(state.narration).toContain("So here is tonight's piece");
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");
  });

  it.each(ROAD_OUT.flatMap((c) => ([["manticore", "duskrunner"], ["bigfoot", "thornguard"], ["griffin", "songkeeper"], ["kitsune", "starweaver"]] as const)
    .map(([species, cls]) => ({ ...c, species, cls }))))("$id: every ending of every $species $cls road is a success that ticks the goal and keeps the chime", ({ id, species, cls }) => {
    const chapter = chapters.get(id)!;
    const { ends } = allPaths(chapter, species, cls);
    const journey = new Set(campaign.graph!.flags);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      goalTicked(chapter, end);
      expect(end.party.some((p) => p.character.questItems.includes("listening_chime"))).toBe(true);
      // The road out sets no journey flag: nothing here crosses the chapter but the graph's own edges.
      expect(Object.entries(end.flags).filter(([flag, on]) => on && journey.has(flag))).toEqual([]);
    }
  });

  it.each(ROAD_OUT)("$id: a party that fails every roll and game still reaches the beat", ({ id }) => {
    const chapter = chapters.get(id)!;
    const everything = Object.keys(chapter.scenes);
    const { state } = play(chapter, { fail: everything, lose: everything });
    expect(state.chapterOutcome).toBe("success");
    goalTicked(chapter, state);
  });
});

describe("Frostfang Shore: push the goats, or watch the boss goat", () => {
  const chapter = chapters.get("riftlight-frostfang-shore")!;

  it("pushing keeps the hay but the goats stay cross, and their track stays hidden", () => {
    const r = play(chapter, { choose: { goats: "push" } });
    expect(r.state.flags.goats_forced).toBe(true);
    expect(r.words.goat_back).toContain("Then the boss goat spots the hay net");
    expect(r.words.surge).toContain("still cross with you");
    expect(r.offered.ascend).not.toContain("track");
    expect(r.state.narration).toContain("still not speaking to you");
    expect(r.state.narration).not.toContain("new hay");
  });

  it("a failed push leaves the boss goat sulking in the stream: one more roll to haul it out", () => {
    const r = play(chapter, { choose: { goats: "push" }, fail: ["goat_push"] });
    expect(r.visited.has("boss_sulk")).toBe(true);
    expect(r.state.flags.goats_forced).toBe(true);
  });

  it("watching costs the hay, and a good watch finds the goats' dry track for the climb", () => {
    const r = play(chapter, { choose: { goats: "watch", ascend: "track" } });
    expect(r.visited.has("goat_track_seen")).toBe(true);
    expect(r.words.goat_back).toContain("carried the hay away");
    expect(r.words.goat_back).not.toContain("spots the hay net");
    expect(r.offered.ascend).toContain("track");
    expect(r.visited.has("climb_track")).toBe(true);
    expect(r.state.narration).toContain("new hay");
    expect(r.state.flags.goats_forced).toBe(false);
  });

  it("a missed watch still costs the hay and finds no track", () => {
    const r = play(chapter, { choose: { goats: "watch" }, fail: ["goat_watch"] });
    expect(r.visited.has("goat_track_seen")).toBe(false);
    expect(r.offered.ascend).not.toContain("track");
    expect(r.state.narration).toContain("new hay");
  });

  it("dropping the kid goat strains Tamsin's wing: she cannot fly the news ahead", () => {
    const r = play(chapter, { fail: ["bar_carry"] });
    expect(r.visited.has("kid_swept")).toBe(true);
    expect(r.words.ascend).toContain("good wing");
    expect(r.state.narration).toContain("can't fly far with that wing");
    const steady = play(chapter);
    expect(steady.state.narration).toContain("I'll fly ahead and tell Brask");
  });

  it("a clumsy knot leaves the ladder wobbling when the wave comes, and a mistimed run costs a soaking", () => {
    const r = play(chapter, { choose: { help: "lash" }, fail: ["lash_foot", "wave_gap"] });
    expect(r.words.foot_set).toContain("it wobbles");
    expect(r.words.surge_after).toContain("wobbly ladder");
    expect(r.visited.has("wave_catch")).toBe(true);
    const dry = play(chapter, { choose: { help: "lash" }, fail: ["lash_foot"] });
    expect(dry.words.surge_after).toContain("wobbly ladder");
    expect(dry.visited.has("wave_catch")).toBe(false);
    expect(r.hp.ascend).toBeLessThan(dry.hp.ascend!);
  });

  it("a rail costs your rope or three coins and earns Tamsin's charm; leaving it costs nothing and earns nothing", () => {
    const rope = play(chapter, { choose: { safety: "rope" } });
    expect(rope.state.narration).toContain("Your rope hangs down the cliff");
    const left = play(chapter, { choose: { safety: "leave" } });
    expect(left.state.narration).not.toMatch(/rope hangs|bell peg/);
    const charm = (s: RunState) => s.party.some((p) => p.character.inventory.some((i) => i.itemId === "river_charm"));
    expect(charm(rope.state)).toBe(true);
    expect(charm(left.state)).toBe(false);
  });
});

describe("The Cairnstep: lean on the slab, or listen to it", () => {
  const chapter = chapters.get("riftlight-cairnstep-pass")!;

  it("leaning proves the slab but cracks the neck: the pass cannot be written open", () => {
    const r = play(chapter, { choose: { moved: "lean", mark: "warn" } });
    expect(r.words.tested).toContain("Your shove did that");
    expect(r.offered.mark).not.toContain("open");
    expect(r.offered.neck).not.toContain("heard");
  });

  it("listening finds the hollow and a safe line across the neck, but the wolves get a loaf first", () => {
    const r = play(chapter, { choose: { moved: "listen", neck: "heard", mark: "open" } });
    expect(r.offered.neck).toContain("heard");
    expect(r.visited.has("neck_heard")).toBe(true);
    expect(r.offered.mark).toContain("open");
    expect(r.words.shelter_found).toContain("One already has a loaf");
    expect(r.state.narration).toContain("a loaf short");
  });

  it("a missed listen still costs the loaf and learns no safe line", () => {
    const r = play(chapter, { choose: { moved: "listen" }, fail: ["test_roll"] });
    expect(r.offered.neck).not.toContain("heard");
    expect(r.state.narration).toContain("a loaf short");
  });

  it("the old page is carried home whole only if it was learned by heart", () => {
    expect(play(chapter).state.narration).toContain("boot lake and two horns");
    const forgot = play(chapter, { fail: ["drawing_memory"] });
    expect(forgot.state.narration).toContain("if not the landmarks around it");
  });

  it("a dropped capstone leaves Brask standing at the neck himself", () => {
    const r = play(chapter, { fail: ["capstone"] });
    expect(r.visited.has("capstone_fall")).toBe(true);
    expect(r.state.narration).toContain("Brask will stand at the neck himself");
  });

  it("the griffins owe the party a flight to their island neighbors", () => {
    const { state } = play(chapter);
    expect(state.narration).toContain("the aerie owes you a flight");
    expect(campaign.graph!.edges["pass-to-sky"]).toMatchObject({ from: "cairnstep-pass", to: "sky-islands-arrival" });
  });
});

describe("Boundary Stone Bank: heave Splash up, or dig round him first", () => {
  const chapter = chapters.get("riftlight-boundary-stone-bank")!;

  it("heaving is quick but chips Splash's top notch, so the count is less sure", () => {
    const r = play(chapter, { choose: { plan: "lever" } });
    expect(r.state.flags.splash_forced).toBe(true);
    expect(r.visited.has("trench_out")).toBe(false);
    expect(r.words.splash_up).toContain("His top notch is chipped");
    expect(r.words.compare).toContain("chipped notch");
    expect(r.words.clue).toContain("even your count is a guess");
    expect(r.state.narration).toContain("top notch chipped");
  });

  it("digging shows the river came over the top, at the price of a scramble out of the flooding trench", () => {
    const r = play(chapter, { choose: { plan: "dig" } });
    expect(r.visited.has("dug_found")).toBe(true);
    expect(r.words.dug_found).toContain("It came over the top");
    expect(r.visited.has("trench_out")).toBe(true);
    expect(r.words.splash_up).toContain("without a scratch");
    expect(r.words.clue).not.toContain("even your count is a guess");
    expect(r.state.narration).toContain("the river came over the top");
  });

  it("a slow scramble out of the flooding trench loses the kettle, and tea comes in Tally's hat", () => {
    const r = play(chapter, { choose: { plan: "dig" }, fail: ["trench_out"] });
    expect(r.words.surge_safe).toContain("after her kettle");
    expect(r.words.rest_row).toContain("in her hat");
    const quick = play(chapter, { choose: { plan: "dig" } });
    expect(quick.words.rest_row).not.toContain("in her hat");
  });

  it("a slack count cord makes the fourth stone a guess, and Tally must tighten it before she goes", () => {
    const r = play(chapter, { fail: ["tighten"] });
    expect(r.words.tight).toContain("small question mark");
    expect(r.state.narration).toContain("still sags");
  });

  it("the flood came above every notch, which is why it shoved the stones", () => {
    const r = play(chapter);
    expect(r.words.notch_plan).toContain("above every notch");
    expect(r.state.narration).toContain("higher than any notch in the count");
  });

  it("Tally is greeted in words true whether or not a party met her at the counting stones", () => {
    const opening = start(chapter, "manticore", "duskrunner").narration!;
    expect(opening).toContain("If we've met, I've counted you twice now");
    expect(chapter.voiceGuide!.npcVoices).toHaveProperty("Tally");
  });
});

describe("Ashspan Bridge: haul the jam loose, or find the log that holds it", () => {
  const chapter = chapters.get("riftlight-ashspan-bridge")!;

  it("hauling clears the jam fast but chips the old span stone, which Bryn must patch", () => {
    const r = play(chapter, { choose: { jam_plan: "haul" } });
    expect(r.state.flags.pier_chipped).toBe(true);
    expect(r.words.span_stone).toContain("you can see right inside it");
    expect(r.words.beam_plan).toContain("patches the chipped span stone");
    expect(r.state.narration).toContain("fresh patch of Bryn's mortar");
    expect(r.state.flags.lost_a_plank).toBe(false);
  });

  it("studying spares the stone but the river takes a plank, so Ossley gives up a board from his boat", () => {
    const r = play(chapter, { choose: { jam_plan: "study" } });
    expect(r.state.flags.pier_chipped).toBe(false);
    expect(r.words.planks_plan).toContain("One short");
    expect(r.words.planks_laid).toContain("pries up a board from his own deck");
    expect(r.words.rest_hut).toContain("A dry mat would cover that");
    expect(r.state.narration).toContain("Ossley's boat is a board short");
  });

  it("the reed mat from the marsh covers the hole in Ossley's boat", () => {
    const r = play(chapter, { choose: { jam_plan: "study", rest_hut: "marsh", village_rest: "return" } });
    expect(r.words.mat_return).toContain("covers the hole where his board was");
    expect(r.state.flags.mended_the_bridge_deck).toBe(true);
  });

  it("a hard bump at the dock wakes the eggs early", () => {
    const r = play(chapter, { fail: ["ferry_dock"] });
    expect(r.visited.has("dock_bump")).toBe(true);
    expect(r.words.hatch).toContain("That bump at the dock");
  });

  it("Ossley's greeting remembers the river only for a party that shared it, in words true whichever way the rope went", () => {
    const shared = start(chapter, "manticore", "duskrunner", { ossley_rescued: true }).narration!;
    const fresh = start(chapter, "manticore", "duskrunner").narration!;
    expect(shared).toContain("You, me, and a rope.");
    expect(fresh).not.toContain("You, me, and a rope.");
    for (const text of [shared, fresh]) expect(text).toContain("Old Ossley, the frogfolk boatman");
  });
});
