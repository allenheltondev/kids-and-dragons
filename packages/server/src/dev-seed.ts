/**
 * A room with its heroes already made, in one call: the end-to-end suite's
 * setup, for specs that are about what happens once a table is sitting down
 * and not about how it sat down (`POST /api/dev/seed`, e2e/seed.ts).
 *
 * Dev server only, on the same line as the playtest cheats: `dev-server.ts`
 * is the one file that mounts it, and nothing under `lambda/` imports this
 * module (dev-seed.test.ts holds both). A deployed build has no route to it.
 *
 * It is not a second way to make a room. Every step is the handler the real
 * routes call, in the order they call it: a phone opening the room is
 * `createGuestHousehold` + `createRoom` + `joinRoom`, as `POST /api/room`
 * does; a TV opening it is the display branch of that route; a phone joining
 * is `settleRoom` + `admitNewPhone` + `bindNewPhone` + `joinRoom`, as
 * `POST /api/room/:code/join` does for a phone it has never seen; and the
 * heroes, the ready-up, Begin and the jump are intents through `applyAction`,
 * as the phones send them. So what a seeded table sees is what a clicked one
 * sees, minus the clicking. The creation flow and the join form keep their
 * own specs, which do not use this.
 */

import type { ClassId, ClientIntent, FactValue, RoomMode, SpeciesId, Stats } from "@kad/shared";
import { createGuestHousehold, vetTypedName, type BoundDevice } from "./handlers/account.ts";
import { applyAction } from "./handlers/action.ts";
import type { ActionError, HandlerDeps, HandlerResult } from "./handlers/deps.ts";
import { admitNewPhone, bindNewPhone, createRoom, joinRoom, settleRoom } from "./handlers/room.ts";

export interface SeedHero {
  /** The hero's name, as typed on the last creation step. */
  name: string;
  species: SpeciesId;
  /** The creation flow's first class card when absent. */
  class?: ClassId;
  /**
   * Points assigned, before the species bonus. Absent: all of them on the
   * first stat, as tapping the first "Add a point" until none are left does.
   */
  stats?: Stats;
  /** The player's own name (the host's "Your adventurer name"). "Player" when absent, as a join leaves it. */
  player?: string;
}

export interface SeedRequest {
  mode: RoomMode;
  /** A Party Mode room opened by a TV, which is nobody (spec §2.1). Otherwise the first hero's phone opens it. */
  tv?: boolean;
  campaignId?: string | null;
  /** Join an open room instead of opening one: the heroes sit down at it, in order. */
  code?: string;
  heroes: SeedHero[];
  /** Each hero says ready, as "Ready to play" does. Default true. */
  ready?: boolean;
  /** The first hero taps Begin (CONTINUE_CAMPAIGN on the room's campaign). Needs `ready`. */
  begin?: boolean;
  /** Then the playtest jump to this scene (playtest.ts). Needs `begin` or `chapterId`. */
  sceneId?: string;
  /**
   * Start this chapter instead of the campaign's next one: any chapter of any campaign, out of
   * order and unlocked (handlers/deps.ts `playtestStart`). It plays as a chapter of no attempt,
   * so it settles nothing into the household's journey. Implies `begin`.
   */
  chapterId?: string;
  /** Route flags the jumped-to chapter starts holding, as an earlier chapter would have set. */
  flags?: Record<string, boolean>;
  /** A graph campaign's world facts the chapter starts with (#220). */
  facts?: Record<string, FactValue>;
}

/** What a browser would have stored had it done this itself (client store/persistence.ts). */
export interface SeededPhone {
  name: string;
  householdId: string;
  playerId: string;
  displayName: string;
  deviceToken: string;
  session: {
    runId: string;
    roomCode: string;
    playerId: string;
    mode: RoomMode;
    sessionToken: string;
    host?: true;
    keeper?: true;
  };
}

export interface SeedResponse {
  code: string;
  runId: string;
  mode: RoomMode;
  /** The TV's binding, when a TV opened the room. */
  tv?: { householdId: string; playerId: string; deviceToken: string };
  phones: SeededPhone[];
}

const fail = (code: ActionError["code"], message: string): HandlerResult<never> => ({
  ok: false,
  error: { code, message },
});

/** The body, checked: a malformed seed is a 400 with a reason, not a half-made room. */
export function readSeedRequest(body: unknown): SeedRequest | string {
  if (typeof body !== "object" || body === null) return "expected a JSON body";
  const b = body as Record<string, unknown>;
  if (b.mode !== "party" && b.mode !== "travel") return 'mode must be "party" or "travel"';
  if (b.tv === true && b.mode !== "party") return "only a Party Mode room has a TV";
  if (b.code !== undefined && typeof b.code !== "string") return "code must be a room code";
  if (b.code !== undefined && b.tv === true) return "a TV opens a room; it does not join one";
  if (!Array.isArray(b.heroes) || b.heroes.length > 6) return "heroes must be a list of at most six";
  if (b.heroes.length === 0 && b.tv !== true) return "a room nobody opens needs a hero to open it";
  for (const hero of b.heroes as unknown[]) {
    const h = (hero ?? {}) as Record<string, unknown>;
    if (typeof h.name !== "string" || typeof h.species !== "string") return "every hero needs a name and a species";
  }
  if (b.begin === true && b.ready === false) return "begin needs everyone ready";
  // Begin is a tap on the first phone, so a TV alone cannot begin (and a
  // scene jump rides on begin); otherwise seedRoom would reach for a phone
  // that is not there.
  if (b.begin === true && b.heroes.length === 0) return "begin needs at least one hero to tap it";
  if (b.chapterId !== undefined && typeof b.chapterId !== "string") return "chapterId must be a chapter id";
  if (b.chapterId !== undefined && b.ready === false) return "chapterId needs everyone ready";
  if (b.chapterId !== undefined && (b.heroes as unknown[]).length === 0) return "chapterId needs at least one hero to start it";
  if (b.flags !== undefined && (typeof b.flags !== "object" || b.flags === null || Object.values(b.flags).some((v) => typeof v !== "boolean"))) return "flags must map flag names to true or false";
  if (b.facts !== undefined && (typeof b.facts !== "object" || b.facts === null || Object.values(b.facts).some((v) => typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean"))) return "facts must map fact names to plain values";
  if ((b.flags !== undefined || b.facts !== undefined) && b.chapterId === undefined) return "flags and facts need chapterId";
  if (b.sceneId !== undefined && (typeof b.sceneId !== "string" || (b.begin !== true && b.chapterId === undefined))) return "sceneId needs begin or chapterId";
  return b as unknown as SeedRequest;
}

export async function seedRoom(input: SeedRequest, deps: HandlerDeps): Promise<HandlerResult<SeedResponse>> {
  const phones: SeededPhone[] = [];
  const seat = (bound: BoundDevice, joined: Awaited<ReturnType<typeof joinRoom>>, name: string, code: string) => {
    if (!joined.ok) return joined;
    const j = joined.value;
    phones.push({
      name,
      householdId: bound.principal.householdId,
      playerId: j.playerId,
      displayName: bound.player.displayName,
      deviceToken: bound.deviceToken,
      session: {
        runId: j.runId,
        roomCode: code,
        playerId: j.playerId,
        mode: j.mode,
        sessionToken: j.sessionToken,
        ...(j.host ? { host: true as const } : {}),
        ...(j.keeper ? { keeper: true as const } : {}),
      },
    });
    return null;
  };

  const heroes = [...input.heroes];
  let code: string;
  let tv: SeedResponse["tv"];

  if (input.code !== undefined) {
    code = input.code.toUpperCase();
  } else if (input.tv) {
    // POST /api/room with display: true.
    const screen = await createGuestHousehold({ displayName: "Host", display: true }, deps);
    const created = await createRoom(
      {
        householdId: screen.principal.householdId,
        mode: input.mode,
        campaignId: input.campaignId ?? null,
        claimable: true,
        hostDeviceId: screen.principal.deviceId,
      },
      deps,
    );
    if (!created.ok) return created;
    code = created.value.code;
    tv = { householdId: screen.principal.householdId, playerId: screen.principal.playerId, deviceToken: screen.deviceToken };
  } else {
    // POST /api/room from a phone nobody has seen: a guest household, seated.
    const first = heroes.shift()!;
    const name = vetTypedName(first.player ?? "Host", "Host");
    if (!name.ok) return name;
    const host = await createGuestHousehold({ displayName: name.value }, deps);
    const created = await createRoom(
      {
        householdId: host.principal.householdId,
        mode: input.mode,
        campaignId: input.campaignId ?? null,
        claimable: false,
        hostDeviceId: host.principal.deviceId,
      },
      deps,
    );
    if (!created.ok) return created;
    code = created.value.code;
    const refused = seat(host, await joinRoom({ code, principal: host.principal }, deps), first.name, code);
    if (refused) return refused;
  }

  // POST /api/room/:code/join, for a phone with no binding yet.
  for (const hero of heroes) {
    const found = await deps.repo.getRoom(code);
    if (!found) return fail("NOT_FOUND", `no open room ${code}`);
    const settled = await settleRoom(found, found.householdId, deps);
    if (!settled.ok) return settled;
    const room = settled.value;
    if (!room) return fail("NOT_FOUND", `no open room ${code}`);
    // A seeded table is one family's phones: every one joins as family, as the
    // household's own new phones once did, rather than as a visitor.
    const admitted = await admitNewPhone(room, true, deps);
    if (!admitted.ok) return admitted;
    const name = vetTypedName(hero.player ?? "Player", "Player");
    if (!name.ok) return name;
    const bound = await bindNewPhone(room, admitted.value, { displayName: name.value }, deps);
    const refused = seat(bound, await joinRoom({ code, principal: bound.principal }, deps), hero.name, code);
    if (refused) return refused;
  }

  const runId = phones[0]?.session.runId ?? (await deps.repo.getRoom(code))?.runId;
  if (!runId) return fail("NOT_FOUND", `no open room ${code}`);

  // The rest is what the phones send.
  const send = async (phone: SeededPhone, intent: ClientIntent, via: HandlerDeps = deps): Promise<HandlerResult<null>> => {
    const seq = (await deps.repo.getState(runId))?.seq ?? 0;
    const response = await applyAction(
      { runId, playerId: phone.playerId, seq, intent, principal: { householdId: phone.householdId, playerId: phone.playerId } },
      via,
    );
    if (response.ok) return { ok: true, value: null };
    return fail(response.error?.code ?? "ILLEGAL", `${intent.type} for ${phone.name}: ${response.error?.message ?? "refused"}`);
  };
  // One phone per hero, in the order they were given.
  const seated = phones;
  for (const [i, phone] of seated.entries()) {
    const hero = input.heroes[i]!;
    const made = await send(phone, {
      type: "CREATE_CHARACTER",
      name: hero.name,
      species: hero.species,
      class: hero.class ?? "thornguard",
      stats: hero.stats ?? { might: 3, quick: 0, clever: 0, heart: 0 },
    });
    if (!made.ok) return made;
  }
  if (input.ready !== false) {
    for (const phone of seated) {
      const ready = await send(phone, { type: "READY", ready: true });
      if (!ready.ok) return ready;
    }
  }
  if (input.chapterId) {
    // A playtest start: the chapter asked for, whatever the campaign says is next. The same
    // START_CHAPTER a phone sends, through the same handler, with the one start allowed.
    const leader = phones[0]!;
    if (!deps.content.chapter(input.chapterId)) return fail("NOT_FOUND", `unknown chapter "${input.chapterId}"`);
    const forced: HandlerDeps = { ...deps, playtestStart: { chapterId: input.chapterId, flags: input.flags, facts: input.facts } };
    const started = await send(leader, { type: "START_CHAPTER", chapterId: input.chapterId }, forced);
    if (!started.ok) return started;
    if (input.sceneId) {
      const jumped = await send(leader, { type: "PLAYTEST_GOTO", sceneId: input.sceneId });
      if (!jumped.ok) return jumped;
    }
  } else if (input.begin) {
    const leader = phones[0]!;
    const state = await deps.repo.getState(runId);
    const campaignId = state?.campaignId;
    if (!campaignId) return fail("ILLEGAL", "begin needs a room with a campaign");
    const begun = await send(leader, { type: "CONTINUE_CAMPAIGN", campaignId });
    if (!begun.ok) return begun;
    if (input.sceneId) {
      const jumped = await send(leader, { type: "PLAYTEST_GOTO", sceneId: input.sceneId });
      if (!jumped.ok) return jumped;
    }
  }

  const mode = (await deps.repo.getState(runId))?.mode ?? input.mode;
  return { ok: true, value: { code, runId, mode, ...(tv ? { tv } : {}), phones } };
}
