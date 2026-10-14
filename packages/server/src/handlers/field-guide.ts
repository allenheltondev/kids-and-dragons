/**
 * The Field Guide during play — epic #101, issue #106.
 *
 * The engine decides *where the party is*; this file decides what that
 * reveals to the household's book, and is the only place the server does. It
 * runs in the handler, around the engine, because the engine is pure and
 * replayable (it runs in Lambda with no store) and a discovery is a household
 * write. What a moment reveals is shared `discoveries.ts`, so the content
 * validator and the server cannot disagree about it.
 *
 * ---------------------------------------------------------------------------
 * WHEN SOMETHING IS DISCOVERED
 *
 * Read off the step, by comparing the state before and after it — never off
 * the intent or the presentation, which miss paths (a chapter that ends off a
 * roll has no CHAPTER_COMPLETE presentation; see `finishedChapter` in
 * action.ts for the same lesson):
 *
 *   - a chapter start discovers the chapter's biome (`chapterStartDiscoveries`)
 *     and everything its entry scene reveals;
 *   - every scene the step entered discovers what `sceneDiscoveries` says —
 *     an encounter's creatures and the scene's explicit `discovers`. A fight's
 *     start *is* its scene's entry, so the creatures land the moment the
 *     board goes up.
 *
 * "Entered" is the run's `visited` trail (the recap's spine), so a step that
 * passes through several scenes discovers all of them, not just where it
 * stopped.
 *
 * ---------------------------------------------------------------------------
 * WHO FOUND IT (`firstFinder`)
 *
 * The player whose tap caused the transition: the vote that closed a choice,
 * the roll that landed, the END_TURN that let the monsters win, the Begin tap
 * that started the chapter. A Field Guide entry says "found by Ada", and the
 * tap that moved the story is the only per-player fact the server has.
 *
 * When nobody tapped — a server-driven step with no actor, or an actor who has
 * no hero at the table (a phone still on character creation) — the credit
 * goes to the story-turn holder (`RunState.storyTurn`, the seat whose turn it
 * is to lead), then to the first seat, so a find is always somebody's.
 *
 * First finder wins for good: the store never overwrites an entry.
 *
 * ---------------------------------------------------------------------------
 * WHOSE BOOK (`discoveryHousehold`)
 *
 * The run's household — but only once it is settled. A room the TV opened
 * belongs to a placeholder household until the first phone joins (§4.5); a
 * find recorded then would land in the TV's book, not the family's. That
 * cannot happen in practice (nobody can act before a phone has joined), but
 * it is guarded rather than assumed: an unsettled room records nothing and
 * says so in the log, and play goes on.
 */

import type { Chapter, FieldGuideDiscovery, FieldGuideFind, RunState, SceneId } from "@kad/shared";
import { chapterStartDiscoveries, sceneDiscoveries } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import type { HandlerDeps } from "./deps.ts";

export type FieldGuideBook = Record<string, FieldGuideFind>;

/**
 * The scenes `after` entered that `before` was not already standing in.
 *
 * `chapterStarted` means `after` is a fresh chapter: everything on its trail is
 * new, even when the previous chapter's trail happened to look the same.
 * Otherwise the trail only grows within a chapter (engine `enterSceneDraft`),
 * so what was appended is what was entered; a change of chapter that is not a
 * start (back to the lobby) enters nothing.
 */
export function enteredScenes(before: RunState, after: RunState, chapterStarted: boolean): SceneId[] {
  if (after.chapterId === null || after.sceneId === null) return [];
  const trail = after.visited;
  if (chapterStarted) return trail && trail.length > 0 ? [...trail] : [after.sceneId];
  if (before.chapterId !== after.chapterId) return [];
  const previous = before.visited ?? [];
  if (trail && trail.length > previous.length) return trail.slice(previous.length);
  // A run persisted before `visited` existed: fall back to "did the scene move".
  return !trail && after.sceneId !== before.sceneId ? [after.sceneId] : [];
}

/** Every canon id this step reveals, deduplicated, in a stable order. */
export function stepDiscoveries(
  before: RunState,
  after: RunState,
  chapter: Chapter | null,
  chapterStarted: boolean,
  deps: Pick<HandlerDeps, "content">,
): string[] {
  if (!chapter || after.chapterId !== chapter.id) return [];
  const ids: string[] = [];
  if (chapterStarted) ids.push(...chapterStartDiscoveries(chapter, deps.content.world()));
  const bestiary = deps.content.bestiary();
  for (const sceneId of enteredScenes(before, after, chapterStarted)) {
    const scene = chapter.scenes[sceneId];
    if (scene) ids.push(...sceneDiscoveries(scene, bestiary));
  }
  return [...new Set(ids)];
}

/** Who gets the credit — see the header. */
export function firstFinder(state: RunState, actorId: string | null | undefined): string | null {
  const party = state.party;
  if (actorId && party.some((m) => m.playerId === actorId)) return actorId;
  const turn = party[state.storyTurn ?? 0] ?? party[0];
  return turn?.playerId ?? actorId ?? null;
}

/**
 * The household whose book this run writes to, or null when that is not
 * settled (see the header). Logs why it said no; never throws for that.
 */
export async function discoveryHousehold(
  run: Pick<RunRecord, "id" | "householdId">,
  state: Pick<RunState, "roomCode">,
  deps: Pick<HandlerDeps, "repo">,
): Promise<string | null> {
  const room = await deps.repo.getRoom(state.roomCode);
  // An expired room, or its code since reused by another run, says nothing
  // about this one: a room can only be claimable before anybody plays in it,
  // so a run still being played has long since been settled.
  if (!room || room.runId !== run.id) return run.householdId;
  if (room.claimable === true) {
    console.warn(
      `field guide: run ${run.id} is in room ${room.code}, which no phone has claimed yet; not recording discoveries`,
    );
    return null;
  }
  if (room.householdId !== run.householdId) {
    console.warn(
      `field guide: run ${run.id} belongs to ${run.householdId} but room ${room.code} names ${room.householdId}; not recording discoveries`,
    );
    return null;
  }
  return run.householdId;
}

/** The household's whole book, as the run state carries it. */
export async function loadBook(householdId: string, deps: Pick<HandlerDeps, "repo">): Promise<FieldGuideBook> {
  return (await deps.repo.getFieldGuide(householdId)).entries;
}

/** What one step owes the book: the mirror to ship, and the finds to record. */
export interface StepFinds {
  householdId: string;
  /** The run state's new `fieldGuide` — the book with this step's finds in it. */
  book: FieldGuideBook;
  /** Only ids the book did not already have; empty when nothing is new. */
  report: FieldGuideDiscovery[];
}

/**
 * Works out, *before* the commit, what this step discovers — so the finds can
 * ride the step's own patch, and the TV's "new page" lands with the scene that
 * revealed it rather than a beat later.
 *
 * Null when there is nothing to do: no discoveries and no chapter start, or a
 * household that is not settled. A chapter start always re-reads the whole
 * book from the store, which is what heals the mirror when another room of
 * the same household has found things since this one last looked.
 *
 * A failed read is not allowed to cost the table its tap: the step goes ahead
 * on the mirror it already has.
 */
export async function prepareStepFinds(
  input: {
    before: RunState;
    after: RunState;
    chapter: Chapter | null;
    chapterStarted: boolean;
    actorId: string | null;
    run: Pick<RunRecord, "id" | "householdId">;
    now: string;
  },
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<StepFinds | null> {
  const { before, after, chapter, chapterStarted, actorId, run, now } = input;
  const found = stepDiscoveries(before, after, chapter, chapterStarted, deps);
  if (found.length === 0 && !chapterStarted) return null;

  const householdId = await discoveryHousehold(run, after, deps);
  if (!householdId) return null;

  let base: FieldGuideBook = before.fieldGuide ?? {};
  if (chapterStarted || before.fieldGuide === undefined) {
    try {
      base = await loadBook(householdId, deps);
    } catch (err) {
      console.error(`field guide: could not read ${householdId}'s book; keeping the run's copy:`, err);
    }
  }

  const finder = firstFinder(after, actorId);
  const fresh = finder ? found.filter((id) => !(id in base)) : [];
  const book: FieldGuideBook = { ...base };
  const report: FieldGuideDiscovery[] = [];
  for (const canonId of fresh) {
    book[canonId] = { firstFoundBy: finder!, foundAt: now, runId: run.id };
    report.push({ canonId, playerId: finder!, runId: run.id, foundAt: now });
  }
  return { householdId, book, report };
}

/**
 * Writes the step's finds to the household's record, after the commit, and
 * returns what the store says was new — the ids to celebrate.
 *
 * After, not inside, `commit()`: the book is the household's and permanent,
 * and the commit is one run's seq-gated transaction. A step that loses the
 * seq race must not have recorded anything, and one that lands and then fails
 * here has still happened — so this logs and reports nothing new rather than
 * failing a request that succeeded. A later step that reveals the same thing
 * reports it again, and the store's first-finder-wins write makes that
 * harmless.
 */
export async function recordStepFinds(
  finds: StepFinds | null,
  deps: Pick<HandlerDeps, "repo">,
): Promise<string[]> {
  if (!finds || finds.report.length === 0) return [];
  try {
    return await deps.repo.recordDiscoveries(finds.householdId, finds.report);
  } catch (err) {
    console.error(`field guide: recording ${finds.report.length} find(s) for ${finds.householdId} failed:`, err);
    return [];
  }
}
