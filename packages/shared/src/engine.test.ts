import { describe, expect, it } from "vitest";

import {
  applyEffects,
  applyIntent,
  createRunState,
  currentChoices,
  enterScene,
  isPartyDown,
} from "./engine.js";
import type { EngineContext, EngineResult } from "./engine.js";
import { makeRng } from "./dice.js";
import type { Rng } from "./dice.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";
import { APPEARANCE, makeChapter, makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

/** A rigged die, for tests about branches rather than about randomness. */
function fixedRng(die: number): Rng {
  return { next: () => (die - 1) / 20 + 0.001 };
}

function ctx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    rules,
    items,
    chapter: makeChapter(),
    rng: makeRng("test"),
    now: "2026-07-28T12:00:00.000Z",
    householdId: "h_1",
    ...overrides,
  };
}

const CREATE_UNICORN: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Sparklehoof",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 0, quick: 0, clever: 0, heart: 3 },
  appearance: APPEARANCE,
};

const CREATE_GRIFFIN: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Windstep",
  species: "griffin",
  class: "duskrunner",
  stats: { might: 0, quick: 3, clever: 0, heart: 0 },
  appearance: APPEARANCE,
};

function newRun(): RunState {
  return createRunState({
    runId: "r_88c",
    roomCode: "ABCD",
    mode: "travel",
    now: "2026-07-28T11:00:00.000Z",
  });
}

/** Applies intents in order, asserting each one was accepted. */
function walk(
  state: RunState,
  steps: { playerId: string; intent: ClientIntent }[],
  context: EngineContext,
): EngineResult {
  let result: EngineResult = { state };
  for (const step of steps) {
    result = applyIntent(result.state, step, context);
    if (result.error) {
      throw new Error(`${step.intent.type} rejected: ${result.error.code} ${result.error.message}`);
    }
  }
  return result;
}

function seatedParty(context = ctx()): RunState {
  return walk(
    newRun(),
    [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
    ],
    context,
  ).state;
}

describe("createRunState", () => {
  it("starts in the lobby with nothing decided", () => {
    const state = newRun();
    expect(state).toMatchObject({
      phase: "lobby",
      seq: 0,
      party: [],
      prompt: null,
      sceneId: null,
      xpEarned: 0,
    });
  });
});

describe("CREATE_CHARACTER", () => {
  it("seats a resolved character at full HP", () => {
    const state = seatedParty();
    expect(state.phase).toBe("creation");
    expect(state.party).toHaveLength(2);
    const unicorn = state.party[0]!;
    expect(unicorn.character.name).toBe("Sparklehoof");
    expect(unicorn.character.stats.heart).toBe(5); // 1 base + 3 assigned + 1 species
    expect(unicorn.hp).toBe(unicorn.character.maxHp);
    expect(unicorn.down).toBe(false);
  });

  it("returns ILLEGAL instead of throwing on a bad creation payload", () => {
    const result = applyIntent(
      newRun(),
      {
        playerId: "p_1",
        intent: { ...CREATE_UNICORN, stats: { might: 9, quick: 0, clever: 0, heart: 0 } } as ClientIntent,
      },
      ctx(),
    );
    expect(result.error).toMatchObject({ code: "ILLEGAL" });
    expect(result.error?.message).toMatch(/exactly 3 creation points/);
    expect(result.state.party).toHaveLength(0);
  });

  it("refuses a second character for the same player", () => {
    const state = seatedParty();
    const result = applyIntent(state, { playerId: "p_1", intent: CREATE_GRIFFIN }, ctx());
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("errors, never throws", () => {
  it("rejects a stale intent", () => {
    const state = seatedParty();
    const result = applyIntent(state, { playerId: "p_1", intent: { type: "ROLL" }, seq: 0 }, ctx());
    expect(result.error?.code).toBe("STALE_SEQ");
    expect(result.state).toBe(state);
  });

  it("rejects a choice when nothing is waiting on one", () => {
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ctx(),
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("rejects a chapter that isn't loaded", () => {
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "frostpeak-09" } },
      ctx(),
    );
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("leaves the state untouched when an intent is rejected", () => {
    const state = seatedParty();
    const before = JSON.parse(JSON.stringify(state)) as RunState;
    applyIntent(state, { playerId: "p_9", intent: { type: "READY", ready: true } }, ctx());
    expect(state).toEqual(before);
  });

  it("bumps seq only on success", () => {
    const state = seatedParty();
    const ok = applyIntent(state, { playerId: "p_1", intent: { type: "READY", ready: true } }, ctx());
    expect(ok.state.seq).toBe(state.seq + 1);
    const bad = applyIntent(state, { playerId: "p_9", intent: { type: "READY", ready: true } }, ctx());
    expect(bad.state.seq).toBe(state.seq);
  });
});

describe("START_CHAPTER", () => {
  it("enters the entry scene and opens its choice prompt", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.presentation).toEqual({
      kind: "SCENE_ENTER",
      sceneId: "scene_clearing",
      art: "bg/bramblewood/clearing",
    });
    expect(result.state).toMatchObject({
      phase: "scene",
      chapterId: "bramblewood-01",
      campaignId: "the-hollow-crown",
      sceneId: "scene_clearing",
      sceneType: "story",
      narration: "A wall of thorns twice your height.",
      art: "bg/bramblewood/clearing",
    });
    expect(result.state.prompt).toMatchObject({ kind: "choice", vote: false });
  });

  it("refuses to start with nobody in the party", () => {
    const result = applyIntent(
      newRun(),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      ctx(),
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("species gating at the prompt (architecture §5)", () => {
  const started = (context: EngineContext, party: { playerId: string; intent: ClientIntent }[]) =>
    walk(
      newRun(),
      [...party, { playerId: party[0]!.playerId, intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;

  it("hides the flying choice from an all-unicorn party", () => {
    const context = ctx();
    const state = started(context, [{ playerId: "p_1", intent: CREATE_UNICORN }]);
    const prompt = state.prompt;
    expect(prompt?.kind).toBe("choice");
    if (prompt?.kind !== "choice") return;
    expect(prompt.options.map((o) => o.id)).toEqual(["squeeze"]);
    expect(currentChoices(state, makeChapter()).map((c) => c.id)).toEqual(["squeeze"]);
  });

  it("shows it once a griffin is at the table", () => {
    const context = ctx();
    const state = started(context, [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
    ]);
    const prompt = state.prompt;
    if (prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(prompt.options.map((o) => o.id)).toEqual(["squeeze", "over"]);
  });

  it("rejects a hidden choice even if a client asks for it", () => {
    const context = ctx();
    const state = started(context, [{ playerId: "p_1", intent: CREATE_UNICORN }]);
    const result = applyIntent(state, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "over" } }, context);
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("checks", () => {
  function atCheck(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ],
      context,
    ).state;
  }

  it("nominates the best roller and opens a roll prompt", () => {
    const state = atCheck(ctx());
    expect(state.phase).toBe("check");
    expect(state.prompt).toMatchObject({
      kind: "roll",
      stat: "quick",
      tn: 12,
      // Windstep the griffin duskrunner: 1 base + 3 assigned + 1 species = 5 Quick.
      characterId: "c_p_2",
    });
  });

  it("only the nominated character's player may roll", () => {
    const context = ctx();
    const state = atCheck(context);
    const wrong = applyIntent(state, { playerId: "p_1", intent: { type: "ROLL" } }, context);
    expect(wrong.error?.code).toBe("FORBIDDEN");
  });

  it("takes onSuccess on a high roll, granting the item to the roller", () => {
    const context = ctx({ rng: fixedRng(20) });
    const result = applyIntent(atCheck(context), { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(result.presentation).toMatchObject({ kind: "ROLL" });
    expect(result.state.lastRoll).toMatchObject({ die: 20, mod: 5, total: 25, tn: 12, result: "success" });
    expect(result.state.sceneId).toBe("scene_shrine");
    const roller = result.state.party.find((m) => m.playerId === "p_2")!;
    expect(roller.character.inventory.map((e) => e.itemId)).toEqual(["sunbloom_draught"]);
  });

  it("takes onFailure on a low roll, damaging the roller and showing the branch line", () => {
    const context = ctx({ rng: fixedRng(1) });
    const before = atCheck(context);
    const hpBefore = before.party.map((m) => m.hp);
    const result = applyIntent(before, { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(result.state.lastRoll?.result).toBe("failure");
    expect(result.state.sceneId).toBe("scene_scratched");
    expect(result.state.narration).toContain("the thorns take their toll");
    expect(result.state.narration).toContain("Scratched, but through.");
    const [unicorn, griffin] = result.state.party;
    // `to` was omitted, and there was a roller — so only the roller took it.
    expect(unicorn!.hp).toBe(hpBefore[0]);
    expect(griffin!.hp).toBe(hpBefore[1]! - 1);
  });
});

describe("a full walk of a chapter", () => {
  it("goes entry → check → shrine → encounter → rest → vote → ending", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = seatedParty(context);

    const result = walk(
      state,
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      ],
      context,
    );

    // The shrine's onEnter fired: a slot-free quest item and a story flag.
    expect(result.state.flags["found_shrine"]).toBe(true);

    // Encounter — TODO(chapter-4): resolved as an auto-victory placeholder.
    expect(result.state.phase).toBe("encounter");
    expect(result.state.prompt).toMatchObject({ kind: "ready" });

    const afterFight = applyIntent(result.state, { playerId: "p_1", intent: { type: "ADVANCE" } }, context);
    expect(afterFight.state.sceneId).toBe("scene_camp");
    expect(afterFight.state.sceneType).toBe("rest");

    const atRidge = walk(
      afterFight.state,
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } }],
      context,
    ).state;
    expect(atRidge.sceneId).toBe("scene_ridge");

    // choice_point puts it to a vote: the first answer does not settle it.
    const prompt = atRidge.prompt;
    if (prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(prompt.vote).toBe(true);
    expect(prompt.forPlayerIds).toEqual(["p_1", "p_2"]);

    const firstVote = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(firstVote.state.sceneId).toBe("scene_ridge");
    expect(firstVote.state.prompt).toMatchObject({ kind: "choice", votes: { p_1: "high" } });

    const secondVote = applyIntent(
      firstVote.state,
      { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "high" } },
      context,
    );

    // The ending scene has no exits, so it completes the chapter.
    expect(secondVote.state.sceneId).toBe("scene_ending");
    expect(secondVote.state.phase).toBe("chapter_complete");
    expect(secondVote.state.prompt).toBeNull();
    expect(secondVote.state.xpEarned).toBe(300);
    expect(secondVote.presentation).toMatchObject({ kind: "CHAPTER_COMPLETE", xp: 300 });
  });

  it("breaks a tied vote toward the first player in party order", () => {
    const context = ctx({ rng: fixedRng(20) });
    const atRidge = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "ADVANCE" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } },
        { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "low" } },
      ],
      context,
    ).state;

    // One vote each, so it is tied — p_1 votes first in party order and wins.
    const settled = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(settled.state.flags["took_high"]).toBe(true);
    expect(settled.state.flags["took_low"]).toBeUndefined();
  });

  it("resolves an encounter on a full ready-up too", () => {
    const context = ctx({ rng: fixedRng(20) });
    const inFight = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    expect(inFight.phase).toBe("encounter");

    const done = applyIntent(inFight, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
    expect(done.state.sceneId).toBe("scene_camp");
  });
});

describe("rest scenes", () => {
  it("heals on arrival (spec §6.1)", () => {
    const context = ctx({ rng: fixedRng(20) });
    let state = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    state = applyEffects(state, [{ type: "damage", amount: 5, to: "party" }], context);
    const hurt = state.party.map((m) => m.hp);

    const rested = enterScene(state, "scene_camp", context);
    expect(rested.state.party.map((m) => m.hp)).toEqual(hurt.map((hp) => hp! + 3));
  });
});

describe("items in play", () => {
  function withDraught(context: EngineContext): RunState {
    const state = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;
    return applyEffects(state, [{ type: "damage", amount: 6, to: "p_2" }], context);
  }

  it("uses a consumable and heals", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = withDraught(context);
    const before = state.party.find((m) => m.playerId === "p_2")!.hp;

    const result = applyIntent(state, { playerId: "p_2", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } }, context);
    const after = result.state.party.find((m) => m.playerId === "p_2")!;
    expect(after.hp).toBe(before + 4);
    expect(after.character.inventory).toEqual([]);
    expect(result.presentation).toMatchObject({ kind: "HEAL", amount: 4 });
  });

  it("refuses an item the character isn't carrying", () => {
    const context = ctx({ rng: fixedRng(20) });
    const result = applyIntent(
      withDraught(context),
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to burn a quest item", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "rusted_key" } },
      context,
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("prompts to swap rather than dropping a grant into a full bag", () => {
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(
      state,
      [
        { type: "grantItem", itemId: "river_charm", to: "p_1" },
        { type: "grantItem", itemId: "emberglass_shard", to: "p_1" },
        { type: "grantItem", itemId: "oak_token", to: "p_1" },
        { type: "grantItem", itemId: "pebble", to: "p_1" },
        { type: "grantItem", itemId: "acorn", to: "p_1" },
        { type: "grantItem", itemId: "feather", to: "p_1" },
      ],
      context,
    );
    expect(state.party[0]!.character.inventory).toHaveLength(6);

    state = applyEffects(state, [{ type: "grantItem", itemId: "ribbon", to: "p_1" }], context);
    expect(state.prompt).toEqual({
      kind: "item_swap",
      characterId: "c_p_1",
      incomingItemId: "ribbon",
    });

    const swapped = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    const inventory = swapped.state.party[0]!.character.inventory.map((e) => e.itemId);
    expect(inventory).toHaveLength(6);
    expect(inventory).toContain("ribbon");
    expect(inventory).not.toContain("pebble");
    expect(swapped.state.prompt).toBeNull();

    // "Leave it" is the other half of the one prompt.
    const left = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: null } },
      context,
    );
    expect(left.state.party[0]!.character.inventory.map((e) => e.itemId)).not.toContain("ribbon");
  });

  it("carries a swap prompt across a scene transition rather than losing the item", () => {
    const context = ctx({ rng: fixedRng(20) });
    // Fill the griffin's bag, then walk into the check whose success grants it
    // one more item.
    let state = seatedParty(context);
    for (const itemId of ["river_charm", "emberglass_shard", "oak_token", "pebble", "acorn", "feather"]) {
      state = applyEffects(state, [{ type: "grantItem", itemId, to: "p_2" }], context);
    }
    state = walk(
      state,
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;

    // Arrived at the shrine, but the grant is still owed a decision.
    expect(state.sceneId).toBe("scene_shrine");
    expect(state.prompt).toMatchObject({ kind: "item_swap", incomingItemId: "sunbloom_draught" });

    const answered = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    // ...and the scene's own prompt opens once it's answered.
    expect(answered.state.prompt).toMatchObject({ kind: "choice", sceneId: "scene_shrine" });
    expect(
      answered.state.party.find((m) => m.playerId === "p_2")!.character.inventory.map((e) => e.itemId),
    ).toContain("sunbloom_draught");
  });

  it("only the owner answers the swap prompt", () => {
    const context = ctx();
    let state = seatedParty(context);
    for (const itemId of ["river_charm", "emberglass_shard", "oak_token", "pebble", "acorn", "feather", "ribbon"]) {
      state = applyEffects(state, [{ type: "grantItem", itemId, to: "p_1" }], context);
    }
    const result = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("effects", () => {
  it("grants quest items outside the slot budget and only once", () => {
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(state, [{ type: "grantQuestItem", itemId: "rusted_key" }], context);
    state = applyEffects(state, [{ type: "grantQuestItem", itemId: "rusted_key" }], context);
    const holder = state.party[0]!;
    expect(holder.character.questItems).toEqual(["rusted_key"]);
    expect(holder.character.inventory).toEqual([]);
  });

  it("sets flags and accumulates XP", () => {
    const context = ctx();
    const state = applyEffects(
      seatedParty(context),
      [
        { type: "setFlag", flag: "found_shrine" },
        { type: "setFlag", flag: "lantern_lit", value: false },
        { type: "grantXp", amount: 50 },
      ],
      context,
    );
    expect(state.flags).toEqual({ found_shrine: true, lantern_lit: false });
    expect(state.xpEarned).toBe(50);
  });

  it("knocks characters down instead of killing them, and never ends the run", () => {
    const context = ctx();
    const state = applyEffects(seatedParty(context), [{ type: "damage", amount: 99, to: "party" }], context);
    expect(state.party.every((m) => m.hp === 0 && m.down)).toBe(true);
    expect(isPartyDown(state)).toBe(true);
    // spec §7.3 — a wipe is a story branch. There is no game-over phase at all.
    expect(state.phase).not.toBe("chapter_complete");
    expect(["lobby", "creation", "scene", "check", "encounter", "chapter_complete"]).toContain(
      state.phase,
    );
  });

  it("lifts a knocked-down character back up on a heal", () => {
    const context = ctx();
    let state = applyEffects(seatedParty(context), [{ type: "damage", amount: 99, to: "party" }], context);
    state = applyEffects(state, [{ type: "heal", amount: 1, to: "p_1" }], context);
    expect(state.party[0]).toMatchObject({ hp: 1, down: false });
    expect(state.party[1]).toMatchObject({ down: true });
  });

  it("caps healing at max HP", () => {
    const context = ctx();
    const state = applyEffects(seatedParty(context), [{ type: "heal", amount: 99, to: "party" }], context);
    for (const member of state.party) expect(member.hp).toBe(member.character.maxHp);
  });

  it("never mutates the state it was handed", () => {
    const context = ctx();
    const state = seatedParty(context);
    const before = JSON.parse(JSON.stringify(state)) as RunState;
    applyEffects(state, [{ type: "damage", amount: 3, to: "party" }], context);
    expect(state).toEqual(before);
  });
});

describe("SET_MODE", () => {
  it("switches layout mid-run — the laptop dying is exactly when you need it", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "SET_MODE", mode: "party" } },
      context,
    );
    expect(result.state.mode).toBe("party");
  });
});
