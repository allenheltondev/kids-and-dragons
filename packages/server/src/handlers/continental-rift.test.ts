/**
 * The Continental Rift vertical slice (#203), played end to end through the
 * real server — the epic's (#191) exit proof.
 *
 * Every other graph test pins one issue's contract on a fixture made for it.
 * This one plays the slice (shared fixtures/continental-rift.campaign.json and
 * its chapters, map and all) the way a household would: several evenings, a
 * new room and a new run each time, the same household and the same attempt
 * row underneath, phones dropping and coming back, a chapter left half-played
 * one night and picked up the next. And it plays it through the *shipping*
 * loader: the slice is copied into a scratch content root beside the real
 * rules, items, abilities and bestiary, and `loadContent` reads it exactly as
 * it reads `content/` at server start — enemies filled from canon, every
 * chapter and the board checked, the graph parsed and linted. The real
 * `content/` never sees it (the last test says so).
 *
 * What the epic promised, and where each is asserted:
 *
 *   Exchange -> Glacier of Origins       the shelf rift, every party
 *   sideways to two regions              the Whispering Marsh (b), the Frostfang Peaks (a)
 *   a single-use rift                    the shelf rift: consumed by the crossing, drawn used
 *                                        up, refused afterwards with nothing written (a)
 *   a revisit with changed state         the river surges at the glacier (world fact) and the
 *                                        Exchange replays as the flooded harbour (variant) (a, c)
 *   a temporary buff, used in a fight    Rift Spark's +1 on the Starweaver's attack roll (a),
 *                                        Starlight Ward's +1 on the Guard a wisp swings at (a),
 *                                        Marsh Mettle in the escape fight (b)
 *   class-conditional Starweaver ways    sense and attune offered to (a) only; a hint, and a
 *                                        refusal, for (b)
 *   a path without a Starweaver          the yeti readers, befriended by the rescue in the
 *                                        environmental fight, open the seal for (b); a party
 *                                        that opens nothing goes home down the river (c)
 *   an environmental fight -> a fact     (b) frees the reader and escapes for real; the
 *                                        glacier's completion rule makes the readers friends
 */

import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyIntent,
  createRunState,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  makeRng,
  positionOf,
  riftActionsForParty,
} from "@kad/shared";
import type { ClassId, ClientIntent, DiceRoll, EncounterEvent, JourneyRiftActionView, RunState } from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { setPresence } from "./presence.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN_ID = "continental-rift-slice";
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const FIXTURES = path.join(ROOT, "packages", "shared", "src", "fixtures");
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The slice, loaded the way the server loads content
// ---------------------------------------------------------------------------

const scratch: string[] = [];
afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/**
 * A content root holding the real rules, items, abilities, bestiary and world
 * and nothing of the shipped campaigns but the slice: the loader cannot tell
 * it from `content/`, so everything it refuses at server start it refuses
 * here. Built once per file (the loader caches by path).
 */
const sliceContent: Promise<ContentStore> = (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kad-continental-rift-"));
  scratch.push(dir);
  for (const file of ["rules.json", "items.json", "abilities.json", "bestiary.json", "world.json"]) {
    await cp(path.join(ROOT, "content", file), path.join(dir, file));
  }
  for (const sub of ["chapters", "maps", "campaigns"]) await mkdir(path.join(dir, sub));
  const chapters = path.join(FIXTURES, "continental-rift", "chapters");
  for (const file of await readdir(chapters)) await cp(path.join(chapters, file), path.join(dir, "chapters", file));
  await cp(path.join(FIXTURES, "continental-rift", "ice-shelf.map.json"), path.join(dir, "maps", "cr_ice_shelf.json"));
  await cp(path.join(FIXTURES, "continental-rift.campaign.json"), path.join(dir, "campaigns", `${CAMPAIGN_ID}.json`));
  return loadContent(dir);
})();

async function household(players = 2) {
  const content = await sliceContent;
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  // The server seeds each step's dice from `runId:seq`, and a run id is a
  // random UUID. Keyed to the seq alone (as playthrough-driver.ts does), the
  // fights below throw the same dice on every run.
  harness.deps.rng = (key) => makeRng(`continental-rift:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, players);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, CAMPAIGN_ID);
  return { harness, attempt, ...seeded };
}

type Household = Awaited<ReturnType<typeof household>>;

const NAMES = ["Glimmer", "Bramble", "Sparklehoof", "Windstep"];

/**
 * One evening: a new room for the slice, each listed player at their own
 * phone. The first evening creates each player's hero of the class given; a
 * later one seats the hero that player already has — the same table coming
 * back, as a household does.
 */
async function evening(h: Household, classes: ClassId[]) {
  const { harness } = h;
  harness.clock.advance(DAY);
  const created = await createRoom({ householdId: h.householdId, mode: "party", campaignId: CAMPAIGN_ID }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const seats: string[] = [];
  for (const [i] of classes.entries()) {
    const joined = await joinRoom({ code, principal: h.players[i]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    seats.push(joined.value.playerId);
  }
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent, seat = 0) =>
    applyAction({ runId, playerId: seats[seat]!, seq: (await state()).seq, intent }, harness.deps);
  const must = async (intent: ClientIntent, seat = 0) => {
    const response = await send(intent, seat);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    return response;
  };
  const everyone = async (intent: ClientIntent) => {
    for (const seat of seats.keys()) await must(intent, seat);
  };
  const stored = await harness.repo.listCharacters(h.householdId);
  for (const [seat, cls] of classes.entries()) {
    const mine = stored.find((c) => c.ownerPlayerId === seats[seat] && c.class === cls);
    await must(
      mine
        ? { type: "SEAT_CHARACTER", characterId: mine.id }
        : {
            type: "CREATE_CHARACTER",
            name: NAMES[seat]!,
            species: "unicorn",
            class: cls,
            stats: { might: 1, quick: 1, clever: 1, heart: 0 },
          },
      seat,
    );
  }
  await everyone({ type: "READY", ready: true });
  const view = async () => {
    const now = await state();
    return (now.campaign ?? now.campaignOptions?.[0])?.journey;
  };
  const heroOf = async (cls: ClassId) => (await state()).party.find((m) => m.character.class === cls)!.character;
  const seatOf = (s: RunState, characterId: string) =>
    seats.indexOf(s.party.find((m) => m.character.id === characterId)!.playerId);

  return {
    runId,
    seats,
    state,
    send,
    must,
    view,
    heroOf,
    /** What this table's phones draw (#199): the view's ways judged against the heroes seated now. */
    drawn: async (): Promise<JourneyRiftActionView[]> => {
      const now = await state();
      const party = { classes: now.party.map((m) => m.character.class), items: [] };
      return riftActionsForParty((await view())?.riftActions ?? [], party);
    },
    begin: async () => must({ type: "CONTINUE_CAMPAIGN" }),
    /** Warps the chapter under way to one of its scenes (an ending finishes it). */
    goto: async (sceneId: string) => must({ type: "PLAYTEST_GOTO", sceneId }),
    /** Into a fight: the warp, then every phone readies up for the board. */
    fight: async (sceneId: string) => {
      await must({ type: "PLAYTEST_GOTO", sceneId });
      await everyone({ type: "READY", ready: true });
    },
    /** From the completion screen back to the lobby, everyone ready. */
    lobby: async () => {
      await must({ type: "ADVANCE" });
      await everyone({ type: "READY", ready: true });
    },
    exit: async (edgeId: string) => send({ type: "CHOOSE_EXIT", edgeId, visit: (await view())?.visit ?? 0 }),
    act: async (action: "discover" | "open", edgeId: string, way: string, seat = 0) =>
      send({ type: "RIFT_ACTION", action, edgeId, way, visit: (await view())?.visit ?? 0 }, seat),
    /** A phone drops (the presence layer marks it gone) and joins again on the same device. */
    dropAndRejoin: async (seat: number) => {
      expect(await setPresence({ runId, playerId: seats[seat]!, connected: false }, harness.deps)).not.toBeNull();
      expect((await state()).party.find((m) => m.playerId === seats[seat])?.connected).toBe(false);
      const again = await joinRoom({ code, principal: h.players[seat]!.principal }, harness.deps);
      if (!again.ok) throw new Error("rejoin");
      expect(again.value.playerId).toBe(seats[seat]);
      expect((await state()).party.find((m) => m.playerId === seats[seat])?.connected).toBe(true);
    },
    /**
     * Plays the fight under way through the real engine, one turn at a time,
     * until `done` says stop or the fight ends. `turn` decides a hero's turn
     * (an intent, or null to end it); the monsters' turns are the engine's own
     * (ADVANCE hands them on). Returns every dice roll the table was shown.
     */
    play: async (
      turn: (s: RunState, heroId: string) => ClientIntent | null,
      done: (rolls: DiceRoll[], s: RunState) => boolean = () => false,
    ) => {
      const since = (await state()).seq;
      const rolls = async () => rollsShown(harness, runId, since);
      for (let step = 0; step < 400; step++) {
        const s = await state();
        if (s.phase !== "encounter" || !s.encounter || done(await rolls(), s)) return rolls();
        const actorId = currentActorId(s.encounter);
        const holder = s.encounter.combatants.find((c) => c.id === actorId);
        const actor = currentActor(s.encounter);
        if (holder?.side === "party" && !actor) {
          await must({ type: "END_TURN" }, seatOf(s, holder.id));
          continue;
        }
        if (!actor || actor.side !== "party") {
          await must({ type: "ADVANCE" });
          continue;
        }
        const seat = seatOf(s, actor.id);
        const intent = turn(s, actor.id);
        if (intent) {
          const response = await send(intent, seat);
          if (response.ok) continue;
        }
        await must({ type: "END_TURN" }, seat);
      }
      throw new Error("the fight never settled");
    },
  };
}

type Evening = Awaited<ReturnType<typeof evening>>;

/** Every die roll the table was shown since `seq`: the presentations' combat beats, in order. */
async function rollsShown(harness: TestHarness, runId: string, seq: number): Promise<DiceRoll[]> {
  const out: DiceRoll[] = [];
  for (const event of await harness.repo.listEvents(runId, seq)) {
    const p = event.presentation;
    const beats: readonly EncounterEvent[] =
      p?.kind === "COMBAT_SEQUENCE" || p?.kind === "ENCOUNTER_BEGAN" ? (p.events ?? []) : [];
    for (const beat of beats) if (beat.type === "roll") out.push(beat.roll);
  }
  return out;
}

/**
 * A hero's turn in a plain fight: swing at a monster standing next to them,
 * judged by the same `legalActions` the phones and the server share.
 */
function swingAt(content: ContentStore) {
  return (s: RunState): ClientIntent | null => {
    const encounter = s.encounter!;
    if (encounter.actionTaken) return null;
    const foes = encounter.combatants.filter((c) => c.side !== "party" && !c.down).map((c) => c.id);
    const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("legal-actions") };
    const attack = legalActions(encounter, ctx).find((a) => a.abilityId === "attack" && a.targets.some((t) => foes.includes(t)));
    return attack ? { type: "COMBAT_ACTION", abilityId: "attack", targetId: attack.targets.find((t) => foes.includes(t))! } : null;
  };
}

/**
 * A hero's turn in the glacier fight, played for the reader: walk to the
 * crack in the wall (next to the trapped reader), and end the turn there —
 * which frees the reader and steps through, in that order (#201).
 */
const forTheCrack = (s: RunState, heroId: string): ClientIntent | null => {
  const encounter = s.encounter!;
  const exits = encounter.environment!.spec.exits!.flatMap((exit) => exit.tiles);
  const here = positionOf(encounter, heroId)!;
  if (exits.some((t) => t.x === here.x && t.y === here.y) || encounter.stepsLeft === 0) return null;
  const moves = legalMoves(encounter);
  const onExit = moves.find((m) => exits.some((t) => t.x === m.x && t.y === m.y));
  if (onExit) return { type: "MOVE", to: { x: onExit.x, y: onExit.y } };
  const distance = (t: { x: number; y: number }) => Math.min(...exits.map((e) => Math.abs(e.x - t.x) + Math.abs(e.y - t.y)));
  const closer = [...moves].sort((a, b) => distance(a) - distance(b))[0];
  return closer && distance(closer) < distance(here) ? { type: "MOVE", to: { x: closer.x, y: closer.y } } : null;
};

const ids = (list: readonly { id: string }[] | undefined) => (list ?? []).map((b) => b.id).sort();
const exitOf = async (t: Evening, edge: string) => (await t.view())?.exits.find((exit) => exit.edge === edge);

// ---------------------------------------------------------------------------
// (a) A table with a Starweaver
// ---------------------------------------------------------------------------

describe("the slice, played by a table with a Starweaver", () => {
  it(
    "senses and crosses the single-use rift, comes home to a changed Exchange, attunes the seal and reaches the heart — over three evenings",
    { timeout: 60_000 },
    async () => {
      const content = await sliceContent;
      const h = await household(2);

      // ---- Monday ------------------------------------------------------------
      const monday = await evening(h, ["starweaver", "duskrunner"]);
      await monday.begin();
      expect(await monday.state()).toMatchObject({ chapterId: "cr-exchange", journeyVisit: { node: "exchange", visit: 1 } });
      await monday.goto("scene_tear");
      expect((await h.attempt())!.journey).toMatchObject({ node: "exchange", status: "choosing" });

      // The shelf rift: one use, and where it leads is hidden until crossed…
      expect(await exitOf(monday, "shelf-rift")).toMatchObject({
        available: true,
        to: "",
        hiddenDestination: true,
        rift: { status: "open", usesLeft: 1 },
      });
      // …unless a Starweaver senses it: a way only this table is offered.
      expect((await monday.drawn()).map((a) => [a.action, a.way, a.unmet ?? false])).toEqual([["discover", "sense", false]]);
      expect((await monday.act("discover", "shelf-rift", "sense")).ok).toBe(true);
      expect((await h.attempt())!.journey?.facts).toEqual({ attunement: 1 });
      expect(await exitOf(monday, "shelf-rift")).toMatchObject({ to: "glacier" });
      expect(await exitOf(monday, "shelf-rift")).not.toHaveProperty("hiddenDestination");

      // Exchange -> Glacier of Origins, through the rift: used up, and charged.
      expect((await monday.exit("shelf-rift")).ok).toBe(true);
      const crossed = (await h.attempt())!;
      expect(crossed.journey).toMatchObject({
        node: "glacier",
        status: "playing",
        traversed: { "shelf-rift": 1 },
        rifts: { "shelf-rift": { status: "consumed", crossings: 1 } },
      });
      expect(ids(crossed.journey?.buffs)).toEqual(["rift-spark"]);

      // Into the environmental fight, the Rift Spark on every hero…
      await monday.lobby();
      await monday.begin();
      expect(await monday.state()).toMatchObject({ chapterId: "cr-glacier", journeyVisit: { node: "glacier", visit: 1 } });
      expect(ids((await monday.state()).buffs)).toEqual(["rift-spark"]);
      await monday.fight("fight_shelf");
      const board = (await monday.state()).encounter!;
      expect(board.environment?.spec).toMatchObject({ clock: { rounds: 4, onExpire: "collapse" }, rescue: { name: "the trapped yeti reader" } });
      const heroes = board.combatants.filter((c) => c.side === "party").map((c) => c.id);
      expect(board.buffs?.map((b) => [b.id, b.kind, b.amount, b.heroId])).toEqual(
        heroes.map((hero) => ["rift-spark", "roll", 1, hero]),
      );
      // …a phone drops mid-fight and comes back to the same board…
      await monday.dropAndRejoin(1);
      expect((await monday.state()).encounter?.buffs).toEqual(board.buffs);
      // …and Monday ends there, the chapter half-played. Nothing on the attempt moved.
      expect(await h.attempt()).toEqual(crossed);

      // ---- Tuesday: a new room resumes the visit under way --------------------
      const tuesday = await evening(h, ["starweaver", "duskrunner"]);
      await tuesday.begin();
      expect(await tuesday.state()).toMatchObject({ chapterId: "cr-glacier", journeyVisit: { node: "glacier", visit: 1 } });
      expect(await h.attempt()).toEqual(crossed);
      // Seeded from the journey, whole — never from what Monday's run did.
      expect(ids((await tuesday.state()).buffs)).toEqual(["rift-spark"]);
      await tuesday.fight("fight_shelf");

      // The buff in use: the Starweaver's swing at the wisp beside them rolls +1.
      const starweaver = (await tuesday.heroOf("starweaver")).id;
      const rolls = await tuesday.play(
        (s, hero) => (hero === starweaver ? swingAt(content)(s) : null),
        (shown) => shown.some((roll) => roll.characterId === starweaver),
      );
      const swingRoll = rolls.find((roll) => roll.characterId === starweaver)!;
      const sw = (await tuesday.state()).encounter!.combatants.find((c) => c.id === starweaver)!;
      expect(swingRoll.mod).toBe(sw.attackMod + 1);

      // Out through the crack without the reader: the source wakes regardless.
      await tuesday.goto("scene_through");
      const glacierDone = (await h.attempt())!;
      expect(glacierDone.journey).toMatchObject({
        node: "glacier",
        status: "choosing",
        facts: { attunement: 1, "great-river": "surging" },
      });
      expect(glacierDone.journey?.facts).not.toHaveProperty("yeti-readers");
      expect(glacierDone.journey).not.toHaveProperty("buffs");

      // The seal is drawn shut; not attuned enough yet, so the Starweaver has nothing to try.
      expect(await exitOf(tuesday, "origin-seal")).toMatchObject({ available: false, reason: "rift-dormant" });
      expect(await tuesday.drawn()).toEqual([]);

      // Home down the river — to an Exchange the crossing says has changed.
      expect(await exitOf(tuesday, "meltwater-home")).toMatchObject({ available: true, arrival: "replay", changed: true });
      expect((await tuesday.exit("meltwater-home")).ok).toBe(true);
      await tuesday.lobby();
      await tuesday.begin();
      expect(await tuesday.state()).toMatchObject({ chapterId: "cr-exchange-flooded", journeyVisit: { node: "exchange", visit: 2 } });
      await tuesday.goto("scene_tied");
      expect((await h.attempt())!.journey).toMatchObject({
        node: "exchange",
        status: "choosing",
        flags: { flood_seen: true },
        chaptersCompleted: ["cr-exchange", "cr-glacier", "cr-exchange-flooded"],
      });

      // ---- Wednesday: a new room opens at the exit choice ----------------------
      const wednesday = await evening(h, ["starweaver", "duskrunner"]);
      expect((await wednesday.view())?.status).toBe("choosing");
      // The used-up rift is still drawn — and refused, with nothing written.
      expect(await exitOf(wednesday, "shelf-rift")).toMatchObject({ available: false, reason: "rift-consumed", rift: { status: "consumed" } });
      const before = (await h.attempt())!;
      const seq = (await wednesday.state()).seq;
      const refused = await wednesday.exit("shelf-rift");
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(await h.attempt()).toEqual(before);
      expect((await wednesday.state()).seq).toBe(seq);

      // The long road north instead; the glacier is a hub now (pass).
      expect(await exitOf(wednesday, "exchange-north")).toMatchObject({ available: true, arrival: "pass" });
      expect((await wednesday.exit("exchange-north")).ok).toBe(true);
      expect((await h.attempt())!.journey).toMatchObject({ node: "glacier", visit: 2, status: "choosing" });

      // Sideways to the Frostfang Peaks: studying the stars is the second attunement.
      expect((await wednesday.exit("glacier-to-peaks")).ok).toBe(true);
      await wednesday.lobby();
      await wednesday.begin();
      expect((await wednesday.state()).chapterId).toBe("cr-peaks");
      await wednesday.goto("scene_pattern");
      expect((await h.attempt())!.journey?.facts).toMatchObject({ attunement: 2 });
      expect((await wednesday.exit("peaks-to-glacier")).ok).toBe(true);
      expect(await exitOf(wednesday, "glacier-to-peaks")).toBeUndefined(); // closed now, and hidden

      // Attuned enough: the Starweaver's way, and only theirs (hum needs a Songkeeper and has no hint).
      expect((await wednesday.drawn()).map((a) => [a.action, a.way, a.unmet ?? false])).toEqual([["open", "attune", false]]);
      expect((await wednesday.act("open", "origin-seal", "attune")).ok).toBe(true);
      const attuned = (await h.attempt())!;
      expect(attuned.journey).toMatchObject({
        facts: { attunement: 3 },
        rifts: { "origin-seal": { status: "open" } },
        lastAction: { action: "open", edge: "origin-seal", way: "attune" },
      });
      expect(ids(attuned.journey?.buffs)).toEqual(["starlight-ward"]);

      // Into the heart: the Starlight Ward on every hero, and a wisp's swing has to beat Guard + 1.
      expect((await wednesday.exit("origin-seal")).ok).toBe(true);
      await wednesday.lobby();
      await wednesday.begin();
      expect((await wednesday.state()).chapterId).toBe("cr-heart");
      await wednesday.fight("fight_wisps");
      const heart = (await wednesday.state()).encounter!;
      const party = heart.combatants.filter((c) => c.side === "party");
      expect(heart.buffs?.map((b) => [b.id, b.kind, b.amount])).toEqual(party.map(() => ["starlight-ward", "guard", 1]));
      // Every hero here has the same Guard (base + Quick 1), so a wisp's target
      // number names the buff unambiguously: Guard + 1, never Guard.
      const guards = new Set(party.map((c) => c.guard));
      expect(guards.size).toBe(1);
      const wisps = new Set(heart.combatants.filter((c) => c.side !== "party").map((c) => c.id));
      const shown = await wednesday.play(swingAt(content), (r) => r.some((roll) => wisps.has(roll.characterId ?? "")));
      const wispRolls = shown.filter((roll) => wisps.has(roll.characterId ?? ""));
      expect(wispRolls.length).toBeGreaterThan(0);
      for (const roll of wispRolls) expect(guards.has(roll.tn - 1)).toBe(true);

      await wednesday.goto("scene_song");
      const done = (await h.attempt())!;
      expect(done).toMatchObject({ status: "complete", journey: { status: "ended", ending: "heart" } });
      expect(done.journey?.visits).toEqual({ exchange: 2, glacier: 3, peaks: 1, heart: 1 });
      expect((await wednesday.state()).campaign?.journey?.reachedEnding).toBeDefined();
    },
  );
});


// ---------------------------------------------------------------------------
// (b) A table without one
// ---------------------------------------------------------------------------

describe("the slice, played by a table with no Starweaver", () => {
  it(
    "is told what a Starweaver could do and refused it, frees the yeti reader in the fight, and the readers open the seal",
    { timeout: 60_000 },
    async () => {
      const h = await household(2);

      // ---- Monday ------------------------------------------------------------
      const monday = await evening(h, ["thornguard", "songkeeper"]);
      await monday.begin();
      await monday.goto("scene_tear");
      // The sense way is a hint to this table, never a button — and refused if sent anyway.
      expect((await monday.drawn()).map((a) => [a.way, a.unmet ?? false, a.hint])).toEqual([
        ["sense", true, "A Starweaver could feel where this tear goes."],
      ]);
      const before = (await h.attempt())!;
      const refused = await monday.act("discover", "shelf-rift", "sense");
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(refused.ok ? "" : refused.error?.message).toMatch(/needs a starweaver|nobody in this party can/i);
      expect(await h.attempt()).toEqual(before);

      // Sideways to the Whispering Marsh first: Marsh Mettle for the next fight.
      expect((await monday.exit("exchange-to-marsh")).ok).toBe(true);
      await monday.lobby();
      await monday.begin();
      expect((await monday.state()).chapterId).toBe("cr-marsh");
      await monday.goto("scene_mud");
      expect(ids((await h.attempt())!.journey?.buffs)).toEqual(["marsh-mettle"]);
      expect((await monday.exit("marsh-to-exchange")).ok).toBe(true);
      expect((await h.attempt())!.journey).toMatchObject({ node: "exchange", visit: 2, status: "choosing" });

      // Through the shelf rift without knowing where it goes.
      expect(await exitOf(monday, "shelf-rift")).toMatchObject({ hiddenDestination: true, to: "" });
      expect((await monday.exit("shelf-rift")).ok).toBe(true);
      expect(ids((await h.attempt())!.journey?.buffs)).toEqual(["marsh-mettle", "rift-spark"]);
      await monday.lobby();

      // ---- Tuesday: the glacier fight, played for the reader -------------------
      const tuesday = await evening(h, ["thornguard", "songkeeper"]);
      await tuesday.begin();
      expect(await tuesday.state()).toMatchObject({ chapterId: "cr-glacier", journeyVisit: { node: "glacier", visit: 1 } });
      await tuesday.fight("fight_shelf");
      const board = (await tuesday.state()).encounter!;
      const party = board.combatants.filter((c) => c.side === "party");
      expect(board.buffs?.map((b) => [b.id, b.kind, b.amount]).sort()).toEqual(
        party.flatMap(() => [["marsh-mettle", "guard", 1], ["rift-spark", "roll", 1]]).sort(),
      );
      await tuesday.dropAndRejoin(0);
      const guards = new Set(party.map((c) => c.guard));
      expect(guards.size).toBe(1);
      const wisps = new Set(board.combatants.filter((c) => c.side !== "party").map((c) => c.id));
      const rolls = await tuesday.play(forTheCrack);
      // Any swing a wisp took had to beat the Marsh Mettle as well.
      for (const roll of rolls.filter((r) => wisps.has(r.characterId ?? ""))) expect(guards.has(roll.tn - 1)).toBe(true);

      // Freed and through: a real escape, the reader's rescue effect, the objective.
      const out = await tuesday.state();
      expect(out.phase).toBe("chapter_complete");
      expect(out.sceneId).toBe("scene_through");
      expect(out.flags.reader_freed).toBe(true);
      const after = (await h.attempt())!;
      expect(after.journey).toMatchObject({
        node: "glacier",
        status: "choosing",
        outcomes: { glacier: "success" },
        flags: { reader_freed: true },
        facts: { "great-river": "surging", "yeti-readers": "friends" },
      });
      // Both buffs were the fight's: Marsh Mettle's one fight and the Rift Spark's.
      expect(after.journey).not.toHaveProperty("buffs");

      // ---- Wednesday: the readers open the seal --------------------------------
      const wednesday = await evening(h, ["thornguard", "songkeeper"]);
      expect((await wednesday.view())).toMatchObject({ node: "glacier", status: "choosing" });
      // No attunement, no Starweaver: nothing of theirs is drawn. The Songkeeper's
      // song and the readers' favour are this table's ways.
      expect((await wednesday.drawn()).map((a) => [a.way, a.unmet ?? false])).toEqual([
        ["hum", false],
        ["readers", false],
      ]);
      expect((await wednesday.act("open", "origin-seal", "attune")).ok).toBe(false);
      expect((await wednesday.act("open", "origin-seal", "readers")).ok).toBe(true);
      expect((await h.attempt())!.journey).toMatchObject({
        rifts: { "origin-seal": { status: "open" } },
        lastAction: { action: "open", edge: "origin-seal", way: "readers" },
      });
      expect((await h.attempt())!.journey?.facts).not.toHaveProperty("attunement");
      expect((await wednesday.exit("origin-seal")).ok).toBe(true);
      await wednesday.lobby();
      await wednesday.begin();
      expect((await wednesday.state()).chapterId).toBe("cr-heart");
      expect((await wednesday.state()).buffs ?? []).toEqual([]);
      await wednesday.goto("scene_song");
      expect(await h.attempt()).toMatchObject({ status: "complete", journey: { status: "ended", ending: "heart" } });
    },
  );

  it("a table that opens nothing still gets home: down the flooded river to the other ending", { timeout: 60_000 }, async () => {
    const h = await household(1);
    const t = await evening(h, ["duskrunner"]);
    await t.begin();
    await t.goto("scene_tear");
    // The Starweaver's way is a hint on this phone (words, never a button).
    expect((await t.drawn()).map((a) => [a.way, a.unmet])).toEqual([["sense", true]]);
    expect((await t.exit("shelf-rift")).ok).toBe(true);
    await t.lobby();
    await t.begin();
    // The shelf breaks away: a setback, the reader lost — and the river wakes anyway.
    await t.goto("scene_collapse");
    expect(await h.attempt()).toMatchObject({ setbacks: 1, journey: { outcomes: { glacier: "setback" }, facts: { "great-river": "surging" } } });
    // Nobody here can hum, and the readers are strangers: nothing to try at the seal.
    expect(await t.drawn()).toEqual([]);
    expect((await t.exit("meltwater-home")).ok).toBe(true);
    await t.lobby();
    await t.begin();
    expect((await t.state()).chapterId).toBe("cr-exchange-flooded");
    await t.goto("scene_tied");
    expect((await t.exit("exchange-to-delta")).ok).toBe(true);
    await t.lobby();
    await t.begin();
    expect((await t.state()).chapterId).toBe("cr-delta");
    await t.goto("scene_home");
    expect(await h.attempt()).toMatchObject({ status: "complete", setbacks: 1, journey: { status: "ended", ending: "delta" } });
  });
});

// ---------------------------------------------------------------------------
// Not shipped
// ---------------------------------------------------------------------------

describe("the slice does not ship", () => {
  it("the shipping content store has no such campaign, chapter or board", async () => {
    const shipped = await loadContent(path.join(ROOT, "content"));
    expect(shipped.campaign(CAMPAIGN_ID)).toBeNull();
    expect(shipped.graph(CAMPAIGN_ID)).toBeNull();
    const slice = await sliceContent;
    for (const id of slice.campaign(CAMPAIGN_ID)!.chapters) expect(shipped.chapter(id)).toBeNull();
    expect(shipped.map("cr_ice_shelf")).toBeNull();
  });
});
