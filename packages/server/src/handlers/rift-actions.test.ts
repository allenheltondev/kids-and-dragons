/**
 * Rift actions and transactional traversal (#197), played through the real
 * server.
 *
 * The Ferry Rift (shared fixtures/rift-actions.campaign.json) with a small
 * test chapter behind every node — the journey.test.ts harness, bent to this
 * fixture: each chapter has a plain success ending, a setback, and one that
 * reads the old chart (sets `read_the_chart`, which lets the party turn the
 * ferry rift).
 *
 * What is pinned is the table's side of the contract: a rift action is one
 * conditional write of the household's attempt, like a crossing; the double
 * tap and the retry after a lost response are answered without a second
 * write or a second effect; a phone that dropped and a different player's
 * device both see the rift as the server has it; a destination nobody
 * declared is refused and changes nothing; and once the single-use ferry is
 * gone the party still has a way on.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, StoryScene } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function ferry(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-actions.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

const ending = (narration: string, extra: Partial<StoryScene> = {}): StoryScene => ({
  type: "story",
  narration,
  choices: [],
  ...extra,
});

function ferryChapters(campaign: Campaign): Chapter[] {
  return campaign.chapters.map((id, i) => {
    const base = makeChapter();
    return {
      ...base,
      id,
      campaignId: campaign.id,
      index: i + 1,
      title: `Title of ${id}`,
      scenes: {
        ...base.scenes,
        scene_setback: ending("The storm wins this one.", { outcome: "setback" }),
        scene_chart: ending("An old chart, under the nets.", {
          onEnter: [{ type: "setFlag", flag: "read_the_chart" }],
        }),
      },
    };
  });
}

const CREATION: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Pip",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
};

async function world(players = 2) {
  const campaign = ferry();
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: ferryChapters(campaign), campaigns: [campaign] }),
  });
  const seeded = await seedHousehold(harness, players);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, campaign.id);
  return { harness, attempt, ...seeded };
}

/** A room opened for the Ferry Rift, with one ready hero — one evening, on one device. */
async function room(harness: TestHarness, householdId: string, principal: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "party", campaignId: "rift-actions" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const send = async (intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    return applyAction({ runId, playerId: joined.value.playerId, seq, intent }, harness.deps);
  };
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    return response;
  };
  const state = async () => (await harness.repo.getState(runId))!;
  const view = async () => {
    const now = await state();
    return (now.campaign ?? now.campaignOptions?.[0])?.journey;
  };
  await must(CREATION);
  await must({ type: "READY", ready: true });
  return {
    send,
    must,
    state,
    view,
    /** Begins the journey's next chapter and plays it to the given ending. */
    play: async (sceneId = "scene_ending") => {
      await must({ type: "CONTINUE_CAMPAIGN" });
      await must({ type: "PLAYTEST_GOTO", sceneId });
    },
    /** Back to the lobby from the completion screen, everyone ready. */
    lobby: async () => {
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
    },
    /** Takes an exit from the visit this room's view shows. */
    exit: async (edgeId: string) => send({ type: "CHOOSE_EXIT", edgeId, visit: (await view())?.visit ?? 0 }),
    /** Tries a rift action on the visit this room's view shows. */
    act: async (action: "redirect" | "stabilize" | "open" | "close" | "discover", edgeId: string, to?: string) =>
      send({ type: "RIFT_ACTION", action, edgeId, visit: (await view())?.visit ?? 0, ...(to ? { to } : {}) }),
  };
}

/** The chart read at the harbor, the beacon lit, and back at the harbor's choice — the ferry awake. */
async function toTheFerry(r: Awaited<ReturnType<typeof room>>, lighthouse = "scene_ending") {
  await r.play("scene_chart");
  expect((await r.exit("harbor-to-lighthouse")).ok).toBe(true);
  await r.lobby();
  await r.play(lighthouse);
  expect((await r.exit("lighthouse-to-harbor")).ok).toBe(true);
}

describe("a rift action on the household's attempt", () => {
  it("is offered on the phones, and taking it writes the attempt once", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    expect((await a.view())?.riftActions).toEqual([
      { action: "redirect", edge: "ferry-rift", label: "Turn the rift toward The Hidden Cove", to: "cove" },
    ]);
    const version = (await attempt())!.version!;
    expect((await a.act("redirect", "ferry-rift", "cove")).ok).toBe(true);
    const turned = (await attempt())!;
    expect(turned.version).toBe(version + 1);
    expect(turned.journey).toMatchObject({
      node: "harbor",
      status: "choosing",
      rifts: { "ferry-rift": { status: "open", to: "cove" } },
      lastAction: { node: "harbor", action: "redirect", edge: "ferry-rift", to: "cove" },
    });
    // The room's view moved with it: the ferry now leads to the cove, and the action offered is the way back.
    expect((await a.view())?.exits.find((exit) => exit.edge === "ferry-rift")).toMatchObject({ to: "cove", available: true });
    expect((await a.view())?.riftActions?.map((each) => each.to)).toEqual(["isle"]);
  });

  it("a double tap or a retry after a lost response is answered as done: no write, no second effect", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    const visit = (await a.view())!.visit;
    const intent: ClientIntent = { type: "RIFT_ACTION", action: "redirect", edgeId: "ferry-rift", to: "cove", visit };
    await a.must(intent);
    const after = (await attempt())!;
    const seq = (await a.state()).seq;
    expect(await a.send(intent)).toEqual({ ok: true, seq });
    expect(await attempt()).toEqual(after);
  });

  it("two phones taking the same action at once take it once", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    const b = await room(harness, householdId, players[1]!.principal);
    const visit = (await a.view())!.visit;
    const version = (await attempt())!.version!;
    const intent: ClientIntent = { type: "RIFT_ACTION", action: "redirect", edgeId: "ferry-rift", to: "cove", visit };
    const [ra, rb] = await Promise.all([a.send(intent), b.send(intent)]);
    expect(ra.ok || rb.ok).toBe(true);
    // Whoever lost the write retries, and meets the action as a duplicate.
    expect((await (ra.ok ? b : a).send(intent)).ok).toBe(true);
    expect((await attempt())!.version).toBe(version + 1);
    expect((await attempt())!.journey?.rifts?.["ferry-rift"]).toEqual({ status: "open", to: "cove" });
  });

  it("a different player's device, joining after, sees the rift as the server has it", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    expect((await a.act("redirect", "ferry-rift", "cove")).ok).toBe(true);
    // Player A's phone drops. Player B opens a room on their own device.
    const b = await room(harness, householdId, players[1]!.principal);
    const seen = await b.view();
    expect(seen).toMatchObject({ node: "harbor", status: "choosing" });
    expect(seen?.exits.find((exit) => exit.edge === "ferry-rift")).toMatchObject({ to: "cove" });
    // B crosses; the turned ferry takes the party to the cove.
    expect((await b.exit("ferry-rift")).ok).toBe(true);
    await b.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await b.state()).chapterId).toBe("actions-cove");
  });

  it("refuses an invalid destination or an unknown rift, and writes nothing", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    const before = (await attempt())!;
    const dawn = await a.act("redirect", "ferry-rift", "dawn");
    expect(dawn).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(dawn.ok ? "" : dawn.error?.message).toContain("not one of its destinations");
    expect(await a.act("redirect", "ferry-rift", "atlantis")).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await a.act("stabilize", "to-the-moon")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await a.act("close", "ferry-rift")).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await attempt()).toEqual(before);
  });

  it("is refused mid-chapter: the rift can wait", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    const refused = await a.act("redirect", "ferry-rift", "cove");
    expect(refused.ok ? "" : refused.error?.message).toContain("between chapters");
  });
});

describe("a single-use crossing, and the way on after it", () => {
  it("a double-clicked crossing of the ferry crosses it once, and the stale tap after is the duplicate", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    const b = await room(harness, householdId, players[1]!.principal);
    const visit = (await a.view())!.visit;
    const tap: ClientIntent = { type: "CHOOSE_EXIT", edgeId: "ferry-rift", visit };
    const [ra, rb] = await Promise.all([a.send(tap), b.send(tap)]);
    expect(ra.ok || rb.ok).toBe(true);
    expect((await (ra.ok ? b : a).send(tap)).ok).toBe(true);
    expect((await a.send(tap)).ok).toBe(true);
    expect((await attempt())!.journey).toMatchObject({
      node: "isle",
      traversed: { "ferry-rift": 1 },
      rifts: { "ferry-rift": { status: "consumed", crossings: 1 } },
    });
  });

  it("the long way round is refused while the ferry runs, and offered once it is used up", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a);
    const early = await a.exit("harbor-row");
    expect(early.ok ? "" : early.error?.message).toContain("fallback");

    expect((await a.exit("ferry-rift")).ok).toBe(true);
    await a.lobby();
    await a.play();
    expect((await a.exit("isle-to-harbor")).ok).toBe(true);
    const harbor = await a.view();
    expect(harbor?.exits).toEqual([
      expect.objectContaining({ edge: "ferry-rift", available: false, reason: "rift-consumed" }),
      expect.objectContaining({ edge: "harbor-row", available: true }),
    ]);
    expect(harbor).not.toHaveProperty("stuck");
    expect((await a.exit("harbor-row")).ok).toBe(true);
    expect((await attempt())!.journey).toMatchObject({ node: "isle", visit: 2 });

    // The second visit to the isle: the stair has flickered shut — steady it and climb.
    await a.lobby();
    await a.play();
    expect((await a.view())?.exits.find((exit) => exit.edge === "storm-stair")).toMatchObject({ reason: "rift-faded" });
    expect((await a.act("stabilize", "storm-stair")).ok).toBe(true);
    expect((await a.exit("storm-stair")).ok).toBe(true);
    await a.lobby();
    await a.play();
    expect(await attempt()).toMatchObject({ status: "complete", journey: { status: "ended", ending: "dawn" } });
  });

  it("the storm can turn the ferry: a lighthouse setback sends the crossing to the cove", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheFerry(a, "scene_setback");
    expect((await attempt())!.journey?.rifts?.["ferry-rift"]).toEqual({ status: "open", to: "cove" });
    expect((await a.exit("ferry-rift")).ok).toBe(true);
    expect((await attempt())!.journey).toMatchObject({ node: "cove", chapter: "actions-cove" });
  });
});
