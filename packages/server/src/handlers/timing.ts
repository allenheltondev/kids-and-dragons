/**
 * Family-session timing (#511): what the server writes down and the operator's
 * controls. The clock policy and the numbers themselves are
 * `packages/shared/src/session-timing.ts`; the rows live in a table of their
 * own (`store/timing-store.ts`).
 *
 * A step that opens, advances, pauses or ends a chapter yields a `TimingNote`.
 * Once the step has landed, the note is written as a mark (run, seq, server
 * time, chapter) to the timing table, keyed so that a retry is the same row.
 * It is not in the game's commit: a failed write is retried and logged, and
 * never fails a turn. Server timestamps only, so a reload, a reconnect, a
 * restart, a duplicate tap or a second phone cannot change what was recorded.
 *
 * **Nothing is recorded unless the entry point says whose play it is.**
 * `HandlerDeps.timing` is absent in the tests, the load tool and the seeded
 * playthroughs, which therefore leave no timing at all, so a synthetic run can
 * never be mistaken for a family. The Lambda sets `family` (unless the stack
 * turns it off); the dev server sets `playtest` unless `KAD_TIMING=family`.
 * The report keeps the two apart.
 *
 * **What is kept** (docs/session-timing.md): the chapter and its content
 * revision, how many were seated, whether it was a revisit or a resume, the
 * scenes and when they opened, pauses, the recoveries and assisted routes
 * taken, the road flags carried, the outcome, and one short note an operator
 * typed. Inside a mini-game: start, result and retry; inside a fight: the
 * board going up (with how many heroes and foes), each new round, and how it
 * ended. No names, chat, audio, household or player ids. Marks expire.
 */

import { createHash } from "node:crypto";
import {
  carriedRouteFlags,
  cleanNote,
  isPracticeCampaign,
  timingReportFromMarks,
  type Chapter,
  type FightEnd,
  type GameKind,
  type RunState,
  type Scene,
  type StepResult,
  type TimingNote,
  type TimingReport,
} from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";

/** Attempts at a mark's write before it is given up on and logged. */
const RECORD_ATTEMPTS = 3;

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

/** The mini-game a scene plays, when it is one. */
function gameOf(chapter: Chapter, sceneId: string | null | undefined): GameKind | undefined {
  const scene = sceneId ? chapter.scenes[sceneId] : undefined;
  return scene?.type === "interaction" ? scene.interaction.kind : undefined;
}

/** The fight `before` was in, when this commit ended it. */
function fightEnded(before: RunState, after: RunState): FightEnd | undefined {
  const fight = before.encounter;
  const ended = after.lastEncounter;
  if (!fight || after.encounter || !ended || ended.sceneId !== before.sceneId) return undefined;
  return { outcome: ended.outcome, round: fight.round };
}

/** A mini-game or a fight that moved inside its scene, or undefined. */
function inSceneNote(before: RunState, after: RunState, chapter: Chapter): TimingNote | undefined {
  const scene = after.sceneId;
  if (!scene || scene !== before.sceneId) return undefined;
  const was = before.prompt?.kind === "interaction" ? before.prompt : null;
  const now = after.prompt?.kind === "interaction" ? after.prompt : null;
  if (now && now.sceneId === scene && (!was || was.openedSeq === now.openedSeq)) {
    if (was && now.attempt > was.attempt) return { kind: "game", scene, phase: "retry", attempt: now.attempt };
    if (now.phase === "active" && was?.phase !== "active") {
      return { kind: "game", scene, phase: "play", attempt: now.attempt, ...(now.relaxed ? { relaxed: true } : {}) };
    }
    if (now.phase === "result" && was?.phase !== "result") {
      return { kind: "game", scene, phase: "result", attempt: now.attempt, ...(now.outcome ? { outcome: now.outcome } : {}) };
    }
  }
  const fight = after.encounter;
  if (fight && !before.encounter) {
    const spec = chapter.scenes[scene];
    const enemies = spec?.type === "encounter" ? spec.enemies : [];
    return {
      kind: "fight",
      scene,
      phase: "begin",
      round: fight.round,
      heroes: after.party.length,
      foes: enemies.reduce((t, e) => t + e.count, 0),
      foeKinds: [...new Set(enemies.map((e) => e.id))],
    };
  }
  if (fight && before.encounter && fight.round > before.encounter.round) {
    return { kind: "fight", scene, phase: "round", round: fight.round };
  }
  return undefined;
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
    const game = gameOf(chapter, after.sceneId);
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
      ...(game ? { game } : {}),
    };
  }
  if (after.timingOff) return undefined;
  const fight = fightEnded(before, after);
  if (input.finished) {
    const campaign = after.campaignId ? deps.content.campaign(after.campaignId) : null;
    return {
      kind: "end",
      outcome: after.chapterOutcome === "setback" ? "setback" : "success",
      routes: campaign ? carriedRouteFlags(campaign, chapter, after.flags) : [],
      ...(fight ? { fight } : {}),
    };
  }
  if (after.sceneId && after.sceneType && after.sceneId !== before.sceneId && after.chapterId === before.chapterId) {
    const result = stepResult(chapter.scenes[before.sceneId ?? ""], after.sceneId);
    const game = gameOf(chapter, after.sceneId);
    return {
      kind: "step",
      scene: after.sceneId,
      type: after.sceneType,
      ...(result ? { result } : {}),
      ...(game ? { game } : {}),
      ...(fight ? { fight } : {}),
    };
  }
  if (after.chapterId === before.chapterId) return inSceneNote(before, after, chapter);
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
// Writing and reading marks

/** Where a note came from: the step that produced it. */
export interface TimingStep {
  runId: string;
  /** The chapter the run was in. A start names its own. */
  chapterId: string | null;
  seq: number;
  /** The event's server time. */
  at: string;
}

/**
 * Writes one note as a mark, after the step it describes has landed. Retried,
 * then logged: telemetry never fails a turn, and a lost mark is a gap the
 * report tolerates (docs/session-timing.md, "Not covered").
 */
export async function recordTiming(
  deps: Pick<HandlerDeps, "timing">,
  step: TimingStep,
  note: TimingNote | undefined,
): Promise<void> {
  const timing = deps.timing;
  const chapterId = note?.kind === "start" ? note.chapterId : step.chapterId;
  if (!timing || !note || !chapterId) return;
  const mark = { runId: step.runId, chapterId, seq: step.seq, at: step.at, timing: note };
  for (let attempt = 1; ; attempt++) {
    try {
      await timing.store.put(mark);
      return;
    } catch (err) {
      if (attempt >= RECORD_ATTEMPTS) {
        console.error(`timing: lost a ${note.kind} mark for ${step.runId} #${String(step.seq)}:`, err);
        return;
      }
    }
  }
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
  deps: Pick<HandlerDeps, "timing" | "content">,
): Promise<TimingNote | undefined> {
  const timing = deps.timing;
  const chapter = resumed.chapterId ? deps.content.chapter(resumed.chapterId) : null;
  if (!timing || !chapter || !resumed.sceneId || !resumed.sceneType) return undefined;
  const marks = await timing.store.runMarks(chapter.id, stoppedRunId);
  const origin = [...marks].reverse().find((m) => m.timing.kind === "start");
  if (!origin || origin.timing.kind !== "start") return undefined;
  // The scene picked up at, not the one the stopped evening began on.
  const { game: _origin, fighting: _was, ...context } = origin.timing;
  const game = gameOf(chapter, resumed.sceneId);
  return {
    ...context,
    source: timing.source,
    partySize: resumed.party.length,
    revision: chapterRevision(chapter),
    resumedFrom: `${stoppedRunId}:${origin.seq}`,
    scene: resumed.sceneId,
    type: resumed.sceneType,
    ...(game ? { game } : {}),
    ...(resumed.encounter ? { fighting: true as const } : {}),
  };
}

/** Everything this process has recorded, as a report: the dev server's view, since it has no AWS table to export. */
export async function localTimingReport(deps: Pick<HandlerDeps, "timing" | "now">): Promise<TimingReport> {
  const marks = deps.timing ? await deps.timing.store.allMarks() : [];
  return timingReportFromMarks(marks, deps.now(), deps.timing?.source ?? null);
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
