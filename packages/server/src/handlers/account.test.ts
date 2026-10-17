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
      { householdId: host.household.id, displayName: "Kid" },
      harness.deps,
    );
    expect(kid.player.color).not.toBe(host.player.color);
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

  it("is founded by the phone that started it, and not by one that joined (#265)", async () => {
    const harness = makeHarness();
    const host = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
    expect(host.household).toMatchObject({ founderDeviceId: host.principal.deviceId });
    expect(host.household).not.toHaveProperty("awaitingFounder");

    await addPlayer({ householdId: host.household.id, displayName: "Sam" }, harness.deps);
    expect((await harness.repo.getHousehold(host.household.id))?.founderDeviceId).toBe(host.principal.deviceId);
  });

  it("leaves a TV's household to be founded by the first phone to join it", async () => {
    // The TV is a screen, not somebody who signs in at the end of a chapter.
    const harness = makeHarness();
    const tv = await createGuestHousehold({ displayName: "Host", display: true }, harness.deps);
    expect(tv.household).toMatchObject({ awaitingFounder: true });
    expect(tv.household).not.toHaveProperty("founderDeviceId");

    const first = await addPlayer({ householdId: tv.household.id, displayName: "Mia" }, harness.deps);
    await addPlayer({ householdId: tv.household.id, displayName: "Sam" }, harness.deps);
    expect((await harness.repo.getHousehold(tv.household.id))?.founderDeviceId).toBe(first.principal.deviceId);
  });

  it("refuses a claim from a phone that only joined with the room code (#265)", async () => {
    // Review of #271: a stranger with the code is bound into the household
    // like anybody else, and signing in to their own account must not make
    // them its owner.
    const harness = makeHarness();
    const host = await guestParty(harness);
    const stranger = await addPlayer({ householdId: host.household.id, displayName: "Who?" }, harness.deps);

    const result = await linkAccount({ cognitoSub: "sub_stranger", principal: stranger.principal }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await harness.repo.getHousehold(host.household.id)).toMatchObject({ guest: true, ownerSub: null });
    expect(await harness.repo.listHouseholdsForAccount("sub_stranger")).toEqual([]);

    // The family's own phone still keeps it.
    const kept = await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
  });

  it("sends a joiner signing in from the home screen to their own household, not this one", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    const joiner = await addPlayer({ householdId: host.household.id, displayName: "Sam" }, harness.deps);

    const result = await linkAccount(
      { cognitoSub: "sub_b", email: "b@example.com", principal: joiner.principal, preferExisting: true },
      harness.deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(false);
    expect(result.value.householdId).not.toBe(host.household.id);
    expect(await harness.repo.getHousehold(host.household.id)).toMatchObject({ guest: true, ownerSub: null });
  });

  it("keeps the old rule on a guest household made before founders, until it expires", async () => {
    // Any device playing in it may claim, as before #265. Those households
    // are gone within a week of this shipping.
    const harness = makeHarness();
    const host = await guestParty(harness);
    const { founderDeviceId: _gone, ...legacy } = host.household;
    await harness.repo.putHousehold(legacy);
    const joiner = await addPlayer({ householdId: host.household.id, displayName: "Sam" }, harness.deps);

    const result = await linkAccount({ cognitoSub: "sub_a", principal: joiner.principal }, harness.deps);
    expect(result.ok && result.value.claimed).toBe(true);
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

describe("linkAccount from the home screen (preferExisting)", () => {
  it("returns an existing account to its household instead of claiming the guest game this phone started", async () => {
    const harness = makeHarness();
    // The family's saved household, from an earlier phone.
    const saved = await guestParty(harness);
    const kept = await linkAccount({ cognitoSub: "sub_a", principal: saved.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);

    // A replacement phone plays one anonymous game first, then signs in.
    const replacement = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
    const result = await linkAccount(
      { cognitoSub: "sub_a", principal: replacement.principal, preferExisting: true },
      harness.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.householdId).toBe(saved.household.id);
    expect(result.value.claimed).toBe(false);
    expect(result.value.characters.map((c) => c.name)).toEqual(["Sparklehoof"]);
    // Not yet anybody there, so the client shows the player picker.
    expect(result.value.deviceBound).toBe(false);
    expect(result.value.deviceToken).toBeUndefined();

    // And the stray guest game is left alone, not quietly adopted.
    expect(await harness.repo.listHouseholdsForAccount("sub_a")).toEqual([saved.household.id]);
    expect(await harness.repo.getHousehold(replacement.household.id)).toMatchObject({ guest: true });
  });

  it("still keeps the guest game for an account that has nothing yet", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    const result = await linkAccount(
      { cognitoSub: "sub_new", principal: host.principal, preferExisting: true },
      harness.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(true);
    expect(result.value.householdId).toBe(host.household.id);
    expect(result.value.deviceBound).toBe(true);
  });

  it("reports a phone already in one of the account's households as bound", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);

    const again = await linkAccount(
      { cognitoSub: "sub_a", principal: host.principal, preferExisting: true },
      harness.deps,
    );
    expect(again.ok && again.value.deviceBound).toBe(true);
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

describe("the Field Guide is part of what a claim keeps", () => {
  const found = (canonId: string, playerId: string, foundAt: string) => ({
    canonId,
    playerId,
    foundAt,
  });

  /** What `lambda/sweep.ts` does, against the harness repo and clock. */
  async function sweep(harness: TestHarness): Promise<string[]> {
    const nowIso = new Date(harness.clock.now()).toISOString();
    const deleted: string[] = [];
    for (const household of await harness.repo.listExpiredGuestHouseholds(nowIso)) {
      if (await harness.repo.deleteGuestHousehold(household.id, nowIso)) deleted.push(household.id);
    }
    return deleted;
  }

  it("is swept with an unclaimed guest household (the stake the offer names)", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    await harness.repo.recordDiscoveries(host.household.id, [
      found("moth", host.player.id, "2026-01-01T00:00:00.000Z"),
    ]);

    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS + 1);
    expect(await sweep(harness)).toEqual([host.household.id]);
    expect((await harness.repo.getFieldGuide(host.household.id)).entries).toEqual({});
  });

  it("survives claim and a sweep past the guest expiry", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    const foundAt = "2026-01-01T00:00:00.000Z";
    await harness.repo.recordDiscoveries(host.household.id, [
      found("moth", host.player.id, foundAt),
      found("newt", host.player.id, foundAt),
    ]);

    const claimed = await linkAccount(
      { cognitoSub: "sub_a", email: "allen@example.com", principal: host.principal },
      harness.deps,
    );
    expect(claimed.ok && claimed.value.claimed).toBe(true);

    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS * 2);
    expect(await sweep(harness)).toEqual([]);

    const book = await harness.repo.getFieldGuide(host.household.id);
    expect(Object.keys(book.entries).sort()).toEqual(["moth", "newt"]);
    expect(book.entries["moth"]).toMatchObject({ firstFoundBy: host.player.id, foundAt });
  });

  it("is readable on a new phone after the restore sign-in", async () => {
    const harness = makeHarness();
    const host = await guestParty(harness);
    await harness.repo.recordDiscoveries(host.household.id, [
      found("moth", host.player.id, "2026-01-01T00:00:00.000Z"),
    ]);
    await linkAccount({ cognitoSub: "sub_a", principal: host.principal }, harness.deps);
    harness.clock.advance(GUEST_HOUSEHOLD_TTL_MS * 2);
    await sweep(harness);

    // A fresh phone: it played a guest game first, then restores.
    const replacement = await createGuestHousehold({ displayName: "Allen" }, harness.deps);
    const restored = await linkAccount(
      { cognitoSub: "sub_a", principal: replacement.principal, preferExisting: true },
      harness.deps,
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.householdId).toBe(host.household.id);

    const adopted = await adoptDevice(
      { cognitoSub: "sub_a", householdId: restored.value.householdId, playerId: host.player.id },
      harness.deps,
    );
    expect(adopted.ok).toBe(true);

    const book = await harness.repo.getFieldGuide(restored.value.householdId);
    expect(Object.keys(book.entries)).toEqual(["moth"]);
  });
});
