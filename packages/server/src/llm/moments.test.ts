/**
 * What can happen next — architecture §6.4's input.
 *
 * The pair that has to agree: `nextMoments` writes the cache keys from the
 * scene being left, `arrivalKey` reads one from the scene arrived at. If they
 * ever disagree about a label the layer goes quiet with a 100% miss rate and
 * nothing anywhere reports it, so the round trip is the test that matters here.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, RunState, Scene } from "@kad/shared";
import { PREFETCH_WIDTH, arrivalKey, exitsOf, nextMoments } from "./moments.ts";

const CHAPTER: Chapter = {
  id: "bramblewood-01",
  campaignId: "the-hollow-crown",
  index: 1,
  title: "The Bramblewood",
  biome: "forest",
  estimatedMinutes: 30,
  xpAward: 100,
  entry: "scene_fork",
  scenes: {
    scene_fork: {
      type: "choice_point",
      narration: "The path splits at a mossy stone.",
      choices: [
        { id: "c_left", label: "Take the left path", goto: "scene_hedge", icon: "arrow" },
        { id: "c_right", label: "Take the right path", goto: "scene_river", icon: "arrow" },
      ],
    },
    scene_hedge: { type: "story", narration: "A wall of thorns blocks the way.", choices: [] },
    scene_river: { type: "story", narration: "The river is going about its business.", choices: [] },
    scene_quiet: { type: "story", narration: "", choices: [] },
    encounter_wisps: {
      type: "encounter",
      map: "map_hollow",
      enemies: [{ id: "wisp", name: "Bramblewisp", count: 2, hp: 6, guard: 11, quick: 3, steps: 4, attack: 3 }],
      onVictory: { goto: "scene_hedge" },
      onDefeat: { goto: "scene_river" },
    },
    check_squeeze: {
      type: "check",
      stat: "might",
      tn: 12,
      prompt: "Push through the gap?",
      onSuccess: { goto: "scene_hedge" },
      onFailure: { goto: "scene_river" },
    },
  } as Record<string, Scene>,
};

function runAt(sceneId: string | null): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "travel",
    seq: 3,
    phase: "scene",
    campaignId: "the-hollow-crown",
    chapterId: "bramblewood-01",
    sceneId,
    sceneType: "story",
    narration: "",
    art: null,
    party: [],
    prompt: null,
    lastRoll: null,
    flags: { freed_sprite: true },
    xpEarned: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
  } as RunState;
}

describe("where a scene can lead", () => {
  it("uses the choice labels, which are the words on the buttons", () => {
    expect(exitsOf(CHAPTER.scenes.scene_fork!)).toEqual([
      { label: "Take the left path", goto: "scene_hedge" },
      { label: "Take the right path", goto: "scene_river" },
    ]);
  });

  it("treats winning and losing a fight as the two ways out", () => {
    /*
     * The party does not choose either, and the losing branch is where the
     * layer earns the most: §7.3 says a loss is a beat in the story rather than
     * a failure, and that beat is exactly what an authored line written for
     * both outcomes cannot land.
     */
    expect(exitsOf(CHAPTER.scenes.encounter_wisps!)).toEqual([
      { label: "won the fight", goto: "scene_hedge" },
      { label: "lost the fight", goto: "scene_river" },
    ]);
  });

  it("treats a check the same way", () => {
    expect(exitsOf(CHAPTER.scenes.check_squeeze!).map((e) => e.label)).toEqual([
      "passed the check",
      "failed the check",
    ]);
  });

  it("drops the label when both of a check's branches land in the same place", () => {
    /*
     * The choices case has collapsed shared destinations for a while; this pins
     * that checks and fights go through the same rule. The shipped chapter has
     * checks whose success and failure share a `goto` — the branch changes the
     * state, not the destination — and `arrivalKey` finds the exit by
     * destination, so without the collapse a failed check was served the line
     * written for "passed the check". Confidently telling a child she passed a
     * check she failed is the exact failure the null label exists to prevent.
     */
    const gap: Scene = {
      type: "check",
      stat: "might",
      tn: 12,
      prompt: "Push through the gap?",
      onSuccess: { goto: "scene_hedge" },
      onFailure: { goto: "scene_hedge" },
    };
    expect(exitsOf(gap)).toEqual([{ label: null, goto: "scene_hedge" }]);
  });

  it("drops the label when a fight's outcomes do too", () => {
    const both: Scene = {
      ...(CHAPTER.scenes.encounter_wisps as Scene & { type: "encounter" }),
      onVictory: { goto: "scene_hedge" },
      onDefeat: { goto: "scene_hedge" },
    };
    expect(exitsOf(both)).toEqual([{ label: null, goto: "scene_hedge" }]);
  });
});

describe("what to warm", () => {
  it("warms every branch out of where the party is standing", () => {
    const moments = nextMoments(runAt("scene_fork"), CHAPTER);
    expect(moments.map((m) => m.key.sceneId)).toEqual(["scene_hedge", "scene_river"]);
    expect(moments.map((m) => m.key.choiceId)).toEqual(["Take the left path", "Take the right path"]);
  });

  it("carries the destination's authored line and the run's flags", () => {
    // The authored line is the anchor and the fallback; the flags are how a
    // line knows the party has been somewhere before.
    const moment = nextMoments(runAt("scene_fork"), CHAPTER)[0];
    expect(moment?.request.authored).toBe("A wall of thorns blocks the way.");
    expect(moment?.request.flags).toEqual({ freed_sprite: true });
    expect(moment?.request.via).toBe("Take the left path");
  });

  it("caps the fan-out at §6.4's three or four", () => {
    /*
     * Not about money — §6.2 says cost is not a design constraint. It is that a
     * burst of parallel requests is the one thing that could make the *next*
     * prefetch slow, and a slow prefetch is a miss.
     */
    const wide: Chapter = {
      ...CHAPTER,
      scenes: {
        ...CHAPTER.scenes,
        scene_fork: {
          type: "choice_point",
          narration: "Many doors.",
          // Nine *distinct* destinations. Nine doors to the same room would be
          // collapsed to one by the dedupe rule below and would test that
          // instead.
          choices: Array.from({ length: 9 }, (_, i) => ({
            id: `c_${String(i)}`,
            label: `Door ${String(i)}`,
            goto: `scene_door_${String(i)}`,
            icon: "arrow",
          })),
        },
      },
    };
    const doors = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`scene_door_${String(i)}`, { type: "story", narration: `Room ${String(i)}.`, choices: [] }]),
    ) as Record<string, Scene>;
    expect(nextMoments(runAt("scene_fork"), { ...wide, scenes: { ...wide.scenes, ...doors } })).toHaveLength(
      PREFETCH_WIDTH,
    );
  });

  it("warms one line per destination, not one per button", () => {
    /*
     * A correctness rule rather than a saving, and the two halves of this file
     * disagreed without it. `arrivalKey` finds an arrival by taking the *first*
     * branch that leads where the party ended up, so a second branch to the
     * same scene yields a key nothing can ever read back.
     *
     * The reference chapter's entry scene is this exact shape — smash the
     * hedge, fly over it, or walk through it, all arriving in the same clearing
     * — and before the fix those three filled the window and pushed one of the
     * scene's only two ungated choices out of it. The branch most parties
     * actually take was the one branch never warmed.
     */
    const shared: Chapter = {
      ...CHAPTER,
      scenes: {
        ...CHAPTER.scenes,
        scene_fork: {
          type: "choice_point",
          narration: "Three ways through.",
          choices: [
            { id: "c_smash", label: "Smash it", goto: "scene_hedge", icon: "fist" },
            { id: "c_fly", label: "Fly over", goto: "scene_hedge", icon: "wing" },
            { id: "c_walk", label: "Walk through", goto: "scene_river", icon: "hoof" },
          ],
        },
      },
    };
    expect(nextMoments(runAt("scene_fork"), shared)).toHaveLength(2);

    /*
     * And the label is **dropped** for the shared destination, which is the
     * half that makes collapsing safe rather than merely cheap.
     *
     * Keeping the first label meant a party who *flew over* the hedge got a
     * line generated from "Smash it": the prompt was told they chose something
     * they did not choose, and the result could contradict the authored
     * transition sitting directly above it on the same screen. Confidently
     * wrong about how they got here is worse than saying nothing, because
     * knowing how they got here is the entire reason this layer exists.
     *
     * The prefetch runs before anybody has tapped. When several buttons lead to
     * one room, "I do not know which" is the true answer, and `null` is how it
     * is said.
     */
    const exits = exitsOf(shared.scenes.scene_fork!);
    expect(exits.map((e) => e.goto)).toEqual(["scene_hedge", "scene_river"]);
    expect(exits.map((e) => e.label)).toEqual([null, "Walk through"]);
    expect(nextMoments(runAt("scene_fork"), shared).map((m) => m.request.via)).toEqual([null, "Walk through"]);
  });

  it("keeps the label when exactly one button leads somewhere", () => {
    // The other side of the rule: dropping every label would throw away the
    // most useful thing the prompt gets, on every scene that does not have the
    // collision.
    expect(exitsOf(CHAPTER.scenes.scene_fork!).every((exit) => exit.label !== null)).toBe(true);
  });

  it("skips a destination with no authored text", () => {
    // Nothing to decorate and nothing to fall back to — and the validator's
    // on-topic rule would have no vocabulary to work with either.
    const dangling: Chapter = {
      ...CHAPTER,
      scenes: {
        ...CHAPTER.scenes,
        scene_fork: {
          type: "choice_point",
          narration: "Two doors.",
          choices: [
            { id: "c_a", label: "Quiet door", goto: "scene_quiet", icon: "arrow" },
            { id: "c_b", label: "Loud door", goto: "scene_hedge", icon: "arrow" },
          ],
        },
      },
    };
    expect(nextMoments(runAt("scene_fork"), dangling).map((m) => m.key.sceneId)).toEqual(["scene_hedge"]);
  });

  it("skips a goto that names a scene the chapter does not have", () => {
    // `content:validate` catches this at build time. At table time it must be
    // quiet, not a crash: a broken branch is a scene the layer says nothing
    // about, and the game plays on.
    const broken: Chapter = {
      ...CHAPTER,
      scenes: {
        ...CHAPTER.scenes,
        scene_fork: {
          type: "choice_point",
          narration: "One door.",
          choices: [{ id: "c_a", label: "Nowhere", goto: "scene_missing", icon: "arrow" }],
        },
      },
    };
    expect(nextMoments(runAt("scene_fork"), broken)).toEqual([]);
  });

  it("has nothing to warm in the lobby", () => {
    // Most of a session's intents happen with no scene at all — joining,
    // building a character, readying up.
    expect(nextMoments(runAt(null), CHAPTER)).toEqual([]);
  });
});

describe("what to take on arrival", () => {
  it("round-trips a key written by nextMoments", () => {
    /*
     * The test this file exists for. Two functions build the same string from
     * opposite directions; if they ever disagree the layer goes to a 100% miss
     * rate and looks exactly like a layer that is switched off.
     */
    const written = nextMoments(runAt("scene_fork"), CHAPTER)[0]?.key;
    const read = arrivalKey(runAt("scene_fork"), runAt("scene_hedge"), CHAPTER);
    expect(read).toEqual(written);
  });

  it("round-trips a fight's two outcomes too", () => {
    const written = nextMoments(runAt("encounter_wisps"), CHAPTER);
    const lost = arrivalKey(runAt("encounter_wisps"), runAt("scene_river"), CHAPTER);
    expect(lost).toEqual(written[1]?.key);
  });

  it("has nothing to take when nobody moved", () => {
    // A READY, a trade, a stat spend — most intents do not change the scene,
    // and taking a line on one of them would spend it on a moment that is not
    // an arrival.
    expect(arrivalKey(runAt("scene_fork"), runAt("scene_fork"), CHAPTER)).toBeNull();
  });

  it("has nothing to take when the party arrived by a road the chapter does not author", () => {
    /*
     * A playtest jump is the live case: it moves the party to a scene that the
     * one they left has no branch to. There is no `via` for that, which is
     * correct — nothing chose it.
     */
    expect(arrivalKey(runAt("scene_river"), runAt("scene_hedge"), CHAPTER)).toBeNull();
  });

  it("has nothing to take on the first scene of a chapter", () => {
    // Nobody was anywhere before, so there was no scene to prefetch from.
    expect(arrivalKey(runAt(null), runAt("scene_fork"), CHAPTER)).toBeNull();
  });

  it("does not claim an outcome when a check's branches share a destination", () => {
    // The read half of the collapse pinned above: the arrival's `choiceId` is
    // null — an arrival, not a verdict — and it still round-trips with what
    // `nextMoments` warmed.
    const shared: Chapter = {
      ...CHAPTER,
      scenes: {
        ...CHAPTER.scenes,
        check_gap: {
          type: "check",
          stat: "might",
          tn: 12,
          prompt: "Push through the gap?",
          onSuccess: { goto: "scene_hedge" },
          onFailure: { goto: "scene_hedge" },
        },
      } as Record<string, Scene>,
    };
    const written = nextMoments(runAt("check_gap"), shared)[0]?.key;
    const read = arrivalKey(runAt("check_gap"), runAt("scene_hedge"), shared);
    expect(read?.choiceId).toBeNull();
    expect(read).toEqual(written);
  });
});

describe("the state fingerprint", () => {
  /**
   * A run at a scene with the party in a given condition. The default fixture
   * has an empty party, so these build one — the fingerprint is about hit
   * points and flags, and neither is observable without somebody to have them.
   */
  function runWith(sceneId: string, hp: number, flags: Record<string, boolean>): RunState {
    const base = runAt(sceneId);
    return {
      ...base,
      flags,
      party: [
        {
          character: { id: "c_1", maxHp: 10 } as RunState["party"][number]["character"],
          playerId: "p_1",
          hp,
          down: false,
          connected: true,
          ready: false,
        },
      ],
    };
  }

  it("makes a loop back through the same edge miss rather than serve a stale line", () => {
    /*
     * §6.4 keys the cache on `(sceneId, choiceId)`, which is enough for a party
     * that only ever moves forward and wrong for one that loops. A chapter may
     * route back through a scene it has already been through, and the entry
     * from the first pass is still in the map under an identical key: same
     * edge, same button, a line written before an intervening fight and before
     * three flags got set.
     *
     * Serving that is worse than serving nothing. The layer's whole job is to
     * know what has happened, so a stale line fails at precisely the thing it
     * was added to do — and does it confidently, on a television.
     */
    const first = nextMoments(runWith("scene_fork", 10, { freed_sprite: true }), CHAPTER);
    const hurt = runWith("scene_fork", 3, { freed_sprite: true, met_the_door: true });
    const second = nextMoments(hurt, CHAPTER);

    expect(first[0]?.key.sceneId).toBe(second[0]?.key.sceneId);
    expect(first[0]?.key.choiceId).toBe(second[0]?.key.choiceId);
    expect(first[0]?.key.stamp).not.toBe(second[0]?.key.stamp);
  });

  it("agrees between the scene being left and the scene arrived at", () => {
    // The two halves have to compute the same fingerprint from the same state,
    // or nothing is ever taken and the layer is silently off.
    const before = runWith("scene_fork", 7, { freed_sprite: true });
    const after = { ...runWith("scene_hedge", 7, { freed_sprite: true }), sceneId: "scene_hedge" };

    const warmed = nextMoments(before, CHAPTER).find((m) => m.key.sceneId === "scene_hedge");
    const arrival = arrivalKey(before, after, CHAPTER);

    expect(arrival).not.toBeNull();
    expect(arrival?.stamp).toBe(warmed?.key.stamp);
  });

  it("is fingerprinted from where they were, not from where they landed", () => {
    /*
     * The subtlety that would break every hit. The line was written while the
     * party stood in the *previous* scene, so the fingerprint has to be of that
     * state — and arriving somewhere applies `onEnter`, which can set a flag
     * and change the answer.
     */
    const before = runWith("scene_fork", 7, {});
    const after = { ...runWith("scene_hedge", 7, { arrived_at_hedge: true }), sceneId: "scene_hedge" };

    const warmed = nextMoments(before, CHAPTER).find((m) => m.key.sceneId === "scene_hedge");
    expect(arrivalKey(before, after, CHAPTER)?.stamp).toBe(warmed?.key.stamp);
  });

  it("ignores seq, which moves on every tap and would miss every time", () => {
    // A READY, a roll, a trade — all bump seq without touching anything the
    // prompt reads. Folding seq in would invalidate the batch before the party
    // had finished reading the scene it was warmed for.
    const a = runWith("scene_fork", 10, { freed_sprite: true });
    const b = { ...a, seq: a.seq + 5 };
    expect(nextMoments(a, CHAPTER)[0]?.key.stamp).toBe(nextMoments(b, CHAPTER)[0]?.key.stamp);
  });

  it("holds still across a fight, whose every turn moves somebody's hp", () => {
    /*
     * In a fight the party's health changes on nearly every accepted action,
     * and `warm()` runs after every accepted action. A stamp that included hp
     * was therefore a key that changed every turn: each turn of a fight bought
     * fresh "won the fight"/"lost the fight" lines for the same two exits and
     * orphaned the last turn's — a typical fight paid for its exit lines
     * twenty times over and read one. So a fight's stamp is hp-blind, and the
     * mid-fight re-warm becomes a cache hit that sends nothing.
     */
    const entry = nextMoments(runWith("encounter_wisps", 10, { freed_sprite: true }), CHAPTER);
    const bruised = nextMoments(runWith("encounter_wisps", 3, { freed_sprite: true }), CHAPTER);
    expect(entry[0]?.key.stamp).toBe(bruised[0]?.key.stamp);
    expect(entry[0]?.key).toEqual(bruised[0]?.key);
  });

  it("lets the fight's exit line land however the fight went", () => {
    // The other half: the line warmed when the fight began is the one
    // `arrivalKey` finds when it ends, whatever the hp is by then.
    const entry = runWith("encounter_wisps", 10, { freed_sprite: true });
    const exiting = runWith("encounter_wisps", 2, { freed_sprite: true });
    const landed = runWith("scene_hedge", 2, { freed_sprite: true });

    const warmed = nextMoments(entry, CHAPTER).find((m) => m.key.sceneId === "scene_hedge");
    const read = arrivalKey(exiting, landed, CHAPTER);
    expect(read?.choiceId).toBe("won the fight");
    expect(read).toEqual(warmed?.key);
  });

  it("still re-warms a fight when a flag lands mid-fight", () => {
    // Hp-blind is not state-blind: a flag is rare, the prompt reads it, and a
    // line written before it is the staleness the stamp exists to catch.
    const entry = nextMoments(runWith("encounter_wisps", 10, {}), CHAPTER);
    const flagged = nextMoments(runWith("encounter_wisps", 10, { rang_the_bell: true }), CHAPTER);
    expect(entry[0]?.key.stamp).not.toBe(flagged[0]?.key.stamp);
  });
});
