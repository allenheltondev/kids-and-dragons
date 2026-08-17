/**
 * The AI-optional invariant — the cross-cutting rule, and roadmap chapter 7's
 * done condition.
 *
 * > "Turning the whole layer off changes nothing about whether the game works."
 * > "AI-optional invariant: **tested in CI, not assumed.**"
 *
 * So it is tested by playing the same opening twice through the real engine —
 * once with the layer off, once with a narrator that answers every call — and
 * asserting the two runs differ in the narration and **in nothing else at all**.
 * Not "the game still works", which any test can be made to say: the same seq,
 * the same flags, the same party, the same prompt, the same dice.
 *
 * The narrator here is a fake transport, not a mock of the narrator: the real
 * cache, the real prompt builder and the real validator all run. What is
 * replaced is Bedrock.
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
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const APPEARANCE = { palette: "meadow", accent: "#7FD4C1" };

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;

/** A line that passes the gate against the reference chapter's hedge scene. */
const LIVE_LINE = "The thorns lean back a little, as though the hedge had been expecting somebody taller.";

function character(name: string, species: string, klass: string): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name,
    species,
    class: klass,
    // Exactly rules.creationPoints (3) — a miscount is refused, and a run
    // that never gets a party never reaches a scene to narrate.
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: APPEARANCE,
  } as ClientIntent;
}

/** Drives the reference chapter's opening. Returns every state it passed through. */
async function playOpening(narrator?: Narrator): Promise<RunState[]> {
  const harness = makeHarness({
    engine: realEngine,
    // The real content tree, because the live layer reads `llmHints` and the
    // fixture chapter has none — a fixture would test the defaults path twice.
    content: await realContent(),
    ...(narrator ? { narrator } : {}),
  });
  const { householdId, players } = await seedHousehold(harness, 2);
  const [host, guest] = players;
  if (!host || !guest) throw new Error("setup failed");

  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("room failed");
  const { code, runId } = created.value;
  await joinRoom({ code, principal: host.principal }, harness.deps);
  await joinRoom({ code, principal: guest.principal }, harness.deps);

  const seen: RunState[] = [];
  const send = async (playerId: string, intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    const response = await applyAction({ runId, playerId, seq, intent }, harness.deps);
    // Asserted rather than ignored: a script that silently stops advancing
    // would make every comparison below trivially true.
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    // Prefetch is fired after the broadcast and is not awaited, so a test that
    // wants a warm cache on the *next* intent has to let it land. Real play has
    // a transition animation and somebody reading aloud; this is that gap.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = await harness.repo.getState(runId);
    if (after) seen.push(after);
  };

  await send("p_1", character("Sparklehoof", "unicorn", "songkeeper"));
  await send("p_2", character("Thistle", "bigfoot", "thornguard"));
  await send("p_1", { type: "READY", ready: true });
  await send("p_2", { type: "READY", ready: true });
  await send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    // The reference chapter's entry is `scene_hedge_wall`; `listen` is one of
  // its two ungated choices, so this script does not depend on which species
  // the party happens to have rolled.
  await send("p_1", { type: "CHOOSE", choiceId: "listen" });

  return seen;
}

async function realContent() {
  const { loadContent } = await import("../content/loader.ts");
  return loadContent(path.join(ROOT, "content"));
}

/**
 * A state with its room identity blanked, so two runs can be compared field by
 * field.
 *
 * Two runs are two rooms and get different ids. Rewriting the run id *by
 * substitution* rather than deleting the field takes everything derived from it
 * with it — character ids are `c_<runId>_<playerId>` — and, unlike a list of
 * excluded fields, cannot silently stop covering something a later change
 * derives from the same id.
 *
 * `narration` is the one field the layer is allowed to write, so it is the one
 * field held out. Everything else is compared exactly: the phase, the scene,
 * the party, the prompt, the flags, the dice, `seq` and `updatedAt`.
 */
function normalise(state: RunState): unknown {
  const { narration: _ignored, ...rest } = state;
  const json = JSON.stringify(rest)
    .split(state.runId)
    .join("<run>")
    .split(state.roomCode)
    .join("<room>");
  return JSON.parse(json) as unknown;
}

/** The real narrator, with Bedrock replaced by a function that always answers. */
function talkative(text = LIVE_LINE): Narrator {
  const send = (): Promise<LiveReply> => Promise.resolve({ text, cacheRead: 4200, cacheWrite: 0 });
  return createNarrator({ rules: RULES, awsRegion: "us-east-1", send, log: vi.fn() });
}

describe("the game without the layer", () => {
  it("plays the opening with no narrator at all", async () => {
    // The `LIVE_LLM_ENABLED=false` path, and the default for every other test
    // in this repo. `deps.narrator` is simply not set.
    const states = await playOpening();
    const last = states.at(-1);
    expect(last?.sceneId).toBe("scene_humming");
    expect(last?.narration.length).toBeGreaterThan(0);
  });
});

describe("the game with the layer", () => {
  it("changes the narration and nothing else", async () => {
    /*
     * The invariant, stated as a diff. Two runs of the same script with the
     * same seeded dice: everything the game *is* must be identical, and the
     * only field allowed to differ is the one the layer exists to write.
     *
     * `seq` and `updatedAt` are excluded because they are transport, not state,
     * and the clock is the same fixture in both — but every flag, the party,
     * the prompt, the phase, the scene and the roll are compared as they stand.
     */
    const off = await playOpening();
    const on = await playOpening(talkative());

    expect(on).toHaveLength(off.length);
    for (const [index, before] of off.entries()) {
      const after = on[index];
      if (!after) throw new Error("length mismatch");
      expect(normalise(after)).toEqual(normalise(before));
    }
  });

  it("actually said something, or the test above proves nothing", async () => {
    /*
     * The other half, and the one that keeps the first honest. A narrator that
     * silently never fired would pass "changes nothing else" perfectly.
     */
    const on = await playOpening(talkative());
    const narrations = on.map((state) => state.narration);
    expect(narrations.some((line) => line.includes(LIVE_LINE))).toBe(true);
  });

  it("keeps the branch's authored line in front of the live one", async () => {
    /*
     * `enterSceneDraft` builds the narration as the branch's own line — written
     * for this specific transition — followed by the destination's text. Only
     * the second half is the layer's to replace. Eating the first would be
     * deleting the author's work to make room.
     */
    const on = await playOpening(talkative());
    const decorated = on.find((state) => state.narration.includes(LIVE_LINE));
    expect(decorated).toBeDefined();
    const off = await playOpening();
    const plain = off[on.indexOf(decorated!)];
    // Whatever the authored transition line was, it is still the opening of the
    // decorated version.
    const transition = plain?.narration.split("\n\n")[0] ?? "";
    if (plain && plain.narration.includes("\n\n")) {
      expect(decorated?.narration.startsWith(transition)).toBe(true);
    }
  });

  it("falls back to the authored text when every line is rejected", async () => {
    /*
     * §6.5's silent discard, end to end. A narrator whose model answers with
     * something the gate refuses must be indistinguishable from no narrator at
     * all — including in the narration, which is the field the layer is
     * otherwise allowed to touch.
     */
    const off = await playOpening();
    const on = await playOpening(talkative("There is blood on the thorns and something here has met its death."));
    expect(on.map((s) => s.narration)).toEqual(off.map((s) => s.narration));
  });

  it("falls back when the model declines", async () => {
    // PASS is a good answer, and its effect on the game has to be exactly none.
    const off = await playOpening();
    const on = await playOpening(talkative("PASS"));
    expect(on.map((s) => s.narration)).toEqual(off.map((s) => s.narration));
  });

  it("survives a narrator whose transport throws on every call", async () => {
    /*
     * The outage case. Bedrock being down, credentials expired, the region
     * wrong — all of it arrives here as a rejected promise inside a
     * fire-and-forget prefetch, and the game must not notice.
     */
    const broken = createNarrator({
      rules: RULES,
      awsRegion: "us-east-1",
      send: () => Promise.reject(new Error("bedrock is down")),
      log: vi.fn(),
    });
    const off = await playOpening();
    const on = await playOpening(broken);
    expect(on.map((s) => s.narration)).toEqual(off.map((s) => s.narration));
  });
});
