/**
 * Family-session timing (#511) through the handlers and the shipped Gemfall:
 * a real chapter opened, played, paused, stopped and picked up again, read
 * back as a report. The arithmetic is shared/session-timing.test.ts; this is
 * the part that has to survive concurrent phones, retries and restarts.
 */

import path from "node:path";
import { timingCsv, applyIntent, classPlaceWaitingOn, createRunState, keepClassIntent, makeRng, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it, vi } from "vitest";
import { loadContent } from "../content/loader.ts";
import { MemoryTimingStore } from "../store/timing-store.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { closeRoom } from "./host.ts";
import { createRoom, joinRoom } from "./room.ts";
import { resumeGame, stopForToday } from "./save.ts";
import {
  chapterRevision,
  localTimingReport,
  parseTimingControl,
  setTiming,
  stepResult,
  timingNoteFor,
  type TimingControl,
} from "./timing.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";
const MIN = 60_000;

async function household(timing: "family" | "playtest" | null = "family") {
  const harness = makeHarness({ engine: realEngine, playtest: true, content, ...(timing ? { timing } : {}) });
  harness.deps.rng = (key) => makeRng(`timing:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, 2);
  await harness.repo.putAccountPointer("sub-test", seeded.householdId);
  return { harness, ...seeded };
}
type Household = Awaited<ReturnType<typeof household>>;

async function sit(h: Household, code: string, runId: string, seat: number) {
  const joined = await joinRoom({ code, principal: h.players[seat]!.principal }, h.harness.deps);
  if (!joined.ok) throw new Error(`join: ${JSON.stringify(joined)}`);
  const playerId = joined.value.playerId;
  const state = async (): Promise<RunState> => (await h.harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent, seq?: number) =>
    applyAction({ runId, playerId, seq: seq ?? (await state()).seq, intent }, h.harness.deps);
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return response;
  };
  return { code, runId, playerId, state, send, must, resume: () => resumeGame({ runId, playerId, householdId: h.householdId }, h.harness.deps) };
}
type Seat = Awaited<ReturnType<typeof sit>>;

const SPECS = [
  { name: "Pip", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } },
  { name: "Bo", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 0, clever: 1, heart: 1 } },
] as const;

/** A Gemfall chapter 1, begun in a fresh room. */
async function evening(h: Household) {
  const created = await createRoom(
    { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: h.players[0]!.principal.deviceId },
    h.harness.deps,
  );
  if (!created.ok) throw new Error(JSON.stringify(created));
  const { code, runId } = created.value;
  const one = await sit(h, code, runId, 0);
  const two = await sit(h, code, runId, 1);
  for (const [seat, spec] of [[one, SPECS[0]], [two, SPECS[1]]] as const) {
    await seat.must({ type: "CREATE_CHARACTER", ...spec });
    await seat.must({ type: "READY", ready: true });
  }
  await one.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  return { code, runId, one, two };
}

/** The table makes `steps` plays, a minute apart. */
async function play(h: Household, seats: Seat[], steps: number, gap = MIN) {
  for (let i = 0; i < steps; i++) {
    h.harness.clock.advance(gap);
    const state = await seats[0]!.state();
    const prompt = state.prompt;
    const byPlayer = (id: string | undefined) => seats.find((s) => s.playerId === id) ?? seats[0]!;
    let seat = byPlayer(state.party[(state.storyTurn ?? 0) % state.party.length]?.playerId);
    let intent: ClientIntent = { type: "ADVANCE" };
    const deciding = classPlaceWaitingOn(state)[0];
    if (deciding && state.classPlace) {
      seat = byPlayer(deciding.playerId);
      intent = keepClassIntent(state.classPlace, deciding);
    } else if (prompt?.kind === "choice") {
      if (prompt.forPlayerIds[0]) seat = byPlayer(prompt.forPlayerIds[0]);
      intent = { type: "CHOOSE", choiceId: prompt.options[0]!.id };
    } else if (prompt?.kind === "roll") {
      seat = byPlayer(state.party.find((m) => m.character.id === prompt.characterId)?.playerId);
      intent = { type: "ROLL" };
    }
    if (!(await seat.send(intent)).ok) break;
  }
}

const host = (h: Household) => h.players[0]!.principal;
const control = (h: Household, code: string, c: TimingControl, who = 0) =>
  setTiming({ code, principal: h.players[who]!.principal, control: c }, h.harness.deps);
const report = (h: Household) => localTimingReport(h.harness.deps);

describe("session timing (#511)", () => {
  it("records nothing unless the entry point says whose play it is", async () => {
    const h = await household(null);
    const e = await evening(h);
    await play(h, [e.one, e.two], 3);
    expect((await report(h)).sittings).toEqual([]);
    expect(await control(h, e.code, { action: "pause" })).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("opens a sitting when the first playable scene is presented, and times the steps", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 4);
    const { sittings, aggregates, policy } = await report(h);
    expect(sittings).toHaveLength(1);
    const s = sittings[0]!;
    expect(s).toMatchObject({ source: "family", chapterId: (await e.one.state()).chapterId, kind: "fresh", partySize: 2, status: "in_progress" });
    expect(s.revision).toBe(chapterRevision(content.chapter(s.chapterId)!));
    expect(s.steps).toBeGreaterThan(0);
    expect(s.activeMs).toBeGreaterThan(0);
    expect(s.wallMs).toBe(s.activeMs + s.idleMs + s.pausedMs + s.unrecordedMs);
    // Observed numbers carry their own sample label and the budget they are read against.
    expect(aggregates[0]).toMatchObject({ source: "family", attempts: 1, sample: "none" });
    expect(policy.budgetMinutes).toBe(30);
  });

  it("labels a developer's runs as playtests, never as family observations", async () => {
    const h = await household("playtest");
    const e = await evening(h);
    await play(h, [e.one, e.two], 2);
    expect((await report(h)).sittings.map((s) => s.source)).toEqual(["playtest"]);
  });

  it("pauses and resumes idempotently, leaving the paused time out of active", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 2);
    expect(await control(h, e.code, { action: "pause" })).toMatchObject({ ok: true });
    const seqAfterPause = (await e.one.state()).seq;
    // A second phone's duplicate tap changes nothing and burns no seq.
    expect(await control(h, e.code, { action: "pause" })).toMatchObject({ ok: true, value: { seq: seqAfterPause } });
    expect((await e.one.state()).timingPaused).toBe(true);
    h.harness.clock.advance(45 * MIN);
    expect(await control(h, e.code, { action: "resume" })).toMatchObject({ ok: true });
    const seqAfterResume = (await e.one.state()).seq;
    expect(await control(h, e.code, { action: "resume" })).toMatchObject({ ok: true, value: { seq: seqAfterResume } });
    expect((await e.one.state()).timingPaused).toBeUndefined();
    await play(h, [e.one, e.two], 2);
    const s = (await report(h)).sittings[0]!;
    expect(s.pauses).toBe(1);
    expect(s.pausedMs).toBe(45 * MIN);
    expect(s.activeMs).toBeLessThan(10 * MIN);
  });

  it("counts a step taken while paused but gives it no active time", async () => {
    const h = await household();
    const e = await evening(h);
    await control(h, e.code, { action: "pause" });
    await play(h, [e.one, e.two], 1, 2 * MIN);
    await control(h, e.code, { action: "resume" });
    const s = (await report(h)).sittings[0]!;
    expect(s.stepsWhilePaused).toBe(1);
    expect(s.activeMs).toBeLessThan(2 * MIN);
  });

  it("does not double count a duplicated or stale input", async () => {
    const h = await household();
    const e = await evening(h);
    const before = (await e.one.state()).seq;
    await play(h, [e.one, e.two], 1);
    const once = (await report(h)).sittings[0]!;
    // The same tap again, at the seq it was first built on: refused, nothing written.
    const state = await e.one.state();
    const stale = await e.one.send({ type: "ADVANCE" }, before);
    expect(stale.ok).toBe(false);
    const again = (await report(h)).sittings[0]!;
    expect(again.steps).toBe(once.steps);
    expect((await e.one.state()).seq).toBe(state.seq);
    // And a second reader (another phone, a restart) sees the same figures.
    expect(await report(h)).toEqual(await report(h));
  });

  it("is the host's alone, and only means something mid-chapter", async () => {
    const h = await household();
    const lobby = await createRoom(
      { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: host(h).deviceId },
      h.harness.deps,
    );
    if (!lobby.ok) throw new Error("room");
    // In the lobby there is no chapter to pause: a quiet no-op, not an error.
    const idle = await control(h, lobby.value.code, { action: "pause" });
    expect(idle).toMatchObject({ ok: true });
    expect((await h.harness.repo.getState(lobby.value.runId))?.timingPaused).toBeUndefined();

    const e = await evening(h);
    expect(await control(h, e.code, { action: "pause" }, 1)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await e.one.state()).timingPaused).toBeUndefined();
  });

  it("keeps one short note, trimmed, and refuses an empty one", async () => {
    const h = await household();
    const e = await evening(h);
    expect(await control(h, e.code, { action: "note", text: "   " })).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    await control(h, e.code, { action: "note", text: "needed help\n understanding the clue" });
    await control(h, e.code, { action: "note", text: "wanted another turn" });
    expect((await report(h)).sittings[0]!.note).toBe("wanted another turn");
    expect(timingCsv((await report(h)).sittings)).toContain("wanted another turn");
  });

  it("leaves a stretch unrecorded when the host turns timing off, and records nothing for it", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 1);
    await control(h, e.code, { action: "off" });
    await play(h, [e.one, e.two], 3);
    await control(h, e.code, { action: "on" });
    const s = (await report(h)).sittings[0]!;
    expect(s.unrecordedMs).toBe(3 * MIN);
    expect(s.steps).toBe(1);
  });

  it("closes a sitting as closed, or saved, and reads a resumed game as one attempt", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 3);
    expect(await stopForToday({ code: e.code, principal: host(h) }, h.harness.deps)).toMatchObject({ ok: true });
    h.harness.clock.advance(24 * 60 * MIN);

    const created = await createRoom(
      { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: host(h).deviceId },
      h.harness.deps,
    );
    if (!created.ok) throw new Error("room");
    const one = await sit(h, created.value.code, created.value.runId, 0);
    await sit(h, created.value.code, created.value.runId, 1);
    expect(await one.resume()).toMatchObject({ ok: true });
    await play(h, [one], 2);
    expect(await closeRoom({ code: created.value.code, principal: host(h) }, h.harness.deps)).toMatchObject({ ok: true });

    const { sittings, aggregates } = await report(h);
    const byStatus = Object.fromEntries(sittings.map((s) => [s.status, s]));
    expect(byStatus.saved).toBeDefined();
    expect(byStatus.closed).toMatchObject({ kind: "resumed", resumedFrom: byStatus.saved!.id });
    expect(aggregates[0]).toMatchObject({ attempts: 1, kinds: { fresh: 0, revisit: 0, resumed: 1 } });
  });

  it("writes a mark idempotently, so a retried write or a restart reads the same", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 3);
    const before = await report(h);
    for (const mark of await h.harness.timingStore.allMarks()) await h.harness.timingStore.put(mark);
    expect(await report(h)).toEqual(before);
  });

  it("retries a failed write, and never fails a turn when it cannot be written", async () => {
    const h = await household();
    const e = await evening(h);
    const put = vi.spyOn(h.harness.timingStore, "put");
    put.mockRejectedValueOnce(new Error("throttled"));
    await play(h, [e.one, e.two], 1);
    // The second attempt landed: the step is there.
    expect((await report(h)).sittings[0]?.steps).toBe(1);

    const lost = vi.spyOn(console, "error").mockImplementation(() => undefined);
    put.mockRejectedValue(new Error("table gone"));
    const seq = (await e.one.state()).seq;
    await play(h, [e.one, e.two], 6);
    // The turn landed even though its mark could not be written, and the loss was logged.
    expect((await e.one.state()).seq).toBeGreaterThan(seq);
    expect(lost).toHaveBeenCalled();
    lost.mockRestore();
  });

  it("keeps only the chapter, run, seq and note: no household, player or name", async () => {
    const h = await household();
    const e = await evening(h);
    await play(h, [e.one, e.two], 2);
    await control(h, e.code, { action: "note", text: "wanted another turn" });
    const text = JSON.stringify(await h.harness.timingStore.allMarks());
    for (const secret of [h.householdId, "p_1", "p_2", "Pip", "Bo", "Player 1"]) expect(text).not.toContain(secret);
  });
});

describe("timingNoteFor", () => {
  const chapter = content.chapter("gemfall-01")!;
  const base = { phase: "scene", sceneId: "a", sceneType: "story", chapterId: "gemfall-01", campaignId: GEMFALL, flags: {}, party: [{}, {}, {}] } as unknown as RunState;
  const deps = { timing: { source: "family" as const, store: new MemoryTimingStore() }, content };

  it("notes a scene change, an ending, and nothing for a tap that moved no scene", () => {
    const step = timingNoteFor({ before: base, after: { ...base, sceneId: "b", sceneType: "check" } as RunState, chapter, started: false, finished: false, revisit: false }, deps);
    expect(step).toEqual({ kind: "step", scene: "b", type: "check" });
    const none = timingNoteFor({ before: base, after: { ...base } as RunState, chapter, started: false, finished: false, revisit: false }, deps);
    expect(none).toBeUndefined();
    const end = timingNoteFor(
      { before: base, after: { ...base, sceneId: "z", phase: "chapter_complete", chapterOutcome: "setback" } as RunState, chapter, started: false, finished: true, revisit: false },
      deps,
    );
    expect(end).toMatchObject({ kind: "end", outcome: "setback" });
  });

  it("reports a revisit and the party size at the start, and skips the practice", () => {
    const after = { ...base, chapterInfo: { index: 1, title: "x" } } as RunState;
    const start = timingNoteFor({ before: base, after, chapter, started: true, finished: false, revisit: true }, deps);
    expect(start).toMatchObject({ kind: "start", partySize: 3, revisit: true, scene: "a" });
    expect(timingNoteFor({ before: base, after: { ...after, campaignId: "first-steps" } as RunState, chapter, started: true, finished: false, revisit: false }, deps)).toBeUndefined();
  });

  it("reads recovery and assisted routes off the scene that was left", () => {
    const scenes = {
      c: { type: "check", onSuccess: { goto: "ok" }, onFailure: { goto: "bad" } },
      i: { type: "interaction", onSuccess: { goto: "ok" }, onFailure: { goto: "bad" }, onAssisted: { goto: "help" } },
      e: { type: "encounter", onVictory: { goto: "ok" }, onDefeat: { goto: "bad" } },
    } as unknown as Record<string, Parameters<typeof stepResult>[0]>;
    expect(stepResult(scenes.c, "bad")).toBe("recovery");
    expect(stepResult(scenes.c, "ok")).toBe("success");
    expect(stepResult(scenes.i, "help")).toBe("assisted");
    expect(stepResult(scenes.e, "bad")).toBe("recovery");
    expect(stepResult(undefined, "x")).toBeUndefined();
  });

  it("gives a chapter a new revision when its content changes", () => {
    expect(chapterRevision(chapter)).toBe(chapterRevision(chapter));
    expect(chapterRevision({ ...chapter, title: `${chapter.title}!` })).not.toBe(chapterRevision(chapter));
  });
});

describe("parseTimingControl", () => {
  it("accepts the five actions and nothing else", () => {
    expect(parseTimingControl({ action: "pause" })).toEqual({ action: "pause" });
    expect(parseTimingControl({ action: "note", text: "hi" })).toEqual({ action: "note", text: "hi" });
    expect(parseTimingControl({ action: "note" })).toBeNull();
    expect(parseTimingControl({ action: "drop" })).toBeNull();
    expect(parseTimingControl({})).toBeNull();
  });
});
