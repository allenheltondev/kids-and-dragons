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
 * a buddy only from the friends that crew has.
 *
 * **The device wins** (decided, docs/camp.md §7, §11): a kid's own kit is only
 * ever edited on her one phone, so a book change applies over whatever her
 * kit holds now, a table's pick of the same field included, whether it is sent
 * straight away or long after from the phone's queue (shared `mergeBookKit`).
 * Only validity is checked: sent straight away, one field that is not hers to
 * pick refuses the whole change, as `KIT_EDIT` does; from the queue (`merge`)
 * that field is skipped (`refused`) and the rest apply. Last-writer-wins is
 * about the values, never the write: it is `mutateKit`, conditional on her row
 * as read and retried on a lost race, so nothing written between the read and
 * the write (a table's commit, a milestone) is ever lost.
 *
 * A live room reads her kit afresh as its next downtime moment begins
 * (camp-edit.ts `syncCampDowntime`), so that is where a book edit shows.
 */

import {
  BOOK_EDIT_FIELDS,
  FIRST_CREW_NAME,
  isKitChange,
  BOOK_LOOK_FIELDS,
  isLookChange,
  lookView,
  mergeBookLook,
  withLookEdit,
  bookKitProblem,
  bookKitEdit,
  bookKitState,
  campKey,
  campKeyOf,
  campView,
  claimOf,
  parseClaim,
  friendRotation,
  kitEditProblem,
  mergeBookKit,
  parseBookKitChanges,
  readKit,
  withBookKitValue,
  withKitEdit,
  withKitCrew,
} from "@kad/shared";
import type {
  BookEditField,
  BookKitRequest,
  HeroLook,
  LookEdit,
  BookKitResponse,
  BookKitState,
  CampCatalog,
  CampRecord,
  Character,
  HeroKit,
  JournalCrewCamp,
  JournalKit,
  JournalResponse,
  LookCampStanding,
  RunState,
} from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import type { CharacterWrite } from "../store/repository.ts";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { mutateKit, readCamp, type CampDeps } from "./camp.ts";
import { bookLookProblem, mutateLook } from "./look-edit.ts";

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * The book's Camp tray for her heroes (`characters`, already hers), as the
 * journal carries it: `camp`; nothing when the content has no camp; or, when
 * a store read failed, `campError` and no camp, so the rest of the book opens
 * without it and the phone keeps the camp its saved copy has (#656), rather
 * than taking the gap for a household with no camp.
 */
export async function journalCamp(
  householdId: string,
  heroes: readonly Character[],
  deps: CampDeps,
): Promise<Pick<JournalResponse, "camp" | "campError">> {
  const catalog = deps.content.campCatalog();
  if (!catalog) return {};
  try {
    const crews = await crewCamps(householdId, heroes, catalog, deps);
    const kits: Record<string, JournalKit> = {};
    for (const hero of heroes) kits[hero.id] = journalKit(readKit(hero), householdId);
    return { camp: { crews, kits } };
  } catch (err) {
    console.error(`camp: the book could not read ${householdId}'s camps:`, err);
    return { campError: true };
  }
}

/**
 * The backfill's reach (`heroCrews`): how many of the household's runs, newest
 * first, are read for a hero with no recorded crews yet (a kit from before v4).
 * Only ever for those heroes, and only until a run commit writes her row and
 * records her crew (`recordCrews`).
 */
export const CREW_LOOKBACK = 40;

/**
 * Record on each seated hero's kit the crew she is seated with (#629;
 * `HeroKit.crews`, by `campKey`): on the rows this run commit already writes
 * (her seat, her creation, a chapter's start or end, a kit edit), so it adds no
 * write of its own and lands with the commit or not at all. A hero seated at
 * a table whose commit writes her row has played with that crew from then on,
 * however many later evenings were spent elsewhere.
 *
 * A hero with no record yet (a kit from before v4) is given one seeded with
 * what the book's backfill finds for her (`pastCrewKeys`: the runs she sat in,
 * her claim, her buddies) before this table's crew is added, so the first
 * record never forgets a crew the book listed. Only those heroes cost a read
 * of past runs, and each of them only once: from then on her kit has a record.
 * Reads only; the rows are written by the commit that follows.
 */
export async function recordCrews(
  characters: CharacterWrite[],
  state: Pick<RunState, "party" | "removed"> & { crew?: string | null | undefined },
  tableHouseholdId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<void> {
  const removed = new Set(state.removed ?? []);
  const seated = new Set(state.party.filter((m) => !removed.has(m.playerId)).map((m) => m.character.id));
  const key = campKey(tableHouseholdId, state.crew);
  const seats = new Map<string, Promise<PastSeat[] | null>>();
  for (const write of characters) {
    if (!seated.has(write.character.id)) continue;
    const before = readKit(write.character);
    let kit = before;
    // A brand-new hero has no past to seed; one from before v4 has.
    if (kit.crews === undefined && write.expectedVersion !== null) {
      const home = write.character.householdId;
      if (!seats.has(home)) seats.set(home, pastSeats(home, deps).catch(() => null));
      const past = await seats.get(home)!;
      // Unread, she keeps no record yet: the book's backfill still finds her crews, and a later commit seeds it.
      if (past === null) continue;
      kit = { ...kit, crews: pastCrewKeys(write.character, past) };
    }
    const next = withKitCrew(kit, key);
    if (next !== before) write.character = { ...write.character, kit: next };
  }
}

/** One of the household's past runs, as the backfill reads it: who sat, and with which crew. */
interface PastSeat {
  heroes: Set<string>;
  crew: string | null;
}

/** The household's recent runs (`CREW_LOOKBACK`, newest first), for the backfill of heroes with no recorded crews. */
async function pastSeats(householdId: string, deps: Pick<HandlerDeps, "repo">): Promise<PastSeat[]> {
  const runs = (await deps.repo.listRuns(householdId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, CREW_LOOKBACK);
  const states = await Promise.all(runs.map((run) => deps.repo.getState(run.id).catch(() => null)));
  return states.flatMap((s) => {
    if (!s || !playedIn(s)) return [];
    const removed = new Set(s.removed ?? []);
    return [{ heroes: new Set(s.party.filter((m) => !removed.has(m.playerId)).map((m) => m.character.id)), crew: s.crew ?? null }];
  });
}

/**
 * Whether a past run shows it left the lobby: a chapter in play, ended or
 * walked. A snapshot that never did is a lobby visit, which does not make a
 * crew hers (decided, #629). The backfill sees only each run's last snapshot,
 * so it is stricter than the record: a hero who made, seated or edited
 * something in a lobby that never started a chapter is recorded from then on
 * (`recordCrews`), but is not found in the history before v4.
 */
function playedIn(state: RunState): boolean {
  return state.phase !== "lobby" || state.chapterId !== null || state.chapterOutcome != null || (state.visited?.length ?? 0) > 0 || state.xpEarned > 0;
}

/**
 * Every crew a hero is known to have sat with, by `campKey`: her kit's record,
 * or for a hero with none yet the runs of her household she sat in (`seats`);
 * and always her claim and her buddies.
 */
function pastCrewKeys(hero: Character, seats: readonly PastSeat[] | null): string[] {
  const kit = readKit(hero);
  const keys = new Set<string>(kit.crews ?? []);
  if (kit.crews === undefined && seats) {
    for (const seat of seats) if (seat.heroes.has(hero.id)) keys.add(campKey(hero.householdId, seat.crew));
  }
  const held = claimOf(hero);
  if (held !== null) {
    const { table, crew } = parseClaim(held, hero);
    keys.add(campKey(table, crew));
  }
  for (const key of Object.keys(kit.buddies)) keys.add(key);
  return [...keys];
}

/**
 * The crews of the household her heroes are part of (decided, #629): every
 * crew any of them has sat with, at this household (`pastCrewKeys`):
 *
 *   - her kit's crews (`HeroKit.crews`), recorded by every run commit that
 *     writes her row while she is seated (`recordCrews`): the record;
 *   - her claim (`provisional.runId`), the crew whose adventure she is on;
 *   - her kit's buddies, one per crew she picked one in (`campKey`);
 *   - **the backfill**, for a hero with no recorded crews yet (a kit from
 *     before v4) and only for her: the household's recent runs
 *     (`CREW_LOOKBACK`), where a run whose party seats her was played with its
 *     `crew` (absent: the first). The first run commit that writes her row at
 *     a table seeds her record with the same backfill (`recordCrews`), so
 *     nothing it found is lost, and the runs are never read for her again.
 *
 * The household's first crew first, then the others oldest first. Only crews
 * the household still has; a hero who has sat with nobody yet gets the first
 * crew, where her next game will most likely be.
 */
export async function heroCrews(householdId: string, heroes: readonly Character[], deps: Pick<HandlerDeps, "repo">): Promise<(string | null)[]> {
  // The backfill: only for heroes with no record yet, and so, in time, never.
  const seats = heroes.some((h) => readKit(h).crews === undefined) ? await pastSeats(householdId, deps) : null;
  const found = new Set<string | null>();
  for (const hero of heroes) {
    // A hero of this household's backfill reads its runs; her record and her claim say where else she sat.
    for (const key of pastCrewKeys(hero, hero.householdId === householdId ? seats : null)) {
      if (key === householdId) found.add(null);
      else if (campKeyOf(key, householdId)) found.add(key.slice(householdId.length + 1));
    }
  }
  const crews = await deps.repo.listCrews(householdId);
  const out: (string | null)[] = [];
  if (found.has(null)) out.push(null);
  for (const crew of crews) if (found.has(crew.id)) out.push(crew.id);
  return out.length > 0 ? out : [null];
}

/**
 * Each hero's crews' camps as a camp look reads them (docs/hero-looks.md §6),
 * by character id, for the book, which has no room's camp to hand: every
 * friend any crew she has sat with at this household has made, and the
 * grandest of their camps. Only crews she is known to have sat with
 * (`pastCrewKeys`), never `heroCrews`' first-crew guess, so a hero who has
 * played with nobody earns no crew's milestone. Null for a hero with no such
 * crew, and for all of them when the content has no camp or a read fails:
 * the camp looks then wait for the next read, as they did before.
 */
export async function heroCampStandings(
  householdId: string,
  heroes: readonly Character[],
  deps: CampDeps,
): Promise<Map<string, LookCampStanding | null>> {
  const out = new Map<string, LookCampStanding | null>(heroes.map((h) => [h.id, null]));
  if (heroes.length === 0 || !deps.content.campCatalog()) return out;
  try {
    const seats = heroes.some((h) => readKit(h).crews === undefined) ? await pastSeats(householdId, deps) : null;
    const known = new Set((await deps.repo.listCrews(householdId)).map((c) => c.id));
    const crewsOf = new Map<string, (string | null)[]>();
    for (const hero of heroes) {
      const crews = new Set<string | null>();
      for (const key of pastCrewKeys(hero, hero.householdId === householdId ? seats : null)) {
        if (key === householdId) crews.add(null);
        else if (campKeyOf(key, householdId) && known.has(key.slice(householdId.length + 1))) crews.add(key.slice(householdId.length + 1));
      }
      crewsOf.set(hero.id, [...crews]);
    }
    const ids = [...new Set([...crewsOf.values()].flat())];
    const camps = new Map(await Promise.all(ids.map(async (id) => [id, await readCamp(householdId, id, deps)] as const)));
    for (const hero of heroes) {
      const mine = (crewsOf.get(hero.id) ?? []).map((id) => camps.get(id)!);
      if (mine.length === 0) continue;
      out.set(hero.id, {
        friends: [...new Set(mine.flatMap((camp) => Object.keys(camp.friends)))],
        frameStage: Math.max(...mine.map((camp) => camp.frameStage)),
      });
    }
  } catch (err) {
    console.error(`looks: could not read ${householdId}'s camps for the book:`, err);
    return new Map(heroes.map((h) => [h.id, null]));
  }
  return out;
}

/** Each of her heroes' crews' camps (`heroCrews`), named. */
async function crewCamps(householdId: string, heroes: readonly Character[], catalog: CampCatalog, deps: CampDeps): Promise<JournalCrewCamp[]> {
  const [ids, others, firstName] = await Promise.all([
    heroCrews(householdId, heroes, deps),
    deps.repo.listCrews(householdId),
    deps.repo.getFirstCrewName(householdId),
  ]);
  return Promise.all(
    ids.map(async (id) => {
      const name = id === null ? firstName ?? FIRST_CREW_NAME : others.find((c) => c.id === id)?.name ?? FIRST_CREW_NAME;
      return crewCamp(id, name, await readCamp(householdId, id, deps), catalog, deps.content);
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
  const { characterId, crew, merge } = body;
  if (typeof characterId !== "string" || characterId.length === 0 || characterId.length > 64) return "characterId is required";
  if (crew !== undefined && crew !== null && (typeof crew !== "string" || crew.length === 0 || crew.length > 64)) return "crew is a crew id or null";
  if (merge !== undefined && merge !== true) return "merge is true or absent";
  const changes = parseBookKitChanges(body.changes);
  if (changes === null) return "changes are { field, before, after }, each field once";
  return {
    characterId,
    ...(crew !== undefined ? { crew: crew as string | null } : {}),
    ...(merge === true ? { merge: true as const } : {}),
    changes,
  };
}

/**
 * A kit, buddy or look change from the book (`POST /api/journal/kit`).
 * Refused unless the hero is the bound kid's own; a buddy only from the
 * friends that crew has; a look only one she holds (docs/hero-looks.md §3.2,
 * #664). See the header for online and queued changes.
 *
 * Her look's fields (`coat`, `accent`, `special`, `nameplate`, `title`) are change kinds on the
 * same request, applied by the same rule: each over whatever is stored now,
 * the device winning, and one that is not hers skipped from the queue
 * (`merge`) or refusing the whole change sent straight away. They are written
 * to her look first, then her kit's fields to her kit; a queued entry may
 * carry both, while a change sent straight away is one tap, so one or the
 * other.
 */
export async function editKitFromBook(input: BookKitInput, deps: HandlerDeps): Promise<HandlerResult<BookKitResponse>> {
  const request = parseRequest(input.body);
  if (typeof request === "string") return fail("ILLEGAL", request);
  const kitChanges = request.changes.filter(isKitChange);
  const lookChanges = request.changes.filter(isLookChange);
  const catalog = deps.content.campCatalog();
  if (kitChanges.length > 0 && !catalog) return fail("ILLEGAL", "there is no kit catalog in this content");
  const looks = deps.content.looksCatalog();
  if (lookChanges.length > 0 && !looks) return fail("ILLEGAL", "there are no looks in this content");

  const hero = await deps.repo.getCharacter(input.householdId, request.characterId);
  if (!hero) return fail("NOT_FOUND", "that hero is not in your book");
  if (hero.ownerPlayerId !== input.playerId) return fail("FORBIDDEN", "only a hero's own kid changes her kit");

  const seen: { applied: BookEditField[]; refused: BookEditField[]; problem: string | null } = {
    applied: [],
    refused: [],
    problem: null,
  };

  // Her look (docs/hero-looks.md §3.2): each field over what is stored now.
  let look: HeroLook | null = null;
  if (lookChanges.length > 0 && looks) {
    const lookSeen: { applied: BookEditField[]; refused: BookEditField[]; problem: string | null } = { applied: [], refused: [], problem: null };
    // Her crews' camps, so a camp look she has earned is hers to pick (#669).
    const camp = (await heroCampStandings(input.householdId, [hero], deps)).get(hero.id) ?? null;
    const written = await mutateLook(
      input.householdId,
      request.characterId,
      (stored, row) => {
        Object.assign(lookSeen, { applied: [], refused: [], problem: null });
        const check = (edit: LookEdit) => bookLookProblem(looks, stored, edit, row);
        let next: HeroLook;
        if (request.merge) {
          const merged = mergeBookLook(stored, lookChanges, check);
          Object.assign(lookSeen, { applied: merged.applied, refused: merged.refused });
          next = merged.look;
        } else {
          const edit: LookEdit = Object.fromEntries(lookChanges.map((c) => [c.field, c.after]));
          lookSeen.problem = check(edit);
          if (lookSeen.problem !== null) return null;
          lookSeen.applied = lookChanges.map((c) => c.field);
          next = withLookEdit(stored, edit);
        }
        return Object.fromEntries(BOOK_LOOK_FIELDS.map((f) => [f, next[f]])) as LookEdit;
      },
      deps,
      { camp },
    );
    if (lookSeen.problem !== null) return fail("ILLEGAL", lookSeen.problem);
    if (!written.ok) {
      if (written.reason === "missing") return fail("NOT_FOUND", "that hero is not in your book");
      console.error(`looks: a book edit to ${request.characterId}'s look was not written (${written.reason})`);
      return fail("STALE_DECISION", "Your look could not be saved just now. Try again.");
    }
    look = written.value;
    seen.applied.push(...lookSeen.applied);
    seen.refused.push(...lookSeen.refused);
  }

  let kit: HeroKit;
  if (kitChanges.length > 0 && catalog) {
    // A buddy is one of this crew's friends, as the crew's own record says (§4.4).
    const crew = request.crew ?? null;
    const buddy = kitChanges.some((c) => c.field === "buddy");
    let friends: string[] = [];
    if (buddy) {
      if (crew !== null && !(await deps.repo.listCrews(input.householdId)).some((c) => c.id === crew)) {
        return fail("NOT_FOUND", "that crew is not one of your household's");
      }
      friends = Object.keys((await readCamp(input.householdId, crew, deps)).friends);
    }
    const key = campKey(input.householdId, crew);
    const rules = catalog.kit;
    const kitSeen: { applied: BookEditField[]; refused: BookEditField[] } = { applied: [], refused: [] };

    const written = await mutateKit(
      input.householdId,
      request.characterId,
      (stored) => {
        seen.problem = null;
        const unlocked = Object.keys(stored.unlocked);
        const now = bookKitState(stored, key);
        let next: BookKitState;
        if (request.merge) {
          const merged = mergeBookKit(now, kitChanges, (base, next) => bookKitProblem(rules, unlocked, base, next, friends));
          Object.assign(kitSeen, { applied: merged.applied, refused: merged.refused });
          next = merged.state;
        } else {
          // The table's rule, all at once: every field the change names, as picked.
          next = kitChanges.reduce((state, c) => withBookKitValue(state, c.field, c.after), now);
          const style = kitChanges.find((c) => (c.field === "style" || c.field === "tent") && c.after === null);
          seen.problem = style ? `a ${style.field} is always picked` : null;
          const edit = bookKitEdit(now, next);
          if (seen.problem === null && Object.keys(edit).length > 0) seen.problem = kitEditProblem(rules, unlocked, edit, friends);
          if (seen.problem !== null) return null;
          Object.assign(kitSeen, { applied: kitChanges.map((c) => c.field), refused: [] });
        }
        const edit = bookKitEdit(now, next);
        return Object.keys(edit).length === 0 ? null : withKitEdit(stored, edit, key);
      },
      deps,
    );
    if (seen.problem !== null) return fail("ILLEGAL", seen.problem);
    if (!written.ok) {
      if (written.reason === "missing") return fail("NOT_FOUND", "that hero is not in your book");
      console.error(`camp: a book edit to ${request.characterId}'s kit was not written (${written.reason})`);
      return fail("STALE_DECISION", "Your kit could not be saved just now. Try again.");
    }
    kit = written.value;
    seen.applied.push(...kitSeen.applied);
    seen.refused.push(...kitSeen.refused);
  } else {
    // A look change alone: her kit as it now stands, for the book's copy.
    kit = readKit((await deps.repo.getCharacter(input.householdId, request.characterId)) ?? hero);
  }
  const order = (fields: BookEditField[]) => BOOK_EDIT_FIELDS.filter((f) => fields.includes(f));
  return ok({
    kit: journalKit(kit, input.householdId),
    ...(look ? { look: lookView(look, { sources: true }) } : {}),
    applied: order(seen.applied),
    refused: order(seen.refused),
  });
}
