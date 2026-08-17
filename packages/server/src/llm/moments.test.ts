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
      difficulty: "medium",
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
    expect(exitsOf(shared.scenes.scene_fork!).map((e) => e.label)).toEqual(["Smash it", "Walk through"]);
    expect(nextMoments(runAt("scene_fork"), shared)).toHaveLength(2);
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
});
