/**
 * The session recap — roadmap chapter 7's last bullet, architecture §6.5.
 *
 * Reached with roadmap chapter 6's playtest jump rather than by playing the
 * reference chapter's eight-step road to its ending. That is what the jump was
 * built for, it keeps this test about the recap instead of about the chapter,
 * and it means the test does not break the next time somebody edits a branch
 * halfway down that road.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { applyIntent, createRunState } from "@kad/shared";
import type { ClientIntent, RulesContent, RunState } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { createNarrator } from "../llm/narrator.ts";
import type { LiveReply } from "../llm/narrator.ts";
import type { Narrator } from "../llm/port.ts";
import { loadContent } from "../content/loader.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;

const RECAP =
  "You went into the Bramblewood after a way through a hedge, and came out the other side with a " +
  "sprite who will not stop following you. Nobody has explained the acorn, and nobody is going to.";

/** The last scene in the reference chapter — a rest with nothing after it. */
const ENDING = "rest_lanternfall";

function narrator(text: string, send?: () => Promise<LiveReply>): Narrator {
  return createNarrator({
    rules: RULES,
    awsRegion: "us-east-1",
    send: send ?? (() => Promise.resolve({ text, cacheRead: 4200, cacheWrite: 0 })),
    log: vi.fn(),
  });
}

/** Plays to the chapter's end via a playtest jump, and returns the final state. */
async function playToTheEnd(
  live?: Narrator,
  /** Runs against the harness before any action, so a test can spy or sabotage. */
  prepare?: (harness: ReturnType<typeof makeHarness>) => void,
): Promise<{ final: RunState; harness: ReturnType<typeof makeHarness> }> {
  const harness = makeHarness({
    engine: realEngine,
    content: await loadContent(path.join(ROOT, "content")),
    playtest: true,
    ...(live ? { narrator: live } : {}),
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

describe("the recap itself", () => {
  it("is absent with the layer off", async () => {
    // Which is every run by default, and the completion screen has its own
    // content either way.
    const { final } = await playToTheEnd();
    expect(final.phase).toBe("chapter_complete");
    expect(final.recap ?? null).toBeNull();
  });

  it("lands on the run when the chapter ends", async () => {
    const { final } = await playToTheEnd(narrator(RECAP));
    expect(final.phase).toBe("chapter_complete");
    expect(final.recap).toBe(RECAP);
  });

  it("is refused when it fails its own gate", async () => {
    // §6.5's second length cap and its forbidden screen apply here too, and a
    // rejection is silent — the chapter still completes.
    const { final } = await playToTheEnd(narrator("Good job!"));
    expect(final.phase).toBe("chapter_complete");
    expect(final.recap ?? null).toBeNull();
  });

  it("gives up rather than holding the chapter open", async () => {
    /*
     * The bound. `recap()` swallows its own failures, but "returns null on
     * error" and "returns" are different promises — a request that hangs rather
     * than fails would keep a finished chapter from committing, behind a socket
     * nobody is watching.
     *
     * A call that never settles: the chapter must still complete.
     */
    const hung = narrator("", () => new Promise<LiveReply>(() => undefined));
    const { final } = await playToTheEnd(hung);
    expect(final.phase).toBe("chapter_complete");
    expect(final.recap ?? null).toBeNull();
  }, 20_000);
});

describe("when the recap arrives", () => {
  type Published = { seq: number; patch: { path: string; value?: unknown }[] };

  it("never rides the completion patch — the chapter's end ships first, the recap follows", async () => {
    /*
     * The ordering this pins: the recap used to be awaited *before* the
     * completion committed, which put up to four seconds of language model
     * between a chapter ending and any screen being told — with the whole wait
     * sitting inside the optimistic-concurrency window. Now the completion
     * broadcasts immediately and the recap lands as its own follow-up commit,
     * one seq later, so a slow model can only ever make the *bonus paragraph*
     * late.
     */
    const sent: Published[] = [];
    const { final } = await playToTheEnd(narrator(RECAP), (harness) => {
      const real = harness.channel.publish.bind(harness.channel);
      vi.spyOn(harness.channel, "publish").mockImplementation(async (room, message) => {
        sent.push(message as unknown as Published);
        await real(room, message);
      });
    });

    // A string value, specifically: START_CHAPTER's patch also touches
    // `/recap` — clearing it to null for the new run — and that is not a recap.
    const carriesRecap = (m: Published) =>
      m.patch.some((op) => op.path === "/recap" && typeof op.value === "string");
    const completion = sent.find((m) =>
      m.patch.some((op) => op.path === "/phase" && op.value === "chapter_complete"),
    );
    const followUp = sent.find(carriesRecap);

    expect(completion).toBeDefined();
    expect(followUp).toBeDefined();
    expect(carriesRecap(completion!)).toBe(false);
    expect(followUp!.seq).toBe(completion!.seq + 1);
    expect(final.seq).toBe(followUp!.seq);
    expect(final.recap).toBe(RECAP);
  });

  it("is dropped silently when somebody acted before it landed", async () => {
    /*
     * The follow-up is a real commit with a real expected seq, and losing that
     * race means the table has already moved on — almost certainly to "back to
     * the lobby". A recap for a screen nobody is looking at is not worth
     * fighting for, and above all it must not fail the action that finished
     * the chapter.
     */
    const { final } = await playToTheEnd(narrator(RECAP), (harness) => {
      const real = harness.repo.commit.bind(harness.repo);
      vi.spyOn(harness.repo, "commit").mockImplementation(async (input) => {
        // The recap's follow-up is the one commit no intent produced.
        if (input.event.intent === undefined) return false;
        return real(input);
      });
    });
    expect(final.phase).toBe("chapter_complete");
    expect(final.recap ?? null).toBeNull();
  });
});
