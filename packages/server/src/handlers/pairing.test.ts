import { describe, expect, it } from "vitest";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { addPlayer } from "./account.ts";
import { CODE_MISS_LIMIT } from "./code-guard.ts";
import type { HandlerResult } from "./deps.ts";
import { addProfile, createGroup, pairProfile, setProfileRetired } from "./organizer.ts";
import {
  isSlowDown,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  pairFromDevice,
  redeemPairingCode,
} from "./pairing.ts";

const ANA = { cognitoSub: "sub_ana", email: "ana@example.com" };
const EVE = { cognitoSub: "sub_eve", email: "eve@example.com" };
const CLIENT = "203.0.113.7";

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function redeem(harness: TestHarness, code: string, extra: { previous?: Parameters<typeof redeemPairingCode>[0]["previous"] } = {}) {
  return redeemPairingCode({ code, client: CLIENT, ...extra }, harness.deps);
}

/** Ada's own phone, bound the ordinary way. */
async function adasPhone(harness: TestHarness) {
  return addPlayer({ householdId: "h_ada", displayName: "Ada" }, harness.deps);
}

async function household(harness: TestHarness) {
  await harness.deps.repo.putHousehold({ id: "h_ada", displayName: "Ada's household", ownerSub: null, guest: true, createdAt: "2026-07-04T18:00:00.000Z" });
}

describe("pairing a new device to a kid (#281)", () => {
  it("lets her bound phone make a code that binds a brand-new device to her", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);

    const made = value(await pairFromDevice(phone.principal, harness.deps));
    expect(made.code).toMatch(new RegExp(`^[A-Z]{${PAIRING_CODE_LENGTH}}$`));
    expect(made.playerName).toBe("Ada");
    expect(Date.parse(made.expiresAt) - harness.clock.now()).toBe(PAIRING_TTL_MS);

    const paired = await redeem(harness, made.code);
    if (isSlowDown(paired)) throw new Error("unexpected slow down");
    const bound = value(paired);
    expect(bound).toMatchObject({ householdId: "h_ada", playerId: phone.player.id, displayName: "Ada" });

    // The new device is her, by the same token any device gets.
    const resolved = await harness.identity.resolveDevice(bound.deviceToken);
    expect(resolved).toMatchObject({ householdId: "h_ada", playerId: phone.player.id });
    expect(resolved?.deviceId).not.toBe(phone.principal.deviceId);
    // And her phone is untouched.
    expect(await harness.identity.resolveDevice(phone.deviceToken)).not.toBeNull();
  });

  it("reads the code as typed: any case, with the dash it is shown with", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);
    const { code } = value(await pairFromDevice(phone.principal, harness.deps));
    const shown = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    expect(normalizePairingCode(shown)).toBe(code);
    expect(value((await redeem(harness, shown)) as HandlerResult<unknown>)).toBeTruthy();
  });

  it("refuses a code the second time", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);
    const { code } = value(await pairFromDevice(phone.principal, harness.deps));

    value((await redeem(harness, code)) as HandlerResult<unknown>);
    const again = await redeem(harness, code);
    expect(again).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("refuses an expired code", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);
    const { code } = value(await pairFromDevice(phone.principal, harness.deps));

    harness.clock.advance(PAIRING_TTL_MS + 1000);
    expect(await redeem(harness, code)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("refuses a code for a profile retired since it was made", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = view.players[0]!;
    const { code } = value(await pairProfile({ ...ANA, householdId: group.id, playerId: posy.id }, harness.deps));

    value(await setProfileRetired({ ...ANA, householdId: group.id, playerId: posy.id, retired: true }, harness.deps));
    const refused = await redeem(harness, code);
    expect(refused).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await harness.deps.repo.listDevices(group.id)).toEqual([]);
  });

  it("will not make a code for a retired profile", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = view.players[0]!;
    value(await setProfileRetired({ ...ANA, householdId: group.id, playerId: posy.id, retired: true }, harness.deps));

    const made = await pairProfile({ ...ANA, householdId: group.id, playerId: posy.id }, harness.deps);
    expect(made).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("will not make a code from a phone whose profile was retired", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);
    await harness.deps.repo.putPlayer({ ...phone.player, retired: true });
    const made = await pairFromDevice(phone.principal, harness.deps);
    expect(made).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("lets a signed-in owner make a code for a kid with no phone, and nobody else", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = view.players[0]!;

    const stranger = await pairProfile({ ...EVE, householdId: group.id, playerId: posy.id }, harness.deps);
    expect(stranger).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const made = value(await pairProfile({ ...ANA, householdId: group.id, playerId: posy.id }, harness.deps));
    const bound = value((await redeem(harness, made.code)) as HandlerResult<{ deviceToken: string; playerId: string }>);
    expect(bound.playerId).toBe(posy.id);
    expect(await harness.identity.resolveDevice(bound.deviceToken)).toMatchObject({ householdId: group.id, playerId: posy.id });
  });

  it("will not name a player who is not in the household the owner owns", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const made = await pairProfile({ ...ANA, householdId: group.id, playerId: "p_nobody" }, harness.deps);
    expect(made).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("revokes the binding the redeeming device already held, and leaves her phone alone", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);
    // A borrowed phone that was already somebody else in the same household.
    const borrowed = await addPlayer({ householdId: "h_ada", displayName: "Rue" }, harness.deps);
    const { code } = value(await pairFromDevice(phone.principal, harness.deps));

    const result = await redeem(harness, code, { previous: borrowed.principal });
    const bound = value(result as HandlerResult<{ deviceToken: string }>);

    expect(await harness.identity.resolveDevice(borrowed.deviceToken)).toBeNull();
    expect(await harness.identity.resolveDevice(phone.deviceToken)).not.toBeNull();
    expect(await harness.identity.resolveDevice(bound.deviceToken)).toMatchObject({ playerId: phone.player.id });
  });

  it("asks for a code of the right length without spending a lookup", async () => {
    const harness = makeHarness();
    expect(await redeem(harness, "ABC")).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(await redeemPairingCode({ code: 42, client: CLIENT }, harness.deps)).toMatchObject({ ok: false });
  });

  it("counts wrong codes against the client, and a right one does not run the budget down", async () => {
    const harness = makeHarness();
    await household(harness);
    const phone = await adasPhone(harness);

    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      expect(await redeem(harness, "ZZZZZZZZ")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(isSlowDown(await redeem(harness, "ZZZZZZZZ"))).toBe(true);

    // Another address has its own budget, and real codes are given back to it.
    for (let i = 0; i < CODE_MISS_LIMIT + 5; i++) {
      const { code } = value(await pairFromDevice(phone.principal, harness.deps));
      const ok = await redeemPairingCode({ code, client: "198.51.100.9" }, harness.deps);
      expect(isSlowDown(ok)).toBe(false);
      value(ok as HandlerResult<unknown>);
    }
  });
});
