/**
 * Changing the camp at the table (docs/camp.md §4.5, §6.1, §12.1, §12.5;
 * #620): `CAMP_PLACE`, `CAMP_UNDO` and `KIT_EDIT`, and the downtime moment
 * they are counted in.
 *
 * Resolved here rather than in the engine because each writes a store row
 * the engine never sees (the crew's camp, a hero's own kit), the way
 * CAMP_VOTE spends Dash Cash (camp-shop.ts). Prepared before the run's
 * commit and written by it (#645): each `prepare*` reads, decides and
 * returns the write it owes (`CampEditWrites`) without making it, and
 * `applyAction` hands that to `repo.commit`, so the camp or kit and the run
 * state showing it land in one transaction or not at all. An intent that
 * loses its seq race, or finds the camp or kit moved on since it read them,
 * changes nothing: no piece moves, and no change is counted.
 *
 * **The downtime moment** (`RunState.campMoment`, shared camp-edit.ts) is the
 * server's: a lobby visit, a rest scene, a chapter's end, each a moment of its
 * own with a fresh id the moment the table enters it (`syncCampDowntime`,
 * after every step). Shared changes are counted in it per seated *player*,
 * never per device, and it lives on the run, so a second phone or a reconnect
 * finds the same count. A change naming a moment the table has left is stale.
 *
 * **Shared hotspots**: any seated player, the full camp only; checked on the
 * camp as read by `planCamp` (owned, fits the hotspot, the limit), and
 * written by the run's commit conditionally on the revision read, so two
 * rooms reaching one crew never lose a write and the later pick wins (a
 * commit that finds the camp moved on is tried again from a fresh read,
 * `applyAction`). Undo gives back only the
 * player's own latest change, and only while the hotspot still shows it.
 *
 * **A hero's kit**: only her own player, any downtime, no limit; only from the
 * kit catalog and her own unlocks (§12.1); written to her row conditionally on
 * the kit revision her phone showed, so an edit from the book in between
 * refuses the stale one rather than overwriting it.
 */

import {
  campIntentProblem,
  campMomentKind,
  campView,
  emptyKit,
  followCampMoment,
  freshPieces,
  kitEditProblem,
  kitView,
  placeProblem,
  placeRefusalText,
  readKit,
  withKitEdit,
  withPlaced,
} from "@kad/shared";
import type {
  ActionResponse,
  CampCatalog,
  CampChange,
  CampRecord,
  CampView,
  ClientIntent,
  HeroKitView,
  HotspotRule,
  PieceRule,
  PlaceRefusal,
  RunState,
} from "@kad/shared";
import type { CampWrite, CharacterWrite, RunRecord } from "../store/repository.ts";
import { planCamp, planKit, readCampView, type CampDeps } from "./camp.ts";
import { discoveryHousehold } from "./field-guide.ts";

type EditError = NonNullable<ActionResponse["error"]>;

/**
 * The store writes a prepared camp intent owes, for the run's commit to carry
 * (`CommitInput.camp`, `CommitInput.characters`): never made by the `prepare*`
 * function itself (#645).
 */
export interface CampEditWrites {
  /** The crew's camp, conditional on the revision read. */
  camp?: CampWrite;
  /** A hero's row with her kit changed, conditional on her version and claim as read. */
  kit?: CharacterWrite;
}

export type CampEditResult = { ok: true; state: RunState; writes: CampEditWrites } | { ok: false; error: EditError };

const STALE: EditError = { code: "STALE_DECISION", message: "The camp moved on. Look again." };
const illegal = (message: string): { ok: false; error: EditError } => ({ ok: false, error: { code: "ILLEGAL", message } });

/** The catalog's hotspots and crew pieces, as the shared rules read them. */
export function campRules(catalog: Pick<CampCatalog, "hotspots" | "crewPieces">): { hotspots: HotspotRule[]; pieces: PieceRule[] } {
  return {
    hotspots: catalog.hotspots.map((h) => ({ ...h })),
    pieces: catalog.crewPieces.map((p) => ({ id: p.id, hotspot: p.hotspot, group: p.group })),
  };
}

/** The view after a write, keeping the stage-up flag the chapter's end set. */
function viewAfter(state: RunState, camp: CampRecord): CampView {
  return { ...campView(camp), ...(state.camp?.grew ? { grew: true as const } : {}) };
}

async function campHousehold(run: Pick<RunRecord, "id" | "householdId">, state: RunState, deps: CampDeps): Promise<string | null> {
  try {
    return await discoveryHousehold(run, state, deps);
  } catch (err) {
    console.error(`camp: could not settle run ${run.id}'s household for a camp change:`, err);
    return null;
  }
}

/** The checks every shared change starts with: well formed, this moment, outdoors, a seated player. */
function sharedGate(
  state: RunState,
  intent: Extract<ClientIntent, { type: "CAMP_PLACE" | "CAMP_UNDO" }>,
  playerId: string,
): EditError | null {
  const malformed = campIntentProblem(intent);
  if (malformed !== null) return { code: "ILLEGAL", message: `malformed ${intent.type}: ${malformed}` };
  const moment = state.campMoment;
  if (!moment || moment.id !== intent.moment) return STALE;
  if (!state.party.some((m) => m.playerId === playerId) || (state.removed ?? []).includes(playerId)) {
    return { code: "FORBIDDEN", message: "only a seated player changes the camp" };
  }
  if (!moment.outdoor) return { code: "ILLEGAL", message: placeRefusalText("indoors") };
  return null;
}

/** One player's pick for a shared hotspot (§6.1, §12.5). */
export async function prepareCampPlace(
  state: RunState,
  intent: Extract<ClientIntent, { type: "CAMP_PLACE" }>,
  playerId: string,
  run: Pick<RunRecord, "id" | "householdId">,
  deps: CampDeps,
): Promise<CampEditResult> {
  const gate = sharedGate(state, intent, playerId);
  if (gate) return { ok: false, error: gate };
  const moment = state.campMoment!;
  const catalog = deps.content.campCatalog();
  if (!catalog) return illegal("there is no camp in this content");
  const householdId = await campHousehold(run, state, deps);
  if (!householdId) return illegal("this table has no camp yet");
  const rules = campRules(catalog);
  const fresh = freshPieces(state);
  const seen: { refused: PlaceRefusal | null; change: CampChange | null } = { refused: null, change: null };
  const plan = await planCamp(
    householdId,
    state.crew,
    (camp) => {
      seen.refused = null;
      seen.change = null;
      const verdict = placeProblem({
        moment,
        camp: { frameStage: camp.frameStage, owned: Object.keys(camp.owned), placed: camp.placed },
        ...rules,
        hotspotId: intent.hotspot,
        piece: intent.piece,
        playerId,
        fresh,
      });
      if ("refused" in verdict) {
        seen.refused = verdict.refused;
        return null;
      }
      const hotspot = rules.hotspots.find((h) => h.id === intent.hotspot)!;
      const placed = withPlaced(camp.placed, hotspot, intent.piece);
      seen.change = { hotspot: hotspot.id, before: camp.placed[hotspot.id] ?? null, after: placed[hotspot.id] ?? null, counted: verdict.counted };
      return { ...camp, placed };
    },
    deps,
  );
  const { refused, change } = seen;
  if (refused !== null) return illegal(placeRefusalText(refused));
  if (!plan.ok || plan.write === null || change === null) {
    console.error(`camp: a placement on ${intent.hotspot} for ${householdId} was not planned (${plan.ok ? "no change" : plan.reason})`);
    return illegal("The camp could not be reached. Try again.");
  }
  const mine = moment.changes[playerId] ?? [];
  return {
    ok: true,
    state: {
      ...state,
      camp: viewAfter(state, plan.value),
      campMoment: { ...moment, changes: { ...moment.changes, [playerId]: [...mine, change] } },
    },
    writes: { camp: plan.write },
  };
}

/** Undo a player's own latest shared change in this moment, giving the change back (§6.1, §12.5). */
export async function prepareCampUndo(
  state: RunState,
  intent: Extract<ClientIntent, { type: "CAMP_UNDO" }>,
  playerId: string,
  run: Pick<RunRecord, "id" | "householdId">,
  deps: CampDeps,
): Promise<CampEditResult> {
  const gate = sharedGate(state, intent, playerId);
  if (gate) return { ok: false, error: gate };
  const moment = state.campMoment!;
  const mine = moment.changes[playerId] ?? [];
  const last = mine.at(-1);
  if (!last) return illegal("You have nothing to undo.");
  const catalog = deps.content.campCatalog();
  if (!catalog) return illegal("there is no camp in this content");
  const householdId = await campHousehold(run, state, deps);
  if (!householdId) return illegal("this table has no camp yet");
  const hotspot = catalog.hotspots.find((h) => h.id === last.hotspot);
  if (!hotspot) return illegal("That spot is not in your camp.");
  const seen = { moved: false };
  const plan = await planCamp(
    householdId,
    state.crew,
    (camp) => {
      // Somebody has picked for that spot since, or moved the old piece
      // elsewhere: undoing would undo their pick, which Undo never does.
      const elsewhere = last.before !== null && Object.entries(camp.placed).some(([id, p]) => id !== hotspot.id && p === last.before);
      seen.moved = (camp.placed[hotspot.id] ?? null) !== last.after || elsewhere;
      return seen.moved ? null : { ...camp, placed: withPlaced(camp.placed, hotspot, last.before) };
    },
    deps,
  );
  if (seen.moved) return illegal("Somebody changed that spot since, so it stays.");
  if (!plan.ok || plan.write === null) return illegal("The camp could not be reached. Try again.");
  return {
    ok: true,
    state: {
      ...state,
      camp: viewAfter(state, plan.value),
      campMoment: { ...moment, changes: { ...moment.changes, [playerId]: mine.slice(0, -1) } },
    },
    writes: { camp: plan.write },
  };
}

/** A hero's kit, changed by her own player (§4.5, §12.1). */
export async function prepareKitEdit(
  state: RunState,
  intent: Extract<ClientIntent, { type: "KIT_EDIT" }>,
  playerId: string,
  run: Pick<RunRecord, "householdId">,
  deps: CampDeps,
): Promise<CampEditResult> {
  const malformed = campIntentProblem(intent);
  if (malformed !== null) return illegal(`malformed KIT_EDIT: ${malformed}`);
  if (campMomentKind(state) === null) return illegal("A kit changes in the lobby, at a rest stop or at the chapter's end.");
  const member = state.party.find((m) => m.character.id === intent.characterId);
  if (!member) return { ok: false, error: { code: "NOT_FOUND", message: "that hero is not at this table" } };
  if (member.playerId !== playerId || (state.removed ?? []).includes(playerId)) {
    return { ok: false, error: { code: "FORBIDDEN", message: "only a hero's own player changes her kit" } };
  }
  const catalog = deps.content.campCatalog();
  if (!catalog) return illegal("there is no kit catalog in this content");
  const edit = {
    ...(intent.style !== undefined ? { style: intent.style } : {}),
    ...(intent.tent !== undefined ? { tent: intent.tent } : {}),
    ...(intent.color !== undefined ? { color: intent.color } : {}),
    ...(intent.slots !== undefined ? { slots: intent.slots } : {}),
  };
  const seen: { problem: string | null } = { problem: null };
  const plan = await planKit(
    member.homeHouseholdId ?? run.householdId,
    intent.characterId,
    (kit) => {
      seen.problem = kitEditProblem(catalog.kit, Object.keys(kit.unlocked), edit);
      return seen.problem === null ? withKitEdit(kit, edit) : null;
    },
    deps,
    { expectedRevision: intent.revision },
  );
  if (seen.problem !== null) return illegal(seen.problem);
  if (!plan.ok) {
    // Changed elsewhere since (the book, another phone): the newer kit stands.
    return plan.reason === "stale"
      ? { ok: false, error: { code: "STALE_DECISION", message: "Your kit changed on another screen. Look again." } }
      : { ok: false, error: { code: "NOT_FOUND", message: "that hero has not been saved yet" } };
  }
  if (plan.write === null) return illegal("Your kit could not be saved. Try again.");
  return {
    ok: true,
    state: { ...state, kits: { ...state.kits, [intent.characterId]: kitView(plan.value) } },
    writes: { kit: plan.write },
  };
}

// ---------------------------------------------------------------------------
// After every step: the moment, and what the screens need for it
// ---------------------------------------------------------------------------

/**
 * Keep the run's camp state in step with where the table is (§3, §9):
 *
 *   - the downtime moment: kept while the table stays in it, a fresh one (an
 *     empty count) as it enters another, gone in a scene, a check or a fight;
 *   - the camp view at a rest scene, read as the rest opens (the lobby's and
 *     the chapter end's are set where those begin); the stage-up flag is the
 *     chapter end's alone;
 *   - each seated hero's kit, read from her row as each moment begins (so a
 *     change made in the book shows at the next one) and for anybody who sat
 *     down since; gone outside downtime.
 *
 * `stamp` makes a new moment's id unique: the run and the seq that began it.
 * A failed read costs the screens their camp or a kit, never the step.
 */
export async function syncCampDowntime(
  state: RunState,
  input: { run: Pick<RunRecord, "householdId">; stamp: string; created?: string },
  deps: CampDeps,
): Promise<RunState> {
  const moment = followCampMoment(state.campMoment, state, input.stamp);
  const next: RunState = { ...state };
  if (moment === undefined) {
    delete next.campMoment;
    delete next.kits;
    return next;
  }
  const fresh = moment !== state.campMoment;
  next.campMoment = moment;
  if (moment.kind === "rest" && fresh && !next.camp) {
    const camp = await readCampView(input.run.householdId, state.crew, deps);
    if (camp) next.camp = camp;
  }
  if (next.camp?.grew && moment.kind !== "chapterEnd") {
    const camp = { ...next.camp };
    delete camp.grew;
    next.camp = camp;
  }
  const removed = new Set(state.removed ?? []);
  const seated = state.party.filter((m) => !removed.has(m.playerId));
  const kits: Record<string, HeroKitView> = {};
  const want = seated.filter((m) => fresh || !state.kits?.[m.character.id]);
  // A hero made this very step is written by its commit: her kit is the empty one.
  const made = want.filter((m) => m.character.id === input.created);
  for (const m of made) kits[m.character.id] = kitView(emptyKit());
  for (const m of seated) {
    const known = state.kits?.[m.character.id];
    if (known && !fresh) kits[m.character.id] = known;
  }
  const read = await Promise.all(
    want.filter((m) => m.character.id !== input.created).map(async (m) => {
      try {
        const row = await deps.repo.getCharacter(m.homeHouseholdId ?? input.run.householdId, m.character.id);
        return [m.character.id, kitView(row ? readKit(row) : emptyKit())] as const;
      } catch (err) {
        console.error(`camp: could not read hero ${m.character.id}'s kit:`, err);
        return null;
      }
    }),
  );
  for (const entry of read) if (entry) kits[entry[0]] = entry[1];
  if (Object.keys(kits).length > 0) next.kits = kits;
  else delete next.kits;
  return next;
}
