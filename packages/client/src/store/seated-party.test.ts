/**
 * The party the screens draw: everybody but whoever the host took out (#267). A removed player
 * stays in `party` as away, so no turn waits on them, but they left the game: the TV must not
 * keep them on the stage, faded, saying they stepped away (playtest, 2026-11-14).
 */

import { describe, expect, it } from "vitest";
import type { PartyMember } from "@kad/shared";
import { seatedParty } from "./index";

const member = (playerId: string, connected = true): PartyMember =>
  ({ playerId, connected, ready: false, hp: 10, down: false, character: { id: `c_${playerId}` } }) as unknown as PartyMember;

describe("the seated party", () => {
  it("leaves out a player the host took out, and keeps one who only stepped away", () => {
    const party = [member("p_1"), member("p_2", false), member("p_3", false)];
    expect(seatedParty({ party, removed: ["p_3"] }).map((m) => m.playerId)).toEqual(["p_1", "p_2"]);
  });

  it("is the party itself, the same array, when nobody was taken out", () => {
    const party = [member("p_1")];
    expect(seatedParty({ party })).toBe(party);
    expect(seatedParty({ party, removed: [] })).toBe(party);
    expect(seatedParty(null)).toEqual([]);
  });
});
