/**
 * Gemfall, played — every chapter, start to finish, through the real server.
 *
 * `content:validate` proves each chapter is a sound graph and the wiring test
 * proves each one sets the forks it owes. Neither proves the campaign is
 * *playable*: that a party who started chapter 1 on a Tuesday can keep tapping
 * "Begin the adventure" and arrive, eight evenings later, at an ending — with
 * the road they took and the pursuit they declared steering them into the
 * right files on the way, through every fight, without the engine refusing a
 * tap or stranding them at a beat with nothing to start.
 *
 * So this plays it. A three-player party drives `applyAction` exactly as the
 * phones do — votes, rolls, item swaps, combat turns through `legalActions` —
 * and continues the campaign with CONTINUE_CAMPAIGN after each chapter. Choices
 * are random under a seed, and the party's species change per seed so the
 * species gates get walked too. Every run must end the campaign: completed, or
 * failed by setbacks. Never stuck.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  applyIntent,
  createRunState,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  makeRng,
  positionOf,
  type ClassId,
  type ClientIntent,
  type RunState,
  type SpeciesId,
} from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { loadContent } from "../content/loader.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };

const SPECIES: SpeciesId[] = ["unicorn", "dragonling", "griffin", "kitsune", "manticore", "bigfoot"];
const CLASSES: ClassId[] = ["thornguard", "duskrunner", "starweaver", "songkeeper"];

interface Playthrough {
  status: string;
  chapters: string[];
  outcomes: string[];
  routeFlags: Record<string, boolean>;
}

async function playCampaign(seed: number): Promise<Playthrough> {
  const rng = makeRng(`gemfall-playthrough-${seed}`);
  const random = () => rng.next();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const harness = makeHarness({ engine: realEngine, content });
  const { householdId, players } = await seedHousehold(harness, 3);
  const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  for (const player of players) {
    const joined = await joinRoom({ code, principal: player.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
  }
  const playerIds = players.map((p) => p.principal.playerId);

  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (playerId: string, intent: ClientIntent) => {
    const seq = (await state()).seq;
    return applyAction({ runId, playerId, seq, intent }, harness.deps);
  };
  const must = async (playerId: string, intent: ClientIntent) => {
    const response = await send(playerId, intent);
    if (!response.ok) {
      const s = await state();
      const enc = s.encounter;
      const debug = enc
        ? ` actor=${currentActorId(enc)} ${JSON.stringify(enc.combatants.map((c) => [c.id, c.side, c.hp, c.down]))} prompt=${JSON.stringify(s.prompt)} phase=${s.phase}`
        : "";
      throw new Error(
        `seed ${seed}: ${intent.type} refused in ${s.chapterId}/${s.sceneId}: ${JSON.stringify(response.error)}${debug}`,
      );
    }
  };
  const ownerOf = (s: RunState, characterId: string) =>
    s.party.find((m) => m.character.id === characterId)?.playerId ?? playerIds[0]!;

  // Three different species each seed, so species-gated choices get walked.
  const species = [...SPECIES].sort(() => random() - 0.5).slice(0, 3);
  for (const [i, playerId] of playerIds.entries()) {
    await must(playerId, {
      type: "CREATE_CHARACTER",
      name: `Hero ${i + 1}`,
      species: species[i]!,
      class: pick(CLASSES),
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
    } as ClientIntent);
  }

  const chapters: string[] = [];
  const outcomes: string[] = [];

  for (let evening = 0; evening < 12; evening++) {
    for (const playerId of playerIds) await must(playerId, { type: "READY", ready: true });
    await must(playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: "gemfall" });
    chapters.push((await state()).chapterId!);

    // One chapter. Bounded, so a loop in the content fails the test rather
    // than hanging it.
    for (let step = 0; ; step++) {
      if (step > 3000) throw new Error(`seed ${seed}: stuck in ${(await state()).chapterId}/${(await state()).sceneId}`);
      const s = await state();
      if (s.phase === "chapter_complete") break;

      const prompt = s.prompt;
      if (prompt?.kind === "item_swap") {
        await must(ownerOf(s, prompt.characterId), { type: "RESOLVE_ITEM_SWAP", dropItemId: null });
        continue;
      }
      if (prompt?.kind === "ready") {
        // Every phone readies up before the board goes up.
        for (const playerId of prompt.forPlayerIds) {
          const now = await state();
          if (now.prompt?.kind !== "ready") break;
          const me = now.party.find((m) => m.playerId === playerId);
          if (me?.ready) await must(playerId, { type: "READY", ready: false });
          await must(playerId, { type: "READY", ready: true });
        }
        continue;
      }
      if (prompt?.kind === "roll") {
        await must(ownerOf(s, prompt.characterId), { type: "ROLL" });
        continue;
      }
      if (prompt?.kind === "choice") {
        const choiceId = pick(prompt.options).id;
        const voters = prompt.forPlayerIds.length ? prompt.forPlayerIds : playerIds;
        if (prompt.vote) {
          // Everybody votes the same way; a split vote is the engine's
          // business and is tested elsewhere.
          for (const playerId of voters) {
            const now = await state();
            if (now.prompt?.kind !== "choice" || now.sceneId !== prompt.sceneId) break;
            await must(playerId, { type: "CHOOSE", choiceId });
          }
        } else {
          await must(voters[0]!, { type: "CHOOSE", choiceId });
        }
        continue;
      }

      const encounter = s.encounter;
      if (s.phase === "encounter" && encounter) {
        const actorId = currentActorId(encounter);
        const holder = encounter.combatants.find((c) => c.id === actorId);
        if (holder && holder.side === "party" && !currentActor(encounter)) {
          // A hero on the floor still has a turn to hand on.
          await must(ownerOf(s, holder.id), { type: "END_TURN" });
          continue;
        }
        const actor = currentActor(encounter);
        if (!actor || actor.side !== "party") {
          // The fight is over and waiting to be cleared, or it is the
          // monsters' move — ADVANCE settles the first; the engine runs the
          // second on its own after END_TURN.
          await must(playerIds[0]!, { type: "ADVANCE" });
          continue;
        }
        const playerId = ownerOf(s, actor.id);
        const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("legal-actions") };
        const enemies = encounter.combatants.filter((c) => c.side !== "party" && !c.down).map((c) => c.id);

        const attack = legalActions(encounter, ctx).find((a) => a.targets.some((t) => enemies.includes(t)));
        if (attack && !encounter.actionTaken) {
          const targetId = attack.targets.find((t) => enemies.includes(t))!;
          const response = await send(playerId, { type: "COMBAT_ACTION", abilityId: attack.abilityId, targetId });
          if (response.ok) continue;
        }
        // Walk toward the nearest standing enemy, then end the turn.
        const moves = legalMoves(encounter);
        const goals = enemies.map((id) => positionOf(encounter, id)).filter((p) => p !== null);
        if (moves.length && goals.length && encounter.stepsLeft > 0 && !encounter.actionTaken) {
          const distance = (t: { x: number; y: number }) =>
            Math.min(...goals.map((g) => Math.abs(g.x - t.x) + Math.abs(g.y - t.y)));
          const here = positionOf(encounter, actor.id)!;
          const best = [...moves].sort((a, b) => distance(a) - distance(b))[0]!;
          if (distance(best) < distance(here)) {
            await must(playerId, { type: "MOVE", to: { x: best.x, y: best.y } });
            continue;
          }
        }
        await must(playerId, { type: "END_TURN" });
        continue;
      }

      await must(playerIds[0]!, { type: "ADVANCE" });
    }

    const done = await state();
    outcomes.push(done.chapterOutcome ?? "success");
    const attempt = await harness.repo.getCampaignProgress(householdId, "gemfall");
    if (attempt && attempt.status !== "active") {
      return { status: attempt.status, chapters, outcomes, routeFlags: attempt.routeFlags ?? {} };
    }
    // The completion screen's button: back to the lobby for next evening.
    await must(playerIds[0]!, { type: "ADVANCE" });
  }
  throw new Error(`seed ${seed}: twelve evenings and the campaign never ended`);
}

describe("Gemfall can be played from the Exchange to the mountain", () => {
  const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
  const runs: Playthrough[] = [];

  for (const seed of SEEDS) {
    it(`seed ${seed} reaches an ending of the campaign`, { timeout: 60_000 }, async () => {
      const run = await playCampaign(seed);
      runs.push(run);
      expect(["complete", "failed"]).toContain(run.status);
      if (run.status === "complete") {
        // A finished campaign toured one chapter per beat, in order — all
        // eight, or seven when the Collection took the Walk at the tree line.
        expect(run.chapters[0]).toBe("gemfall-01");
        const last = run.chapters[run.chapters.length - 1];
        if (run.chapters.length === 7) expect(last).toBe("gemfall-07h");
        else expect(run.chapters, "a campaign of eight beats").toHaveLength(8);
        if (run.chapters.length === 8) expect(last).toBe("gemfall-08");
      }
    });
  }

  it("between them, the runs took every road and every pursuit", () => {
    const visited = new Set(runs.flatMap((r) => r.chapters));
    for (const id of ["gemfall-03a", "gemfall-03b", "gemfall-03c", "gemfall-07r", "gemfall-07h", "gemfall-07l"]) {
      expect(visited, `no run entered ${id}`).toContain(id);
    }
    // And at least one Collection party took the Walk and finished there.
    expect(runs.some((r) => r.status === "complete" && r.chapters.length === 7)).toBe(true);
  });
});
