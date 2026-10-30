/**
 * Class rift interaction (#199), played through the real server.
 *
 * The Sealed Rift (shared fixtures/rift-classes.campaign.json) with a small
 * test chapter behind every node — the journey.test.ts harness, bent to this
 * fixture and to a table of several heroes: each player joins the same room
 * and creates a hero of the class the case needs.
 *
 * What is pinned is the table's side of the contract: the server judges a
 * way's `requires` against the heroes seated in the room *now* — not the
 * journey, not the household — and refuses what nobody seated can do without
 * writing anything; a Starweaver's progression is a world fact on the
 * household's attempt row, so it is there on another evening, on another
 * device, whoever comes; and every composition, a table with no Starweaver
 * included, reaches the ending.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, riftActionsForParty } from "@kad/shared";
import type { Campaign, Chapter, ClassId, ClientIntent, JourneyRiftActionView } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness, keepGoing } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function sealed(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-classes.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

function sealedChapters(campaign: Campaign): Chapter[] {
  return campaign.chapters.map((id, i) => {
    const base = makeChapter();
    return { ...base, id, campaignId: campaign.id, index: i + 1, title: `Title of ${id}` };
  });
}

async function world(players = 3) {
  const campaign = sealed();
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: sealedChapters(campaign), campaigns: [campaign] }),
  });
  const seeded = await seedHousehold(harness, players);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, campaign.id);
  return { harness, attempt, ...seeded };
}

type Seeded = Awaited<ReturnType<typeof world>>;

const NAMES = ["Pip", "Wren", "Moss", "Fennel"];

/**
 * A room opened for the Sealed Rift, one hero per class given, each on its
 * own player's device — one evening's table. Everyone ready.
 */
async function table(harness: TestHarness, seeded: Seeded, classes: ClassId[]) {
  const created = await createRoom({ householdId: seeded.householdId, mode: "party", campaignId: "rift-classes" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const seats: string[] = [];
  for (const [i] of classes.entries()) {
    const joined = await joinRoom({ code, principal: seeded.players[i]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    seats.push(joined.value.playerId);
  }
  const send = async (intent: ClientIntent, seat = 0) => {
    // The TV's "Keep going" for heroes new to the adventure (crew.ts): these tests are about what follows.
    if (intent.type === "CONTINUE_CAMPAIGN") await keepGoing(harness, runId, intent.campaignId);
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    return applyAction({ runId, playerId: seats[seat]!, seq, intent }, harness.deps);
  };
  const must = async (intent: ClientIntent, seat = 0) => {
    const response = await send(intent, seat);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    return response;
  };
  const everyone = async (intent: ClientIntent) => {
    for (const seat of seats.keys()) await must(intent, seat);
  };
  for (const [seat, cls] of classes.entries()) {
    await must(
      {
        type: "CREATE_CHARACTER",
        name: NAMES[seat]!,
        species: "unicorn",
        class: cls,
        stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      },
      seat,
    );
  }
  await everyone({ type: "READY", ready: true });
  const state = async () => (await harness.repo.getState(runId))!;
  const view = async () => {
    const now = await state();
    return (now.campaign ?? now.campaignOptions?.[0])?.journey;
  };
  return {
    send,
    must,
    state,
    view,
    /** What this table's phones draw (#199): the view's actions judged against the seated heroes. */
    drawn: async (): Promise<JourneyRiftActionView[]> => {
      const now = await state();
      const party = { classes: now.party.map((m) => m.character.class), items: [] };
      return riftActionsForParty((await view())?.riftActions ?? [], party);
    },
    /** Begins the journey's next chapter and plays it to its ending. */
    play: async () => {
      await must({ type: "CONTINUE_CAMPAIGN" });
      await must({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" });
    },
    /** Back to the lobby from the completion screen, everyone ready. */
    lobby: async () => {
      await must({ type: "ADVANCE" });
      await everyone({ type: "READY", ready: true });
    },
    exit: async (edgeId: string) => send({ type: "CHOOSE_EXIT", edgeId, visit: (await view())?.visit ?? 0 }),
    act: async (action: "discover" | "open" | "redirect", edgeId: string, way: string, to?: string, seat = 0) =>
      send({ type: "RIFT_ACTION", action, edgeId, way, visit: (await view())?.visit ?? 0, ...(to ? { to } : {}) }, seat),
  };
}

type Table = Awaited<ReturnType<typeof table>>;

/** The camp played, and the party standing at the sealed rift's choice. */
async function toTheGate(t: Table) {
  await t.play();
  expect((await t.exit("camp-to-gate")).ok).toBe(true);
  await t.lobby();
  await t.play();
}

/** Through the (opened) rift to the ending, the attempt complete. */
async function across(t: Table, edge = "veil-rift", last = "shore-to-dawn") {
  expect((await t.exit(edge)).ok).toBe(true);
  await t.lobby();
  await t.play();
  expect((await t.exit(last)).ok).toBe(true);
  await t.lobby();
  await t.play();
}

describe("the server judges a way against the heroes seated now", () => {
  it("a mixed table sees each hero's way, and the Thornguard's shove tears the veil on the way through", async () => {
    const seeded = await world();
    const t = await table(seeded.harness, seeded, ["starweaver", "thornguard"]);
    await toTheGate(t);
    expect((await t.drawn()).map((a) => [a.way, a.unmet ?? false])).toEqual([
      ["sense", false],
      ["force", false],
      ["lantern", true],
    ]);
    // Either player's phone may send it: the requirement is the table's, not the tapper's.
    expect((await t.act("open", "veil-rift", "force", undefined, 0)).ok).toBe(true);
    expect((await seeded.attempt())!.journey).toMatchObject({
      facts: { veil: "torn" },
      rifts: { "veil-rift": { status: "open" } },
      lastAction: { action: "open", edge: "veil-rift", way: "force" },
    });
    expect((await t.exit("veil-rift")).ok).toBe(true);
    await t.lobby();
    await t.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await t.state()).chapterId).toBe("rc-far-shore-torn");
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" });
    expect((await t.exit("shore-to-dawn")).ok).toBe(true);
    await t.lobby();
    await t.play();
    expect(await seeded.attempt()).toMatchObject({ status: "complete", journey: { status: "ended", ending: "dawn" } });
  });

  it("refuses a way nobody seated can take, and writes nothing", async () => {
    const seeded = await world();
    const t = await table(seeded.harness, seeded, ["songkeeper"]);
    await toTheGate(t);
    const before = (await seeded.attempt())!;
    const seq = (await t.state()).seq;
    for (const [action, edge, way] of [
      ["open", "veil-rift", "force"],
      ["discover", "veil-rift", "sense"],
      ["discover", "shadow-path", "scout"],
      ["open", "veil-rift", "lantern"],
    ] as const) {
      const refused = await t.act(action, edge, way);
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(refused.ok ? "" : refused.error?.message).toMatch(/nobody in this party can/);
    }
    expect(await seeded.attempt()).toEqual(before);
    expect((await t.state()).seq).toBe(seq);
    // What they can do, they can.
    expect((await t.act("open", "veil-rift", "calm")).ok).toBe(true);
    await across(t);
    expect(await seeded.attempt()).toMatchObject({ status: "complete" });
  });

  it("a Duskrunner's scouting finds and opens the shadow path", async () => {
    const seeded = await world();
    const t = await table(seeded.harness, seeded, ["duskrunner"]);
    await toTheGate(t);
    expect((await t.view())?.exits.map((exit) => exit.edge)).toEqual(["gate-to-camp", "veil-rift"]);
    expect((await t.act("discover", "shadow-path", "scout")).ok).toBe(true);
    expect((await t.view())?.exits.find((exit) => exit.edge === "shadow-path")).toMatchObject({ available: true });
    await across(t, "shadow-path");
    expect(await seeded.attempt()).toMatchObject({ status: "complete", journey: { traversed: { "shadow-path": 1 } } });
  });
});

describe("a table with no Starweaver", () => {
  it("befriends the hermit, who opens the seal — the ungated way every composition has", async () => {
    const seeded = await world();
    const t = await table(seeded.harness, seeded, ["thornguard", "songkeeper"]);
    await toTheGate(t);
    expect((await t.act("discover", "veil-rift", "sense")).ok).toBe(false);
    expect((await t.act("open", "veil-rift", "hermit")).ok).toBe(false);
    expect((await t.exit("gate-to-camp")).ok).toBe(true);
    expect((await t.exit("camp-to-hut")).ok).toBe(true);
    await t.lobby();
    await t.play();
    expect((await seeded.attempt())!.journey?.facts).toEqual({ hermit: "friend" });
    expect((await t.exit("hut-to-camp")).ok).toBe(true);
    expect((await t.exit("camp-to-gate")).ok).toBe(true);
    expect((await t.drawn()).map((a) => a.way)).toEqual(["force", "calm", "lantern", "hermit"]);
    expect((await t.act("open", "veil-rift", "hermit")).ok).toBe(true);
    await across(t);
    expect(await seeded.attempt()).toMatchObject({ status: "complete", journey: { ending: "dawn", facts: { hermit: "friend" } } });
  });
});

describe("a Starweaver's progression", () => {
  it("is earned across the campaign, stored on the attempt row, and outlives the evening and the hero", async () => {
    const seeded = await world();
    const first = await table(seeded.harness, seeded, ["starweaver"]);
    await toTheGate(first);
    expect((await first.act("discover", "veil-rift", "sense")).ok).toBe(true);
    expect((await seeded.attempt())!.journey?.facts).toEqual({ attunement: 1 });
    expect((await first.exit("gate-to-camp")).ok).toBe(true);
    expect((await first.exit("camp-to-tower")).ok).toBe(true);
    await first.lobby();
    await first.play();
    expect((await seeded.attempt())!.journey?.facts).toEqual({ attunement: 2 });
    expect((await first.exit("tower-to-camp")).ok).toBe(true);
    expect((await first.exit("camp-to-gate")).ok).toBe(true);

    // Another evening, another device, and the Starweaver stayed home: the
    // attunement is still the household's, the way to use it is not this table's.
    const second = await table(seeded.harness, seeded, ["thornguard"]);
    const seen = await second.view();
    expect(seen?.facts?.find((fact) => fact.id === "attunement")).toMatchObject({ value: 2 });
    expect((await second.drawn()).map((a) => [a.way, a.unmet ?? false])).toEqual([
      ["attune", true],
      ["force", false],
      ["lantern", true],
    ]);
    const before = (await seeded.attempt())!;
    const refused = await second.act("open", "veil-rift", "attune");
    expect(refused.ok ? "" : refused.error?.message).toMatch(/needs a starweaver/);
    expect(await seeded.attempt()).toEqual(before);

    // The Starweaver is back: attune, then weave the rift toward Starfall Glade.
    const third = await table(seeded.harness, seeded, ["starweaver", "duskrunner"]);
    expect((await third.act("open", "veil-rift", "attune")).ok).toBe(true);
    expect((await seeded.attempt())!.journey?.facts).toEqual({ attunement: 3 });
    expect((await third.drawn()).map((a) => [a.action, a.way, a.to])).toContainEqual(["redirect", "weave", "starfall"]);
    expect((await third.act("redirect", "veil-rift", "weave", "starfall")).ok).toBe(true);
    // The retry after a lost response is the same action: no second write.
    const after = (await seeded.attempt())!;
    expect((await third.act("redirect", "veil-rift", "weave", "starfall")).ok).toBe(true);
    expect(await seeded.attempt()).toEqual(after);
    await across(third, "veil-rift", "starfall-to-dawn");
    expect(await seeded.attempt()).toMatchObject({ status: "complete", journey: { ending: "dawn", visits: { starfall: 1 } } });
  });
});
