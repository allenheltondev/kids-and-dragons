/**
 * The camp in the adventure book (docs/camp.md §7, §12.6; #629): what the
 * book's Camp tray reads, and the one thing it may write.
 *
 * **The read** rides `GET /api/journal` (`journalCamp`): each crew her heroes
 * sit with, its camp as the table sees it (`CampView`), its friends with their
 * words and where the crew met them, where every piece came from, and each of
 * her heroes' kits with a buddy per crew. Look-only, apart from her own kit.
 *
 * **The write** is `POST /api/journal/kit` (`editKitFromBook`), outside any
 * room, authorised by the phone's device binding exactly as the book's read
 * is (the entry points resolve the kid and hand her in; the body never names
 * her). It changes one hero's kit or buddy, only for a hero that is hers, by
 * the table's own rule (`kitEditProblem`, the same check `KIT_EDIT` makes), and
 * a buddy only from the friends that crew has. Written on her row with
 * `mutateKit`, conditional on the row as read, so a book edit and a table's
 * can never lose each other's write:
 *
 *   - **Online** (`revision`): the table's revision check. A kit that has moved
 *     on since the book read it applies nothing, and the answer carries the kit
 *     as it now is (`stale`). A table edit racing it the other way is refused
 *     by the table's own check, because this write bumps the revision.
 *   - **Queued** (`merge`): field by field, each only where her kit still has
 *     the value the change was made over (shared `mergeBookKit`). A field
 *     changed elsewhere meanwhile keeps the newer value (`kept`); a pick that
 *     is not hers any more is skipped (`refused`); everything else applies.
 *
 * A live room reads her kit afresh as its next downtime moment begins
 * (camp-edit.ts `syncCampDowntime`), so that is where a book edit shows.
 */

import {
  BOOK_KIT_FIELDS,
  FIRST_CREW_NAME,
  bookFieldProblem,
  bookKitEdit,
  bookKitState,
  campKey,
  campKeyOf,
  campView,
  friendRotation,
  kitEditProblem,
  mergeBookKit,
  parseBookKitChanges,
  readKit,
  withBookKitValue,
  withKitEdit,
} from "@kad/shared";
import type {
  BookKitField,
  BookKitRequest,
  BookKitResponse,
  BookKitState,
  CampCatalog,
  CampRecord,
  Character,
  HeroKit,
  JournalCamp,
  JournalCrewCamp,
  JournalKit,
} from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { mutateKit, readCamp, type CampDeps } from "./camp.ts";

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * The book's Camp tray for her heroes (`characters`, already hers). Null when
 * the content has no camp, or a store read failed: the rest of the book
 * opens without it, and its saved copy keeps the last camp it had.
 */
export async function journalCamp(
  householdId: string,
  heroes: readonly Character[],
  deps: CampDeps,
): Promise<JournalCamp | null> {
  const catalog = deps.content.campCatalog();
  if (!catalog) return null;
  try {
    const crews = await crewCamps(householdId, catalog, deps);
    const kits: Record<string, JournalKit> = {};
    for (const hero of heroes) kits[hero.id] = journalKit(readKit(hero), householdId);
    return { crews, kits };
  } catch (err) {
    console.error(`camp: the book could not read ${householdId}'s camps:`, err);
    return null;
  }
}

/**
 * The crews her heroes sit with: the household's first, always, then every
 * other crew that has played, oldest first. Any kid may sit with any crew
 * (architecture §4.5), so a crew that has a save or a camp of its own is one
 * her hero may be seated with; a crew made and never played is left out.
 */
async function crewCamps(householdId: string, catalog: CampCatalog, deps: CampDeps): Promise<JournalCrewCamp[]> {
  const [others, firstName] = await Promise.all([deps.repo.listCrews(householdId), deps.repo.getFirstCrewName(householdId)]);
  const played = await Promise.all(
    others.map(async (crew) => {
      const [stored, attempts] = await Promise.all([deps.repo.getCamp(householdId, crew.id), deps.repo.listCampaignProgress(householdId, crew.id)]);
      return stored !== null || attempts.length > 0 ? crew : null;
    }),
  );
  const crews = [{ id: null as string | null, name: firstName ?? FIRST_CREW_NAME }, ...played.filter((c) => c !== null).map((c) => ({ id: c.id as string | null, name: c.name }))];
  return Promise.all(
    crews.map(async ({ id, name }) => {
      const camp = await readCamp(householdId, id, deps);
      return crewCamp(id, name, camp, catalog, deps.content);
    }),
  );
}

function crewCamp(crew: string | null, name: string, camp: CampRecord, catalog: CampCatalog, content: CampDeps["content"]): JournalCrewCamp {
  const sources: Record<string, string> = {};
  for (const [pieceId, owned] of Object.entries(camp.owned)) {
    if (owned.from === "bought") sources[pieceId] = "Bought with Dash Cash";
    else if (owned.from === "kept") sources[pieceId] = "Your crew's very own";
    else {
      const place = owned.rewardId ? offerPlace(owned.rewardId, catalog, content) : null;
      sources[pieceId] = place ? `Found ${place}` : "Found on an adventure";
    }
  }
  // What a spot shows until the crew places something: its frame's own piece, or the crew's banner.
  for (const spot of catalog.hotspots) {
    if (!spot.default || spot.stage > camp.frameStage || sources[spot.default]) continue;
    const piece = catalog.crewPieces.find((p) => p.id === spot.default);
    sources[spot.default] = piece?.group === "kept" ? "Your crew's very own" : "Came with your camp";
  }
  for (const piece of catalog.crewPieces) {
    if (piece.group === "trophy" && camp.grownBy.includes(piece.campaign)) {
      sources[piece.id] = `For finishing ${content.campaign(piece.campaign)?.title ?? "a whole adventure"}`;
    }
  }
  const order = friendRotation(camp.friends);
  const friends = order.flatMap((id) => {
    const card = catalog.friends.find((f) => f.id === id);
    if (!card) return [];
    const place = offerPlace(camp.friends[id]!.rewardId, catalog, content);
    return [{
      id: card.id,
      name: card.name,
      figure: card.figure,
      ...(card.size ? { size: card.size } : {}),
      reactions: [...card.reactions],
      source: place ? `Met ${place}` : "Met on an adventure",
    }];
  });
  return { crew, name, camp: campView(camp), friends, sources };
}

/**
 * Where an offer was handed over, in a kid's words: "at the Ashspan Bridge"
 * (a graph campaign's place, its map label), or "in “Green Roads North”" (a
 * chapter of a campaign told in order). Null for an offer the content does
 * not have (a seeded or retired one).
 */
export function offerPlace(rewardId: string, catalog: CampCatalog, content: Pick<ContentStore, "chapter" | "campaign">): string | null {
  const offers = [
    ...catalog.crewPieces.flatMap((p) => (p.group === "find" ? p.offers : [])),
    ...catalog.kit.decorations.flatMap((d) => (d.group === "find" ? d.offers : [])),
    ...catalog.friends.flatMap((f) => f.offers),
  ];
  const offer = offers.find((o) => o.rewardId === rewardId);
  const chapter = offer ? content.chapter(offer.chapter) : null;
  if (!chapter) return null;
  const graph = content.campaign(chapter.campaignId)?.graph;
  const node = graph ? Object.values(graph.nodes).find((n) => n.chapter === chapter.id) : undefined;
  if (node?.title) return `at ${node.title.startsWith("The ") ? `the ${node.title.slice(4)}` : `the ${node.title}`}`;
  return `in “${chapter.title}”`;
}

/** A stored kit as the book shows it: the table's view, with her buddy in each of this household's camps, by crew ("" the first). */
export function journalKit(kit: HeroKit, householdId: string): JournalKit {
  const buddies: Record<string, string> = {};
  for (const [key, friend] of Object.entries(kit.buddies)) {
    if (!campKeyOf(key, householdId)) continue;
    buddies[key === householdId ? "" : key.slice(householdId.length + 1)] = friend;
  }
  return {
    revision: kit.revision,
    style: kit.style,
    tent: kit.tent,
    color: kit.color,
    slots: [...kit.slots],
    unlocked: Object.keys(kit.unlocked).sort(),
    buddies,
  };
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

export interface BookKitInput {
  /** The kid the phone is bound to: her household and her player id, never the body's. */
  householdId: string;
  playerId: string;
  body: Record<string, unknown>;
}

/** What a book edit request asks for, or a reason it cannot be read. */
function parseRequest(body: Record<string, unknown>): BookKitRequest | string {
  const { characterId, crew, revision, merge } = body;
  if (typeof characterId !== "string" || characterId.length === 0 || characterId.length > 64) return "characterId is required";
  if (crew !== undefined && crew !== null && (typeof crew !== "string" || crew.length === 0 || crew.length > 64)) return "crew is a crew id or null";
  if (merge !== undefined && merge !== true) return "merge is true or absent";
  if (merge !== true && (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0)) return "revision is required unless the change is merged";
  const changes = parseBookKitChanges(body.changes);
  if (changes === null) return "changes are { field, before, after }, each field once";
  return {
    characterId,
    ...(crew !== undefined ? { crew: crew as string | null } : {}),
    ...(typeof revision === "number" ? { revision } : {}),
    ...(merge === true ? { merge: true as const } : {}),
    changes,
  };
}

/**
 * A kit or buddy change from the book (`POST /api/journal/kit`). Refused
 * unless the hero is the bound kid's own; a buddy only from the friends that
 * crew has. See the header for online and queued changes.
 */
export async function editKitFromBook(input: BookKitInput, deps: HandlerDeps): Promise<HandlerResult<BookKitResponse>> {
  const request = parseRequest(input.body);
  if (typeof request === "string") return fail("ILLEGAL", request);
  const catalog = deps.content.campCatalog();
  if (!catalog) return fail("ILLEGAL", "there is no kit catalog in this content");

  const hero = await deps.repo.getCharacter(input.householdId, request.characterId);
  if (!hero) return fail("NOT_FOUND", "that hero is not in your book");
  if (hero.ownerPlayerId !== input.playerId) return fail("FORBIDDEN", "only a hero's own kid changes her kit");

  // A buddy is one of this crew's friends, as the crew's own record says (§4.4).
  const crew = request.crew ?? null;
  const buddy = request.changes.some((c) => c.field === "buddy");
  let friends: string[] = [];
  if (buddy) {
    if (crew !== null && !(await deps.repo.listCrews(input.householdId)).some((c) => c.id === crew)) {
      return fail("NOT_FOUND", "that crew is not one of your household's");
    }
    friends = Object.keys((await readCamp(input.householdId, crew, deps)).friends);
  }
  const key = campKey(input.householdId, crew);
  const rules = catalog.kit;

  const seen: { applied: BookKitField[]; kept: BookKitField[]; refused: BookKitField[]; problem: string | null } = {
    applied: [],
    kept: [],
    refused: [],
    problem: null,
  };
  const written = await mutateKit(
    input.householdId,
    request.characterId,
    (kit) => {
      seen.problem = null;
      const unlocked = Object.keys(kit.unlocked);
      const now = bookKitState(kit, key);
      let next: BookKitState;
      if (request.merge) {
        const merged = mergeBookKit(now, request.changes, (state, field, value) => bookFieldProblem(rules, unlocked, state, field, value, friends));
        Object.assign(seen, { applied: merged.applied, kept: merged.kept, refused: merged.refused });
        next = merged.state;
      } else {
        // The table's rule, all at once: every field the change names, as picked.
        next = request.changes.reduce((state, c) => withBookKitValue(state, c.field, c.after), now);
        const style = request.changes.find((c) => (c.field === "style" || c.field === "tent") && c.after === null);
        seen.problem = style ? `a ${style.field} is always picked` : null;
        const edit = bookKitEdit(now, next);
        if (seen.problem === null && Object.keys(edit).length > 0) seen.problem = kitEditProblem(rules, unlocked, edit, friends);
        if (seen.problem !== null) return null;
        Object.assign(seen, { applied: request.changes.map((c) => c.field), kept: [], refused: [] });
      }
      const edit = bookKitEdit(now, next);
      return Object.keys(edit).length === 0 ? null : withKitEdit(kit, edit, key);
    },
    deps,
    request.merge ? {} : { expectedRevision: request.revision! },
  );
  if (seen.problem !== null) return fail("ILLEGAL", seen.problem);
  if (!written.ok) {
    if (written.reason === "missing") return fail("NOT_FOUND", "that hero is not in your book");
    if (written.reason === "stale" && written.value) {
      // Changed elsewhere since the book read it (a table, her other phone): the newer kit stands.
      return ok({ kit: journalKit(written.value, input.householdId), applied: [], kept: request.changes.map((c) => c.field), refused: [], stale: true });
    }
    console.error(`camp: a book edit to ${request.characterId}'s kit was not written (${written.reason})`);
    return fail("STALE_DECISION", "Your kit could not be saved just now. Try again.");
  }
  const order = (fields: BookKitField[]) => BOOK_KIT_FIELDS.filter((f) => fields.includes(f));
  return ok({
    kit: journalKit(written.value, input.householdId),
    applied: order(seen.applied),
    kept: order(seen.kept),
    refused: order(seen.refused),
  });
}
