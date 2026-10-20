/**
 * The end-of-chapter recap's server half — the trail it is told from.
 *
 * The recap is authored-only (#347): the completion screen retells the
 * priority-1 scenes on `RunState.visited` in their own words, so all the
 * server owes it is an honest trail and a completion that lands in one turn.
 *
 * Reached with roadmap chapter 6's playtest jump rather than by playing the
 * reference chapter's eight-step road to its ending. That is what the jump was
 * built for, it keeps this test about the recap instead of about the chapter,
 * and it means the test does not break the next time somebody edits a branch
 * halfway down that road.
 */

import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { applyIntent, createRunState } from "@kad/shared";
import type { ClientIntent, RunState } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { loadContent } from "../content/loader.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/** The last scene in the reference chapter — a rest with nothing after it. */
const ENDING = "rest_lanternfall";

/** Plays to the chapter's end via a playtest jump, and returns the final state. */
async function playToTheEnd(
  /** Runs against the harness before any action, so a test can spy or sabotage. */
  prepare?: (harness: ReturnType<typeof makeHarness>) => void,
): Promise<{ final: RunState; harness: ReturnType<typeof makeHarness> }> {
  const harness = makeHarness({
    engine: realEngine,
    content: await loadContent(path.join(ROOT, "content")),
    playtest: true,
  });
  prepare?.(harness);
  const { householdId, players } = await seedHousehold(harness, 1);
  const host = players[0];
  if (!host) throw new Error("setup failed");

  const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
  if (!created.ok) throw new Error("room failed");
  const { code, runId } = created.value;
  await joinRoom({ code, principal: host.principal }, harness.deps);

  const send = async (intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    const response = await applyAction({ runId, playerId: "p_1", seq, intent }, harness.deps);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
  };

  await send({
    type: "CREATE_CHARACTER",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  } as ClientIntent);
  await send({ type: "READY", ready: true });
  await send({ type: "START_CHAPTER", chapterId: "bramblewood-01" });
  // Arriving is what completes the chapter — an `ADVANCE` after this is the
  // completion screen's "back to the lobby" button, which would move the run
  // past the state under test.
  await send({ type: "PLAYTEST_GOTO", sceneId: ENDING });

  const final = await harness.repo.getState(runId);
  if (!final) throw new Error("no state");
  return { final, harness };
}

describe("the trail", () => {
  it("records every scene the party entered, in order", async () => {
    // The spine of the recap. Kept on the run rather than derived from the
    // event log, so a client that mirrors the state has the whole road.
    const { final } = await playToTheEnd();
    expect(final.visited?.[0]).toBe("scene_hedge_wall");
    expect(final.visited?.at(-1)).toBe(ENDING);
  });

  it("does not repeat a scene the party did not leave", async () => {
    // Re-entering the scene you are already on is not a step in the story, and
    // a recap that names the same room twice in a row reads like a bug.
    const { final } = await playToTheEnd();
    const trail = final.visited ?? [];
    for (let i = 1; i < trail.length; i += 1) expect(trail[i]).not.toBe(trail[i - 1]);
  });
});

describe("the chapter's end", () => {
  it("lands in one turn, with nothing written after it", async () => {
    /*
     * There used to be a generated recap that followed the completion as its
     * own commit. There is no such thing now: the turn that completes the
     * chapter is the last write, and every commit carries an intent.
     */
    const intentless: unknown[] = [];
    const { final } = await playToTheEnd((harness) => {
      const real = harness.repo.commit.bind(harness.repo);
      // Armed by the first player action, so the join's own write (it puts the
      // player on the host's roster, #263) is not counted.
      let armed = false;
      vi.spyOn(harness.repo, "commit").mockImplementation(async (input) => {
        if (input.event.intent !== undefined) armed = true;
        if (armed && input.event.intent === undefined) intentless.push(input.event);
        return real(input);
      });
    });
    expect(final.phase).toBe("chapter_complete");
    expect(intentless).toEqual([]);
  });

  it("carries no generated text on the run", async () => {
    const { final } = await playToTheEnd();
    expect(final.phase).toBe("chapter_complete");
    expect("recap" in final).toBe(false);
  });
});
