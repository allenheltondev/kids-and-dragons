/**
 * The endgame played through the real engine (riftlight-convergence and
 * riftlight-finale, rewritten in November 2026; docs/campaigns/continental-rift/
 * convergence-review.md and finale-review.md). Each row is one route: votes,
 * dice at a chosen face and the one game with real actions. Fights take a
 * declared outcome here; riftlight-finale-combat.test.ts plays the four boards
 * turn by turn.
 *
 * What the rows protect is consequence, not counts:
 * - every success ending ticks every goal step and keeps only the chime;
 * - each piece the party learned is laid on the map (and anchored) in its own
 *   words, and a piece it never learned is a question mark, never a callback;
 * - the convergence's choices decide helped_bram / olivia_continued /
 *   pip_stayed_back, and the node's onComplete turns them into Olivia's status;
 * - earlier choices open later ways (Bram's rope, Seren's edge, the stop
 *   signal, Orin's word, the tracing; the brace, the reserve, the allies);
 * - a failed roll costs something a later scene reads, and the chapter goes on;
 * - a lost final battle costs a scar on the map, and only a failed recovery
 *   after it reaches Rivers Wander.
 */
import { applyEffects, completeVisit, enterScene, parseCampaignGraph, startJourney } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

type Outcome = "success" | "failure" | "assisted";
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
const hp = (s: RunState) => s.party.reduce((n, p) => n + p.hp, 0);
const product = <T extends Record<string, readonly unknown[]>>(axes: T) =>
  Object.entries(axes).reduce<Record<string, unknown>[]>((rows, [key, values]) =>
    rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);

interface Plan {
  picks: Record<string, string>;
  faces: Record<string, number>;
  games?: Record<string, Outcome>;
  battle?: "won" | "closed" | "lost";
}

/** Plays one route and keeps the state at every scene it passed. */
function walk(chapter: Chapter, initial: RunState, plan: Plan) {
  let state = initial;
  const trace = new Map<string, RunState>();
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${chapter.id}/${state.sceneId}`).toBeLessThan(90);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const lost = plan.battle === "lost";
      const branch = lost ? scene.onDefeat : scene.onVictory;
      const won = plan.battle === "closed" ? scene.environment?.objectives?.[0]?.effects ?? [] : [];
      state = applyEffects(state, [...won, ...(branch.effects ?? [])], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined();
      state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, plan.games?.[state.sceneId!] ?? "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, plan.faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = plan.picks[state.sceneId!];
      if (want) expect(offered(state, want), `${state.sceneId}: ${want}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: want ?? state.prompt.options[0]!.id }, chapter);
    } else {
      state = send(state, { type: "ADVANCE" }, chapter);
    }
  }
  trace.set(state.sceneId!, structuredClone(state));
  expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
  expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
  return { state, trace };
}

const PIECES = {
  pc: { fragment_paths_learned: true, fragment_coast_learned: true },
  ps: { fragment_paths_learned: true, fragment_sky_learned: true },
  cs: { fragment_coast_learned: true, fragment_sky_learned: true },
  pcs: { fragment_paths_learned: true, fragment_coast_learned: true, fragment_sky_learned: true },
} as const;
type Pieces = keyof typeof PIECES;
const has = (set: Pieces, piece: "p" | "c" | "s") => set.includes(piece);
const TOLD = { p: "memory ice", c: "buried bridge", s: "island that came back" } as const;

// --- The convergence ---------------------------------------------------------

const conv = chapters.get("riftlight-convergence")!;
const HISTORY = { trusted: { olivia_trusted: true, whales_scattered: true }, guided: { whales_guided: true }, skipped: {} } as const;
type History = keyof typeof HISTORY;

type ConvRoute = {
  pieces: Pieces; history: History; seats: 1 | 2 | 4;
  bram: "stake_pass" | "stake_fail" | "olivia";
  trace: "pass" | "fail"; chime: "pass" | "fail";
  pip: "chase_pass" | "chase_fail" | "call_pass" | "call_fail";
  rest: "olivia" | "bram"; asks: "wait" | "go";
  pull: "sled_success" | "sled_failure" | "sled_assisted" | "run" | "rope" | "seren";
  decision: "bram_pass" | "bram_fail" | "olivia_pass" | "olivia_fail" | "orin" | "signal" | "remind" | "beside";
  fish: "pass" | "fail";
  lesson: "self_pass" | "self_fail" | "pip_pass" | "pip_fail" | "traced";
};
const CONV_DEFAULT: ConvRoute = { pieces: "pc", history: "skipped", seats: 1, bram: "stake_pass", trace: "pass", chime: "pass",
  pip: "chase_pass", rest: "bram", asks: "wait", pull: "sled_success", decision: "bram_pass", fish: "pass", lesson: "self_pass" };
const face = (pass: boolean) => (pass ? 20 : 1);
const head = (s: string) => s.split("_")[0]!;
const stoppedHer = (d: ConvRoute["decision"]) => ["bram_pass", "bram_fail", "orin", "signal", "remind"].includes(d);

function convValid(r: ConvRoute) {
  const sharp = r.bram === "stake_pass";
  if (r.pull === "rope" && !sharp) return false;
  if (r.pull === "seren" && r.asks !== "wait") return false;
  if (r.decision === "signal" && r.rest !== "bram") return false;
  if (r.decision === "remind" && r.bram !== "olivia") return false;
  if (r.decision === "beside" && !(r.asks === "go" || r.pull === "run")) return false;
  if (r.lesson === "traced" && r.trace !== "pass") return false;
  return true;
}

function playConvergence(r: ConvRoute) {
  const flags = { ...PIECES[r.pieces], ...HISTORY[r.history], orin_chime_shared: r.decision === "orin" };
  const picks: Record<string, string> = {
    bram: r.bram === "olivia" ? "olivia" : "stake", pip_runs: head(r.pip), rest: r.rest, olivia_asks: r.asks,
    pull: r.pull.startsWith("sled") ? "sled" : r.pull, decision: head(r.decision), lesson: r.lesson === "traced" ? "traced" : head(r.lesson),
  };
  const faces: Record<string, number> = {
    check_line: face(r.bram === "stake_pass"), check_trace: face(r.trace === "pass"), chime_pull: face(r.chime === "pass"),
    check_chase: face(r.pip === "chase_pass"), check_call: face(r.pip === "call_pass"), check_bram: face(r.decision === "bram_pass"),
    check_olivia: face(r.decision === "olivia_pass"), fish: face(r.fish === "pass"), check_hold: face(r.lesson === "self_pass"),
    check_pip_hold: face(r.lesson === "pip_pass"),
  };
  const games: Record<string, Outcome> = { grab_sled: r.pull === "sled_failure" ? "failure" : r.pull === "sled_assisted" ? "assisted" : "success" };
  return walk(conv, start(conv, "manticore", "duskrunner", flags, r.seats), { picks, faces, games });
}

function completeConvergence(flags: Record<string, boolean>) {
  const graph = parseCampaignGraph(campaign).graph!;
  const initial = { ...startJourney(graph), node: "convergence", chapter: conv.id, visits: { convergence: 1 } };
  const done = completeVisit(graph, initial, { node: "convergence", chapterId: conv.id, visit: initial.visit, outcome: "success", flags }, campaign);
  if (!done.ok) throw new Error(done.message);
  return done.journey;
}

function checkConvergence(r: ConvRoute) {
  const { state, trace } = playConvergence(r);
  const ending = state.narration;

  // The beat: pieces laid, the fit seen, a side taken, Manipulate learned.
  expect(state.chapterOutcome).toBe("success");
  for (const step of conv.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
  expect(state.flags.manipulate_learned).toBe(true);
  expect(trace.has("fit")).toBe(true);
  expect(ending).toContain("on purpose. Who is it?");

  // Each learned piece in its own words; each missing one a question mark.
  const told = trace.get("tell_rivers")!.narration + trace.get("tell_sky")!.narration;
  for (const piece of ["p", "c", "s"] as const) {
    expect(told.includes(`You tell him about the ${TOLD[piece]}`), `${r.pieces} ${piece}`).toBe(has(r.pieces, piece));
  }
  expect((told.match(/question mark/g) ?? []).length).toBe(3 - r.pieces.length);
  expect(trace.get("fit")!.narration.includes("runs right under the buried bridge")).toBe(has(r.pieces, "c"));

  // Olivia, Bram and Pip: the journey flags and the status they become.
  const stopped = stoppedHer(r.decision);
  expect(state.flags.helped_bram === true).toBe(stopped);
  expect(state.flags.olivia_continued === true).toBe(!stopped);
  expect(state.flags.pip_stayed_back === true).toBe(stopped);
  const journey = completeConvergence(state.flags);
  const status = r.history === "trusted" ? (stopped ? "redeemed" : "ally") : "rival";
  expect(["ally", "redeemed", "rival"].filter(s => journey.flags?.[`olivia_${s}`])).toEqual([status]);
  expect(journey.facts?.attunement).toBe(2);
  expect(ending.includes("I'm listening now")).toBe(status === "redeemed");
  expect(ending.includes("help hold what's already there")).toBe(status === "ally");
  expect(ending.includes("Pip stays with Bram")).toBe(status === "rival" && stopped);
  expect(ending.includes("hurries after her")).toBe(status === "rival" && !stopped);

  // Earlier choices open later ways.
  const sharp = r.bram === "stake_pass";
  expect(trace.get("line_held")!.narration.includes("crooked stakes")).toBe(!sharp);
  expect(offered(trace.get("pull"), "rope")).toBe(sharp);
  expect(offered(trace.get("pull"), "seren")).toBe(r.asks === "wait");
  expect(offered(trace.get("decision"), "orin")).toBe(r.decision === "orin");
  expect(offered(trace.get("decision"), "signal")).toBe(r.rest === "bram");
  expect(offered(trace.get("decision"), "remind")).toBe(r.bram === "olivia");
  expect(offered(trace.get("decision"), "beside")).toBe(r.asks === "go" || r.pull === "run");
  expect(offered(trace.get("lesson"), "traced")).toBe(r.trace === "pass");

  // What failures and gambles cost, read later.
  const torn = r.pull === "sled_failure" || r.pull === "run";
  expect(trace.get("joining")!.narration.includes("torn corner of his map, come back")).toBe(torn);
  expect(trace.get("joining")!.narration.includes("Pip's notebook drops")).toBe(r.decision === "olivia_fail");
  expect(trace.get("rest")!.narration.includes("emergency crackers")).toBe(r.chime === "fail");
  if (r.decision === "bram_fail") expect(hp(trace.get("stopped")!)).toBeLessThan(hp(trace.get("decision")!));
  expect(ending.includes("still shimmers inside Bram's rope")).toBe(r.lesson === "self_fail" || r.lesson === "pip_fail");
  expect(JSON.stringify([...trace.values()].map(s => s.narration))).not.toMatch(/Corvane|Pangea|emperor/i);
}

const convDecisions = { bram: ["stake_pass", "stake_fail", "olivia"], trace: ["pass", "fail"], rest: ["olivia", "bram"], asks: ["wait", "go"],
  pull: ["sled_success", "sled_failure", "sled_assisted", "run", "rope", "seren"],
  decision: ["bram_pass", "bram_fail", "olivia_pass", "olivia_fail", "orin", "signal", "remind", "beside"],
  lesson: ["self_pass", "self_fail", "pip_pass", "pip_fail", "traced"], history: ["trusted", "guided", "skipped"], seats: [1, 2, 4] } as const;
const convEarly = { pieces: ["pc", "ps", "cs", "pcs"], bram: ["stake_pass", "stake_fail", "olivia"], trace: ["pass", "fail"], chime: ["pass", "fail"],
  pip: ["chase_pass", "chase_fail", "call_pass", "call_fail"], fish: ["pass", "fail"], history: ["trusted", "guided", "skipped"], seats: [1, 2, 4] } as const;
const convRows = [
  ...pairwise(product(convDecisions).map(row => ({ ...CONV_DEFAULT, ...row }) as ConvRoute).filter(convValid), Object.keys(convDecisions) as (keyof ConvRoute)[],
    { together: [["decision", "history"], ["bram", "pull", "decision"]] }),
  ...pairwise(product(convEarly).map(row => ({ ...CONV_DEFAULT, ...row }) as ConvRoute).filter(convValid), Object.keys(convEarly) as (keyof ConvRoute)[]),
];

describe("every route through the convergence", () => {
  it.each(convRows)("$pieces $history $bram trace:$trace chime:$chime $pip $rest $asks $pull $decision fish:$fish $lesson, $seats seats", checkConvergence);
});

// --- The finale ----------------------------------------------------------------

const fin = chapters.get("riftlight-finale")!;
const ALLIES = {
  none: {}, wyrm: { wyrm_ally: true }, ally: { olivia_ally: true }, redeemed: { olivia_redeemed: true, pip_stayed_back: true },
  rival: { olivia_rival: true, pip_stayed_back: true }, both: { wyrm_ally: true, olivia_ally: true },
} as const;
type Allies = keyof typeof ALLIES;
const TEMPLE = { settled: { temple_island_settled: true }, damaged: { temple_damaged: true }, none: {} } as const;

type FinRoute = {
  pieces: Pieces; allies: Allies; temple: keyof typeof TEMPLE; seats: 1 | 2 | 4;
  climb: "stair_pass" | "stair_fail" | "rope_pass" | "rope_fail";
  kid: "fetch_pass" | "fetch_fail" | "home";
  rest: "warm" | "ridge" | "broth";
  quiet: "pass" | "fail"; ask: "why" | "no";
  map: "force_pass" | "force_fail" | "show_pass" | "show_fail" | "home" | "bram_pass" | "bram_fail" | "olivia";
  anchors: "pass_pass" | "fail_pass" | "pass_fail";
  third: "reserve" | "ridge" | "third" | "wyrm" | "olivia"; thirdRoll: "pass" | "fail";
  seam: "face" | "braced";
  battle: "won" | "closed" | "lost_recovered" | "lost_failed";
  recovery: "brace" | "ask" | "reserve" | "pip" | "island";
  help: "wrap" | "maps"; fate: "ice" | "listen";
};
const FIN_DEFAULT: FinRoute = { pieces: "pc", allies: "none", temple: "none", seats: 1, climb: "stair_pass", kid: "fetch_pass", rest: "warm",
  quiet: "pass", ask: "why", map: "show_pass", anchors: "pass_pass", third: "reserve", thirdRoll: "pass", seam: "braced", battle: "won",
  recovery: "brace", help: "wrap", fate: "listen" };

function finFlags(r: FinRoute) {
  return { ...PIECES[r.pieces], ...ALLIES[r.allies], ...TEMPLE[r.temple], three_fragments_ready: r.pieces === "pcs" };
}
const listens = (r: FinRoute) => ["show_pass", "home", "olivia"].includes(r.map);
const braces = (r: FinRoute) => r.climb === "stair_pass" || r.rest === "ridge" || ["force_pass", "bram_pass"].includes(r.map) || r.third === "ridge";
function finValid(r: FinRoute) {
  const f = finFlags(r) as Record<string, boolean>;
  if (r.rest === "broth" && r.kid === "home") return false;
  if (r.map === "home" && r.ask !== "why") return false;
  if (r.map.startsWith("bram") && r.ask !== "no") return false;
  if (r.map === "olivia" && !f.olivia_redeemed) return false;
  if (r.third === "third" && r.pieces !== "pcs") return false;
  if (r.third === "wyrm" && !f.wyrm_ally) return false;
  if (r.third === "olivia" && !f.olivia_ally) return false;
  if (r.seam === "braced" && !braces(r)) return false;
  if (!r.battle.startsWith("lost") && r.recovery !== "brace") return false;
  if (r.recovery === "ask" && !listens(r)) return false;
  if (r.recovery === "reserve" && r.third !== "reserve") return false;
  if (r.recovery === "pip" && !f.pip_stayed_back) return false;
  if (r.recovery === "island" && !f.temple_island_settled) return false;
  return true;
}

const RECOVER = { brace: "recover_check", ask: "recover_ask", reserve: "recover_reserve", pip: "recover_pip", island: "recover_island" } as const;
function playFinale(r: FinRoute) {
  const picks: Record<string, string> = {
    herder: head(r.climb), kid_bridge: r.kid === "home" ? "home" : "fetch", rest: r.rest, his_story: r.ask,
    his_map: r.map === "home" || r.map === "olivia" ? r.map : head(r.map), corvane_two: r.third,
    seam: r.seam, seam_weak: r.seam, loss_plan: r.recovery, help_him: r.help, fate: r.fate,
  };
  const [a1, a2] = r.anchors.split("_");
  const faces: Record<string, number> = {
    check_stair: face(r.climb === "stair_pass"), check_rope: face(r.climb === "rope_pass"), check_kid: face(r.kid === "fetch_pass"),
    check_quiet: face(r.quiet === "pass"), check_force: face(r.map === "force_pass"), check_force_bram: face(r.map === "bram_pass"),
    check_show: face(r.map === "show_pass"), anchor_one: face(a1 === "pass"), anchor_two: face(a2 === "pass"),
    anchor_three: face(r.thirdRoll === "pass"), wyrm_anchor: face(r.thirdRoll === "pass"), olivia_anchor: face(r.thirdRoll === "pass"),
    [RECOVER[r.recovery]]: face(r.battle === "lost_recovered"),
  };
  const battle = r.battle.startsWith("lost") ? "lost" : r.battle as "won" | "closed";
  return walk(fin, start(fin, "manticore", "duskrunner", finFlags(r), r.seats), { picks, faces, battle });
}

function checkFinale(r: FinRoute) {
  const { state, trace } = playFinale(r);
  const f = finFlags(r) as Record<string, boolean>;
  const lost = r.battle.startsWith("lost"), failed = r.battle === "lost_failed";

  // The ending: one of the three, its flag, and the campaign over.
  expect(state.chapterOutcome).toBe(failed ? "setback" : "success");
  expect(state.sceneId).toBe(failed ? "loss_epilogue" : r.fate === "ice" ? "keepers_epilogue" : "listened_epilogue");
  expect(state.flags[failed ? "ending_rivers_wander" : r.fate === "ice" ? "ending_keepers" : "ending_listened"]).toBe(true);
  expect(fin.scenes[state.sceneId!]).toMatchObject({ endsCampaign: true });
  if (!failed) for (const step of fin.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
  expect(trace.has("reveal")).toBe(true);
  expect(trace.has("chime_straight")).toBe(!failed);

  // The anchors read the pieces this party learned, slot by slot.
  const one = trace.get("anchor_one")!.narration, two = trace.get("anchor_two")!.narration;
  expect(one).toContain(has(r.pieces, "p") ? "memory ice" : "buried bridge");
  expect(two).toContain(has(r.pieces, "p") && has(r.pieces, "c") ? "buried bridge" : "island that came back");
  expect(trace.has("anchor_three")).toBe(r.third === "third");
  expect(offered(trace.get("corvane_two"), "third")).toBe(r.pieces === "pcs");
  expect(offered(trace.get("corvane_two"), "wyrm")).toBe(!!f.wyrm_ally);
  expect(offered(trace.get("corvane_two"), "olivia")).toBe(!!f.olivia_ally);
  expect(offered(trace.get("his_map"), "olivia")).toBe(!!f.olivia_redeemed);
  const skySlot = r.third === "third" ? "anchor_three" : !has(r.pieces, "p") || !has(r.pieces, "c") ? "anchor_two" : undefined;
  if (skySlot) expect(trace.get(skySlot)!.narration.includes("mending its landing")).toBe(r.temple === "damaged");

  // Three anchors at most: fragments or one ally weakens him, never more.
  const weak = ["third", "wyrm", "olivia"].includes(r.third);
  const fights = [...trace.keys()].filter(k => k.startsWith("fight_"));
  expect(fights).toEqual([`fight_${weak ? "weakened" : "standard"}${r.seam === "braced" ? "_braced" : ""}`]);
  expect(offered(trace.get(weak ? "seam_weak" : "seam"), "braced")).toBe(braces(r));

  // Costs that later scenes read.
  expect(trace.get("figure")!.narration.includes("He has not seen you yet")).toBe(r.quiet === "pass");
  expect(trace.has("broth")).toBe(r.rest === "broth");
  const slipped = r.map === "show_fail" || r.anchors !== "pass_pass" || (weak && r.thirdRoll === "fail");
  if (!failed) {
    expect(state.narration.includes("settled a little crooked")).toBe(slipped);
    expect(state.narration.includes("scar on it")).toBe(lost);
    expect(state.narration.includes(r.fate === "ice" ? "Wake me if the rivers ever forget their way" : "Then tell me what you call this valley now")).toBe(true);
  } else {
    expect(state.narration).toContain("Then we learn the new map");
    expect(trace.has("fate")).toBe(false);
  }

  // A lost battle: the recovery, its ways in and their price.
  expect(trace.has("loss_recover")).toBe(lost);
  if (lost) {
    const plan = trace.get("loss_plan")!;
    expect(offered(plan, "ask")).toBe(listens(r));
    expect(offered(plan, "reserve")).toBe(r.third === "reserve");
    expect(offered(plan, "pip")).toBe(!!f.pip_stayed_back);
    expect(offered(plan, "island")).toBe(r.temple === "settled");
    expect(state.flags.final_fell_back).toBe(true);
    expect(state.flags.final_battle_lost === true).toBe(failed);
  }

  // Who is there at the end.
  const tail = state.narration;
  expect(tail.includes("study with Orin") || tail.includes("starts on the first river")).toBe(r.allies === "redeemed");
  expect(tail.includes("trying her own way")).toBe(r.allies === "rival");
  if (!failed) expect(tail.includes("for Bram, with drawings")).toBe(!!f.pip_stayed_back);
  expect(tail.includes("frost wyrm")).toBe(!!f.wyrm_ally);

  // Nothing names him before the reveal.
  for (const [id, s] of trace) {
    if (id === "reveal") break;
    expect(s.narration, id).not.toMatch(/Corvane|Pangea|emperor|\bking\b/i);
  }
}

// Axes that only gate one later way are derived from the seat count, so the
// products stay small enough to pick pairs from.
const derive = (r: FinRoute): FinRoute => ({
  ...r,
  ask: r.map === "home" ? "why" : r.map.startsWith("bram") ? "no" : r.seats === 1 ? "why" : "no",
  temple: r.recovery === "island" ? "settled" : r.seats === 1 ? "none" : r.seats === 2 ? "damaged" : "settled",
  thirdRoll: r.seats === 4 ? "fail" : "pass",
});
const ENDINGS = { wrap_ice: ["wrap", "ice"], wrap_listen: ["wrap", "listen"], maps_ice: ["maps", "ice"], maps_listen: ["maps", "listen"] } as const;
const finRoad = { pieces: ["pc", "ps", "cs", "pcs"], climb: ["stair_pass", "stair_fail", "rope_pass", "rope_fail"], kid: ["fetch_pass", "fetch_fail", "home"],
  rest: ["warm", "ridge", "broth"], quiet: ["pass", "fail"],
  map: ["force_pass", "force_fail", "show_pass", "show_fail", "home", "bram_pass", "bram_fail"], anchors: ["pass_pass", "fail_pass", "pass_fail"],
  seats: [1, 2, 4] } as const;
const finEnd = { pieces: ["pc", "cs", "pcs"], allies: ["none", "wyrm", "ally", "redeemed", "rival", "both"], third: ["reserve", "ridge", "third", "wyrm", "olivia"],
  seam: ["face", "braced"], battle: ["won", "closed", "lost_recovered", "lost_failed"],
  recovery: ["brace", "ask", "reserve", "pip", "island"], ending: Object.keys(ENDINGS), seats: [1, 2, 4] } as const;
const asRoute = (row: Record<string, unknown>) => {
  const { ending, ...rest } = row as { ending?: keyof typeof ENDINGS };
  const [help, fate] = ending ? ENDINGS[ending] : [FIN_DEFAULT.help, FIN_DEFAULT.fate];
  return derive({ ...FIN_DEFAULT, ...rest, help, fate } as FinRoute);
};
const finRows = [
  ...pairwise(product(finRoad).map(asRoute).filter(finValid), Object.keys(finRoad) as (keyof FinRoute)[],
    { together: [["pieces", "anchors"], ["climb", "rest", "map"]] }),
  ...pairwise(product(finEnd).map(row => ({ ...asRoute(row), ending: row.ending }) as FinRoute).filter(finValid), Object.keys(finEnd) as (keyof FinRoute)[],
    { together: [["pieces", "allies", "third"], ["battle", "recovery"]] }),
];

describe("every route through the finale", () => {
  it.each(finRows)("$pieces $allies $climb $kid $rest quiet:$quiet $ask $map $anchors $third/$thirdRoll $seam $battle/$recovery $help $fate, $seats seats", checkFinale);
});
