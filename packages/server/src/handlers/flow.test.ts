/**
 * The whole path, driven through the handlers with the real engine:
 *
 *   create room → join → create characters → start chapter → choose → roll
 *
 * No HTTP. If this passes, `dev-server.ts` is only responsible for parsing
 * JSON — which is the point of keeping the handlers transport-free.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { ChannelMessage, ClientIntent, RunState } from "@kad/shared";
import { applyOps, deepClone } from "../json-patch.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";
import { getState } from "./state.ts";

const realEngine: Engine = { applyIntent, createRunState };

const APPEARANCE = { palette: "meadow", accent: "#7FD4C1" };

describe("create-room → join → intent → broadcast", () => {
  it("plays the opening of a chapter and keeps every client reconstructable", async () => {
    const harness = makeHarness({ engine: realEngine });
    const { householdId, players } = await seedHousehold(harness, 2);
    const [host, guest] = players;
    if (!host || !guest) throw new Error("setup failed");

    // --- create ------------------------------------------------------------
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { code, runId } = created.value;

    // The TV subscribes to the room channel before anyone joins.
    const received: ChannelMessage[] = [];
    harness.channel.subscribe(code, (m) => received.push(m));

    // --- join --------------------------------------------------------------
    const hostJoin = await joinRoom({ code, principal: host.principal }, harness.deps);
    const guestJoin = await joinRoom({ code, principal: guest.principal }, harness.deps);
    expect(hostJoin.ok && guestJoin.ok).toBe(true);
    if (!hostJoin.ok || !guestJoin.ok) return;
    // Neither device was asked who it was (§4.5).
    expect(hostJoin.value.playerId).toBe("p_1");
    expect(guestJoin.value.playerId).toBe("p_2");

    const initial: RunState = deepClone(hostJoin.value.state);
    expect(initial.phase).toBe("lobby");

    // --- play --------------------------------------------------------------
    const send = async (playerId: string, intent: ClientIntent) => {
      const seq = (await harness.repo.getState(runId))?.seq ?? 0;
      const response = await applyAction({ runId, playerId, seq, intent }, harness.deps);
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      return response;
    };

    await send("p_1", character("Sparklehoof", "unicorn", "songkeeper"));
    await send("p_2", character("Thistle", "bigfoot", "thornguard"));
    await send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });

    let state = await harness.repo.getState(runId);
    expect(state?.phase).toBe("scene");
    expect(state?.sceneId).toBe("scene_clearing");
    expect(state?.party).toHaveLength(2);

    // The species-gated choice is hidden, not greyed out: neither a unicorn nor
    // a bigfoot can go over the thorns (architecture §5).
    const prompt = state?.prompt;
    expect(prompt?.kind).toBe("choice");
    if (prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(prompt.options.map((o) => o.id)).toEqual(["squeeze"]);

    await send("p_1", { type: "CHOOSE", choiceId: "squeeze" });

    state = await harness.repo.getState(runId);
    expect(state?.sceneType).toBe("check");
    const rollPrompt = state?.prompt;
    if (rollPrompt?.kind !== "roll") throw new Error("expected a roll prompt");

    // Whoever the chapter nominated rolls — and the *server* rolls (§4.1).
    const roller = state?.party.find((m) => m.character.id === rollPrompt.characterId);
    if (!roller) throw new Error("no roller");
    await send(roller.playerId, { type: "ROLL" });

    const final = await harness.repo.getState(runId);
    expect(final?.lastRoll?.die).toBeGreaterThanOrEqual(1);
    expect(final?.lastRoll?.die).toBeLessThanOrEqual(20);
    expect(final?.lastRoll?.tn).toBe(rollPrompt.tn);

    // --- what the room saw --------------------------------------------------
    const patches = received.filter((m) => m.kind === "patch");
    expect(patches.map((m) => m.seq)).toEqual(patches.map((_, i) => i + 1));
    expect(patches.map((m) => m.seq)).toEqual([...Array(final?.seq ?? 0).keys()].map((i) => i + 1));

    const kinds = patches.map((m) => (m.kind === "patch" ? m.presentation?.kind : undefined));
    expect(kinds).toContain("SCENE_ENTER");
    expect(kinds).toContain("CHOICE_MADE");
    expect(kinds).toContain("ROLL");

    // A phone that applied every patch is byte-identical to the server.
    let mirror: RunState = initial;
    for (const message of patches) {
      if (message.kind !== "patch") continue;
      mirror = applyOps(mirror, message.patch);
    }
    expect(mirror).toEqual(final);
  });

  it("lets a hard-refreshed device catch up from the event log", async () => {
    const harness = makeHarness({ engine: realEngine });
    const { householdId, players } = await seedHousehold(harness, 1);
    const host = players[0];
    if (!host) throw new Error("setup failed");
    const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!created.ok) return;
    const { code, runId } = created.value;
    await joinRoom({ code, principal: host.principal }, harness.deps);

    const send = async (intent: ClientIntent) => {
      const seq = (await harness.repo.getState(runId))?.seq ?? 0;
      return applyAction({ runId, playerId: "p_1", seq, intent }, harness.deps);
    };
    await send(character("Sparklehoof", "unicorn", "songkeeper"));
    // The TV is refreshed here, holding seq 1.
    const atRefresh = await harness.repo.getState(runId);
    await send({ type: "START_CHAPTER", chapterId: "bramblewood-01" });

    const caught = await getState({ runId, sinceSeq: 1 }, harness.deps);
    expect(caught.ok).toBe(true);
    if (!caught.ok || !atRefresh) return;

    let mirror: RunState = atRefresh;
    for (const event of caught.value.events ?? []) {
      mirror = applyOps(mirror, event.patch);
    }
    expect(mirror).toEqual(await harness.repo.getState(runId));
    expect(mirror.sceneId).toBe("scene_clearing");
  });
});

function character(name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name,
    species,
    class: cls,
    // Exactly rules.creationPoints (3), spent where the class wants them.
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: APPEARANCE,
  };
}
