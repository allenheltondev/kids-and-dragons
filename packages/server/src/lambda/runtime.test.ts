/**
 * The playtest drawer's lock, as production is actually wired (#263).
 *
 * The cheats (warp to a scene, load the next d20) are refused by the engine
 * unless `EngineContext.playtest` is true (shared `playtest.ts`, whose own
 * tests cover the gate). What only this file can say is that the deployed
 * stack never turns that on: it builds the real Lambda wiring, `runtime()`,
 * and then plays a cheat against the real engine with the switch it chose.
 *
 * Building it touches no network: the AWS clients connect on first use, and
 * nothing here uses them. The client half of the lock (the drawer is not in
 * a production build at all) is e2e/production-locks.spec.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import { applyAction } from "../handlers/action.ts";
import { createRoom, joinRoom } from "../handlers/room.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { runtime } from "./runtime.ts";

const ENV = {
  AWS_REGION: "us-east-1",
  TABLE_NAME: "kad-test",
  APPSYNC_HTTP_DOMAIN: "example.appsync-api.us-east-1.amazonaws.com",
  TOKEN_KEY_PARAMETER: "/kad/test/token-signing-key",
};

describe("production's playtest switch", () => {
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("is off, and a cheat played with it is refused", async () => {
    const deployed = await runtime();
    expect(deployed.playtest).toBe(false);

    // The same switch, on a table the test can hold: the real engine, refusing.
    const harness = makeHarness({ engine: { applyIntent, createRunState }, playtest: deployed.playtest });
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!created.ok || !players[0]) throw new Error("setup failed");
    const joined = await joinRoom({ code: created.value.code, principal: players[0].principal }, harness.deps);
    if (!joined.ok) throw new Error("join failed");

    // Loading the next d20: legal at any moment when the switch is on, so a
    // refusal here is the switch and nothing else. (A warp to a made-up scene
    // would be refused either way, and prove nothing.)
    const result = await applyAction(
      {
        runId: created.value.runId,
        playerId: players[0].principal.playerId,
        seq: joined.value.state.seq,
        intent: { type: "PLAYTEST_SET_DIE", die: 20 },
        principal: players[0].principal,
      },
      harness.deps,
    );
    expect(result.ok).toBe(false);
  });
});
