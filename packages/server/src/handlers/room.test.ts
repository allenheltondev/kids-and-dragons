import { describe, expect, it } from "vitest";
import { makeHarness, scriptedRandom, seedHousehold } from "../test-support.ts";
import {
  createRoom,
  generateRoomCode,
  joinRoom,
  ROOM_CODE_ALPHABET,
  ROOM_TTL_MS,
} from "./room.ts";

describe("room codes", () => {
  it("are four letters from the unambiguous alphabet", () => {
    const rng = makeSequence();
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(rng);
      expect(code).toHaveLength(4);
      expect(code).toMatch(/^[A-Z]{4}$/);
      // architecture §4.5: no I, O, 0, or 1 — they are the same glyph read
      // aloud across a room, which is how a code is actually shared.
      expect(code).not.toMatch(/[IO01]/);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("uses the whole alphabet", () => {
    const rng = makeSequence();
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) for (const ch of generateRoomCode(rng)) seen.add(ch);
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

describe("createRoom", () => {
  it("creates a run, a state, and a room with a 6-hour TTL", async () => {
    const harness = makeHarness();
    const { householdId } = await seedHousehold(harness);

    const result = await createRoom({ householdId, mode: "party" }, harness.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const room = await harness.repo.getRoom(result.value.code);
    expect(room?.runId).toBe(result.value.runId);
    expect(Date.parse(result.value.expiresAt) - harness.clock.now()).toBe(ROOM_TTL_MS);
    expect(room?.ttl).toBe(Math.floor((harness.clock.now() + ROOM_TTL_MS) / 1000));

    const run = await harness.repo.getRun(result.value.runId);
    expect(run?.householdId).toBe(householdId);
    const state = await harness.repo.getState(result.value.runId);
    expect(state?.seq).toBe(0);
    expect(state?.roomCode).toBe(result.value.code);
  });

  it("rolls a new code when the first one is taken", async () => {
    // The generator hands out ABCD, then ABCD again, then BCDE. The second
    // create must not be able to steal the first room's code.
    const harness = makeHarness({ random: scriptedRandom(["ABCD", "ABCD", "BCDE"]) });
    const { householdId } = await seedHousehold(harness);

    const first = await createRoom({ householdId, mode: "party" }, harness.deps);
    const second = await createRoom({ householdId, mode: "travel" }, harness.deps);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.code).toBe("ABCD");
    expect(second.value.code).toBe("BCDE");

    // The original room still points at the original run.
    const room = await harness.repo.getRoom("ABCD");
    expect(room?.runId).toBe(first.value.runId);
  });

  it("recycles a code once its room has expired", async () => {
    const harness = makeHarness({ random: scriptedRandom(["ABCD"]) });
    const { householdId } = await seedHousehold(harness);
    const first = await createRoom({ householdId, mode: "party" }, harness.deps);

    harness.clock.advance(ROOM_TTL_MS + 1000);
    const second = await createRoom({ householdId, mode: "party" }, harness.deps);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.code).toBe("ABCD");
    expect(second.value.runId).not.toBe(first.value.runId);
  });

  it("refuses an unknown household", async () => {
    const harness = makeHarness();
    const result = await createRoom({ householdId: "h_nope", mode: "party" }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("joinRoom", () => {
  it("resolves identity from the device — never asks who you are", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("setup failed");

    const player = players[1];
    if (!player) throw new Error("setup failed");
    const joined = await joinRoom(
      { code: created.value.code, principal: player.principal },
      harness.deps,
    );

    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.playerId).toBe(player.principal.playerId);
    expect(joined.value.runId).toBe(created.value.runId);
    expect(joined.value.state.seq).toBe(0);

    const session = await harness.identity.resolveSession(joined.value.sessionToken);
    expect(session?.runId).toBe(created.value.runId);
    // A session token can never outlive the room it is scoped to (§4.5).
    expect(session?.expiresAt).toBe(Date.parse(created.value.expiresAt));
  });

  it("is case-insensitive about the code", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok || !players[0]) throw new Error("setup failed");

    const joined = await joinRoom(
      { code: created.value.code.toLowerCase(), principal: players[0].principal },
      harness.deps,
    );
    expect(joined.ok).toBe(true);
  });

  it("rejects an unknown code, an expired room, and another household's device", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok || !players[0]) throw new Error("setup failed");
    const principal = players[0].principal;

    expect(await joinRoom({ code: "ZZZZ", principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });

    const stranger = { ...principal, householdId: "h_other" };
    expect(
      await joinRoom({ code: created.value.code, principal: stranger }, harness.deps),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    harness.clock.advance(ROOM_TTL_MS + 1);
    expect(await joinRoom({ code: created.value.code, principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

/** A cheap uniform-ish source; the code generator only needs [0, 1). */
function makeSequence(): () => number {
  let state = 12345;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}
