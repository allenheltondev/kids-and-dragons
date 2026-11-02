import { describe, expect, it } from "vitest";
import { CODE_MISS_LIMIT } from "./code-guard.ts";
import { closeRoom } from "./host.ts";
import { createRoom, watchRoom } from "./room.ts";
import {
  createScreenCode,
  isScreenSlowDown,
  normalizeScreenCode,
  redeemScreenCode,
  SCREEN_CODE_LENGTH,
  SCREEN_TTL_MS,
} from "./screens.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";

const CLIENT = "203.0.113.9";

async function leader() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 2);
  const [host, other] = players;
  if (!host || !other) throw new Error("setup failed");
  const created = await createRoom({ householdId, mode: "party", hostDeviceId: host.principal.deviceId }, harness.deps);
  if (!created.ok) throw new Error("setup failed");
  return { harness, host, other, code: created.value.code, runId: created.value.runId };
}

function value<T>(r: { ok: boolean } & ({ ok: true; value: T } | { ok: false; error: { code: string; message: string } })): T {
  if (!r.ok) throw new Error(`expected ok: ${(r as { error: { message: string } }).error.message}`);
  return r.value;
}

describe("a follower screen (leader/follower tables)", () => {
  it("lets the host mint a code that gives another TV a viewer token for the same room, once", async () => {
    const { harness, host, code, runId } = await leader();
    const made = value(await createScreenCode({ code, principal: host.principal }, harness.deps));
    expect(made.code).toMatch(new RegExp(`^[A-Z]{${SCREEN_CODE_LENGTH}}$`));
    expect(Date.parse(made.expiresAt) - harness.clock.now()).toBe(SCREEN_TTL_MS);

    const shown = await redeemScreenCode({ code: made.code, client: CLIENT }, harness.deps);
    if (isScreenSlowDown(shown)) throw new Error("unexpected slow down");
    const view = value(shown);
    expect(view.runId).toBe(runId);
    expect(view.state.runId).toBe(runId);
    expect(view).not.toHaveProperty("host");

    // The token is a viewer's: this room, no player, so it cannot act.
    expect(await harness.identity.resolveViewer(view.viewerToken)).toMatchObject({ runId, roomCode: code });
    expect(await harness.identity.resolveSession(view.viewerToken)).toBeNull();

    // Spent: a second screen with the same code gets nothing.
    const again = await redeemScreenCode({ code: made.code, client: CLIENT }, harness.deps);
    expect(isScreenSlowDown(again) ? null : again).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("is the host's alone, and leaves the old rule for /watch as it was", async () => {
    const { harness, other, code } = await leader();
    expect(await createScreenCode({ code, principal: other.principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await watchRoom({ code }, harness.deps)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("reads a code in any case and with its dash", async () => {
    const { harness, host, code } = await leader();
    const made = value(await createScreenCode({ code, principal: host.principal }, harness.deps));
    const typed = `${made.code.slice(0, 4)}-${made.code.slice(4)}`.toLowerCase();
    expect(normalizeScreenCode(typed)).toBe(made.code);
    const shown = await redeemScreenCode({ code: typed, client: CLIENT }, harness.deps);
    expect(isScreenSlowDown(shown) ? null : shown).toMatchObject({ ok: true });
  });

  it("dies at its expiry", async () => {
    const { harness, host, code } = await leader();
    const made = value(await createScreenCode({ code, principal: host.principal }, harness.deps));
    harness.clock.advance(SCREEN_TTL_MS + 1000);
    const shown = await redeemScreenCode({ code: made.code, client: CLIENT }, harness.deps);
    expect(isScreenSlowDown(shown) ? null : shown).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("is refused once the host has closed the room, at the making and at the redeeming", async () => {
    const { harness, host, code } = await leader();
    const made = value(await createScreenCode({ code, principal: host.principal }, harness.deps));
    expect(await closeRoom({ code, principal: host.principal }, harness.deps)).toMatchObject({ ok: true });

    const shown = await redeemScreenCode({ code: made.code, client: CLIENT }, harness.deps);
    expect(isScreenSlowDown(shown) ? null : shown).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await createScreenCode({ code, principal: host.principal }, harness.deps)).toMatchObject({ ok: false });
  });

  it("counts wrong codes against the client, like wrong room codes", async () => {
    const { harness } = await leader();
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      await redeemScreenCode({ code: "ZZZZZZZZ", client: CLIENT }, harness.deps);
    }
    expect(isScreenSlowDown(await redeemScreenCode({ code: "ZZZZZZZZ", client: CLIENT }, harness.deps))).toBe(true);
    // Another client is not slowed by it.
    expect(isScreenSlowDown(await redeemScreenCode({ code: "ZZZZZZZZ", client: "198.51.100.1" }, harness.deps))).toBe(false);
  });

  it("refuses a code of the wrong length without spending the budget", async () => {
    const { harness } = await leader();
    expect(await redeemScreenCode({ code: "ABC", client: CLIENT }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
  });
});
