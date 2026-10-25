/**
 * The class places in a graph campaign (#315, epic #307's exit test): a hero
 * switches class at each of the four rooms in the Riftlight draft and switches
 * back, with every rank intact, through the shipping loader, the real engine
 * and the handlers.
 *
 * The rooms are side rooms of Riftlight places, each entered from that
 * place's rest scene (docs/class-mastery.md §2): the Rookery on the Exchange's
 * rooftops, the Conservatory off the singing hall, the Dojo in the Sky Islands,
 * and the Academy in the marsh village reached from Ashspan Bridge. One hero
 * walks the graph to all four: a Thornguard Expert who once earned Starweaver
 * Apprentice puts on the dusk hood, the song bell, the star circlet (still
 * Apprentice) and the thorn bracer again (still Expert).
 *
 * The shipped content is staged into a scratch root the way the local preview
 * stages it, with Riftlight's Gemfall prerequisite dropped, so one hero can
 * walk straight in.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyIntent, createRunState, makeRng } from "@kad/shared";
import type { Campaign, ClassId, ClientIntent, RunState } from "@kad/shared";
import { loadContent, type ContentStore } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

const scratch: string[] = [];
afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const campaignId = "riftlight";
const riftlight: Promise<ContentStore> = (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kad-riftlight-rooms-"));
  scratch.push(dir);
  await cp(path.join(ROOT, "content"), dir, { recursive: true });
  const file = path.join(dir, "campaigns", `${campaignId}.json`);
  const campaign = JSON.parse(await readFile(file, "utf8")) as Campaign;
  delete campaign.requires;
  await writeFile(file, JSON.stringify(campaign));
  return loadContent(dir);
})();

describe("the four class rooms in Riftlight (#315)", () => {
  it("a hero switches at the Rookery, the Conservatory, the Academy and the Dojo, and back, with every rank intact", { timeout: 60_000 }, async () => {
    const harness = makeHarness({ engine: realEngine, playtest: true, content: await riftlight });
    harness.deps.rng = (key) => makeRng(`riftlight-rooms:${String(key).split(":").pop()}`);
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party", campaignId }, harness.deps);
    if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
    const { code, runId } = created.value;
    const joined = await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    const me = joined.value.playerId;

    const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
    const must = async (intent: ClientIntent) => {
      const response = await applyAction({ runId, playerId: me, seq: (await state()).seq, intent }, harness.deps);
      expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    };
    const visit = async () => ((await state()).campaign ?? (await state()).campaignOptions?.[0])?.journey?.visit ?? 0;
    const row = async () => (await harness.repo.listCharacters(householdId))[0]!;
    const worn = async () => (await state()).party[0]!.character;
    /** Leaves the place just finished by a way of the journey, and starts the chapter there. */
    const travel = async (edgeId: string, chapterId: string) => {
      await must({ type: "CHOOSE_EXIT", edgeId, visit: await visit() });
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
      await must({ type: "CONTINUE_CAMPAIGN" });
      expect((await state()).chapterId).toBe(chapterId);
    };
    /** From a place's rest scene into its room, the way a table walks in. */
    const walkIn = async (rest: string, choiceId: string, room: string, classId: ClassId) => {
      await must({ type: "PLAYTEST_GOTO", sceneId: rest });
      await must({ type: "CHOOSE", choiceId });
      expect((await state()).sceneId).toBe(room);
      expect((await state()).classPlace).toEqual({ class: classId, answers: {} });
    };

    await must({
      type: "CREATE_CHARACTER",
      name: "Glimmer",
      species: "bigfoot",
      class: "thornguard",
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      appearance: { palette: "meadow", accent: "#7FD4C1" },
    });
    // Ranks earned before tonight: Thornguard Expert, and Starweaver Apprentice
    // from a switch long ago.
    const before = await row();
    before.committed.mastery.thornguard = { rank: "expert", deeds: { shove: 2 } };
    before.committed.mastery.starweaver = { rank: "apprentice", deeds: { burst: 1 } };
    await harness.repo.putCharacter(before);
    await must({ type: "READY", ready: true });
    await must({ type: "CONTINUE_CAMPAIGN", campaignId });
    expect((await state()).chapterId).toBe("riftlight-exchange-rift");
    expect(await worn()).toMatchObject({ class: "thornguard", rank: "expert" });

    // The Exchange: up the ladder from the quay to the Rookery. Duskrunner, from nothing.
    await walkIn("quay_rest", "roof", "rookery", "duskrunner");
    await must({ type: "SWITCH_CLASS", classId: "duskrunner" });
    expect(await worn()).toMatchObject({ class: "duskrunner" });
    expect((await worn()).rank).toBeUndefined();
    await must({ type: "CHOOSE", choiceId: "down" });
    expect((await state()).sceneId).toBe("quay_rest");
    await must({ type: "PLAYTEST_GOTO", sceneId: "white" });

    // The Glacier of Origins: through the glass door off the singing hall. Songkeeper.
    await travel("exchange-to-glacier", "riftlight-glacier-survival");
    await walkIn("hall", "glass_door", "conservatory", "songkeeper");
    await must({ type: "SWITCH_CLASS", classId: "songkeeper" });
    expect(await worn()).toMatchObject({ class: "songkeeper" });
    await must({ type: "CHOOSE", choiceId: "back" });
    expect((await state()).sceneId).toBe("hall");
    await must({ type: "PLAYTEST_GOTO", sceneId: "departure" });

    // The long bank road reaches the marsh village without a roll or a rift.
    await travel("glacier-to-riftseekers", "riftlight-riftseekers-departure");
    await must({ type: "PLAYTEST_GOTO", sceneId: "set_out" });
    await travel("departure-to-bridge", "riftlight-ashspan-bridge");
    await walkIn("village_rest", "tower", "academy", "starweaver");
    await must({ type: "SWITCH_CLASS", classId: "starweaver" });
    expect(await worn()).toMatchObject({ class: "starweaver", rank: "apprentice" });
    await must({ type: "CHOOSE", choiceId: "back" });
    expect((await state()).sceneId).toBe("village_rest");
    await must({ type: "CHOOSE", choiceId: "return" });
    await must({ type: "CHOOSE", choiceId: "continue" });
    await must({ type: "PLAYTEST_GOTO", sceneId: "routes" });

    // The upper bank road and the griffins' flight reach the Sky Islands Dojo.
    await travel("bridge-to-shore", "riftlight-frostfang-shore");
    await must({ type: "PLAYTEST_GOTO", sceneId: "climb" });
    await travel("shore-to-pass", "riftlight-cairnstep-pass");
    await must({ type: "PLAYTEST_GOTO", sceneId: "message" });
    await travel("pass-to-sky", "riftlight-sky-islands-arrival");
    await walkIn("island_rest", "hut", "dojo", "thornguard");
    await must({ type: "SWITCH_CLASS", classId: "thornguard" });
    expect(await worn()).toMatchObject({ class: "thornguard", rank: "expert" });
    expect((await worn()).actions).toEqual(expect.arrayContaining(["brace", "shove", "bramble_wall"]));
    expect((await worn()).actions).not.toContain("unbreakable");
    await must({ type: "CHOOSE", choiceId: "back" });
    expect((await state()).sceneId).toBe("island_rest");
    await must({ type: "CHOOSE", choiceId: "set_out" });

    // Four switches, and nothing earned was lost on the way.
    const stored = await row();
    const progress = stored.provisional ?? stored.committed;
    expect(progress.class).toBe("thornguard");
    expect(progress.mastery.thornguard).toMatchObject({ rank: "expert", deeds: { shove: 2 } });
    expect(progress.mastery.starweaver).toMatchObject({ rank: "apprentice", deeds: { burst: 1 } });
    expect(progress.mastery.duskrunner?.rank ?? "none").toBe("none");
    expect(progress.mastery.songkeeper?.rank ?? "none").toBe("none");
    // Stats never moved.
    expect(progress.stats).toEqual(before.committed.stats);
  });
});
