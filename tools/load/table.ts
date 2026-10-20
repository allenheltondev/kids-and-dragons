/**
 * One simulated table: a host and two to four phones playing the start of a
 * chapter through the real HTTP API.
 *
 * A session is what a family does: open a room, the others join, everybody
 * makes a hero and readies up, the host starts the chapter, and the table
 * works through its first checks and a fight, with every phone sending its
 * presence heartbeat (#258) the whole time. Then the host closes the room.
 *
 * What is and is not simulated, so the numbers are read honestly:
 *  - The realtime channel is not. In production a phone learns the new seq from
 *    a patch on the channel (AppSync Events, a separate service); here the
 *    table shares one "last seq we heard" among its phones, which is what the
 *    channel would have delivered. `STALE_SEQ` therefore counts true races
 *    only, phones acting in the same instant.
 *  - The script has to read the state to decide what to tap, so it makes
 *    `GET /api/state` calls a real table never does. They are reported under
 *    their own route name (`(script read)`) so the real traffic can be read
 *    without them, and counted in the totals, which overstates load a little.
 *    The reads after a `STALE_SEQ` are the real thing and are `(resync)`.
 */

import {
  classPlaceWaitingOn,
  keepClassIntent,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  makeRng,
  positionOf,
  sceneChoices,
  type ClassId,
  type ClientIntent,
  type RunState,
  type SpeciesId,
} from "@kad/shared";
import type { ContentStore } from "../../packages/server/src/content/loader.ts";
import type { Api } from "./client.ts";

const SPECIES: SpeciesId[] = ["unicorn", "dragonling", "griffin", "kitsune", "manticore", "bigfoot"];
const CLASSES: ClassId[] = ["thornguard", "duskrunner", "starweaver", "songkeeper"];

/** The room's rows can be told apart from a family's by these names. */
const NAME_PREFIX = "Loadtest";

export interface TableOptions {
  /** Phones at the table, 2 to 4; the host's is one of them. */
  phones: number;
  /** The campaign the host starts. */
  campaign: string;
  /** Mean pause between a phone's taps, ms. A person takes a second or two. */
  thinkMs: number;
  /** The presence heartbeat interval; production's is 20 seconds (#258). */
  heartbeatMs: number;
  /** Stop playing once this many checks have been rolled and a fight has ended. */
  checks: number;
  /** A session gives up on the chapter after this many steps. */
  maxSteps: number;
  /** Say why a session ended. */
  verbose: boolean;
}

/** A room that is open right now, so an interrupted run can still close it. */
export interface OpenRoom {
  code: string;
  deviceToken: string;
}

export interface TableContext {
  api: Api;
  content: ContentStore;
  options: TableOptions;
  /** Rooms opened and not yet closed. */
  open: Set<OpenRoom>;
  /** True once the run is winding down: finish the step, close the room. */
  stopping: () => boolean;
  tally: Tally;
  random: () => number;
}

export interface Tally {
  roomsOpened: number;
  roomsClosed: number;
  /** A close that did not go through. The room expires on its own TTL. */
  closeFailures: number;
  sessions: number;
  /** Sessions that rolled their checks and finished a fight. */
  sessionsThatFought: number;
  /** A session that gave up: a refused join, a stuck chapter, a step limit. */
  sessionsAbandoned: number;
  /** A session the end of the run cut short. Not a failure. */
  sessionsCutShort: number;
  checksRolled: number;
  fightsFinished: number;
}

export const newTally = (): Tally => ({
  roomsOpened: 0,
  roomsClosed: 0,
  closeFailures: 0,
  sessions: 0,
  sessionsThatFought: 0,
  sessionsAbandoned: 0,
  sessionsCutShort: 0,
  checksRolled: 0,
  fightsFinished: 0,
});

/**
 * For each scene of a chapter, how many scenes it is from the nearest fight
 * (a scene of type `encounter`). Every `goto` in a scene is an exit, whether
 * it is a choice, a check's branch or a fight's, so the walk needs no more
 * than the graph. A table that wants a fight takes the exit that is nearer.
 */
export function distanceToFight(chapter: { scenes: Record<string, any> }): Map<string, number> {
  const exits = (value: unknown, out: string[] = []): string[] => {
    if (Array.isArray(value)) for (const v of value) exits(v, out);
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "goto" && typeof v === "string") out.push(v);
        else exits(v, out);
      }
    }
    return out;
  };
  const distance = new Map<string, number>();
  for (const [id, scene] of Object.entries(chapter.scenes)) if (scene.type === "encounter") distance.set(id, 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      const near = Math.min(...exits(scene).map((to) => distance.get(to) ?? Infinity)) + 1;
      if (near < (distance.get(id) ?? Infinity)) {
        distance.set(id, near);
        changed = true;
      }
    }
  }
  return distance;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Phone {
  name: string;
  playerId: string;
  sessionToken: string;
  /** Only the host's matters: it is what runs the room. */
  deviceToken: string;
  beating: boolean;
}

export class Table {
  private runId = "";
  private code = "";
  private seq = 0;
  private phones: Phone[] = [];
  /** The host's device runs the room, so its token is what closes it. */
  private openRoom: OpenRoom | undefined;
  private readonly fightMaps = new Map<string, Map<string, number>>();

  constructor(
    private readonly id: number,
    private readonly ctx: TableContext,
  ) {}

  private get api(): Api {
    return this.ctx.api;
  }

  private note(message: string): void {
    if (this.ctx.options.verbose) console.error(`table ${this.id}: ${message}`);
  }

  private think(): Promise<void> {
    const { thinkMs } = this.ctx.options;
    return sleep(thinkMs * (0.5 + this.ctx.random()));
  }

  /** Plays one session start to finish. Never throws; the room is closed whatever happens. */
  async session(): Promise<void> {
    const { tally } = this.ctx;
    tally.sessions += 1;
    this.phones = [];
    try {
      if (!(await this.openAndJoin())) {
        tally.sessionsAbandoned += 1;
        return;
      }
      const fought = await this.play();
      if (fought) tally.sessionsThatFought += 1;
      else if (this.ctx.stopping()) tally.sessionsCutShort += 1;
      else tally.sessionsAbandoned += 1;
    } catch (error) {
      tally.sessionsAbandoned += 1;
      console.error(`table ${this.id}: ${String(error)}`);
    } finally {
      for (const phone of this.phones) phone.beating = false;
      await this.close();
    }
  }

  // -- opening ----------------------------------------------------------------

  private async openAndJoin(): Promise<boolean> {
    const { options, tally } = this.ctx;
    const opened = await this.api.call("POST", "/api/room", {
      route: "POST /api/room",
      body: { mode: "travel", displayName: `${NAME_PREFIX} host ${this.id}` },
    });
    if (opened.status !== 200 || !opened.body.sessionToken) return false;
    tally.roomsOpened += 1;
    this.code = String(opened.body.code);
    this.runId = String(opened.body.runId);
    this.seq = Number(opened.body.state?.seq ?? 0);
    const host: Phone = {
      name: `${NAME_PREFIX} host ${this.id}`,
      playerId: String(opened.body.playerId),
      sessionToken: String(opened.body.sessionToken),
      deviceToken: String(opened.body.deviceToken),
      beating: false,
    };
    this.phones.push(host);
    this.openRoom = { code: this.code, deviceToken: host.deviceToken };
    this.ctx.open.add(this.openRoom);
    this.startBeating(host);

    // The others scan the code a moment apart.
    for (let i = 1; i < options.phones; i++) {
      await this.think();
      const name = `${NAME_PREFIX} ${this.id}-${i}`;
      const joined = await this.withRetry(() =>
        this.api.call("POST", `/api/room/${this.code}/join`, {
          route: "POST /api/room/:code/join",
          body: { displayName: name },
        }),
      );
      if (joined.status !== 200 || !joined.body.sessionToken) return false;
      this.seq = Math.max(this.seq, Number(joined.body.state?.seq ?? 0));
      const phone: Phone = {
        name,
        playerId: String(joined.body.playerId),
        sessionToken: String(joined.body.sessionToken),
        deviceToken: String(joined.body.deviceToken),
        beating: false,
      };
      this.phones.push(phone);
      this.startBeating(phone);
    }
    return true;
  }

  /** The host closes the room. A failure here is reported, never swallowed. */
  private async close(): Promise<void> {
    const { tally } = this.ctx;
    const room = this.openRoom;
    if (!room) return;
    this.openRoom = undefined;
    const closed = await this.withRetry(() =>
      this.api.call("POST", `/api/room/${room.code}/close`, {
        route: "POST /api/room/:code/close",
        deviceToken: room.deviceToken,
        body: {},
      }),
    );
    // A room that is already gone counts as closed.
    if (closed.status === 200 || closed.status === 404) {
      tally.roomsClosed += 1;
      this.ctx.open.delete(room);
    } else {
      tally.closeFailures += 1;
    }
  }

  // -- the heartbeat ----------------------------------------------------------

  /** Every seated phone says "still here" every 20 seconds, out of step with the others. */
  private startBeating(phone: Phone): void {
    phone.beating = true;
    void (async () => {
      await sleep(this.ctx.random() * this.ctx.options.heartbeatMs);
      while (phone.beating) {
        await this.api.call("POST", "/api/presence", {
          route: "POST /api/presence",
          token: phone.sessionToken,
          body: {},
        });
        await sleep(this.ctx.options.heartbeatMs);
      }
    })();
  }

  // -- talking to the server ----------------------------------------------------

  /** A 429 is the server asking to slow down: wait as long as it says, then try again, a few times. */
  private async withRetry<T extends { status: number; retryAfterMs: number | undefined }>(
    attempt: () => Promise<T>,
  ): Promise<T> {
    let reply = await attempt();
    for (let tries = 0; reply.status === 429 && tries < 3; tries++) {
      await sleep(reply.retryAfterMs ?? 1000);
      reply = await attempt();
    }
    return reply;
  }

  private async readState(label: "script read" | "resync", phone: Phone): Promise<RunState | null> {
    const reply = await this.withRetry(() =>
      this.api.call("GET", `/api/state?code=${this.code}`, {
        route: `GET /api/state (${label})`,
        token: phone.sessionToken,
      }),
    );
    if (reply.status !== 200 || !reply.body.state) return null;
    this.seq = Number(reply.body.seq ?? reply.body.state.seq);
    return reply.body.state as RunState;
  }

  /**
   * Tap. On `STALE_SEQ` the phone reads the state again and taps again, as the
   * client does (architecture §4.2), up to a few times. False when the engine
   * refused it for good.
   */
  private async send(phone: Phone, intent: ClientIntent): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const reply = await this.withRetry(() =>
        this.api.call("POST", "/api/action", {
          route: "POST /api/action",
          token: phone.sessionToken,
          body: { runId: this.runId, playerId: phone.playerId, seq: this.seq, intent },
        }),
      );
      if (reply.status !== 200) return false;
      if (reply.body.ok) {
        this.seq = Math.max(this.seq, Number(reply.body.seq ?? this.seq));
        return true;
      }
      if (reply.body.error?.code !== "STALE_SEQ") {
        this.note(`${intent.type} was refused: ${reply.body.error?.code} ${reply.body.error?.message}`);
        return false;
      }
      await this.readState("resync", phone);
    }
    return false;
  }

  // -- the chapter ---------------------------------------------------------------

  private phoneOf(playerId: string): Phone {
    return this.phones.find((p) => p.playerId === playerId) ?? this.phones[0]!;
  }

  /** True when the table rolled its checks and finished a fight. */
  private async play(): Promise<boolean> {
    const { options, tally } = this.ctx;
    const host = this.phones[0]!;

    // Everybody makes a hero at once, as a table does: this is where phones
    // most often race for the same seq.
    await Promise.all(
      this.phones.map(async (phone, i) => {
        await this.think();
        await this.send(phone, {
          type: "CREATE_CHARACTER",
          name: `Hero ${this.id}${String.fromCharCode(97 + i)}`,
          species: SPECIES[(this.id + i) % SPECIES.length]!,
          class: CLASSES[(this.id + i) % CLASSES.length]!,
          stats: { might: 1, quick: 1, clever: 0, heart: 1 },
        } as ClientIntent);
      }),
    );
    await Promise.all(
      this.phones.map(async (phone) => {
        await this.think();
        await this.send(phone, { type: "READY", ready: true });
      }),
    );
    await this.think();
    if (!(await this.send(host, { type: "CONTINUE_CAMPAIGN", campaignId: options.campaign }))) {
      this.note("the host could not start the chapter");
      return false;
    }

    let checks = 0;
    let fights = 0;
    let inFight = false;
    for (let step = 0; step < options.maxSteps && !this.ctx.stopping(); step++) {
      await this.think();
      const state = await this.readState("script read", host);
      if (!state || state.closed) {
        this.note("the room went away");
        return false;
      }
      if (state.phase === "chapter_complete") {
        this.note(`the chapter ended after ${step} steps with ${checks} checks and ${fights} fights`);
        return fights >= 1;
      }

      const fighting = state.phase === "encounter" && state.encounter !== undefined;
      if (inFight && !fighting) {
        inFight = false;
        fights += 1;
        tally.fightsFinished += 1;
      }
      if (fights >= 1 && checks >= options.checks) return true;
      if (fighting) inFight = true;

      const rolled = await this.step(state);
      if (rolled === "roll") {
        checks += 1;
        tally.checksRolled += 1;
      }
      if (rolled === "stuck") return false;
    }
    this.note(`stopped with ${checks} checks and ${fights} fights`);
    return fights >= 1 && checks >= options.checks;
  }

  /** One thing a table would do next. */
  private async step(state: RunState): Promise<"roll" | "done" | "stuck"> {
    const { random } = this.ctx;
    const prompt = state.prompt;
    const ownerOf = (characterId: string) =>
      this.phoneOf(state.party.find((m) => m.character.id === characterId)?.playerId ?? "");

    if (prompt?.kind === "item_swap") {
      await this.send(ownerOf(prompt.characterId), { type: "RESOLVE_ITEM_SWAP", dropItemId: null });
      return "done";
    }
    if (prompt?.kind === "ready") {
      for (const playerId of prompt.forPlayerIds) {
        if (state.party.find((m) => m.playerId === playerId)?.ready) continue;
        await this.send(this.phoneOf(playerId), { type: "READY", ready: true });
      }
      return "done";
    }
    if (prompt?.kind === "roll") {
      const ok = await this.send(ownerOf(prompt.characterId), { type: "ROLL" });
      return ok ? "roll" : "done";
    }
    // A class place (#311) or the fitting stall (#312) waits for every hero's
    // own answer before the way on.
    const deciding = classPlaceWaitingOn(state);
    if (deciding.length > 0 && state.classPlace) {
      for (const member of deciding) {
        await this.send(this.phoneOf(member.playerId), keepClassIntent(state.classPlace, member));
      }
      return "done";
    }
    if (prompt?.kind === "choice") {
      const options = prompt.options;
      const choiceId = this.pickChoice(state, options);
      const voters = prompt.forPlayerIds.length ? prompt.forPlayerIds : [this.phones[0]!.playerId];
      if (prompt.vote) {
        for (const playerId of voters) await this.send(this.phoneOf(playerId), { type: "CHOOSE", choiceId });
      } else {
        await this.send(this.phoneOf(voters[0]!), { type: "CHOOSE", choiceId });
      }
      return "done";
    }

    const encounter = state.encounter;
    if (state.phase === "encounter" && encounter) {
      await this.fightTurn(state);
      return "done";
    }
    // A scene with nothing to ask: narration waiting to be moved on.
    await this.send(this.phones[0]!, { type: "ADVANCE" });
    return "done";
  }

  /** The way on a table would take: toward the fight if the chapter has one, else any. */
  private pickChoice(state: RunState, options: readonly { id: string }[]): string {
    const chapter = state.chapterId ? this.ctx.content.chapter(state.chapterId) : undefined;
    const scene = chapter && state.sceneId ? chapter.scenes[state.sceneId] : undefined;
    if (chapter && scene) {
      const distance = (this.fightMaps.get(chapter.id) ?? this.fightMaps.set(chapter.id, distanceToFight(chapter)).get(chapter.id))!;
      const exits = new Map(sceneChoices(scene).map((c) => [c.id, distance.get(c.goto) ?? Infinity]));
      const nearest = Math.min(...options.map((o) => exits.get(o.id) ?? Infinity));
      const toward = options.filter((o) => (exits.get(o.id) ?? Infinity) === nearest);
      if (Number.isFinite(nearest)) return toward[Math.floor(this.ctx.random() * toward.length)]!.id;
    }
    return options[Math.floor(this.ctx.random() * options.length)]!.id;
  }

  /** The active hero attacks the nearest enemy, or walks toward one, then ends the turn. */
  private async fightTurn(state: RunState): Promise<void> {
    const encounter = state.encounter!;
    const { content } = this.ctx;
    const ownerOf = (id: string) => this.phoneOf(state.party.find((m) => m.character.id === id)?.playerId ?? "");

    const actorId = currentActorId(encounter);
    const holder = encounter.combatants.find((c) => c.id === actorId);
    if (holder && holder.side === "party" && !currentActor(encounter)) {
      await this.send(ownerOf(holder.id), { type: "END_TURN" });
      return;
    }
    const actor = currentActor(encounter);
    if (!actor || actor.side !== "party") {
      await this.send(this.phones[0]!, { type: "ADVANCE" });
      return;
    }
    const phone = ownerOf(actor.id);
    const enemies = encounter.combatants.filter((c) => c.side !== "party" && !c.down).map((c) => c.id);
    const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("load-legal") };

    const attack = legalActions(encounter, ctx).find((a) => a.tiles.length === 0 && a.targets.some((t) => enemies.includes(t)));
    if (attack && !encounter.actionTaken) {
      const targetId = attack.targets.find((t) => enemies.includes(t))!;
      if (await this.send(phone, { type: "COMBAT_ACTION", abilityId: attack.abilityId, targetId })) return;
    }
    const moves = legalMoves(encounter);
    const goals = enemies.map((id) => positionOf(encounter, id)).filter((p) => p !== null);
    if (moves.length && goals.length && encounter.stepsLeft > 0 && !encounter.actionTaken) {
      const distance = (t: { x: number; y: number }) =>
        Math.min(...goals.map((g) => Math.abs(g.x - t.x) + Math.abs(g.y - t.y)));
      const here = positionOf(encounter, actor.id)!;
      const best = [...moves].sort((a, b) => distance(a) - distance(b))[0]!;
      if (distance(best) < distance(here) && (await this.send(phone, { type: "MOVE", to: { x: best.x, y: best.y } }))) return;
    }
    await this.send(phone, { type: "END_TURN" });
  }
}
