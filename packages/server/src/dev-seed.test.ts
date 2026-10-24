/**
 * The end-to-end suite's seeded table (dev-seed.ts): a room with its heroes
 * made through the real handlers and the real engine, and a route that only
 * the dev server has.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, type Campaign } from "@kad/shared";
import { readSeedRequest, seedRoom, type SeedRequest } from "./dev-seed.ts";
import { makeChapter, makeContent, makeHarness } from "./test-support.ts";

const CAMPAIGN: Campaign = {
  id: "the-hollow-crown",
  title: "The Hollow Crown",
  blurb: "Two roads north.",
  chapters: ["bramblewood-01"],
};

function harness() {
  return makeHarness({
    engine: { applyIntent, createRunState },
    content: makeContent({ chapters: [makeChapter()], campaigns: [CAMPAIGN] }),
    playtest: true,
  });
}

async function seed(h: ReturnType<typeof harness>, input: SeedRequest) {
  const seeded = await seedRoom(input, h.deps);
  if (!seeded.ok) throw new Error(JSON.stringify(seeded.error));
  return seeded.value;
}

describe("a seeded table", () => {
  it("is a TV's Party Mode room with every hero made, ready and in the first phone's household", async () => {
    const h = harness();
    const seeded = await seed(h, {
      mode: "party",
      tv: true,
      campaignId: CAMPAIGN.id,
      heroes: [
        { name: "Sam", species: "unicorn" },
        { name: "Rosie", species: "griffin", class: "duskrunner" },
      ],
    });
    expect(seeded.tv?.deviceToken).toBeTruthy();
    expect(seeded.phones.map((p) => p.name)).toEqual(["Sam", "Rosie"]);

    const state = (await h.repo.getState(seeded.runId))!;
    expect(state.phase).toBe("creation");
    expect(state.party.map((m) => [m.character.name, m.character.class, m.ready])).toEqual([
      ["Sam", "thornguard", true],
      ["Rosie", "duskrunner", true],
    ]);
    // The TV's placeholder household was claimed by the first phone, as a real join does.
    const room = (await h.repo.getRoom(seeded.code))!;
    expect(room.claimable).not.toBe(true);
    expect(room.householdId).toBe(seeded.phones[0]!.householdId);
    expect(new Set(seeded.phones.map((p) => p.householdId)).size).toBe(1);
    // Each phone holds what the client would have stored: a session for this
    // room, and a binding that names its own player.
    for (const phone of seeded.phones) {
      expect(phone.session).toMatchObject({ runId: seeded.runId, roomCode: seeded.code, playerId: phone.playerId, mode: "party" });
      expect(await h.identity.resolveDevice(phone.deviceToken)).toMatchObject({ playerId: phone.playerId });
    }
  });

  it("is a phone's own room when there is no TV: the first hero hosts it", async () => {
    const h = harness();
    const seeded = await seed(h, {
      mode: "travel",
      campaignId: CAMPAIGN.id,
      heroes: [
        { name: "Sparklehoof", species: "unicorn", player: "Grown-up" },
        { name: "Rosie", species: "griffin" },
      ],
      ready: false,
    });
    expect(seeded.tv).toBeUndefined();
    expect(seeded.phones[0]).toMatchObject({ displayName: "Grown-up", session: { host: true } });
    expect(seeded.phones[1]!.session.host).toBeUndefined();
    const state = (await h.repo.getState(seeded.runId))!;
    expect(state.party.map((m) => m.ready)).toEqual([false, false]);
  });

  it("joins a room already open, and begins at a scene", async () => {
    const h = harness();
    const opened = await seed(h, { mode: "travel", campaignId: CAMPAIGN.id, heroes: [{ name: "Sam", species: "unicorn" }] });
    const joined = await seed(h, {
      mode: "travel",
      code: opened.code,
      heroes: [{ name: "Rosie", species: "griffin" }],
    });
    expect(joined.code).toBe(opened.code);
    expect(joined.runId).toBe(opened.runId);
    const first = (await h.repo.getState(opened.runId))!;
    expect(first.party.map((m) => m.character.name)).toEqual(["Sam", "Rosie"]);

    const h2 = harness();
    const begun = await seed(h2, {
      mode: "party",
      tv: true,
      campaignId: CAMPAIGN.id,
      heroes: [{ name: "Sam", species: "unicorn" }],
      begin: true,
      sceneId: "scene_shrine",
    });
    const state = (await h2.repo.getState(begun.runId))!;
    expect(state).toMatchObject({ phase: "scene", chapterId: "bramblewood-01", sceneId: "scene_shrine" });
  });

  it("says what is wrong with a malformed request instead of half-making a room", () => {
    expect(readSeedRequest({ mode: "solo", heroes: [] })).toMatch(/mode/);
    expect(readSeedRequest({ mode: "travel", tv: true, heroes: [] })).toMatch(/Party Mode/);
    expect(readSeedRequest({ mode: "travel", heroes: [] })).toMatch(/needs a hero/);
    expect(readSeedRequest({ mode: "party", heroes: [{ name: "Sam" }] })).toMatch(/species/);
    expect(readSeedRequest({ mode: "party", tv: true, heroes: [], sceneId: "x" })).toMatch(/needs begin/);
    // A TV alone cannot tap Begin: refused as a bad request, never a thrown error inside seedRoom.
    expect(readSeedRequest({ mode: "party", tv: true, heroes: [], begin: true })).toMatch(/at least one hero/);
    expect(readSeedRequest({ mode: "party", tv: true, heroes: [], begin: true, sceneId: "x" })).toMatch(/at least one hero/);
    expect(typeof readSeedRequest({ mode: "party", tv: true, heroes: [{ name: "Sam", species: "fox" }], begin: true })).toBe("object");
    expect(typeof readSeedRequest({ mode: "party", tv: true, heroes: [] })).toBe("object");
  });

  it("refuses the playtest jump where the switch is off, as production has it", async () => {
    const h = makeHarness({
      engine: { applyIntent, createRunState },
      content: makeContent({ chapters: [makeChapter()], campaigns: [CAMPAIGN] }),
    });
    const seeded = await seedRoom(
      { mode: "travel", campaignId: CAMPAIGN.id, heroes: [{ name: "Sam", species: "unicorn" }], begin: true, sceneId: "scene_shrine" },
      h.deps,
    );
    expect(seeded.ok).toBe(false);
    if (!seeded.ok) expect(seeded.error.code).toBe("FORBIDDEN");
  });
});

describe("the seed route", () => {
  const src = fileURLToPath(new URL(".", import.meta.url));
  const imports = (file: string) => /from "\.\.?\/(?:\.\.\/)*dev-seed\.ts"/.test(readFileSync(file, "utf8"));

  it("is mounted by the dev server", () => {
    expect(imports(`${src}dev-server.ts`)).toBe(true);
    expect(readFileSync(`${src}dev-server.ts`, "utf8")).toContain('app.post("/api/dev/seed"');
  });

  it("is never imported by the Lambda entry points", () => {
    const lambda = readdirSync(`${src}lambda`).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(lambda.length).toBeGreaterThan(0);
    for (const file of lambda) expect(imports(`${src}lambda/${file}`), file).toBe(false);
  });
});
