/**
 * The timing fairness matrix (#566, docs/minigame-timing.md): a simulated table of a server, a TV
 * and one to four phones, each with its own clock skew, delivery delay, jitter and refresh rate,
 * playing precision and timing interactions through the real engine. Deterministic: the jitter
 * comes from a seeded generator, so a failure names a cell that fails every run.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, enterScene, type EngineContext } from "./engine.js";
import { resolveCharacter } from "./character.js";
import { makeRng } from "./dice.js";
import { makeChapter, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import { CLOCK_TRUSTED_MS, interactionStartLocal, precisionPosition, precisionSuccess, serverClockGap, type InteractionAction, type InteractionPrompt, type InteractionSpec } from "./interactions.js";
import type { InteractionScene, RunState } from "./index.js";
import { TEAM_HOLD_MS } from "./teamwork.js";

type Timed = Extract<InteractionSpec, { kind: "precision" } | { kind: "timing" }>;
const S0 = Date.parse("2026-10-29T20:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A screen: how far its clock is off the server's, how long a message takes each way, and its frame interval. */
interface Device { skewMs: number; downMs: number; upMs: number; jitterMs: number; fps: number }
interface Cell { name: string; seats: 1 | 2 | 4; tv: Device; phones: Device[] }

const device = (skewMs: number, downMs: number, jitterMs: number, fps: number, upMs = downMs): Device => ({ skewMs, downMs, upMs, jitterMs, fps });
const lan = device(0, 15, 5, 60);
const MATRIX: Cell[] = [
  { name: "one phone on a quiet LAN", seats: 1, tv: lan, phones: [lan] },
  { name: "slow cellular phone", seats: 1, tv: lan, phones: [device(0, 300, 150, 60)] },
  { name: "phone clock 300 ms fast (inside the trusted gap)", seats: 2, tv: lan, phones: [device(300, 40, 20, 60), lan] },
  { name: "phone clock 5 s fast", seats: 2, tv: lan, phones: [device(5000, 40, 20, 60), lan] },
  { name: "phone clock 5 s slow", seats: 2, tv: lan, phones: [device(-5000, 40, 20, 60), lan] },
  { name: "TV clock 90 s off", seats: 2, tv: device(-90_000, 30, 10, 60), phones: [lan, lan] },
  { name: "old phone at 30 fps", seats: 2, tv: lan, phones: [device(0, 120, 60, 30), lan] },
  { name: "120 Hz phone, 30 Hz TV", seats: 2, tv: device(0, 20, 5, 30), phones: [device(0, 20, 5, 120), lan] },
  { name: "four phones, mixed", seats: 4, tv: device(1500, 25, 10, 60), phones: [device(-2000, 200, 120, 30), device(800, 60, 30, 120), device(0, 15, 5, 60), device(30_000, 400, 200, 60)] },
  { name: "four phones, heavy jitter", seats: 4, tv: lan, phones: [device(0, 250, 250, 60), device(0, 250, 250, 60), device(0, 250, 250, 60), device(0, 250, 250, 60)] },
];
const SPECS: Timed[] = [
  { kind: "precision", cue: "Ring the bell", actionLabel: "Throw", target: 0.5, width: 0.3, periodMs: 4000 },
  { kind: "precision", cue: "Ring the bell", actionLabel: "Throw", target: 0.7, width: 0.1, periodMs: 2000 },
  { kind: "timing", cue: "Wait for the floe", actionLabel: "Jump", target: 0.5, width: 0.2, periodMs: 3000 },
];

/** Seeded jitter, so every run sees the same delays. */
function jitter(seed: number): (device: Device) => number {
  let x = seed >>> 0 || 1;
  return (device) => { x = (x * 1664525 + 1013904223) >>> 0; return (x / 2 ** 32) * device.jitterMs; };
}

function table(spec: InteractionSpec, seats: number) {
  const chapter = makeChapter();
  const scene: InteractionScene = { type: "interaction", narration: "A bell hangs from a branch.", interaction: spec,
    onSuccess: { goto: "scene_clearing" }, onFailure: { goto: "scene_clearing" } };
  chapter.scenes["interaction_test"] = scene;
  const ctx = (at: number): EngineContext => ({ chapter, rules: makeRules(), items: makeItems(), rng: makeRng("timing"), now: iso(at), householdId: "h_1" });
  let state = createRunState({ runId: "timing", roomCode: "TEST", mode: "party", now: iso(S0 - 10_000) });
  state.party = Array.from({ length: seats }, (_, index) => ({ playerId: `p${index}`, character: resolveCharacter(makeCharacter({ id: `c${index}`, ownerPlayerId: `p${index}` }), makeRules(), makeItems()), connected: true, ready: true, hp: 10, down: false }));
  state.chapterId = chapter.id;
  state = enterScene(state, "interaction_test", ctx(S0 - 10_000)).state;
  return { state, ctx };
}
function prompt(state: RunState): InteractionPrompt {
  if (state.prompt?.kind !== "interaction") throw Error("Expected interaction");
  return state.prompt;
}
function act(state: RunState, ctx: EngineContext, action: InteractionAction, playerId: string, seat: Pick<InteractionPrompt, "openedSeq" | "attempt"> = prompt(state)) {
  return applyIntent(state, { playerId, intent: { type: "INTERACT", openedSeq: seat.openedSeq, attempt: seat.attempt, ...action } }, ctx);
}

/**
 * A screen's view of the sweep. `aligned` is what ships: the start anchored on this device's
 * clock by interactionStartLocal, with the clock gap its earlier states gave it, if any. `raw` is
 * what shipped before #566: the server's `startedAt` read against this device's clock.
 */
function screen(spec: Timed, startedAt: number, d: Device, arrivedServerMs: number, sentServerMs = startedAt, clockGapMs?: number) {
  const anchor = interactionStartLocal(iso(startedAt), iso(sentServerMs), arrivedServerMs + d.skewMs, clockGapMs);
  const frame = 1000 / d.fps;
  /** The frame on screen at server time `t`: the last one drawn at or before it. */
  const drawnAt = (t: number) => Math.floor((t + d.skewMs) / frame) * frame;
  return {
    aligned: (t: number) => t >= arrivedServerMs ? precisionPosition(drawnAt(t) - anchor, spec.periodMs) : null,
    raw: (t: number) => t >= arrivedServerMs ? precisionPosition(drawnAt(t) - startedAt, spec.periodMs) : null,
  };
}

/**
 * The quickest of a screen's earlier deliveries, and the clock gap they give it (as the client
 * store records them). Twelve states, about what a table sends in the minute before a mini-game.
 */
function history(d: Device, delay: (d: Device) => number, before: number) {
  const latencies = Array.from({ length: 12 }, () => d.downMs + delay(d));
  const samples = latencies.map((latency, index) => ({ sentAt: iso(before - 60_000 + index * 5000), receivedAt: before - 60_000 + index * 5000 + latency + d.skewMs }));
  return { quickest: Math.min(...latencies), gap: serverClockGap(samples)! };
}

/** How far apart two screens may draw the marker: their delivery delays and a frame each, as a share of a half sweep. */
const tolerance = (spec: Timed, a: Device, b: Device, delayA: number, delayB: number) =>
  (Math.abs(delayA - delayB) + 1000 / a.fps + 1000 / b.fps) / (spec.periodMs / 2);

describe("timing fairness matrix (#566)", () => {
  for (const spec of SPECS) for (const cell of MATRIX) {
    it(`${spec.kind} ${spec.width} @ ${spec.periodMs} ms: ${cell.name} (${cell.seats} seat${cell.seats > 1 ? "s" : ""})`, () => {
      const delay = jitter(cell.seats * 7919 + spec.periodMs);
      const { state, ctx } = table(spec, cell.seats);
      const actor = prompt(state).actorId;
      const started = act(state, ctx(S0), { action: "start", relaxed: false }, actor);
      expect(started.error).toBeUndefined();
      const startedAt = Date.parse(prompt(started.state).startedAt!);
      const devices = [cell.tv, ...cell.phones];
      const delays = devices.map((d) => d.downMs + delay(d));
      const past = devices.map((d) => history(d, delay, startedAt));
      const cold = devices.map((d, index) => screen(spec, startedAt, d, startedAt + delays[index]!));
      const warm = devices.map((d, index) => screen(spec, startedAt, d, startedAt + delays[index]!, startedAt, past[index]!.gap));
      // How far behind the server each screen draws the sweep. A cold screen (no earlier states)
      // is behind by this delivery. A warm one whose gap could be only a delivery trusts its own
      // clock and is off by its skew; with a larger or negative gap it is behind by its quickest delivery.
      const coldOff = delays;
      const warmOff = delays.map((latency, index) => {
        const { gap, quickest } = past[index]!;
        return Math.min(latency, gap >= 0 && gap <= CLOCK_TRUSTED_MS ? -devices[index]!.skewMs : quickest);
      });

      // Every phone draws the marker where the TV does, within the difference in those delays and a frame each.
      for (const [screens, off] of [[cold, coldOff], [warm, warmOff]] as const) {
        for (let t = startedAt + 500; t < startedAt + 3 * spec.periodMs; t += 37) {
          const onTv = screens[0]!.aligned(t);
          for (let seat = 1; seat < devices.length; seat++) {
            const onPhone = screens[seat]!.aligned(t);
            if (onTv === null || onPhone === null) continue;
            expect(Math.abs(onTv - onPhone)).toBeLessThanOrEqual(tolerance(spec, cell.tv, devices[seat]!, off[0]!, off[seat]!) + 1e-9);
          }
        }
      }
      const phones = warm.slice(1);
      const phoneDelays = delays.slice(1);

      // The acting child presses on the first frame their phone draws inside the inner half of the target.
      const seat = Number(actor.slice(1));
      const mine = phones[seat]!;
      let pressedAt = startedAt + phoneDelays[seat]!;
      while (mine.aligned(pressedAt) === null || Math.abs(mine.aligned(pressedAt)! - spec.target) > spec.width / 4) pressedAt += 1;
      const drawn = mine.aligned(pressedAt)!;

      // However late the stop arrives, even a whole sweep later, the server scores what was drawn.
      for (const late of [0, cell.phones[seat]!.upMs + delay(cell.phones[seat]!), spec.periodMs * 1.5]) {
        const stopped = act(started.state, ctx(pressedAt + late), { action: "stop", position: drawn }, actor);
        expect(stopped.error).toBeUndefined();
        expect(prompt(stopped.state).outcome).toBe("success");
        // A second stop (a double tap, a retried send) changes nothing.
        expect(act(stopped.state, ctx(pressedAt + late + 50), { action: "stop", position: 0 }, actor).error).toBeDefined();
      }
      // Nobody but the acting seat can stop the marker.
      for (const other of started.state.party.filter((member) => member.playerId !== actor)) {
        expect(act(started.state, ctx(pressedAt), { action: "stop", position: drawn }, other.playerId).error).toBeDefined();
      }
    });
  }

  it("shows the pre-#566 raw clock drew a 5 s fast phone half a sweep from the TV", () => {
    const spec = SPECS[0]!;
    const tv = screen(spec, S0, lan, S0 + 15);
    const fast = device(5000, 15, 0, 60);
    const phone = screen(spec, S0, fast, S0 + 15);
    const t = S0 + 1000;
    expect(Math.abs(tv.raw(t)! - phone.raw(t)!)).toBeGreaterThan(0.4);
    expect(Math.abs(tv.aligned(t)! - phone.aligned(t)!)).toBeLessThanOrEqual(tolerance(spec, lan, fast, 15, 15));
  });

  it("picks the sweep up where it is for a phone that rejoins mid-attempt", () => {
    const spec = SPECS[0]!;
    const tv = screen(spec, S0, lan, S0 + 15);
    // The rejoining phone's first state was sent 2.3 s into the attempt (a presence update), on a clock 4 s slow.
    const rejoined = device(-4000, 180, 0, 60);
    const phone = screen(spec, S0, rejoined, S0 + 2300 + 180, S0 + 2300);
    for (let t = S0 + 2600; t < S0 + 6000; t += 50) {
      expect(Math.abs(tv.aligned(t)! - phone.aligned(t)!)).toBeLessThanOrEqual(tolerance(spec, lan, rejoined, 15, 180));
    }
  });

  it("shows why the press, not the release, is scored: a child's tap leaves a narrow, quick target", () => {
    const spec = SPECS[1]!;
    const phone = screen(spec, S0, lan, S0 + 15);
    let pressedAt = S0 + 15;
    while (Math.abs(phone.aligned(pressedAt)! - spec.target) > spec.width / 4) pressedAt += 1;
    expect(precisionSuccess(spec, phone.aligned(pressedAt)!, false)).toBe(true);
    expect(precisionSuccess(spec, phone.aligned(pressedAt + 120)!, false)).toBe(false);
  });

  it("refuses a stop from an attempt the party has since restarted, however late it lands", () => {
    const spec = SPECS[0]!;
    const { state, ctx } = table(spec, 2);
    const first = act(state, ctx(S0), { action: "start", relaxed: false }, "p0").state;
    const old = { openedSeq: prompt(first).openedSeq, attempt: prompt(first).attempt };
    const retried = act(first, ctx(S0 + 900), { action: "retry" }, "p0").state;
    const again = act(retried, ctx(S0 + 1200), { action: "start", relaxed: false }, "p0").state;
    expect(act(again, ctx(S0 + 1300), { action: "stop", position: 0.5 }, "p0", old).error).toBeDefined();
    expect(prompt(again).outcome).toBeUndefined();
  });
});

describe("team lift fairness (#566)", () => {
  const lift: InteractionSpec = { kind: "cooperate", cue: "Lift the log", supportLabel: "Hold", actionLabel: "Lift" };
  /**
   * Every seat presses and holds; the last hold to land starts the lift (`steadySince`). Each
   * phone draws the lift from when that state reaches it (useCooperationClock), so it looks full
   * TEAM_HOLD_MS after its own receipt, and a child lets go then. No renewal or "complete" lands
   * in between: the worst case, a release racing the lift's end.
   */
  for (const seats of [2, 4] as const) for (const [downMs, upMs] of [[20, 20], [300, 150], [600, 600]] as const) {
    it(`a release sent when the lift looks full still lifts it: ${seats} seats, ${downMs} ms down, ${upMs} ms up`, () => {
      const { state, ctx } = table(lift, seats);
      let next = act(state, ctx(S0), { action: "start", relaxed: false }, "p0").state;
      for (let seat = 0; seat < seats; seat++) next = act(next, ctx(S0 + 100 + seat * 40), { action: "support", mode: "hold" }, `p${seat}`).state;
      const steadySince = Date.parse(prompt(next).steadySince!);
      const looksFull = steadySince + downMs + TEAM_HOLD_MS;
      const released = act(next, ctx(looksFull + upMs), { action: "support", mode: "release" }, `p${seats - 1}`);
      expect(released.error).toBeUndefined();
      expect(prompt(released.state).outcome).toBe("success");
    });
  }
  it("a release before the lift is full still breaks it", () => {
    const { state, ctx } = table(lift, 2);
    let next = act(state, ctx(S0), { action: "start", relaxed: false }, "p0").state;
    next = act(next, ctx(S0 + 100), { action: "support", mode: "hold" }, "p0").state;
    next = act(next, ctx(S0 + 140), { action: "support", mode: "hold" }, "p1").state;
    next = act(next, ctx(S0 + 140 + TEAM_HOLD_MS - 300), { action: "support", mode: "release" }, "p1").state;
    expect(prompt(next).outcome).toBeUndefined();
    expect(prompt(next).steadySince).toBeUndefined();
  });
});
