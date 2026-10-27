/**
 * Family-session timing (#511): what the server writes down, the operator's
 * controls, and the report. The clock policy and the numbers themselves are
 * `packages/shared/src/session-timing.ts`; this is the part that touches the
 * store.
 *
 * Timing is derived from the run's event log, which already carries a
 * server-stamped `at` on every committed step. A step that opens, advances or
 * ends a chapter also carries a small `TimingNote` (`EventRecord.timing`), so
 * the note lands in the same conditional write as the state it describes: a
 * lost race, a retried request or a second phone cannot leave a note without
 * its step, or a step twice.
 *
 * **Nothing is recorded unless the entry point says whose play it is.**
 * `HandlerDeps.timing` is absent in the tests, the load tool and the seeded
 * playthroughs, which therefore leave no timing at all, so a synthetic run can
 * never be mistaken for a family. The Lambda sets `family`; the dev server
 * sets `playtest` unless `KAD_TIMING=family`. The report keeps the two apart.
 *
 * **What is kept** (see the docs/session-timing.md data note): the chapter and
 * its content revision, how many were seated, whether it was a revisit or a
 * resume, the scenes and when they opened, pauses, the recoveries and assisted
 * routes taken, the road flags carried, the outcome, and one short note the
 * operator typed. No names, chat or audio. It lives and dies with the run's
 * event log, so deleting a household deletes it.
 */

import { createHash } from "node:crypto";
import {
  aggregateTimings,
  carriedRouteFlags,
  cleanNote,
  isPracticeCampaign,
  sittingsFromEvents,
  timingCsv,
  TIMING_POLICY,
  type Chapter,
  type RunState,
  type Scene,
  type StepResult,
  type TimingReport,
  type TimingNote,
} from "@kad/shared";
import type { EventRecord } from "../store/repository.ts";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";

/** How many of a household's most recent runs a report reads. */
const REPORT_RUNS = 40;
/** Events read per run: a chapter is a few hundred at most. */
const REPORT_EVENTS = 2000;

const revisions = new WeakMap<Chapter, string>();

/** A short hash of the chapter's content: any edit is a new revision, so versions never mix. */
export function chapterRevision(chapter: Chapter): string {
  const known = revisions.get(chapter);
  if (known) return known;
  const hash = createHash("sha1").update(stableJson(chapter)).digest("hex").slice(0, 10);
  revisions.set(chapter, hash);
  return hash;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** What kind of step moved the story to `to`, read off the scene it left. */
export function stepResult(from: Scene | undefined, to: string): StepResult | undefined {
  if (!from) return undefined;
  switch (from.type) {
    case "check":
      if (from.onSuccess.goto === to) return "success";
      return from.onFailure.goto === to ? "recovery" : undefined;
    case "interaction":
      if (from.onSuccess.goto === to) return "success";
      if (from.onAssisted?.goto === to) return "assisted";
      return from.onFailure.goto === to ? "recovery" : undefined;
    case "encounter":
      if (from.onVictory.goto === to) return "success";
      return [from.onDefeat, from.onEscape, from.onTimeout].some((b) => b?.goto === to) ? "recovery" : undefined;
    default:
      return undefined;
  }
}

export interface StepTimingInput {
  before: RunState;
  after: RunState;
  chapter: Chapter | undefined;
  /** The intent started a chapter (a fresh start, not a join mid-chapter). */
  started: boolean;
  /** The step moved the run into `chapter_complete`. */
  finished: boolean;
  /** A chapter the household had played before. */
  revisit: boolean;
}

/**
 * The note a committed action owes, or undefined when it is not a timing
 * moment (a vote tick, a ready toggle, a tap that changed nothing the clock
 * cares about) or when nobody is keeping time.
 */
export function timingNoteFor(input: StepTimingInput, deps: Pick<HandlerDeps, "timing" | "content">): TimingNote | undefined {
  const source = deps.timing?.source;
  const { before, after, chapter } = input;
  if (!source || !chapter || isPracticeCampaign(after.campaignId)) return undefined;
  if (input.started) {
    if (!after.sceneId || !after.sceneType) return undefined;
    return {
      kind: "start",
      source,
      chapterId: chapter.id,
      campaignId: after.campaignId,
      revision: chapterRevision(chapter),
      partySize: after.party.length,
      // A plate, or a "Last time" recap on any chapter past the first, is shown before
      // the first scene; the server cannot see it dismissed, so that time is in scene one.
      prefaced: Boolean(chapter.plate) || (after.chapterInfo?.index ?? 1) > 1,
      revisit: input.revisit,
      scene: after.sceneId,
      type: after.sceneType,
    };
  }
  if (after.timingOff) return undefined;
  if (input.finished) {
    const campaign = after.campaignId ? deps.content.campaign(after.campaignId) : null;
    return {
      kind: "end",
      outcome: after.chapterOutcome === "setback" ? "setback" : "success",
      routes: campaign ? carriedRouteFlags(campaign, chapter, after.flags) : [],
    };
  }
  if (after.sceneId && after.sceneType && after.sceneId !== before.sceneId && after.chapterId === before.chapterId) {
    const result = stepResult(chapter.scenes[before.sceneId ?? ""], after.sceneId);
    return { kind: "step", scene: after.sceneId, type: after.sceneType, ...(result ? { result } : {}) };
  }
  return undefined;
}

/** True while a chapter is being played, which is when a pause or a note means anything. */
function inChapter(state: RunState): boolean {
  return state.phase === "scene" || state.phase === "check" || state.phase === "encounter";
}

export type TimingControl =
  | { action: "pause" | "resume" | "on" | "off" }
  | { action: "note"; text: string };

export interface SetTimingInput {
  code: string;
  principal: HostPrincipal;
  control: TimingControl;
}

/**
 * The operator's controls: pause and resume the clock for a meal, bedtime or a
 * dead wifi; leave timing off (and on again); add one short note to the
 * chapter. Each is one committed change, so it is idempotent (pausing a
 * paused clock writes nothing), ordered by seq against every phone's input,
 * and seen by every screen in the same patch. Only the host may, as with quiet
 * mode and locking.
 */
export async function setTiming(input: SetTimingInput, deps: HandlerDeps): Promise<HandlerResult<{ seq: number }>> {
  if (!deps.timing) return fail("ILLEGAL", "this server is not keeping session timing");
  const control = input.control;
  const text = control.action === "note" ? cleanNote(control.text) : null;
  if (control.action === "note" && text === null) return fail("ILLEGAL", "a note needs a few words");
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;

  let note: TimingNote | undefined;
  const result = await commitRoomChange(
    hosted.value,
    input.principal.playerId,
    (state) => {
      note = undefined;
      if (!inChapter(state)) return null;
      switch (control.action) {
        case "pause":
          if (state.timingPaused) return null;
          note = state.timingOff ? undefined : { kind: "pause" };
          return { ...state, timingPaused: true };
        case "resume": {
          if (!state.timingPaused) return null;
          note = state.timingOff ? undefined : { kind: "resume" };
          const { timingPaused: _paused, ...rest } = state;
          return rest;
        }
        case "off":
          if (state.timingOff) return null;
          note = { kind: "off" };
          return { ...state, timingOff: true };
        case "on": {
          if (!state.timingOff) return null;
          note = { kind: "on" };
          const { timingOff: _off, ...rest } = state;
          return rest;
        }
        case "note":
          if (state.timingOff || !text) return null;
          note = { kind: "note", text };
          return { ...state };
      }
    },
    deps,
    { timing: () => note },
  );
  return result.ok ? ok({ seq: result.value.seq }) : result;
}

// ---------------------------------------------------------------------------
// The report

/** All of one household's sittings, from the event logs of its most recent runs. */
export async function householdTimingReport(
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "now" | "timing">,
): Promise<HandlerResult<TimingReport>> {
  const runs = (await deps.repo.listRuns(householdId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nowMs = deps.now();
  const read = runs.slice(0, REPORT_RUNS);
  const logs = await Promise.all(read.map(async (run) => ({ run, events: await deps.repo.listEvents(run.id, 0, REPORT_EVENTS) })));
  const sittings = logs.flatMap(({ run, events }) => sittingsFromEvents(run.id, events as EventRecord[], nowMs));
  sittings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return ok({
    enabled: deps.timing !== undefined,
    source: deps.timing?.source ?? null,
    policy: TIMING_POLICY,
    generatedAt: new Date(nowMs).toISOString(),
    sittings,
    aggregates: aggregateTimings(sittings),
    truncated: runs.length > read.length,
  });
}

export function timingReportCsv(report: TimingReport): string {
  return timingCsv(report.sittings);
}

/**
 * The start note of a stopped game taken up in a new room (#259): the same
 * chapter, picked up from the sitting that was stopped, so a report reads the
 * two as one attempt. None when nobody keeps time, or the stopped run never
 * kept any (it was played before timing, or with timing off).
 */
export async function resumedTimingNote(
  stoppedRunId: string,
  resumed: RunState,
  deps: Pick<HandlerDeps, "repo" | "timing" | "content">,
): Promise<TimingNote | undefined> {
  const source = deps.timing?.source;
  const chapter = resumed.chapterId ? deps.content.chapter(resumed.chapterId) : null;
  if (!source || !chapter || !resumed.sceneId || !resumed.sceneType) return undefined;
  const events = await deps.repo.listEvents(stoppedRunId, 0, REPORT_EVENTS);
  const origin = [...events].reverse().find((e) => e.timing?.kind === "start");
  if (!origin || origin.timing?.kind !== "start") return undefined;
  return {
    ...origin.timing,
    source,
    partySize: resumed.party.length,
    revision: chapterRevision(chapter),
    resumedFrom: `${stoppedRunId}:${origin.seq}`,
    scene: resumed.sceneId,
    type: resumed.sceneType,
  };
}

export const TIMING_BODY = 'expected { action: "pause" | "resume" | "on" | "off" } or { action: "note", text }';

/** A request body as a control, or null when it is not one. */
export function parseTimingControl(body: Record<string, unknown>): TimingControl | null {
  switch (body.action) {
    case "pause":
    case "resume":
    case "on":
    case "off":
      return { action: body.action };
    case "note":
      return typeof body.text === "string" ? { action: "note", text: body.text } : null;
    default:
      return null;
  }
}
