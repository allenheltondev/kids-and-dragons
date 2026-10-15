/**
 * Class rift interaction (#199): several ways to the same rift action, each
 * judged against the seated party (`requires`), a class's progression kept as
 * a world fact, and the lint's proof that no class is mandatory.
 *
 * Most cases walk the Sealed Rift fixture (fixtures/rift-classes.campaign.json):
 *
 *   camp (pass, entry) ── camp-to-tower ──▶ observatory (closed; attunement +1)
 *     │                ── camp-to-hut ────▶ hermit-hut (pass; the hermit befriended)
 *     └── camp-to-gate ──▶ rift-gate (pass)
 *            ├── veil-rift (sealed; opened by an action) ──▶ far-shore ──▶ dawn
 *            │     discover: sense (Starweaver, attunement +1)
 *            │     open:     attune (Starweaver, attunement ≥ 2) · force (Thornguard, tears the veil)
 *            │               calm (Songkeeper) · lantern (carries a Mosslight Jar) · hermit (the friend; anyone)
 *            │     redirect: weave (Starweaver, attunement ≥ 3) ──▶ starfall ──▶ dawn
 *            └── shadow-path (hidden, asleep) ──▶ far-shore
 *                  discover: scout (Duskrunner — and the scouting opens it)
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARTY_CLASS_IDS, parseCampaignGraph, riftActionWays, type ParsedCampaignGraph } from "./campaign-graph.js";
import { exploreCampaignGraph, lintCampaignGraph } from "./campaign-graph-lint.js";
import { completeVisit, journeyView, startJourney, takeExit, takeRiftAction, type RiftActionReport } from "./journey.js";
import { partyMeets, riftActionsForParty, riftActionsFrom, riftPartyOf } from "./rift-actions.js";
import type { Campaign } from "./types/chapter.js";
import type { JourneyState, RiftActionRule, RiftParty } from "./types/campaign-graph.js";
import type { ClassId, ResolvedCharacter } from "./types/domain.js";

const fixture = (): Campaign =>
  JSON.parse(readFileSync(new URL("./fixtures/rift-classes.campaign.json", import.meta.url), "utf8")) as Campaign;

function parsed(c: Campaign = fixture()): ParsedCampaignGraph {
  const { graph, problems } = parseCampaignGraph(c);
  expect(problems).toEqual([]);
  return graph!;
}

function bent(mutate: (graph: NonNullable<Campaign["graph"]>) => void): Campaign {
  const c = fixture();
  mutate(c.graph!);
  return c;
}

const party = (classes: ClassId[], items: string[] = []): RiftParty => ({ classes, items });
const NOBODY = party([]);
const nothing = () => ({ setsTrue: [], setsFalse: [] });

function play(graph: ParsedCampaignGraph, journey: JourneyState): JourneyState {
  const result = completeVisit(graph, journey, {
    node: journey.node,
    visit: journey.visit,
    chapterId: journey.chapter,
    outcome: "success",
    flags: {},
  });
  if (!result.ok || result.duplicate) throw new Error(`completion: ${JSON.stringify(result)}`);
  return result.journey;
}

function go(graph: ParsedCampaignGraph, journey: JourneyState, edge: string): JourneyState {
  const result = takeExit(graph, journey, { edge, visit: journey.visit });
  if (!result.ok || result.duplicate) throw new Error(`exit ${edge}: ${JSON.stringify(result)}`);
  // Arriving somewhere new plays it; a "pass" place begins done.
  return result.journey.status === "playing" ? play(graph, result.journey) : result.journey;
}

function act(graph: ParsedCampaignGraph, journey: JourneyState, report: Omit<RiftActionReport, "visit">, by: RiftParty): JourneyState {
  const result = takeRiftAction(graph, journey, { ...report, visit: journey.visit }, undefined, { party: by });
  if (!result.ok || result.duplicate) throw new Error(`action ${report.action}/${report.way}: ${JSON.stringify(result)}`);
  return result.journey;
}

/** Started, the camp played, and standing at the sealed rift's choice. */
function atTheGate(graph: ParsedCampaignGraph): JourneyState {
  return go(graph, play(graph, startJourney(graph)), "camp-to-gate");
}

const ways = (graph: ParsedCampaignGraph, j: JourneyState) =>
  riftActionsFrom(graph, j.node, j).map((offer) => `${offer.action}:${offer.way ?? "-"}`);

describe("declaring several ways to one action", () => {
  it("reads the fixture: lists of ways, a lone named way, and who each needs", () => {
    const graph = parsed();
    const rift = graph.edges["veil-rift"]!.rift;
    expect(riftActionWays(rift, "open").map((each) => [each.way, each.at])).toEqual([
      ["attune", "actions/open/0"],
      ["force", "actions/open/1"],
      ["calm", "actions/open/2"],
      ["lantern", "actions/open/3"],
      ["hermit", "actions/open/4"],
    ]);
    expect(riftActionWays(rift, "redirect")).toMatchObject([{ way: "weave", at: "actions/redirect" }]);
    expect(riftActionWays(rift, "open")[1]!.rule.requires).toEqual({ anyClass: ["thornguard"] });
    expect(riftActionWays(rift, "close")).toEqual([]);
  });

  it("refuses a list way with no id or a repeated one, an unknown class, an empty or unknown requirement, a hint nobody needs", () => {
    const problems = (mutate: (open: RiftActionRule[]) => void) =>
      parseCampaignGraph(
        bent((g) => mutate(g.edges["veil-rift"]!.rift!.actions!.open as RiftActionRule[])),
      ).problems.map((p) => `${p.path}: ${p.problem}`);
    expect(problems((open) => delete open[1]!.id)).toEqual([
      expect.stringMatching(/^\/graph\/edges\/veil-rift\/rift\/actions\/open\/1\/id: every way in a list needs an id/),
    ]);
    expect(problems((open) => (open[1]!.id = "attune"))).toEqual([expect.stringMatching(/open\/1\/id: "attune" names two ways/)]);
    expect(problems((open) => (open[1]!.requires = { anyClass: ["wizard" as ClassId] }))).toEqual([
      expect.stringMatching(/open\/1\/requires\/anyClass\/0: no class "wizard"/),
    ]);
    expect(problems((open) => (open[1]!.requires = {}))).toEqual([expect.stringMatching(/requires asks nothing/)]);
    expect(problems((open) => (open[1]!.requires = { anyClass: [] }))).toEqual([expect.stringMatching(/anyClass must be a non-empty list/)]);
    expect(problems((open) => ((open[1]!.requires as Record<string, unknown>).species = ["unicorn"]))).toEqual([
      expect.stringMatching(/unknown requirement "species"/),
    ]);
    expect(problems((open) => (open[4]!.hint = "Anyone could"))).toEqual([expect.stringMatching(/open\/4\/hint: a hint is for a party/)]);
    expect(problems((open) => open.splice(0))).toEqual([expect.stringMatching(/a list of ways needs at least one rule/)]);
  });

  it("knows exactly the classes the rules content declares", () => {
    const rules = JSON.parse(readFileSync(new URL("../../../content/rules.json", import.meta.url), "utf8")) as {
      classes: Record<string, unknown>;
    };
    expect([...PARTY_CLASS_IDS].sort()).toEqual(Object.keys(rules.classes).sort());
  });
});

describe("who is at the table", () => {
  const hero = (cls: ClassId, inventory: string[] = [], questItems: string[] = []) =>
    ({ class: cls, inventory: inventory.map((itemId) => ({ itemId, kind: "consumable" })), questItems }) as Pick<
      ResolvedCharacter,
      "class" | "inventory" | "questItems"
    >;

  it("reads every class seated and every item carried, quest items included, without repeats", () => {
    expect(riftPartyOf([hero("thornguard", ["mosslight_jar"]), hero("starweaver", [], ["rusted_key"]), hero("thornguard")])).toEqual({
      classes: ["starweaver", "thornguard"],
      items: ["mosslight_jar", "rusted_key"],
    });
    expect(riftPartyOf([])).toEqual({ classes: [], items: [] });
  });

  it("meets a requirement when someone matches every field (any one of a list)", () => {
    expect(partyMeets(undefined, NOBODY)).toBe(true);
    expect(partyMeets({ anyClass: ["starweaver", "songkeeper"] }, party(["songkeeper"]))).toBe(true);
    expect(partyMeets({ anyClass: ["starweaver"] }, party(["songkeeper"]))).toBe(false);
    expect(partyMeets({ anyItem: ["mosslight_jar"] }, party([], ["mosslight_jar"]))).toBe(true);
    expect(partyMeets({ anyClass: ["starweaver"], anyItem: ["mosslight_jar"] }, party(["starweaver"]))).toBe(false);
  });
});

describe("the journey offers; the party is judged", () => {
  it("offers every way whose `when` holds, whoever is seated — the journey's half alone", () => {
    const graph = parsed();
    const gate = atTheGate(graph);
    expect(ways(graph, gate)).toEqual(["discover:sense", "open:force", "open:calm", "open:lantern", "discover:scout"]);
  });

  it("refuses a way nobody seated can take, and writes nothing", () => {
    const graph = parsed();
    const gate = atTheGate(graph);
    const tried = takeRiftAction(graph, gate, { action: "open", way: "force", edge: "veil-rift", visit: gate.visit }, undefined, {
      party: party(["songkeeper"]),
    });
    expect(tried).toMatchObject({ ok: false, code: "party-cannot" });
    expect((tried as { message: string }).message).toMatch(/needs a thornguard/);
  });

  it("asks which way when there are several, and refuses one the rift does not have", () => {
    const graph = parsed();
    const gate = atTheGate(graph);
    expect(takeRiftAction(graph, gate, { action: "open", edge: "veil-rift", visit: gate.visit })).toMatchObject({
      ok: false,
      code: "not-offered",
      message: expect.stringMatching(/say which \(attune, force, calm, lantern, hermit\)/),
    });
    expect(takeRiftAction(graph, gate, { action: "open", way: "shove", edge: "veil-rift", visit: gate.visit })).toMatchObject({
      ok: false,
      code: "not-offered",
    });
    // The journey's half first: the hermit is no friend yet, whoever asks.
    expect(takeRiftAction(graph, gate, { action: "open", way: "hermit", edge: "veil-rift", visit: gate.visit }, undefined, { party: NOBODY })).toMatchObject({
      ok: false,
      code: "not-offered",
    });
  });

  it("records the way taken, and a repeat of it is the same action — a lone named way answers without its name", () => {
    const graph = parsed();
    const gate = atTheGate(graph);
    const thornguard = party(["thornguard"]);
    const report: RiftActionReport = { action: "open", way: "force", edge: "veil-rift", visit: gate.visit };
    const forced = act(graph, gate, report, thornguard);
    expect(forced.lastAction).toEqual({ node: "rift-gate", visit: gate.visit, action: "open", edge: "veil-rift", way: "force" });
    expect(takeRiftAction(graph, forced, report, undefined, { party: thornguard })).toMatchObject({ ok: true, duplicate: true });
    // Another way to the same, already-done action is not the duplicate: it is refused as already so.
    expect(takeRiftAction(graph, forced, { ...report, way: "calm" }, undefined, { party: party(["songkeeper"]) })).toMatchObject({
      ok: false,
      code: "no-change",
    });
    // The Duskrunner's lone way, sent without its name, is recorded under it.
    const scouted = act(graph, gate, { action: "discover", edge: "shadow-path" }, party(["duskrunner"]));
    expect(scouted.lastAction?.way).toBe("scout");
    expect(takeRiftAction(graph, scouted, { action: "discover", way: "scout", edge: "shadow-path", visit: gate.visit })).toMatchObject({
      ok: true,
      duplicate: true,
    });
  });

  it("without a party, requirements are not judged — the explorer's and the tools' reading", () => {
    const graph = parsed();
    const gate = atTheGate(graph);
    expect(takeRiftAction(graph, gate, { action: "open", way: "force", edge: "veil-rift", visit: gate.visit })).toMatchObject({
      ok: true,
      duplicate: false,
    });
  });
});

describe("one goal, every party its own way", () => {
  const ending = (graph: ParsedCampaignGraph, j: JourneyState): JourneyState => {
    const crossed = j.node === "far-shore" || j.node === "starfall" ? j : go(graph, j, j.rifts?.["shadow-path"]?.status === "open" ? "shadow-path" : "veil-rift");
    return go(graph, crossed, crossed.node === "starfall" ? "starfall-to-dawn" : "shore-to-dawn");
  };

  it("a Starweaver senses, studies, attunes and weaves — a progression earned through the campaign and stored with it", () => {
    const graph = parsed();
    const sw = party(["starweaver"]);
    let j = atTheGate(graph);
    expect(riftActionsForParty(journeyView(graph, j).riftActions ?? [], sw).map((a) => [a.way, a.unmet ?? false])).toEqual([
      ["sense", false],
      ["lantern", true],
    ]);
    j = act(graph, j, { action: "discover", way: "sense", edge: "veil-rift" }, sw);
    expect(j.facts?.attunement).toBe(1);
    // Not yet enough to attune: the way is not even offered.
    expect(ways(graph, j)).not.toContain("open:attune");
    j = go(graph, go(graph, go(graph, j, "gate-to-camp"), "camp-to-tower"), "tower-to-camp");
    expect(j.facts?.attunement).toBe(2);
    // The progression survives the store: it is in the journey, which round-trips.
    j = JSON.parse(JSON.stringify(go(graph, j, "camp-to-gate"))) as JourneyState;
    expect(ways(graph, j)).toContain("open:attune");
    j = act(graph, j, { action: "open", way: "attune", edge: "veil-rift" }, sw);
    expect(j.facts?.attunement).toBe(3);
    expect(j.rifts?.["veil-rift"]?.status).toBe("open");
    j = act(graph, j, { action: "redirect", way: "weave", edge: "veil-rift", to: "starfall" }, sw);
    j = ending(graph, j);
    expect(j).toMatchObject({ status: "ended", ending: "dawn" });
    expect(j.visits?.starfall).toBe(1);
  });

  it("a Thornguard forces the seal — and the torn veil changes the far shore", () => {
    const graph = parsed();
    let j = act(graph, atTheGate(graph), { action: "open", way: "force", edge: "veil-rift" }, party(["thornguard"]));
    expect(j.facts?.veil).toBe("torn");
    // The shove has a tactical cost (#200): a burden — a buff with a negative
    // amount — the party carries into the next fight.
    expect(j.buffs).toEqual([{ id: "seal-strain", stacks: 1, encountersLeft: 1, grantedAt: { node: "rift-gate", visit: j.visit } }]);
    expect(journeyView(graph, j).buffs?.map((buff) => [buff.id, buff.amount])).toEqual([["seal-strain", -1]]);
    const shore = takeExit(graph, j, { edge: "veil-rift", visit: j.visit });
    expect(shore.ok && shore.journey.chapter).toBe("rc-far-shore-torn");
    j = ending(graph, j);
    expect(j.status).toBe("ended");
  });

  it("a Songkeeper sings it calm; a Duskrunner scouts the shadow path; a Mosslight Jar wakes it", () => {
    const graph = parsed();
    const calm = act(graph, atTheGate(graph), { action: "open", way: "calm", edge: "veil-rift" }, party(["songkeeper"]));
    expect(ending(graph, calm).status).toBe("ended");

    const scouted = act(graph, atTheGate(graph), { action: "discover", way: "scout", edge: "shadow-path" }, party(["duskrunner"]));
    expect(scouted.rifts?.["shadow-path"]).toMatchObject({ status: "open", discovered: true });
    // Found, it is drawn — and the sealed rift is still sealed.
    const view = journeyView(graph, scouted);
    expect(view.exits.find((exit) => exit.edge === "shadow-path")).toMatchObject({ available: true });
    expect(view.exits.find((exit) => exit.edge === "veil-rift")).toMatchObject({ available: false, reason: "rift-dormant" });
    const done = ending(graph, scouted);
    expect(done.status).toBe("ended");
    expect(done.traversed?.["shadow-path"]).toBe(1);

    const lit = act(graph, atTheGate(graph), { action: "open", way: "lantern", edge: "veil-rift" }, party(["thornguard"], ["mosslight_jar"]));
    expect(ending(graph, lit).status).toBe("ended");
  });

  it("a party with none of them befriends the hermit, who opens it for them", () => {
    const graph = parsed();
    let j = atTheGate(graph);
    const view = (state: JourneyState) => riftActionsForParty(journeyView(graph, state).riftActions ?? [], NOBODY);
    // Nobody here can take any way yet — only the lantern's hint is drawn — but the way back to camp is open.
    expect(view(j).map((a) => [a.way, a.unmet])).toEqual([["lantern", true]]);
    expect(journeyView(graph, j, undefined, undefined, NOBODY).stuck).toBeUndefined();
    j = go(graph, go(graph, go(graph, j, "gate-to-camp"), "camp-to-hut"), "hut-to-camp");
    expect(j.facts?.hermit).toBe("friend");
    j = go(graph, j, "camp-to-gate");
    expect(view(j).map((a) => [a.way, a.unmet ?? false])).toEqual([
      ["lantern", true],
      ["hermit", false],
    ]);
    j = act(graph, j, { action: "open", way: "hermit", edge: "veil-rift" }, NOBODY);
    expect(ending(graph, j).status).toBe("ended");
  });

  it("the Starweaver who attuned it can leave: their progress stays, their ways become hints", () => {
    const graph = parsed();
    const sw = party(["starweaver"]);
    let j = act(graph, atTheGate(graph), { action: "discover", way: "sense", edge: "veil-rift" }, sw);
    j = go(graph, go(graph, go(graph, go(graph, j, "gate-to-camp"), "camp-to-tower"), "tower-to-camp"), "camp-to-gate");
    const songkeeper = party(["songkeeper"]);
    const drawn = riftActionsForParty(journeyView(graph, j).riftActions ?? [], songkeeper);
    expect(drawn.map((a) => [a.way, a.unmet ?? false])).toEqual([
      ["attune", true],
      ["calm", false],
      ["lantern", true],
    ]);
    expect(drawn[0]).toMatchObject({ hint: "A Starweaver who has studied the stars could open this.", needs: { anyClass: ["starweaver"] } });
    expect(
      takeRiftAction(graph, j, { action: "open", way: "attune", edge: "veil-rift", visit: j.visit }, undefined, { party: songkeeper }),
    ).toMatchObject({ ok: false, code: "party-cannot" });
    expect(ending(graph, act(graph, j, { action: "open", way: "calm", edge: "veil-rift" }, songkeeper)).status).toBe("ended");
  });
});

describe("what the screens are sent", () => {
  it("every offered way, with its way, who it needs and its hint — judged by the phone against tonight's table", () => {
    const graph = parsed();
    const view = journeyView(graph, atTheGate(graph));
    expect(view.riftActions).toEqual([
      { action: "discover", edge: "veil-rift", label: "Sense where the rift leads", way: "sense", needs: { anyClass: ["starweaver"] } },
      { action: "open", edge: "veil-rift", label: "Force the seal open", way: "force", needs: { anyClass: ["thornguard"] } },
      { action: "open", edge: "veil-rift", label: "Sing the seal calm until it parts", way: "calm", needs: { anyClass: ["songkeeper"] } },
      {
        action: "open",
        edge: "veil-rift",
        label: "Hold the Mosslight Jar to the seal",
        way: "lantern",
        needs: { anyItem: ["mosslight_jar"] },
        hint: "Something that glows like moss might wake this seal.",
      },
      { action: "discover", edge: "shadow-path", label: "Scout the cliffs for another way", way: "scout", needs: { anyClass: ["duskrunner"] } },
    ]);
    // Given the party, the view is that table's: what it cannot take is gone, or a hint.
    expect(journeyView(graph, atTheGate(graph), undefined, undefined, party(["thornguard", "duskrunner"])).riftActions?.map((a) => a.way)).toEqual([
      "force",
      "lantern",
      "scout",
    ]);
  });

  it("a view without ways (#197) is unchanged: no way, needs or hint keys", () => {
    const graph = parsed();
    const j = go(graph, play(graph, startJourney(graph)), "camp-to-hut");
    expect(journeyView(graph, j).riftActions).toBeUndefined();
  });
});

describe("the lint: no class is mandatory", () => {
  it("passes the fixture clean, every way offered somewhere", () => {
    const { findings, search } = lintCampaignGraph(parsed(), { chapterFlags: nothing });
    expect(findings).toEqual([]);
    expect(search.complete).toBe(true);
  });

  it("refuses a map only a party with the right hero can win — the hermit's way removed", () => {
    const graph = parsed(bent((g) => (g.edges["veil-rift"]!.rift!.actions!.open as RiftActionRule[]).pop()));
    const gated = lintCampaignGraph(graph, { chapterFlags: nothing }).findings.filter((f) => f.code === "CLASS_GATED_ONLY_PATH");
    expect(gated.length).toBeGreaterThan(0);
    expect(gated[0]).toMatchObject({ severity: "error", path: "/graph/nodes/camp" });
    expect(gated[0]!.message).toMatch(/open "veil-rift" \(force\), which needs a thornguard/);
    expect(gated[0]!.message).toMatch(/someone carrying mosslight_jar/);
  });

  it("refuses a gated way that leads where only gated ways go on — the party that loses its Starweaver half-way", () => {
    // The weave turns the rift toward starfall; if starfall's only way on needs a Starweaver too,
    // a table whose Starweaver went home after the weave is stuck there.
    const graph = parsed(
      bent((g) => {
        g.edges["starfall-to-dawn"]!.rift = {
          opensWhen: { visited: "dawn" },
          actions: { open: { requires: { anyClass: ["starweaver"] }, label: "Read the falling stars" } },
        };
      }),
    );
    const gated = lintCampaignGraph(graph, { chapterFlags: nothing }).findings.filter((f) => f.code === "CLASS_GATED_ONLY_PATH");
    // Wherever the turned rift is the only way on: the gate, the camp and hut behind it, and the glade.
    expect(gated.map((f) => f.path).sort()).toEqual(
      ["/graph/nodes/camp", "/graph/nodes/hermit-hut", "/graph/nodes/rift-gate", "/graph/nodes/starfall"].sort(),
    );
    const glade = gated.find((f) => f.path === "/graph/nodes/starfall")!;
    expect(glade.message).toMatch(/~\(redirect "veil-rift" toward "starfall" \(weave\)\)~>/);
    expect(glade.message).toMatch(/open "starfall-to-dawn", which needs a starweaver/);
  });

  it("warns about each way never offered, at its own path", () => {
    const graph = parsed(
      bent((g) => {
        (g.edges["veil-rift"]!.rift!.actions!.open as RiftActionRule[])[0]!.when = { facts: { attunement: { min: 2 }, veil: "torn" } };
      }),
    );
    const never = lintCampaignGraph(graph, { chapterFlags: nothing }).findings.filter((f) => f.code === "RIFT_ACTION_NEVER_OFFERED");
    // Torn means forced open already, so "attune" never has anything to change —
    // and without it attunement never reaches 3, so the weave is never offered either.
    expect(never.map((f) => f.path)).toEqual([
      "/graph/edges/veil-rift/rift/actions/open/0",
      "/graph/edges/veil-rift/rift/actions/redirect",
    ]);
  });

  it("explores as one table: each party alone still reaches the ending", () => {
    const graph = parsed();
    const parties: RiftParty[] = [
      NOBODY,
      party(["starweaver"]),
      party(["thornguard"]),
      party(["songkeeper"]),
      party(["duskrunner"]),
      party([], ["mosslight_jar"]),
    ];
    for (const table of parties) {
      const search = exploreCampaignGraph(graph, { chapterFlags: nothing, party: table });
      expect(search.complete).toBe(true);
      expect(search.states.some((state) => state.ended), JSON.stringify(table)).toBe(true);
      expect(search.stranded).toEqual([]);
    }
    // Only a Starweaver ever stands in Starfall Glade.
    const entered = (table: RiftParty) => exploreCampaignGraph(graph, { chapterFlags: nothing, party: table }).entered.has("starfall");
    expect(entered(party(["starweaver"]))).toBe(true);
    expect(entered(party(["thornguard", "songkeeper", "duskrunner"], ["mosslight_jar"]))).toBe(false);
  });
});
