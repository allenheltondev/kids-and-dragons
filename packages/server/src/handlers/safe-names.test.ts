/**
 * Safe names (#253): the server refuses a blocked word at every door a typed
 * name comes in by. No client is involved anywhere in this file.
 */
import { describe, expect, it } from "vitest";
import { NAME_REFUSED_MESSAGE } from "@kad/shared";
import { makeHarness } from "../test-support.ts";
import { linkAccount } from "./account.ts";
import { addProfile, createGroup, renameProfile } from "./organizer.ts";
import { listSharedPlayers, seatOnSharedDevice, shareDevice } from "./shared-device.ts";
import type { HandlerResult } from "./deps.ts";

const ANA = { cognitoSub: "sub_ana", email: "ana@example.com" };

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function refusal<T>(result: HandlerResult<T>): { code: string; message: string } {
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
}

describe("a blocked name is refused by the server (#253)", () => {
  it("when an organizer adds or renames a kid", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));

    expect(refusal(await addProfile({ ...ANA, householdId: group.id, displayName: "Poopface" }, harness.deps))).toEqual({
      code: "ILLEGAL",
      message: NAME_REFUSED_MESSAGE,
    });
    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = view.players.find((p) => p.displayName === "Posy")!;
    expect(
      refusal(await renameProfile({ ...ANA, householdId: group.id, playerId: posy.id, displayName: "b1tch" }, harness.deps))
        .message,
    ).toBe(NAME_REFUSED_MESSAGE);
    expect((await harness.repo.getPlayer(group.id, posy.id))?.displayName).toBe("Posy");
  });

  it("when a kid taps Someone new on a shared tablet", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const tablet = value(await shareDevice({ cognitoSub: ANA.cognitoSub }, harness.deps));
    const shared = await harness.identity.resolveSharedDevice(tablet.sharedToken);
    if (!shared) throw new Error("tablet did not resolve");

    const error = refusal(await seatOnSharedDevice({ shared, newPlayer: "f u c k" }, harness.deps));
    expect(error).toEqual({ code: "ILLEGAL", message: NAME_REFUSED_MESSAGE });
    expect(value(await listSharedPlayers(shared, harness.deps)).players).toHaveLength(0);
    expect(group.id).toBe(shared.householdId);
  });

  it("when an email prefix would have become a player's name", async () => {
    const harness = makeHarness();
    const linked = value(await linkAccount({ cognitoSub: "sub_x", email: "poop@example.com" }, harness.deps));
    const players = await harness.repo.listPlayers(linked.householdId!);
    expect(players.map((p) => p.displayName)).toEqual(["Grown-up"]);
  });
});
