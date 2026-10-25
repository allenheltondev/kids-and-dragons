import { describe, expect, it, vi } from "vitest";
import { PUSH_BODY, PUSH_TITLE, type PartyMember, type Prompt, type RunState, type TurnPushPayload } from "@kad/shared";
import { makeHarness, seedHousehold, stubEngine, T0, type TestHarness } from "../test-support.ts";
import type { PushSubscriptionRecord } from "../store/repository.ts";
import { applyAction } from "./action.ts";
import { AWAY_AFTER_MS } from "./presence.ts";
import { inProcessDispatch, recordingSender } from "../web-push.ts";
import {
  deliverTurnPush,
  dispatchTurnPush,
  openedFor,
  pushKey,
  quietOnes,
  readSubscription,
  readTurnPushJob,
  subscribePush,
  turnPushJob,
  unsubscribePush,
  type PushSendResult,
  type PushSenderDeps,
  type TurnPushJob,
} from "./push.ts";
import { createRoom, joinRoom } from "./room.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function member(playerId: string, connected = true): PartyMember {
  return {
    playerId,
    character: { id: `c_${playerId}` } as PartyMember["character"],
    hp: 10,
    down: false,
    connected,
    ready: false,
  };
}

function runState(prompt: Prompt | null, party: PartyMember[] = [member("p_1"), member("p_2")], extra: Partial<RunState> = {}): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "party",
    seq: 1,
    phase: "scene",
    campaignId: null,
    chapterId: "ch",
    sceneId: "s1",
    sceneType: null,
    narration: "",
    art: null,
    party,
    prompt,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: new Date(T0).toISOString(),
    ...extra,
  } as RunState;
}

function choiceFor(playerIds: string[], sceneId = "s1"): Prompt {
  return { kind: "choice", sceneId, options: [{ id: "a", label: "A", icon: "" }, { id: "b", label: "B", icon: "" }], forPlayerIds: playerIds, vote: false };
}

function rollFor(characterId: string, sceneId = "s1"): Prompt {
  return { kind: "roll", sceneId, stat: "might", tn: 10, prompt: "Lift it", characterId };
}

function subscription(playerId: string, deviceId: string, endpoint = `https://push.example/${deviceId}`): PushSubscriptionRecord {
  return {
    playerId,
    householdId: "h_test",
    deviceId,
    endpoint,
    keys: { p256dh: "BPub", auth: "secret" },
    createdAt: new Date(T0).toISOString(),
  };
}

/** A sender that records every push, answering what `answer` says. */
function sender(answer: (s: PushSubscriptionRecord) => PushSendResult | Promise<PushSendResult> = () => "sent") {
  const sent: { subscription: PushSubscriptionRecord; payload: TurnPushPayload }[] = [];
  return {
    sent,
    send: vi.fn(async (s: PushSubscriptionRecord, payload: TurnPushPayload) => {
      const result = await answer(s);
      if (result === "sent") sent.push({ subscription: s, payload });
      return result;
    }),
  };
}

/** A store with a kid `p_2` whose bound phone is subscribed, and the sender's deps over it. */
async function withPush(answer?: (s: PushSubscriptionRecord) => PushSendResult | Promise<PushSendResult>) {
  const harness = makeHarness();
  const { players } = await seedHousehold(harness, 2);
  const push = sender(answer);
  const deps: PushSenderDeps = { repo: harness.repo, now: harness.clock.now, delivery: { sender: push } };
  const kid = players[1]!.principal;
  await harness.repo.putPushSubscription(subscription(kid.playerId, kid.deviceId));
  return { harness, push, kid, players, deps };
}

/** The job a step makes, and the room as the sender will find it. */
async function stepped(harness: TestHarness, before: RunState, after: RunState): Promise<TurnPushJob> {
  await harness.repo.putState(after);
  const job = turnPushJob(before, after, "p_1", harness.clock.now());
  if (!job) throw new Error("the step opened nothing");
  return job;
}

async function beat(harness: TestHarness, playerId: string, at: number): Promise<void> {
  await harness.repo.touchPresence("r_1", playerId, new Date(at).toISOString(), Math.floor((at + 3600_000) / 1000));
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

describe("openedFor: who a step just opened a question for", () => {
  it("names the kid a new turn-held choice waits on", () => {
    expect(openedFor(runState(null), runState(choiceFor(["p_2"])), "p_1")).toEqual(["p_2"]);
  });

  it("never names the kid who just acted", () => {
    expect(openedFor(runState(null), runState(choiceFor([])), "p_1")).toEqual(["p_2"]);
  });

  it("names nobody when the same question is still open for her", () => {
    const vote: Prompt = { ...choiceFor([]), vote: true } as Prompt;
    const voted: Prompt = { ...vote, votes: { p_1: "a" } } as Prompt;
    expect(openedFor(runState(vote), runState(voted), "p_1")).toEqual([]);
  });

  it("names her again for the next scene's question", () => {
    expect(openedFor(runState(choiceFor(["p_2"], "s1")), runState(choiceFor(["p_2"], "s2"), undefined, { sceneId: "s2" }), "p_1")).toEqual(["p_2"]);
  });

  it("names the roller of a new check, and nobody else", () => {
    expect(openedFor(runState(choiceFor(["p_1"])), runState(rollFor("c_p_2")), "p_1")).toEqual(["p_2"]);
  });

  it("names nobody once a room is closed, or with no prompt", () => {
    expect(openedFor(runState(null), runState(choiceFor(["p_2"]), undefined, { closed: true }), "p_1")).toEqual([]);
    expect(openedFor(runState(choiceFor(["p_2"])), runState(null), "p_1")).toEqual([]);
  });
});

describe("quietOnes: whose phone has gone quiet", () => {
  const now = T0 + 10 * 60_000;
  const state = runState(null, [member("p_1"), member("p_2"), member("p_3", false), member("p_4")]);

  it("counts a beat older than the away rule as quiet, and a fresh one as here", () => {
    const beats = {
      p_1: new Date(now - 5_000).toISOString(),
      p_2: new Date(now - AWAY_AFTER_MS - 1).toISOString(),
    };
    expect(quietOnes(["p_1", "p_2"], state, beats, now)).toEqual(["p_2"]);
  });

  it("counts a phone marked away as quiet whatever its last beat", () => {
    expect(quietOnes(["p_3"], state, { p_3: new Date(now).toISOString() }, now)).toEqual(["p_3"]);
  });

  it("leaves a phone with no beat on record and still marked here alone", () => {
    expect(quietOnes(["p_4"], state, {}, now)).toEqual([]);
  });

  it("reads the away rule it is given", () => {
    const beats = { p_1: new Date(now - 5_000).toISOString() };
    expect(quietOnes(["p_1"], state, beats, now, 1_000)).toEqual(["p_1"]);
  });

  it("names nobody who is not at the table", () => {
    expect(quietOnes(["p_9"], state, {}, now)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

describe("the job a step hands over", () => {
  it("names the kids it opened a question for, and nothing when it opened none", () => {
    expect(turnPushJob(runState(null), runState(choiceFor(["p_2"])), "p_1", T0)).toEqual({
      kind: "turn",
      runId: "r_1",
      roomCode: "ABCD",
      seq: 1,
      candidates: ["p_2"],
      actorId: "p_1",
      at: T0,
    });
    expect(turnPushJob(runState(choiceFor(["p_2"])), runState(choiceFor(["p_2"])), "p_1", T0)).toBeNull();
  });

  it("is read back off the wire as it was sent, and anything else is not a job", () => {
    const job = turnPushJob(runState(null), runState(choiceFor(["p_2"])), "p_1", T0)!;
    expect(readTurnPushJob(JSON.parse(JSON.stringify(job)))).toEqual(job);
    expect(readTurnPushJob(null)).toBeNull();
    expect(readTurnPushJob({ ...job, kind: "other" })).toBeNull();
    expect(readTurnPushJob({ ...job, candidates: "p_2" })).toBeNull();
    expect(readTurnPushJob({ ...job, runId: "" })).toBeNull();
  });
});

describe("the push sender's job (deliverTurnPush)", () => {
  const before = runState(null);
  const after = runState(choiceFor(["p_2"]));

  it("sends one push, saying only the sentence, to a quiet kid's phone", async () => {
    const { harness, push, kid, deps } = await withPush();
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);

    expect(await deliverTurnPush(await stepped(harness, before, after), deps)).toEqual({ sent: 1, dropped: 0, failed: 0 });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.subscription.deviceId).toBe(kid.deviceId);
    expect(push.sent[0]?.payload).toEqual({ title: PUSH_TITLE, body: PUSH_BODY, url: "/p/ABCD" });
    expect(PUSH_BODY).toBe("It's your turn in Kids & Dragons");
  });

  it("sends nothing to a kid whose phone is here", async () => {
    const { harness, push, kid, deps } = await withPush();
    await beat(harness, kid.playerId, T0 - 5_000);
    expect((await deliverTurnPush(await stepped(harness, before, after), deps)).sent).toBe(0);
    expect(push.send).not.toHaveBeenCalled();
  });

  it("sends nothing once the question has been answered by the time the job runs", async () => {
    const { harness, push, kid, deps } = await withPush();
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);
    const job = await stepped(harness, before, after);
    await harness.repo.putState(runState(null));
    expect((await deliverTurnPush(job, deps)).sent).toBe(0);
    expect(push.send).not.toHaveBeenCalled();
  });

  it("sends nothing to a quiet kid with no subscription", async () => {
    const { harness, push, kid, deps } = await withPush();
    await harness.repo.deletePushSubscription(kid.playerId, kid.deviceId);
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);
    expect(await deliverTurnPush(await stepped(harness, before, after), deps)).toEqual({ sent: 0, dropped: 0, failed: 0 });
    expect(push.send).not.toHaveBeenCalled();
  });

  it("forgets a subscription the push service says is gone", async () => {
    const { harness, kid, deps } = await withPush(() => "gone");
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);
    expect(await deliverTurnPush(await stepped(harness, before, after), deps)).toEqual({ sent: 0, dropped: 1, failed: 0 });
    expect(await harness.repo.listPushSubscriptions(kid.playerId)).toEqual([]);
  });

  it("forgets, without sending, a phone that is no longer hers", async () => {
    const { harness, push, kid, deps } = await withPush();
    await harness.repo.revokeDevice(kid.householdId, kid.deviceId);
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);
    expect((await deliverTurnPush(await stepped(harness, before, after), deps)).dropped).toBe(1);
    expect(push.send).not.toHaveBeenCalled();
    expect(await harness.repo.listPushSubscriptions(kid.playerId)).toEqual([]);
  });

  it("keeps the subscription and never throws when the push service fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { harness, kid, deps } = await withPush(() => {
      throw new Error("push service down");
    });
    await beat(harness, kid.playerId, T0 - AWAY_AFTER_MS - 1);
    expect(await deliverTurnPush(await stepped(harness, before, after), deps)).toEqual({ sent: 0, dropped: 0, failed: 1 });
    expect(await harness.repo.listPushSubscriptions(kid.playerId)).toHaveLength(1);
    warn.mockRestore();
  });

  it("never throws when the store does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { harness, deps } = await withPush();
    const job = await stepped(harness, before, after);
    vi.spyOn(harness.repo, "getPresence").mockRejectedValue(new Error("throttled"));
    expect(await deliverTurnPush(job, deps)).toEqual({ sent: 0, dropped: 0, failed: 0 });
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Through an action: the hand-over, never the send
// ---------------------------------------------------------------------------

describe("an action that opens a question for somebody", () => {
  /** Seats both kids on "seat", then hands kid 2 the turn on "ask". */
  const engine = stubEngine((state, input) => {
    if (input.intent.type !== "CHOOSE") return { state };
    if (input.intent.choiceId === "seat") return { state: { ...state, phase: "scene", party: [member("p_1"), member("p_2")] } };
    if (input.intent.choiceId === "ask") return { state: { ...state, prompt: choiceFor(["p_2"]) } };
    return { state };
  });

  async function room() {
    const harness = makeHarness({ engine });
    const { householdId, players } = await seedHousehold(harness, 2);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("setup failed");
    const [one, two] = players as [(typeof players)[0], (typeof players)[0]];
    await joinRoom({ code: created.value.code, principal: one.principal }, harness.deps);
    await joinRoom({ code: created.value.code, principal: two.principal }, harness.deps);
    const runId = created.value.runId;
    const seat = await applyAction({ runId, playerId: "p_1", seq: (await harness.repo.getState(runId))!.seq, intent: { type: "CHOOSE", choiceId: "seat" } }, harness.deps);
    if (!seat.ok) throw new Error("seat failed");
    await harness.repo.putPushSubscription(subscription("p_2", two.principal.deviceId));
    const at = harness.clock.now();
    await harness.repo.touchPresence(runId, "p_2", new Date(at - AWAY_AFTER_MS - 1).toISOString(), Math.floor(at / 1000) + 3600);
    const ask = () => applyAction({ runId, playerId: "p_1", seq: seat.seq, intent: { type: "CHOOSE", choiceId: "ask" } }, harness.deps);
    return { harness, runId, seq: seat.seq, code: created.value.code, ask };
  }

  /** How long a test lets an action take before calling it stuck. */
  const PATIENCE_MS = 2_000;
  const settledWithin = <T>(work: Promise<T>, ms: number) =>
    Promise.race([work.then((value) => ({ value })), new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), ms))]);

  it("hands over exactly the job, and reads no presence or phone on the way", async () => {
    const { harness, runId, seq, code, ask } = await room();
    const jobs: TurnPushJob[] = [];
    harness.deps.push = { publicKey: "BPublicKey", dispatch: async (job) => void jobs.push(job) };
    const presence = vi.spyOn(harness.repo, "getPresence");
    const phones = vi.spyOn(harness.repo, "listPushSubscriptions");
    expect(await ask()).toEqual({ ok: true, seq: seq + 1 });
    expect(jobs).toEqual([{ kind: "turn", runId, roomCode: code, seq: seq + 1, candidates: ["p_2"], actorId: "p_1", at: harness.clock.now() }]);
    expect(presence).not.toHaveBeenCalled();
    expect(phones).not.toHaveBeenCalled();
  });

  it("answers the tap even when the hand-over never finishes (a hung invoke)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { harness, seq, ask } = await room();
    harness.deps.push = { publicKey: "BPublicKey", dispatch: () => new Promise<void>(() => undefined) };
    const started = Date.now();
    const outcome = await settledWithin(ask(), PATIENCE_MS);
    expect(outcome).toEqual({ value: { ok: true, seq: seq + 1 } });
    expect(Date.now() - started).toBeLessThan(PATIENCE_MS);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/moved on/));
    warn.mockRestore();
  });

  it("succeeds, and says so in the log, when the hand-over fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { harness, runId, seq, ask } = await room();
    harness.deps.push = { publicKey: "BPublicKey", dispatch: () => Promise.reject(new Error("throttled")) };
    expect(await ask()).toEqual({ ok: true, seq: seq + 1 });
    expect((await harness.repo.getState(runId))?.prompt?.kind).toBe("choice");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not be handed over/), expect.any(Error));
    warn.mockRestore();
  });

  it("answers before a slow push service does, and the push still goes after (the dev server's path)", async () => {
    const { harness, code, ask } = await room();
    let release: (() => void) | null = null;
    const slow = recordingSender(harness.clock.now);
    const held = { ...slow, send: async (...args: Parameters<typeof slow.send>) => {
      await new Promise<void>((resolve) => (release = resolve));
      return slow.send(...args);
    } };
    const dispatch = inProcessDispatch({ repo: harness.repo, now: harness.clock.now, delivery: { sender: held } });
    harness.deps.push = { publicKey: "BPublicKey", dispatch };
    expect(await settledWithin(ask(), PATIENCE_MS)).not.toBe("stuck");
    expect(slow.sent).toEqual([]);
    // The sender reaches the push service after the answer, and is held there.
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!();
    await dispatch.settled();
    expect(slow.sent.map((p) => p.payload.url)).toEqual([`/p/${code}`]);
  });

  it("with pushes off, hands over nothing", async () => {
    const { harness, seq, ask } = await room();
    expect(harness.deps.push).toBeUndefined();
    expect(await ask()).toEqual({ ok: true, seq: seq + 1 });
  });

  it("never waits on a dispatch longer than it is told to", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const started = Date.now();
    await dispatchTurnPush(
      { before: runState(null), after: runState(choiceFor(["p_2"])), actorId: "p_1" },
      { now: () => T0, push: { publicKey: "k", dispatch: () => new Promise<void>(() => undefined) } },
      50,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------

describe("subscribing and unsubscribing", () => {
  const body = { endpoint: "https://push.example/abc", keys: { p256dh: "BPub_-", auth: "c2VjcmV0" } };

  it("hands out the public key only when pushes are on", async () => {
    expect(pushKey({})).toEqual({ enabled: false });
    expect(pushKey({ push: { dispatch: async () => undefined, publicKey: "BKey" } })).toEqual({ enabled: true, publicKey: "BKey" });
  });

  it("stores a kid's phone's subscription under her and that phone", async () => {
    const { harness, players } = await withPush();
    harness.deps.push = { dispatch: async () => undefined, publicKey: "BKey" };
    const me = players[0]!.principal;
    expect(await subscribePush({ principal: me, body }, harness.deps)).toEqual({ ok: true });
    expect(await harness.repo.listPushSubscriptions(me.playerId)).toEqual([
      { playerId: me.playerId, householdId: me.householdId, deviceId: me.deviceId, ...body, createdAt: new Date(T0).toISOString() },
    ]);
    expect(await unsubscribePush({ principal: me }, harness.deps)).toEqual({ ok: true });
    expect(await harness.repo.listPushSubscriptions(me.playerId)).toEqual([]);
  });

  it("refuses with pushes off, without a kid's phone, and for a body that is not a subscription", async () => {
    const harness = makeHarness();
    const me = { deviceId: "d_1", householdId: "h_1", playerId: "p_1" };
    expect((await subscribePush({ principal: me, body }, harness.deps)).ok).toBe(false);
    harness.deps.push = { dispatch: async () => undefined, publicKey: "BKey" };
    expect(await subscribePush({ principal: null, body }, harness.deps)).toMatchObject({ status: 403 });
    expect(await subscribePush({ principal: { ...me, playerId: "" }, body }, harness.deps)).toMatchObject({ status: 403 });
    expect(await subscribePush({ principal: me, body: { ...body, endpoint: "http://push.example/abc" } }, harness.deps)).toMatchObject({ status: 400 });
    expect(await unsubscribePush({ principal: null }, harness.deps)).toMatchObject({ status: 403 });
  });

  it("reads only an https endpoint and two base64url keys", () => {
    expect(readSubscription(body)).toEqual(body);
    expect(readSubscription(null)).toBeNull();
    expect(readSubscription({ endpoint: "not a url", keys: body.keys })).toBeNull();
    expect(readSubscription({ endpoint: body.endpoint })).toBeNull();
    expect(readSubscription({ endpoint: body.endpoint, keys: { p256dh: "has space", auth: "x" } })).toBeNull();
    expect(readSubscription({ endpoint: `https://push.example/${"a".repeat(3000)}`, keys: body.keys })).toBeNull();
    // Nothing but what is read is kept.
    expect(readSubscription({ ...body, expirationTime: null, extra: "x" })).toEqual(body);
  });
});
