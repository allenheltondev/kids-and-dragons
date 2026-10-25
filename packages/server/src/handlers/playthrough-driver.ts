/**
 * The Gemfall playthrough driver — a party that plays the campaign through the
 * real server, the way the phones would, plus the steering that makes a party
 * *a particular kind of party* (#166).
 *
 * `playCampaign(content, seed, plan)` is what `gemfall-playthrough.test.ts`
 * runs. A `PartyPlan` says who is at the table and how they choose:
 *
 *  - `size` / `species`   — a solo party, a pinned dragonling, …
 *  - `steer` / `avoid`    — choice ids always taken / never taken when another
 *                           is offered (`"gemfall-07h/walk"` pins a chapter)
 *  - `facets`             — `"collect"` takes every facet a path offers,
 *                           `"avoid"` refuses them (see `facetReach`)
 *  - `beforeEvening`      — household surgery between chapters (strip or seed
 *                           facets); runs at the lobby, before anyone readies
 *
 * Everything shown is recorded in `Playthrough.lines` (see narration-audit.ts).
 * Choices not decided by the plan are random under the seed; dice are keyed to
 * the seed, so a run is repeatable.
 */

import {
  applyIntent,
  chapterDiscoveries,
  chapterStartDiscoveries,
  partyClassDiscoveries,
  classPlaceWaitingOn,
  createRunState,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  keepClassIntent,
  interactionActor,
  makeRng,
  positionOf,
  sceneChoices,
  sceneDiscoveries,
  type Chapter,
  type ChoiceParty,
  type ClassId,
  type ClientIntent,
  type Effect,
  type RunState,
  type Scene,
  type SpeciesId,
} from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import type { ContentStore } from "../content/loader.ts";
import type { GameRepository } from "../store/repository.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import type { AuditLine } from "./narration-audit.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

const SPECIES: SpeciesId[] = ["unicorn", "dragonling", "griffin", "kitsune", "manticore", "bigfoot"];
const CLASSES: ClassId[] = ["thornguard", "duskrunner", "starweaver", "songkeeper"];

export const isFacet = (id: string) => id.startsWith("facet_");

// --- steering -----------------------------------------------------------------

export interface EveningContext {
  /** 0-based: evening 7 is the eighth beat, `gemfall-08`, when the road is whole. */
  evening: number;
  repo: GameRepository;
  householdId: string;
  /** The facet item ids this campaign has (`facet_*` in items.json), keystone last. */
  facetIds: readonly string[];
}

export interface PartyPlan {
  label: string;
  /** Players at the table (default 3). */
  size?: number;
  /** Species for the first seats; the rest are random. */
  species?: readonly SpeciesId[];
  /** Choice ids always taken when offered; `"chapter/id"` pins one chapter. */
  steer?: readonly string[];
  /** Choice ids never taken when something else is offered. */
  avoid?: readonly string[];
  /** Take every facet a path offers ("collect"), or refuse them ("avoid"). */
  facets?: "collect" | "avoid";
  /**
   * Runs at the lobby before each chapter's party readies. Returns how many
   * facets it added to the household, if any (reported as `Playthrough.topUps`).
   */
  beforeEvening?: (ctx: EveningContext) => Promise<number | void>;
}

const matches = (list: readonly string[] | undefined, chapterId: string, id: string) =>
  !!list && (list.includes(id) || list.includes(`${chapterId}/${id}`));

const facetGain = (effects: readonly Effect[] | undefined) =>
  (effects ?? []).filter((e) => e.type === "grantQuestItem" && isFacet(e.itemId)).length;

interface Arm {
  to: string;
  gain: number;
}

/** A scene's exits: each choice if the party decides, each branch if the dice do. */
function armsOf(scene: Scene): { arms: Arm[]; decided: boolean } {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return { arms: scene.choices.map((c) => ({ to: c.goto, gain: facetGain(c.effects) })), decided: true };
    case "interaction":
      return { arms: [scene.onSuccess, scene.onFailure, scene.onAssisted]
        .filter((branch): branch is NonNullable<typeof branch> => branch !== undefined)
        .map((branch) => ({ to: branch.goto, gain: facetGain(branch.effects) })), decided: false };
    case "check":
      return {
        arms: [scene.onSuccess, scene.onFailure].map((b) => ({ to: b.goto, gain: facetGain(b.effects) })),
        decided: false,
      };
    case "encounter":
      return {
        arms: [scene.onVictory, scene.onDefeat, scene.onEscape, scene.onTimeout]
          .filter((b): b is NonNullable<typeof b> => b !== undefined)
          .map((b) => ({ to: b.goto, gain: facetGain(b.effects) })),
        decided: false,
      };
    default:
      return { arms: [], decided: false };
  }
}

/**
 * How many facets are still to come from each scene to the end of its chapter,
 * if every choice goes the way `mode` wants. `collect` assumes the best (most)
 * and `avoid` the least; the dice, which the party does not decide, are taken
 * in the party's favour either way. A scene's own `onEnter` grants cannot be
 * steered around and count in both. Bounded relaxation, so a loop in the
 * content (a retry) settles rather than spins.
 */
export function facetReach(chapter: Chapter, mode: "collect" | "avoid"): Map<string, number> {
  const best = mode === "collect" ? Math.max : Math.min;
  const reach = new Map<string, number>(Object.keys(chapter.scenes).map((id) => [id, 0]));
  for (let round = 0; round < 60; round++) {
    let changed = false;
    for (const [id, scene] of Object.entries(chapter.scenes)) {
      const { arms } = armsOf(scene);
      const onEnter = "onEnter" in scene ? facetGain(scene.onEnter) : 0;
      const value =
        onEnter + (arms.length ? best(...arms.map((a) => a.gain + (reach.get(a.to) ?? 0))) : 0);
      if (value !== reach.get(id)) {
        reach.set(id, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return reach;
}

// --- household surgery ----------------------------------------------------------

export async function householdFacets(repo: GameRepository, householdId: string): Promise<Set<string>> {
  const held = new Set<string>();
  for (const c of await repo.listCharacters(householdId)) for (const id of c.questItems) if (isFacet(id)) held.add(id);
  return held;
}

/** Takes every facet out of the household's characters. */
export async function stripFacets(repo: GameRepository, householdId: string): Promise<void> {
  for (const c of await repo.listCharacters(householdId)) {
    if (c.questItems.some(isFacet)) await repo.putCharacter({ ...c, questItems: c.questItems.filter((id) => !isFacet(id)) });
  }
}

/** Tops the household up to `count` distinct facets (on the first character); returns how many were added. */
export async function topUpFacets(
  repo: GameRepository,
  householdId: string,
  facetIds: readonly string[],
  count: number,
): Promise<number> {
  const held = await householdFacets(repo, householdId);
  const missing = facetIds.filter((id) => !held.has(id));
  const add = missing.slice(0, Math.max(0, count - held.size));
  const [first] = await repo.listCharacters(householdId);
  if (first && add.length) await repo.putCharacter({ ...first, questItems: [...first.questItems, ...add] });
  return add.length;
}

// --- the three steered parties ---------------------------------------------------

/** Never takes the Walk at the tree line: these parties are meant to see the mountain. */
const CLIMB = ["gemfall-07h/walk"] as const;

/**
 * Empty-handed: refuses every facet a choice lets it refuse, and hands the rest
 * back at each chapter's start. Nothing in the content *takes* a facet from a
 * party (the effect set has no such effect), so the household is stripped in the
 * lobby before every chapter after the first; the unavoidable grants (onEnter
 * and dice-decided ones) are still held while their chapter is played, and the
 * audit knows it (a stone the party actually holds may be named).
 */
export const EMPTY_HANDED: PartyPlan = {
  label: "empty-handed",
  facets: "avoid",
  avoid: CLIMB,
  steer: ["restore"],
  beforeEvening: async ({ evening, repo, householdId }) => {
    if (evening > 0) await stripFacets(repo, householdId);
  },
};

/**
 * Full collection: takes every facet on offer, finishes the collection (the
 * hoard pursuit), and keeps a dragonling at the table for the dragonling-only
 * facet choices. Reaches chapter 8 with at least `FULL_COLLECTION_BEFORE_8`
 * facets: if the road gave fewer, the household is topped up from the catalog
 * before the finale (and `topUps` on the run says how many were added).
 */
export const FULL_COLLECTION_BEFORE_8 = 9;
export const FULL_COLLECTION: PartyPlan = {
  label: "full collection",
  facets: "collect",
  species: ["dragonling"],
  steer: ["hoard"],
  avoid: CLIMB,
  beforeEvening: async ({ evening, repo, householdId, facetIds }) => {
    // The finale is the eighth beat. If the road gave fewer than nine, fill the
    // case from the catalog (the keystone is the finale's own, never seeded).
    if (evening !== 7) return;
    return topUpFacets(repo, householdId, facetIds.filter((id) => id !== "facet_keystone"), FULL_COLLECTION_BEFORE_8);
  },
};

/** Solo: one player plays the whole campaign, chapters 6 to 8 included. */
export const SOLO: PartyPlan = { label: "solo", size: 1, avoid: CLIMB, steer: ["restore"] };

/**
 * The Collection and the Tether, steered (#164). The three parties above all
 * take the Restore, so chapters 07h and 07l are walked by these: the same
 * plans with the pursuit overridden. `pursuit` is the choice id at chapter 6's
 * fork ("hoard" or "leash"; pinned to that chapter, because the finale also
 * offers a "leash" and taking it there loops the Seal-Keeper's chamber); the Walk at 07h's tree line stays refused unless
 * `walk` is set.
 */
export function onPursuit(base: PartyPlan, pursuit: "hoard" | "leash", walk = false): PartyPlan {
  return {
    ...base,
    label: `${base.label}, ${pursuit}${walk ? "+walk" : ""}`,
    steer: [...(base.steer ?? []).filter((id) => id !== "restore" && id !== "hoard"), `gemfall-06/${pursuit}`, ...(walk ? CLIMB : [])],
    avoid: walk ? (base.avoid ?? []).filter((id) => !CLIMB.some((c) => c === id)) : base.avoid,
  };
}

/** Full-handed for chapter 7: nine facets in the case when the seventh beat opens (evening 6). */
export const FULL_HANDED_AT_7: PartyPlan = {
  label: "full-handed",
  facets: "collect",
  species: ["dragonling"],
  avoid: CLIMB,
  beforeEvening: async ({ evening, repo, householdId, facetIds }) => {
    if (evening !== 6) return;
    return topUpFacets(repo, householdId, facetIds.filter((id) => id !== "facet_keystone"), FULL_COLLECTION_BEFORE_8);
  },
};

// --- the playthrough --------------------------------------------------------------

export interface Playthrough {
  status: string;
  chapters: string[];
  outcomes: string[];
  routeFlags: Record<string, boolean>;
  /** The household's Field Guide at the end (#106). */
  book: Record<string, { firstFoundBy: string }>;
  /** What the chapters played should have found, derived from the shared rules. */
  expectedFinds: Set<string>;
  /** Everything those chapters *could* have found, had every road been taken. */
  possibleFinds: Set<string>;
  playerIds: string[];
  /** Everything the table was shown: composed narration and visible choice labels. */
  lines: AuditLine[];
  /** Per chapter played: distinct facets held when it opened and when it closed. */
  facetLog: { chapterId: string; atStart: number; atEnd: number }[];
  /** Facets the driver added to the household (full collection, before 08). */
  topUps: number;
}

const snapshot = (s: RunState): ChoiceParty => ({
  members: s.party.map((m) => ({
    species: m.character.species,
    inventory: m.character.inventory.map((e) => ({ itemId: e.itemId })),
    questItems: [...m.character.questItems],
  })) as unknown as ChoiceParty["members"],
  flags: { ...s.flags },
});

const facetCount = (s: RunState) =>
  new Set(s.party.flatMap((m) => m.character.questItems.filter(isFacet))).size;

export async function playCampaign(
  content: ContentStore,
  seed: number,
  plan: PartyPlan = { label: "random" },
): Promise<Playthrough> {
  const rng = makeRng(`gemfall-playthrough-${seed}`);
  const random = () => rng.next();
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const size = plan.size ?? 3;
  const facetIds = Object.keys(content.items()).filter(isFacet).sort((a, b) => (a === "facet_keystone" ? 1 : b === "facet_keystone" ? -1 : 0));

  // The party as the engine composed the closing scene, before settlement
  // (`commitCampaign`) clears the quest items off the characters. The state a
  // phone gets back for the turn that ends a chapter is already settled, so
  // without this the audit would judge an ending against a party holding
  // nothing. Keyed by chapter/scene.
  const composedAt = new Map<string, ChoiceParty>();
  const engine: Engine = {
    ...realEngine,
    applyIntent: (state, input, ctx) => {
      const result = realEngine.applyIntent(state, input, ctx);
      const after = result.state;
      if (state.phase !== "chapter_complete" && after.phase === "chapter_complete" && after.chapterId && after.sceneId) {
        composedAt.set(`${after.chapterId}/${after.sceneId}`, snapshot(after));
      }
      return result;
    },
  };
  const harness = makeHarness({ engine, content });
  // The server seeds each step's dice from `runId:seq`, and a run id is a
  // random UUID. Left alone, "seeded" here would only cover the party's
  // choices, and the dice would differ on every run — so whether any of the
  // 24 parties happens to finish the whole campaign became a coin toss in CI.
  // Key the dice to this seed instead, keeping the per-step `seq`.
  harness.deps.rng = (key) => makeRng(`gemfall-playthrough-${seed}:${String(key).split(":").pop()}`);
  const { householdId, players } = await seedHousehold(harness, size);
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

  // Different species each seed, so species-gated choices get walked. The
  // shuffle runs even when seats are pinned, so a plan never shifts the dice.
  const shuffled = [...SPECIES].sort(() => random() - 0.5);
  const pinned = [...(plan.species ?? [])];
  const species = [...pinned, ...shuffled.filter((sp) => !pinned.includes(sp))].slice(0, size);
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
  const lines: AuditLine[] = [];
  const facetLog: Playthrough["facetLog"] = [];
  let topUps = 0;
  // The Field Guide (#106): what the scenes this party actually walked
  // through reveal, by the shared rules — not hardcoded, so tagging scenes
  // (#104) moves the expectation with the content.
  const expectedFinds = new Set<string>();
  const possibleFinds = new Set<string>();

  // What the table was shown, once each time it changes.
  let lastNarration = "";
  let lastChoices = "";
  const observe = (s: RunState) => {
    if (!s.chapterId || !s.sceneId) return;
    const party = (s.phase === "chapter_complete" && composedAt.get(`${s.chapterId}/${s.sceneId}`)) || snapshot(s);
    const narrationKey = `${s.chapterId}/${s.sceneId}/${s.narration}`;
    if (s.narration && narrationKey !== lastNarration) {
      lastNarration = narrationKey;
      lines.push({ chapterId: s.chapterId, sceneId: s.sceneId, kind: "narration", text: s.narration, party });
    }
    if (s.prompt?.kind === "choice") {
      const choicesKey = `${s.chapterId}/${s.sceneId}/${s.prompt.options.map((o) => `${o.id}:${o.label}`).join("|")}`;
      if (choicesKey !== lastChoices) {
        lastChoices = choicesKey;
        for (const o of s.prompt.options) {
          lines.push({ chapterId: s.chapterId, sceneId: s.sceneId, kind: "choice", text: o.label, party });
        }
      }
    }
  };

  // Which of the offered options this party takes.
  const decide = (s: RunState, options: readonly { id: string }[]): string => {
    const chapterId = s.chapterId!;
    const forced = options.find((o) => matches(plan.steer, chapterId, o.id));
    if (forced) return forced.id;
    let pool = options.filter((o) => !matches(plan.avoid, chapterId, o.id));
    if (pool.length === 0) pool = [...options];
    const chapter = plan.facets ? content.chapter(chapterId) : null;
    const scene = chapter && s.sceneId ? chapter.scenes[s.sceneId] : undefined;
    if (chapter && scene && plan.facets) {
      const reach = facetReach(chapter, plan.facets);
      const choices = sceneChoices(scene);
      const score = (id: string) => {
        const c = choices.find((x) => x.id === id);
        return c ? facetGain(c.effects) + (reach.get(c.goto) ?? 0) : 0;
      };
      const want = plan.facets === "collect" ? Math.max : Math.min;
      const target = want(...pool.map((o) => score(o.id)));
      pool = pool.filter((o) => score(o.id) === target);
    }
    return pick(pool).id;
  };

  for (let evening = 0; evening < 12; evening++) {
    topUps += (await plan.beforeEvening?.({ evening, repo: harness.repo, householdId, facetIds })) ?? 0;
    for (const playerId of playerIds) await must(playerId, { type: "READY", ready: true });
    await must(playerIds[0]!, { type: "CONTINUE_CAMPAIGN", campaignId: "gemfall" });
    chapters.push((await state()).chapterId!);
    const opened = await state();
    const log = { chapterId: opened.chapterId!, atStart: facetCount(opened), atEnd: 0 };
    facetLog.push(log);

    // One chapter. Bounded, so a loop in the content fails the test rather
    // than hanging it.
    for (let step = 0; ; step++) {
      if (step > 3000) throw new Error(`seed ${seed}: stuck in ${(await state()).chapterId}/${(await state()).sceneId}`);
      const s = await state();
      observe(s);
      log.atEnd = facetCount(s);
      if (s.phase === "chapter_complete") break;

      const prompt = s.prompt;
      if (prompt?.kind === "interaction") {
        const actor = interactionActor(prompt, s.party.filter((member) => member.connected).map((member) => member.playerId)) ?? playerIds[0]!;
        await must(actor, { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt,
          ...(prompt.phase === "result" ? { action: "continue" as const } : { action: "assist" as const }) });
        continue;
      }
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
      // Gemfall opens at the Exchange's fitting stall (#312): every new hero
      // keeps the class they made, so the run plays as it did before it.
      const deciding = classPlaceWaitingOn(s);
      if (deciding.length > 0 && s.classPlace) {
        for (const member of deciding) await must(member.playerId, keepClassIntent(s.classPlace, member));
        continue;
      }
      if (prompt?.kind === "choice") {
        const choiceId = decide(s, prompt.options);
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
    const played = content.chapter(done.chapterId!)!;
    for (const id of chapterStartDiscoveries(played, content.world())) expectedFinds.add(id);
    for (const sceneId of done.visited ?? []) {
      const scene = played.scenes[sceneId];
      if (scene) for (const id of sceneDiscoveries(scene, content.bestiary())) expectedFinds.add(id);
    }
    // The classes at the table are found with the chapter they sit down in.
    for (const id of partyClassDiscoveries(done.party)) expectedFinds.add(id);
    for (const id of chapterDiscoveries(played, content.world(), content.bestiary())) possibleFinds.add(id);
    for (const id of partyClassDiscoveries(done.party)) possibleFinds.add(id);
    const attempt = await harness.repo.getCampaignProgress(householdId, "gemfall");
    if (attempt && attempt.status !== "active") {
      return {
        status: attempt.status,
        chapters,
        outcomes,
        routeFlags: attempt.routeFlags ?? {},
        book: (await harness.repo.getFieldGuide(householdId)).entries,
        expectedFinds,
        possibleFinds,
        playerIds,
        lines,
        facetLog,
        topUps,
      };
    }
    // The completion screen's button: back to the lobby for next evening.
    await must(playerIds[0]!, { type: "ADVANCE" });
  }
  throw new Error(`seed ${seed}: twelve evenings and the campaign never ended`);
}
