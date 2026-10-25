/**
 * The practice (#255, architecture §4.5 "The practice"), through the real
 * server and the shipped content: who may start it, that it claims nobody and
 * keeps nothing, that it marks every seated hero `practiced`, and that a
 * party following its hints, and only its hints, gets from the gate to the
 * picnic with every fight played out on the board.
 */

import path from "node:path";
import {
  HELP_UP_ID,
  PRACTICE_CAMPAIGN_ID,
  applyIntent,
  captiveStatuses,
  createRunState,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  makeRng,
  positionOf,
  type ClientIntent,
  type EncounterState,
  type Position,
  type RunState,
} from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { deleteProfile } from "./organizer.ts";
import { createRoom, joinRoom } from "./room.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";
const PRACTICE = "first-steps-01";
const DAY = 24 * 60 * 60 * 1000;

async function household(players: number, seed = "practice") {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`${seed}:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, players);
  return { harness, ...seeded };
}

type Household = Awaited<ReturnType<typeof household>>;

/** A new Gemfall room with every player joined, each seat a phone. */
async function table(h: Household) {
  h.harness.clock.advance(DAY);
  const created = await createRoom({ householdId: h.householdId, mode: "party", campaignId: GEMFALL }, h.harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const playerIds: string[] = [];
  for (const player of h.players) {
    const joined = await joinRoom({ code, principal: player.principal }, h.harness.deps);
    if (!joined.ok) throw new Error("join");
    playerIds.push(joined.value.playerId);
  }
  const state = async (): Promise<RunState> => (await h.harness.repo.getState(runId))!;
  const send = async (playerId: string, intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, h.harness.deps);
  const must = async (playerId: string, intent: ClientIntent) => {
    const response = await send(playerId, intent);
    if (!response.ok) {
      const s = await state();
      throw new Error(`${intent.type} refused in ${s.chapterId}/${s.sceneId}: ${JSON.stringify(response.error)}`);
    }
    return response;
  };
  const readyAll = async () => {
    for (const playerId of playerIds) await must(playerId, { type: "READY", ready: true });
  };
  return { runId, playerIds, state, send, must, readyAll };
}

type Table = Awaited<ReturnType<typeof table>>;

async function create(t: Table, seat: number, name: string) {
  await t.must(t.playerIds[seat]!, {
    type: "CREATE_CHARACTER",
    name,
    species: (["unicorn", "dragonling", "griffin", "bigfoot"] as const)[seat]!,
    class: (["thornguard", "duskrunner", "starweaver", "songkeeper"] as const)[seat]!,
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  });
}

/** The ending of whatever chapter the room is in (the practice has one). */
function ending(chapterId: string): string {
  const chapter = content.chapter(chapterId)!;
  return Object.entries(chapter.scenes).find(
    ([, scene]) => "choices" in scene && scene.choices.length === 0 && !("outcome" in scene && scene.outcome === "setback"),
  )![0];
}

const distance = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Where the hint in this fight says to go: the garden gate, or Bun and then
 * the path home. Null in the fight whose hint says to use a card.
 */
function goals(encounter: EncounterState): Position[] | null {
  const env = encounter.environment;
  if (!env) return null;
  const waiting = captiveStatuses(env).includes("waiting");
  const rescue = env.spec.rescue;
  if (waiting && rescue && !Array.isArray(rescue)) {
    const at = (rescue as { at: Position }).at;
    const around: Position[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) around.push({ x: at.x + dx, y: at.y + dy });
    return around;
  }
  return (env.spec.exits ?? []).flatMap((exit) => exit.tiles);
}

/**
 * Plays the room's chapter the way its hints say to, picking choice
 * `pick(options)` everywhere: walk to the gold squares the hint names, tag a
 * wisp when the hint says to use a card, help Bun up. Returns the finished run
 * and everything the table was read on the way.
 */
async function followHints(t: Table, pick: (ids: string[]) => string) {
  const said: string[] = [];
  // Every Help Up that landed: [who was down at the start of the fight, who was lifted].
  const helpedUp: { downAtStart: string[]; lifted: string }[] = [];
  let downAtStart: string[] = [];
  let fight: number | undefined;
  for (let step = 0; step < 2000; step++) {
    const s = await t.state();
    if (s.narration !== said.at(-1)) said.push(s.narration);
    if (s.phase === "chapter_complete") return { ...s, said: said.join("\n"), helpedUp };
    const ownerOf = (characterId: string) => s.party.find((m) => m.character.id === characterId)!.playerId;
    const prompt = s.prompt;
    // Optional meadow games are real interactions, rather than ordinary
    // scenes that ADVANCE can skip. The hint walk takes their untimed route.
    if (prompt?.kind === "interaction") {
      const playerId = s.party.find((member) => member.connected)?.playerId ?? t.playerIds[0]!;
      await t.must(playerId, { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt,
        ...(prompt.phase === "result" ? { action: "continue" as const } : { action: "assist" as const }) });
      continue;
    }
    if (prompt?.kind === "ready") {
      for (const playerId of prompt.forPlayerIds) await t.send(playerId, { type: "READY", ready: true });
      continue;
    }
    if (prompt?.kind === "roll") {
      await t.must(ownerOf(prompt.characterId), { type: "ROLL" });
      continue;
    }
    if (prompt?.kind === "choice") {
      const choiceId = pick(prompt.options.map((o) => o.id));
      const voters = prompt.forPlayerIds.length > 0 ? prompt.forPlayerIds : t.playerIds;
      for (const playerId of prompt.vote ? voters : voters.slice(0, 1)) {
        const now = await t.state();
        if (now.prompt?.kind !== "choice" || now.sceneId !== prompt.sceneId) break;
        await t.must(playerId, { type: "CHOOSE", choiceId });
      }
      continue;
    }
    const encounter = s.encounter;
    if (s.phase === "encounter" && encounter) {
      const actorId = currentActorId(encounter);
      const holder = encounter.combatants.find((c) => c.id === actorId);
      const actor = currentActor(encounter);
      if (holder && holder.side === "party" && !actor) {
        await t.must(ownerOf(holder.id), { type: "END_TURN" });
        continue;
      }
      if (!actor || actor.side !== "party") {
        await t.must(t.playerIds[0]!, { type: "ADVANCE" });
        continue;
      }
      const playerId = ownerOf(actor.id);
      if (encounter.startedAt !== fight) {
        // A new fight: who walked onto the board already down.
        fight = encounter.startedAt;
        downAtStart = encounter.combatants.filter((c) => c.side === "party" && c.down).map((c) => c.id);
      }
      // "When a friend is knocked down, stand next to them and tap Help Up."
      const fallen = encounter.combatants.filter((c) => c.side === "party" && c.down && c.id !== actor.id);
      if (fallen.length > 0 && !encounter.actionTaken) {
        const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("legal") };
        const helpUp = legalActions(encounter, ctx).find((a) => a.abilityId === HELP_UP_ID);
        if (helpUp) {
          const lifted = helpUp.targets[0]!;
          await t.must(playerId, { type: "COMBAT_ACTION", abilityId: HELP_UP_ID, targetId: lifted });
          const after = (await t.state()).encounter!;
          expect(after.combatants.find((c) => c.id === lifted)!.down).toBe(false);
          helpedUp.push({ downAtStart, lifted });
          continue;
        }
      }
      const targets = fallen.length > 0 ? fallen.map((c) => positionOf(encounter, c.id)!) : goals(encounter);
      if (targets === null && !encounter.actionTaken) {
        // "Tap Attack, then tap a wisp."
        const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("legal") };
        const wisps = encounter.combatants.filter((c) => c.side === "enemy" && !c.down).map((c) => c.id);
        const attack = legalActions(encounter, ctx).find((a) => a.abilityId === "attack" && a.targets.some((id) => wisps.includes(id)));
        if (attack) {
          const response = await t.send(playerId, {
            type: "COMBAT_ACTION",
            abilityId: attack.abilityId,
            targetId: attack.targets.find((id) => wisps.includes(id))!,
          });
          if (response.ok) continue;
        }
      }
      const here = positionOf(encounter, actor.id)!;
      const aim = targets ?? encounter.combatants.filter((c) => c.side === "enemy" && !c.down).map((c) => positionOf(encounter, c.id)!);
      const far = (p: Position) => Math.min(...aim.map((g) => distance(p, g)));
      const moves = legalMoves(encounter);
      if (encounter.stepsLeft > 0 && moves.length > 0 && far(here) > 0) {
        const best = [...moves].sort((a, b) => far(a) - far(b))[0]!;
        if (far(best) < far(here)) {
          await t.must(playerId, { type: "MOVE", to: { x: best.x, y: best.y } });
          continue;
        }
      }
      await t.must(playerId, { type: "END_TURN" });
      continue;
    }
    await t.must(t.playerIds[0]!, { type: "ADVANCE" });
  }
  throw new Error(`stuck in ${(await t.state()).sceneId}`);
}

describe("the practice (#255)", () => {
  it("is ready to play, and plays a newcomer's party from the gate to the picnic by its hints alone", async () => {
    for (const [players, seed] of [[1, "solo"], [2, "pair"], [3, "three"]] as const) {
      const h = await household(players, seed);
      const t = await table(h);
      for (let seat = 0; seat < players; seat++) await create(t, seat, `Hero ${seat + 1}`);
      await t.readyAll();
      await t.must(t.playerIds[0]!, { type: "START_PRACTICE" });
      const opened = await t.state();
      expect(opened.chapterId).toBe(PRACTICE);
      expect(opened.campaignId).toBe(PRACTICE_CAMPAIGN_ID);
      // The lobby's offer is untouched: the room still offers Gemfall after.
      expect(opened.campaign?.id).toBe(GEMFALL);

      // Take the other option each time one is offered, so both kinds of
      // result scene get walked between the two parties.
      let turn = players;
      const walked = await followHints(t, (ids) => ids[turn++ % ids.length]!);
      const visited = walked.visited ?? [];
      for (const step of ["scene_meadow_gate", "scene_tansy", "encounter_stones", "encounter_tag", "encounter_bun", "rest_picnic", "rest_ready"]) {
        expect(visited, `${players}: ${step}`).toContain(step);
      }
      // The gate was walked to, and the wisps tagged with a card.
      expect(walked.said, `${players}`).toMatch(/You step through the garden gate/);
      expect(walked.said, `${players}`).toMatch(/Tag, and tag! Flick spins/);
      // Bun was helped up by somebody ending a turn beside her.
      expect(walked.flags["helped_bun"], `${players}`).toBe(true);
      // And with friends at the table, one of them started the Bun fight on
      // the ground and was lifted with the real Help Up card. Alone, nobody
      // was knocked down: there was nobody to help.
      if (players === 1) {
        expect(walked.helpedUp).toEqual([]);
      } else {
        expect(walked.helpedUp.length, `${players}`).toBeGreaterThan(0);
        const [first] = walked.helpedUp;
        expect(first!.downAtStart).toHaveLength(1);
        expect(first!.lifted).toBe(first!.downAtStart[0]);
      }
      expect(walked.xpEarned).toBe(0);
    }
  });

  it("claims nobody, keeps nothing, and marks every seated hero practiced", async () => {
    const h = await household(2);
    const t = await table(h);
    await create(t, 0, "Pip");
    await create(t, 1, "Rue");
    await t.readyAll();
    const before = await h.harness.repo.listCharacters(h.householdId);
    await t.must(t.playerIds[0]!, { type: "START_PRACTICE" });

    // No attempt, no claim: the rows are as they were.
    expect(await h.harness.repo.getCampaignProgress(h.householdId, PRACTICE_CAMPAIGN_ID)).toBeNull();
    expect(await h.harness.repo.listCharacters(h.householdId)).toEqual(before);

    await t.must(t.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: ending(PRACTICE) });
    const done = await t.state();
    expect(done.phase).toBe("chapter_complete");
    expect(done.party.every((member) => member.character.practiced === true)).toBe(true);
    for (const hero of await h.harness.repo.listCharacters(h.householdId)) {
      const was = before.find((b) => b.id === hero.id)!;
      expect(hero.practiced).toBe(true);
      // Nothing else moved: no XP, no level, no bag, no claim, no record.
      expect(hero.committed).toEqual(was.committed);
      expect(hero.provisional ?? null).toBeNull();
      expect(hero.finished).toBeUndefined();
    }
    expect(await h.harness.repo.getCampaignProgress(h.householdId, PRACTICE_CAMPAIGN_ID)).toBeNull();

    // Back in the lobby, it is not offered again: everybody has played it.
    await t.must(t.playerIds[0]!, { type: "ADVANCE" });
    await t.readyAll();
    const seq = (await t.state()).seq;
    const again = await t.send(t.playerIds[0]!, { type: "START_PRACTICE" });
    expect(again.ok).toBe(false);
    expect(again.error?.code).toBe("ILLEGAL");
    expect((await t.state()).seq).toBe(seq);

    // And the real adventure starts as it always did.
    await t.must(t.playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect((await t.state()).chapterId).toBe("gemfall-01");
  });

  it("lets a hero halfway through Gemfall sit in with a newcomer, and leaves her Gemfall alone", async () => {
    const h = await household(2);
    // Pip plays Gemfall's first chapter alone.
    const first = await table(h);
    await create(first, 0, "Pip");
    await first.must(first.playerIds[0]!, { type: "READY", ready: true });
    await first.must(first.playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    await first.must(first.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: ending("gemfall-01") });
    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    expect(pip!.provisional?.runId).toBe(GEMFALL);

    // The next evening Rue is new. Pip brings her hero; Rue makes one.
    const t = await table(h);
    await t.must(t.playerIds[0]!, { type: "SEAT_CHARACTER", characterId: pip!.id });
    await create(t, 1, "Rue");
    await t.readyAll();
    await t.must(t.playerIds[0]!, { type: "START_PRACTICE" });
    expect((await t.state()).chapterId).toBe(PRACTICE);
    await t.must(t.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: ending(PRACTICE) });

    const after = (await h.harness.repo.getCharacter(h.householdId, pip!.id))!;
    expect(after.practiced).toBe(true);
    expect(after.provisional).toEqual(pip!.provisional);
    expect(after.committed).toEqual(pip!.committed);
    const attempt = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL);
    expect(attempt?.lastIndex).toBe(1);

    // Gemfall carries on at chapter 2, with both of them.
    await t.must(t.playerIds[0]!, { type: "ADVANCE" });
    await t.readyAll();
    await t.must(t.playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect(content.chapter((await t.state()).chapterId!)!.index).toBe(2);
  });

  it("is refused to a table of veterans, and skipping it is simply starting the adventure", async () => {
    const h = await household(1);
    const t = await table(h);
    await create(t, 0, "Pip");
    await t.must(t.playerIds[0]!, { type: "READY", ready: true });
    // Skipped: Begin plays Gemfall, and from then on she is no newcomer.
    await t.must(t.playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    await t.must(t.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: ending("gemfall-01") });
    await t.must(t.playerIds[0]!, { type: "ADVANCE" });
    await t.must(t.playerIds[0]!, { type: "READY", ready: true });
    const seq = (await t.state()).seq;
    const refused = await t.send(t.playerIds[0]!, { type: "START_PRACTICE" });
    expect(refused.ok).toBe(false);
    expect(refused.error).toEqual({
      code: "ILLEGAL",
      message: "everybody here has played already, so there is no practice to play",
    });
    expect((await t.state()).seq).toBe(seq);
    // Starting its chapter directly is the same question, with the same answer.
    const direct = await t.send(t.playerIds[0]!, { type: "START_CHAPTER", chapterId: PRACTICE });
    expect(direct.ok).toBe(false);
  });

  it("keeps its mark only on her hero, so deleting her deletes it", async () => {
    const h = await household(1);
    await h.harness.repo.putAccountPointer("sub-owner", h.householdId);
    const t = await table(h);
    await create(t, 0, "Pip");
    await t.must(t.playerIds[0]!, { type: "READY", ready: true });
    await t.must(t.playerIds[0]!, { type: "START_PRACTICE" });
    await t.must(t.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: ending(PRACTICE) });
    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    expect(pip!.practiced).toBe(true);

    const deleted = await deleteProfile(
      { cognitoSub: "sub-owner", householdId: h.householdId, playerId: t.playerIds[0]! },
      h.harness.deps,
    );
    expect(deleted.ok).toBe(true);
    expect(await h.harness.repo.getCharacter(h.householdId, pip!.id)).toBeNull();
  });

  it("spends no stat point at its rest", async () => {
    const h = await household(1);
    const t = await table(h);
    await create(t, 0, "Pip");
    await t.must(t.playerIds[0]!, { type: "READY", ready: true });
    await t.must(t.playerIds[0]!, { type: "START_PRACTICE" });
    await t.must(t.playerIds[0]!, { type: "PLAYTEST_GOTO", sceneId: "rest_picnic" });
    const spent = await t.send(t.playerIds[0]!, { type: "SPEND_STAT_POINT", stat: "might" });
    expect(spent.ok).toBe(false);
    expect(spent.error?.message).toMatch(/real chapter/);
  });
});
