/**
 * The shipped befriendings (#626, docs/camp.md §4.4): every friend a chapter
 * offers, played through the shipping loader, the real engine and the
 * handlers. The table walks into the scene that offers the friend the way a
 * party does (from a scene that leads into it), chooses "Come along", and the
 * crew owns the friend under that place's reward id; "Say goodbye" lands on
 * its own scene and writes nothing. That the offer stands on every way into
 * the place is tools/content/camp-befriends.test.mjs's.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, makeRng } from "@kad/shared";
import type { ClientIntent, RunState, ServerMessage } from "@kad/shared";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { seedRoom } from "../dev-seed.ts";
import { makeHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { readCamp } from "./camp.ts";

const realEngine: Engine = { applyIntent, createRunState };
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));

interface Befriending {
  friendId: string;
  rewardId: string;
  chapterId: string;
  /** A scene that leads into the offer, and the choice that does. */
  from: string;
  via: string;
  /** The scene with "Come along" and "Say goodbye", and where each lands. */
  ask: string;
  come: string;
  goodbye: string;
}

const BEFRIENDINGS: Befriending[] = [
  { friendId: "bun", rewardId: "first-steps-01.bun", chapterId: "first-steps-01", from: "scene_favorite_part", via: "get_star", ask: "scene_bun_gate", come: "scene_bun_along", goodbye: "scene_bun_goodbye" },
  { friendId: "harbor_gull", rewardId: "gemfall-01.gull", chapterId: "gemfall-01", from: "rest_empty_chair", via: "to_yard", ask: "scene_gull_dawn", come: "scene_gull_along", goodbye: "scene_gull_goodbye" },
  { friendId: "silver_otter", rewardId: "gemfall-02.otter", chapterId: "gemfall-02", from: "scene_ditch_cake", via: "on", ask: "scene_ditch_otter", come: "scene_ditch_otter_along", goodbye: "scene_ditch_otter_goodbye" },
  { friendId: "mosshorn", rewardId: "gemfall-04b.mosshorn", chapterId: "gemfall-04b", from: "scene_read_herd", via: "follow", ask: "scene_mosshorn_friend", come: "scene_mosshorn_along", goodbye: "scene_mosshorn_goodbye" },
  { friendId: "harbor_gull", rewardId: "riftlight-exchange-rift.gull", chapterId: "riftlight-exchange-rift", from: "quay_rest", via: "on", ask: "gull_friend", come: "gull_along", goodbye: "gull_goodbye" },
  { friendId: "duckling", rewardId: "riftlight-ashspan-bridge.duckling", chapterId: "riftlight-ashspan-bridge", from: "ducks_safe", via: "continue", ask: "duck_friend", come: "duck_along", goodbye: "duck_goodbye" },
  { friendId: "kid_goat", rewardId: "riftlight-glacier-survival.kid_goat", chapterId: "riftlight-glacier-survival", from: "ledge_done", via: "continue", ask: "kid_friend", come: "kid_along", goodbye: "kid_goodbye" },
];

/**
 * One hero at a table seated at `from` by the dev server's playtest seed
 * (dev-seed.ts: any chapter of any campaign, out of order and unlocked), then
 * on into the offer by the choice a party takes there.
 */
async function atTheWayIn(b: Befriending) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`befriend:${String(key).split(":").pop()}`);
  const seeded = await seedRoom({ mode: "party", heroes: [{ name: "Glimmer", species: "unicorn" }], chapterId: b.chapterId, sceneId: b.from }, harness.deps);
  if (!seeded.ok) throw new Error(`seed: ${JSON.stringify(seeded.error)}`);
  const { code, runId } = seeded.value;
  const { playerId: me, householdId } = seeded.value.phones[0]!;
  const received: ServerMessage[] = [];
  harness.channel.subscribe(code, (m) => received.push(m as ServerMessage));
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const must = async (intent: ClientIntent) => {
    const response = await applyAction({ runId, playerId: me, seq: (await state()).seq, intent }, harness.deps);
    expect(response.ok, `${intent.type} in ${(await state()).sceneId}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
  };
  expect((await state()).sceneId).toBe(b.from);
  await must({ type: "CHOOSE", choiceId: b.via });
  // A story interaction on the way in (4B's mosshorn is befriended in a `play`
  // first) is played as a table plays it: start, a kind word, done, go on.
  for (let guard = 0; guard < 12; guard++) {
    const prompt = (await state()).prompt;
    if (prompt?.kind !== "interaction") break;
    const at = { type: "INTERACT" as const, openedSeq: prompt.openedSeq, attempt: prompt.attempt };
    const option = "options" in prompt.spec ? prompt.spec.options[0]?.id : undefined;
    if (prompt.phase === "result") await must({ ...at, action: "continue" });
    else if (prompt.phase === "ready") await must({ ...at, action: "start", relaxed: false });
    else {
      const done = await applyAction({ runId, playerId: me, seq: (await state()).seq, intent: { ...at, action: "complete" } }, harness.deps);
      if (!done.ok && option) await must({ ...at, action: "play", optionId: option });
    }
  }
  expect((await state()).sceneId).toBe(b.ask);
  return { harness, householdId, state, must, received };
}

describe("the shipped befriendings (#626)", () => {
  it("lists every friend the catalog offers, each offer once", () => {
    const offered = content.campCatalog()!.friends.flatMap((f) => f.offers.map((o) => `${f.id} ${o.rewardId}`));
    // The kid goat is the spotted kid the herder gives away in the glacier
    // chapter, never the goat kid that goes home to her herd (docs/camp.md §4.4).
    expect(BEFRIENDINGS.map((b) => `${b.friendId} ${b.rewardId}`).sort()).toEqual(offered.sort());
  });

  it.each(BEFRIENDINGS)("$chapterId: 'Come along' gives the crew $friendId", { timeout: 30_000 }, async (b) => {
    const t = await atTheWayIn(b);
    await t.must({ type: "CHOOSE", choiceId: "come" });
    expect((await t.state()).sceneId).toBe(b.come);
    const camp = await readCamp(t.householdId, null, t.harness.deps);
    expect(Object.keys(camp.friends)).toEqual([b.friendId]);
    expect(camp.friends[b.friendId]).toMatchObject({ rewardId: b.rewardId });
    expect(camp.receipts.rewards[b.rewardId]).toBeTruthy();
    expect(t.received.flatMap((m) => m.campClaims ?? []).filter((c) => c.kind === "friend")).toEqual([{ rewardId: b.rewardId, kind: "friend", pieceId: b.friendId, result: "friend" }]);
    // Recorded on the run where it was befriended (a find earlier on the way, like the gull feather, beside it).
    expect((await t.state()).campFinds?.filter((f) => f.kind === "friend")).toEqual([{ kind: "friend", pieceId: b.friendId, rewardId: b.rewardId, sceneId: b.ask }]);
  });

  it.each(BEFRIENDINGS)("$chapterId: 'Say goodbye' lands on its own scene and writes nothing", { timeout: 30_000 }, async (b) => {
    const t = await atTheWayIn(b);
    const before = await t.harness.repo.getCamp(t.householdId);
    const claimed = t.received.flatMap((m) => m.campClaims ?? []).length;
    await t.must({ type: "CHOOSE", choiceId: "goodbye" });
    expect((await t.state()).sceneId).toBe(b.goodbye);
    expect((await t.state()).campFinds?.filter((f) => f.kind === "friend") ?? []).toEqual([]);
    expect(t.received.flatMap((m) => m.campClaims ?? []).slice(claimed)).toEqual([]);
    expect(await t.harness.repo.getCamp(t.householdId)).toEqual(before);
  });
});
