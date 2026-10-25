/**
 * The push-sender function (#466) and the API's dispatcher to it: the job
 * goes by an asynchronous invoke, and the sender does what the request path
 * no longer does, on a memory store with the recording sender.
 */

import { describe, expect, it, vi } from "vitest";
import { PUSH_BODY, type PartyMember, type Prompt, type RunState } from "@kad/shared";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { makeHarness, seedHousehold, T0 } from "../test-support.ts";
import { AWAY_AFTER_MS } from "../handlers/presence.ts";
import { turnPushJob, type PushSenderDeps } from "../handlers/push.ts";
import { recordingSender } from "../web-push.ts";
import { lambdaPushDispatch } from "./push-dispatch.ts";
import { makeSenderHandler } from "./push-sender.ts";

function member(playerId: string): PartyMember {
  return { playerId, character: { id: `c_${playerId}` } as PartyMember["character"], hp: 10, down: false, connected: true, ready: false };
}

function room(prompt: Prompt | null): RunState {
  return {
    runId: "r_1", roomCode: "ABCD", mode: "party", seq: 4, phase: "scene", campaignId: null, chapterId: "ch", sceneId: "s1",
    sceneType: null, narration: "", art: null, party: [member("p_1"), member("p_2")], prompt, lastRoll: null, flags: {},
    xpEarned: 0, updatedAt: new Date(T0).toISOString(),
  } as RunState;
}

const turn: Prompt = { kind: "choice", sceneId: "s1", options: [{ id: "a", label: "A", icon: "" }, { id: "b", label: "B", icon: "" }], forPlayerIds: ["p_2"], vote: false };
const job = turnPushJob(room(null), room(turn), "p_1", T0)!;

/** A store with kid 2's phone subscribed and the room asking her, beaten `ago` ms back. */
async function world(ago: number, endpoint?: string) {
  const harness = makeHarness();
  const { players } = await seedHousehold(harness, 2);
  const kid = players[1]!.principal;
  await harness.repo.putState(room(turn));
  await harness.repo.putPushSubscription({
    playerId: kid.playerId, householdId: kid.householdId, deviceId: kid.deviceId,
    endpoint: endpoint ?? "https://push.example/kid-2", keys: { p256dh: "pub", auth: "sec" }, createdAt: new Date(T0).toISOString(),
  });
  const at = harness.clock.now() - ago;
  await harness.repo.touchPresence("r_1", kid.playerId, new Date(at).toISOString(), Math.floor(at / 1000) + 3600);
  const sender = recordingSender(harness.clock.now);
  const deps: PushSenderDeps = { repo: harness.repo, now: harness.clock.now, delivery: { sender } };
  return { harness, kid, sender, deps };
}

describe("the push-sender function", () => {
  it("sends the quiet kid one push in the fixed words", async () => {
    const { sender, deps } = await world(AWAY_AFTER_MS + 1);
    expect(await makeSenderHandler(async () => deps)(JSON.parse(JSON.stringify(job)))).toEqual({ sent: 1, dropped: 0, failed: 0 });
    expect(sender.sent.map((p) => p.payload)).toEqual([{ title: "Kids & Dragons", body: PUSH_BODY, url: "/p/ABCD" }]);
  });

  it("sends nothing to a kid whose phone is here", async () => {
    const { sender, deps } = await world(5_000);
    expect(await makeSenderHandler(async () => deps)(job)).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(sender.sent).toEqual([]);
  });

  it("does nothing with pushes off here", async () => {
    expect(await makeSenderHandler(async () => null)(job)).toEqual({ skipped: "off" });
  });

  it("sends nothing to a quiet kid with no subscription", async () => {
    const { harness, kid, sender, deps } = await world(AWAY_AFTER_MS + 1);
    await harness.repo.deletePushSubscription(kid.playerId, kid.deviceId);
    expect(await makeSenderHandler(async () => deps)(job)).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(sender.sent).toEqual([]);
  });

  it("forgets a subscription the push service says is gone", async () => {
    const { harness, kid, deps } = await world(AWAY_AFTER_MS + 1, "https://push.example/gone");
    expect(await makeSenderHandler(async () => deps)(job)).toEqual({ sent: 0, dropped: 1, failed: 0 });
    expect(await harness.repo.listPushSubscriptions(kid.playerId)).toEqual([]);
  });

  it("drops an event that is not a job, without reading anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wiring = vi.fn(async () => null);
    expect(await makeSenderHandler(wiring)({ hello: "world" })).toEqual({ skipped: "not-a-job" });
    expect(wiring).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the API's dispatcher", () => {
  it("invokes the sender asynchronously, with the job as the payload", async () => {
    const sent: InvokeCommand[] = [];
    const dispatch = lambdaPushDispatch("kad-test-push-sender", {
      send: async (command) => {
        sent.push(command);
        return { StatusCode: 202 };
      },
    });
    await dispatch(job);
    expect(sent).toHaveLength(1);
    const input = sent[0]!.input;
    expect(input.FunctionName).toBe("kad-test-push-sender");
    expect(input.InvocationType).toBe("Event");
    expect(JSON.parse(new TextDecoder().decode(input.Payload as Uint8Array))).toEqual(job);
  });

  it("fails the hand-over when Lambda did not queue it", async () => {
    const dispatch = lambdaPushDispatch("f", { send: async () => ({ StatusCode: 500 }) });
    await expect(dispatch(job)).rejects.toThrow(/500/);
    const throwing = lambdaPushDispatch("f", { send: async () => Promise.reject(new Error("TooManyRequestsException")) });
    await expect(throwing(job)).rejects.toThrow(/TooMany/);
  });
});
