/**
 * A guest household's seven days run from the last time it played.
 *
 * They used to run from creation, fixed. A campaign is eight evenings over
 * several weeks, so a family that never took the keepsake sign-in would have
 * had its party swept away mid-campaign on day eight — between Tuesday's
 * chapter and Saturday's. Play now slides the window: creating a room, and
 * finishing a chapter.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { ClientIntent } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold, T0 } from "../test-support.ts";
import { GUEST_HOUSEHOLD_TTL_MS } from "./account.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const DAY = 24 * 60 * 60 * 1000;
const realEngine: Engine = { applyIntent, createRunState };

/** seedHousehold's household, turned back into an unclaimed guest. */
async function guestHousehold(harness: ReturnType<typeof makeHarness>, expiresAtMs: number) {
  const seeded = await seedHousehold(harness, 1);
  const household = (await harness.repo.getHousehold(seeded.householdId))!;
  await harness.repo.putHousehold({
    ...household,
    guest: true,
    ownerSub: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
  return seeded;
}

const expiryOf = async (harness: ReturnType<typeof makeHarness>, householdId: string) =>
  (await harness.repo.getHousehold(householdId))?.expiresAt;

describe("the guest window slides on play", () => {
  it("creating a room starts the guest's week again", async () => {
    const harness = makeHarness();
    const { householdId } = await guestHousehold(harness, T0 + DAY);
    harness.clock.advance(5 * DAY);

    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    expect(created.ok).toBe(true);
    expect(await expiryOf(harness, householdId)).toBe(new Date(T0 + 5 * DAY + GUEST_HOUSEHOLD_TTL_MS).toISOString());
  });

  it("finishing a chapter starts it again too", async () => {
    const harness = makeHarness({ engine: realEngine, playtest: true });
    const { householdId, players } = await guestHousehold(harness, T0 + 2 * DAY);
    const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!created.ok) throw new Error("room");
    const { code, runId } = created.value;
    await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
    const send = async (intent: ClientIntent) => {
      const seq = (await harness.repo.getState(runId))?.seq ?? 0;
      const response = await applyAction({ runId, playerId: "p_1", seq, intent }, harness.deps);
      expect(response.ok, JSON.stringify(response.ok ? null : response.error)).toBe(true);
    };
    await send({
      type: "CREATE_CHARACTER",
      name: "Pip",
      species: "unicorn",
      class: "songkeeper",
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
    } as ClientIntent);
    await send({ type: "READY", ready: true });
    await send({ type: "START_CHAPTER", chapterId: "bramblewood-01" });

    // A long evening: the chapter ends hours after the room was made.
    harness.clock.advance(5 * 60 * 60 * 1000);
    await send({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" });
    expect((await harness.repo.getState(runId))?.phase).toBe("chapter_complete");
    expect(await expiryOf(harness, householdId)).toBe(
      new Date(T0 + 5 * 60 * 60 * 1000 + GUEST_HOUSEHOLD_TTL_MS).toISOString(),
    );
  });

  it("leaves a claimed household without an expiry", async () => {
    const harness = makeHarness();
    const { householdId } = await seedHousehold(harness, 1);
    await createRoom({ householdId, mode: "party" }, harness.deps);
    expect(await harness.repo.getHousehold(householdId)).not.toHaveProperty("expiresAt");
  });

  it("is never what stops a room being created", async () => {
    // Best-effort: a store that cannot extend still lets the family play.
    const harness = makeHarness();
    const { householdId } = await guestHousehold(harness, T0 + DAY);
    harness.repo.extendGuestHousehold = async () => {
      throw new Error("throttled");
    };
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    expect(created.ok).toBe(true);
  });
});
