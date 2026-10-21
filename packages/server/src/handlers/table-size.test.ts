/**
 * A table of four, through the handlers and the real engine (#389): a fifth
 * phone is told the table is full before it builds a hero, and a seat the
 * host frees by taking somebody out is a seat a new kid can sit in.
 */

import path from "node:path";
import { applyIntent, createRunState, makeRng, MAX_PARTY, TABLE_FULL_MESSAGE, type ClientIntent } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { removePlayer } from "./remove.ts";
import { createRoom, joinRoom } from "./room.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };

const HERO = { type: "CREATE_CHARACTER", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } } as const;

/** Five players in one household, and a room opened by the first one's phone. */
async function tableOfFive() {
  const harness = makeHarness({ engine: realEngine, content });
  harness.deps.rng = (key) => makeRng(`table:${String(key)}`);
  const { householdId, players } = await seedHousehold(harness, 5);
  const created = await createRoom(
    { householdId, mode: "party", campaignId: "gemfall", hostDeviceId: players[0]!.principal.deviceId },
    harness.deps,
  );
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const join = (seat: number) => joinRoom({ code, principal: players[seat]!.principal }, harness.deps);
  const create = async (seat: number, name: string) => {
    const seq = (await harness.repo.getState(runId))!.seq;
    const intent: ClientIntent = { ...HERO, name };
    return applyAction({ runId, playerId: players[seat]!.principal.playerId, seq, intent }, harness.deps);
  };
  return { harness, players, code, runId, join, create };
}

describe("a table of four (#389)", () => {
  it("tells a fifth phone the table is full when it joins, before it makes a hero", async () => {
    const t = await tableOfFive();
    for (let seat = 0; seat < MAX_PARTY; seat++) {
      const joined = await t.join(seat);
      expect(joined.ok && joined.value.full).toBeFalsy();
      expect((await t.create(seat, `Hero ${seat + 1}`)).ok).toBe(true);
    }

    const fifth = await t.join(4);
    if (!fifth.ok) throw new Error(`join: ${JSON.stringify(fifth)}`);
    // In the room, so the host sees who arrived, but with no seat to fill.
    expect(fifth.value.full).toBe(true);
    expect(fifth.value.state.seats?.[t.players[4]!.principal.playerId]).toBeDefined();

    // A phone that makes a hero anyway is told the same thing, in the same words.
    expect(await t.create(4, "One Too Many")).toMatchObject({ ok: false, error: { message: TABLE_FULL_MESSAGE } });

    // A kid already seated coming back is never shut out.
    const back = await t.join(3);
    expect(back.ok && back.value.full).toBeFalsy();
  });

  it("frees the seat of a player the host took out, so a new kid can join at four", async () => {
    const t = await tableOfFive();
    for (let seat = 0; seat < MAX_PARTY; seat++) {
      await t.join(seat);
      expect((await t.create(seat, `Hero ${seat + 1}`)).ok).toBe(true);
    }
    const before = await t.join(4);
    expect(before.ok && before.value.full).toBe(true);

    const removed = await removePlayer(
      { code: t.code, principal: t.players[0]!.principal, playerId: t.players[3]!.principal.playerId },
      t.harness.deps,
    );
    expect(removed.ok).toBe(true);

    const after = await t.join(4);
    expect(after.ok && after.value.full).toBeFalsy();
    expect((await t.create(4, "Hero 5")).ok).toBe(true);

    const state = (await t.harness.repo.getState(t.runId))!;
    // The one taken out keeps her place in `party` (remove.ts), and no seat.
    expect(state.party.map((m) => m.character.name)).toEqual(["Hero 1", "Hero 2", "Hero 3", "Hero 4", "Hero 5"]);
    expect(state.removed).toEqual([t.players[3]!.principal.playerId]);
    // The taken-out player cannot come back to the seat she left.
    expect(await t.join(3)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
