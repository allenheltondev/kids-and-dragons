import { describe, expect, it } from "vitest";
import { makeHarness, type TestHarness } from "../test-support.ts";
import {
  addPlayer,
  adoptDevice,
  createGuestHousehold,
  GUEST_HOUSEHOLD_TTL_MS,
  linkAccount,
} from "./account.ts";

async function guestParty(harness: TestHarness) {
  const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
  await harness.repo.putCharacter({
    id: "c_1",
    householdId: host.household.id,
    ownerPlayerId: host.player.id,
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    committed: {
      level: 1,
      xp: 0,
      stats: { might: 1, quick: 2, clever: 2, heart: 4 },
      tier: "fledgling",
      unlockedActions: [],
      inventory: [],
    },
    questItems: [],
    souvenirs: [],
    createdAt: new Date(harness.clock.now()).toISOString(),
  });
  return host;
}

describe("anonymous play", () => {
  it("gives a device that has never played a household, a player, and a token", async () => {
    const harness = makeHarness();
    const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);

    expect(host.household).toMatchObject({ guest: true, ownerSub: null });
    expect(host.household.expiresAt).toBe(
      new Date(harness.clock.now() + GUEST_HOUSEHOLD_TTL_MS).toISOString(),
    );
    // The point of the whole design: no sign-up happened, and the device is
    // already somebody.
    expect(await harness.identity.resolveDevice(host.deviceToken)).toMatchObject({
      householdId: host.household.id,
      playerId: host.player.id,
      role: "adult",
    });
  });

  it("expires, and is swept once it does", async () => {
    const harness = makeHarness();
    const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);

    expect(
      await harness.repo.listExpiredGuestHouseholds(new Date(harness.clock.now()).toISOString()),
    ).toEqual([]);

    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS + 1);
    const expired = await harness.repo.listExpiredGuestHouseholds(
      new Date(harness.clock.now()).toISOString(),
    );
    expect(expired.map((h) => h.id)).toEqual([host.household.id]);
  });

  it("hands the second player a different colour", async () => {
    const harness = makeHarness();
    const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
    const kid = await addPlayer(
      { householdId: host.household.id, displayName: "Kid", role: "child" },
      harness.deps,
    );
    expect(kid.player.color).not.toBe(host.player.color);
    expect(kid.player.role).toBe("child");
  });
});

describe("linkAccount", () => {
  it("claims the household the party is already playing in", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);

    const result = await linkAccount(
      { cognitoSub: "sub_a", email: "allen@example.com", principal: host.principal },
      harness.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(true);
    // The id did not change, so nothing the clients are holding went stale —
    // this is a claim, not a migration.
    expect(result.value.householdId).toBe(host.household.id);
    expect(result.value.characters.map((c) => c.name)).toEqual(["Sparklehoof"]);

    const household = await harness.repo.getHousehold(host.household.id);
    expect(household).toMatchObject({ guest: false, ownerSub: "sub_a" });

    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS * 10);
    expect(
      await harness.repo.listExpiredGuestHouseholds(new Date(harness.clock.now()).toISOString()),
    ).toEqual([]);
  });

  it("still works when the household has already expired but not yet been swept", async () => {
    // The sweep is a scheduled job, so there is always a window. Losing the
    // claim inside it would mean "sign in to keep them" failing at exactly the
    // moment it matters most.
    const harness = makeHarness();
    const host = await guestParty(harness);
    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS + 1);

    const result = await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);
    expect(result.ok && result.value.claimed).toBe(true);
    expect(
      await harness.repo.listExpiredGuestHouseholds(new Date(harness.clock.now()).toISOString()),
    ).toEqual([]);
  });

  it("signing in twice is not an event", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);

    const again = await linkAccount(
      { cognitoSub: "sub_a", principal: host.principal },
      harness.deps,
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.claimed).toBe(false);
    expect(again.value.householdId).toBe(host.household.id);
  });

  it("will not let a child device claim a household", async () => {
    const harness = makeHarness();
    const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
    const kid = await addPlayer(
      { householdId: host.household.id, displayName: "Kid", role: "child" },
      harness.deps,
    );

    const result = await linkAccount({ cognitoSub: "sub_a", principal: kid.principal }, harness.deps);
    expect(result.ok).toBe(false);
    expect((await harness.repo.getHousehold(host.household.id))?.guest).toBe(true);
  });

  it("does not hand one family's session to the next person to sign in on that phone", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);

    // A second adult signs in on a device bound to sub_a's household. They get
    // their own household, not this one.
    const other = await linkAccount(
      { cognitoSub: "sub_b", email: "b@example.com", principal: host.principal },
      harness.deps,
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.value.householdId).not.toBe(host.household.id);
    expect((await harness.repo.getHousehold(host.household.id))?.ownerSub).toBe("sub_a");
  });

  it("creates a permanent household when someone signs in before ever playing", async () => {
    const harness = makeHarness();
    const result = await linkAccount(
      { cognitoSub: "sub_a", email: "allen@example.com" },
      harness.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(false);
    expect(result.value.deviceToken).toBeTypeOf("string");

    const household = await harness.repo.getHousehold(result.value.householdId);
    expect(household).toMatchObject({ guest: false, ownerSub: "sub_a" });
    expect(household).not.toHaveProperty("expiresAt");
  });

  it("resolves an existing account on a fresh device without guessing who they are", async () => {
    const harness = makeHarness();
    const first = await linkAccount({ cognitoSub: "sub_a", email: "a@example.com" }, harness.deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Same account, new phone, no device token.
    const second = await linkAccount({ cognitoSub: "sub_a" }, harness.deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.householdId).toBe(first.value.householdId);
    expect(second.value.players).toHaveLength(1);
    // Deliberately no token: only the human knows which player this phone is.
    expect(second.value.deviceToken).toBeUndefined();
  });
});

describe("adoptDevice", () => {
  it("binds a signed-in device to a player of their own household", async () => {
    const harness = makeHarness();
    const linked = await linkAccount({ cognitoSub: "sub_a", email: "a@example.com" }, harness.deps);
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    const playerId = linked.value.players[0]?.id ?? "";

    const adopted = await adoptDevice(
      { cognitoSub: "sub_a", householdId: linked.value.householdId, playerId },
      harness.deps,
    );
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    expect(await harness.identity.resolveDevice(adopted.value.deviceToken)).toMatchObject({
      householdId: linked.value.householdId,
      playerId,
    });
  });

  it("refuses a household the account does not own", async () => {
    const harness = makeHarness();
    const mine = await linkAccount({ cognitoSub: "sub_a", email: "a@example.com" }, harness.deps);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const result = await adoptDevice(
      {
        cognitoSub: "sub_b",
        householdId: mine.value.householdId,
        playerId: mine.value.players[0]?.id ?? "",
      },
      harness.deps,
    );
    expect(result.ok).toBe(false);
  });
});
