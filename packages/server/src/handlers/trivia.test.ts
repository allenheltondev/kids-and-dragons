/**
 * The Field Guide quiz's server side (docs/trivia.md §5.1, §6): answers are
 * authorised by the phone's device binding alone and land on the bound kid's
 * own record; an answer about a page the household has not found (or that is
 * otherwise not one the phone could honestly have asked) never counts; a
 * question is mastered once; a rung is granted once, its title written to
 * every one of her heroes and read back for a hero made later; two phones for
 * one kid union, and a lost race is retried; and the book's read carries the
 * record, its badges, and survives a record that cannot be read.
 */

import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { readLook, type JournalResponse, type JournalTriviaResponse, type LookCatalog, type TriviaAnswer, type TriviaLadder, type TriviaQuestion } from "@kad/shared";
import { LOOKS_FIXTURE, makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { respond, type HttpRuntime } from "../lambda/http.ts";
import { answerTrivia, grantTriviaLooks } from "./trivia.ts";
import { getJournal } from "./journal.ts";
import { saveFlair } from "./profile.ts";
import type { GameRepository } from "../store/repository.ts";

const question = (id: string, entry: string, also: string[] = []): TriviaQuestion => ({
  id,
  entry,
  ask: `What about ${entry}?`,
  answer: "Right",
  wrong: ["Wrong one", "Wrong two", "Wrong three", "Wrong four", "Wrong five"],
  also,
  link: "entry",
});

const BANK: TriviaQuestion[] = [
  question("creature.moth.wings", "creature.moth"),
  question("creature.newt.tail", "creature.newt"),
  question("creature.owl.eyes", "creature.owl"),
  // Names a page nobody has found.
  question("creature.moth.friend", "creature.moth", ["creature.yeti"]),
  question("creature.yeti.fur", "creature.yeti"),
];

const LADDER: TriviaLadder = {
  rungs: [
    { at: 1, badge: { id: "trivia-1", name: "Curious Reader", blurb: "One right." } },
    { at: 2, title: "the_learned" },
    { at: 3, badge: { id: "trivia-3", name: "Lore Hound", blurb: "Three right." } },
  ],
  firstTry: [{ at: 2, badge: { id: "trivia-first-2", name: "Sharp Memory", blurb: "Two on the first ask." } }],
};

const LOOKS: LookCatalog = {
  ...LOOKS_FIXTURE,
  titles: [...LOOKS_FIXTURE.titles, { id: "the_learned", text: "the Learned", unlock: { from: "trivia", rung: 2 } }],
};

const SHOWN = ["Wrong two", "Right", "Wrong one", "Wrong five"];
const AT = "2026-07-04T17:00:00.000Z";

function answer(questionId: string, over: Partial<TriviaAnswer> = {}): TriviaAnswer {
  return { questionId, optionsShown: SHOWN, picked: "Right", at: AT, round: "r1", ...over };
}

const event = (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  ({
    rawPath: path,
    requestContext: { http: { method, sourceIp: "10.0.0.1" } },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: init.headers ?? {},
  }) as unknown as APIGatewayProxyEventV2;
const bodyOf = <T>(r: APIGatewayProxyStructuredResultV2): T => JSON.parse(r.body ?? "{}") as T;

/** Ada with two heroes and Ben with one, in a household that has found the moth, the newt and the owl. */
async function family() {
  const harness = makeHarness({ content: makeContent({ triviaBank: BANK, triviaLadder: LADDER, looksCatalog: LOOKS }) });
  const { householdId, players } = await seedHousehold(harness, 2);
  const [ada, ben] = players as [(typeof players)[number], (typeof players)[number]];
  for (const [id, who, name] of [["c_ada", ada, "Sparklehoof"], ["c_ada2", ada, "Moonbeam"], ["c_ben", ben, "Rumble"]] as const) {
    await harness.repo.putCharacter({ ...makeCharacter({ id, ownerPlayerId: who.principal.playerId, name }), householdId });
  }
  await harness.repo.recordDiscoveries(householdId, [
    { canonId: "creature.moth", playerId: "p_1", foundAt: AT },
    { canonId: "creature.newt", playerId: "p_2", foundAt: AT },
    { canonId: "creature.owl", playerId: "p_1", foundAt: AT },
  ]);
  const rt: HttpRuntime = { deps: async () => harness.deps, verifyAccount: async () => null };
  const post = (token: string | null, body: unknown) =>
    respond(event("POST", "/api/journal/trivia", { body, headers: token ? { "x-kad-device-token": token } : {} }), rt);
  return { harness, rt, householdId, ada, ben, post };
}

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe("POST /api/journal/trivia", () => {
  it("is authorised by the device binding alone, and lands on the bound kid's own record", async () => {
    const { harness, householdId, ada, ben, post } = await family();
    const body = { answers: [answer("creature.moth.wings")] };
    expect((await post(null, body)).statusCode).toBe(401);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(0);

    const saved = await post(ada.deviceToken, body);
    expect(saved.statusCode).toBe(200);
    expect(bodyOf<JournalTriviaResponse>(saved)).toMatchObject({
      trivia: { v: 1, mastered: { "creature.moth.wings": { at: AT, firstTry: true } }, missed: {}, rungs: [1] },
      verdicts: [{ questionId: "creature.moth.wings", at: AT, verdict: "counted" }],
      granted: [{ at: 1 }],
      badges: [{ id: "trivia-1", name: "Curious Reader" }],
    });

    // Her brother's phone answers for him, whatever the body says.
    const his = await post(ben.deviceToken, { ...body, playerId: "p_1", householdId });
    expect(his.statusCode).toBe(200);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(1);
    expect(Object.keys(bodyOf<JournalTriviaResponse>(his).trivia.mastered)).toEqual(["creature.moth.wings"]);
    expect((await harness.repo.getTrivia(householdId, "p_2"))?.revision).toBe(1);

    // A revoked phone is nobody's.
    await harness.repo.revokeDevice(householdId, ada.principal.deviceId);
    expect((await post(ada.deviceToken, { answers: [answer("creature.newt.tail")] })).statusCode).toBe(401);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(1);
  });

  it("refuses a malformed batch, and content with no quiz", async () => {
    const { harness, householdId, ada, post } = await family();
    expect((await post(ada.deviceToken, {})).statusCode).toBe(409);
    expect((await post(ada.deviceToken, { answers: [{ questionId: "creature.moth.wings" }] })).statusCode).toBe(409);
    expect((await post(ada.deviceToken, { answers: [answer("creature.moth.wings", { at: "yesterday" })] })).statusCode).toBe(409);
    const none = await answerTrivia(
      { householdId, playerId: "p_1", body: { answers: [answer("creature.moth.wings")] } },
      { ...harness.deps, content: { ...harness.deps.content, triviaBank: () => null } },
    );
    expect(none.ok).toBe(false);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(0);
  });

  it("never counts an answer about a page the household has not found, or one it could not have asked", async () => {
    const { harness, householdId, ada, post } = await family();
    const res = bodyOf<JournalTriviaResponse>(
      await post(ada.deviceToken, {
        answers: [
          answer("creature.yeti.fur"),
          // Its own page is found, but it names one that is not.
          answer("creature.moth.friend"),
          answer("creature.nobody.ever"),
          answer("creature.owl.eyes", { optionsShown: ["Right", "Wrong one", "Wrong two", "Made up"] }),
          answer("creature.owl.eyes", { picked: "Wrong three" }),
        ],
      }),
    );
    expect(res.verdicts.map((v) => v.verdict)).toEqual(["not-found", "not-found", "unknown-question", "bad-options", "not-shown"]);
    expect(res.trivia).toEqual({ v: 1, mastered: {}, missed: {}, rungs: [] });
    expect(res.granted).toEqual([]);
    // Nothing new: nothing written.
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(0);

    // Once the yeti is found, the same answer counts.
    await harness.repo.recordDiscoveries(householdId, [{ canonId: "creature.yeti", playerId: "p_2", foundAt: AT }]);
    const later = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, { answers: [answer("creature.yeti.fur")] }));
    expect(later.verdicts[0]?.verdict).toBe("counted");
  });

  it("counts a question's mastery once, and a resent batch writes nothing", async () => {
    const { harness, householdId, ada, post } = await family();
    const batch = { answers: [answer("creature.moth.wings"), answer("creature.moth.wings", { at: "2026-07-04T17:01:00.000Z", round: "r2" })] };
    const first = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, batch));
    expect(first.verdicts.map((v) => v.verdict)).toEqual(["counted", "already"]);
    expect(first.trivia.mastered["creature.moth.wings"]).toEqual({ at: AT, firstTry: true });
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(1);

    // The queue resends it (the response was lost): already, and no write.
    const again = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, batch));
    expect(again.verdicts.map((v) => v.verdict)).toEqual(["already", "already"]);
    expect(again.granted).toEqual([]);
    expect(again.badges).toEqual([]);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(1);
    // A wrong answer to a mastered question takes nothing back.
    const wrong = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, { answers: [answer("creature.moth.wings", { picked: "Wrong one" })] }));
    expect(wrong.verdicts[0]?.verdict).toBe("already");
    expect(Object.keys(wrong.trivia.mastered)).toEqual(["creature.moth.wings"]);
    expect(wrong.trivia.missed).toEqual({});
  });

  it("records a miss for its round, and a later right answer masters it, not on the first try", async () => {
    const { ada, post } = await family();
    const missed = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, { answers: [answer("creature.newt.tail", { picked: "Wrong one" })] }));
    expect(missed.verdicts[0]?.verdict).toBe("missed");
    expect(missed.trivia.missed).toEqual({ "creature.newt.tail": { at: AT, round: "r1" } });
    const right = bodyOf<JournalTriviaResponse>(
      await post(ada.deviceToken, { answers: [answer("creature.newt.tail", { at: "2026-07-04T17:05:00.000Z", round: "r2" })] }),
    );
    expect(right.trivia.mastered["creature.newt.tail"]).toEqual({ at: "2026-07-04T17:05:00.000Z", firstTry: false });
    expect(right.trivia.missed).toEqual({});
  });

  it("grants a rung once, writing its title to every one of her heroes and nobody else's", async () => {
    const { harness, householdId, ada, post } = await family();
    const res = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, { answers: [answer("creature.moth.wings"), answer("creature.newt.tail")] }));
    expect(res.granted.map((r) => r.at)).toEqual([1, 2]);
    expect(res.trivia.rungs).toEqual([1, 2]);
    expect(res.badges.map((b) => b.id)).toEqual(["trivia-1", "trivia-first-2"]);
    for (const id of ["c_ada", "c_ada2"]) {
      const look = readLook((await harness.repo.getCharacter(householdId, id))!);
      expect(look.unlocked["the_learned"]).toEqual({ from: "trivia", rung: 2, at: new Date(harness.clock.now()).toISOString(), source: "From the quiz" });
      expect(look.revision).toBe(1);
    }
    expect((await harness.repo.getCharacter(householdId, "c_ben"))?.look).toBeUndefined();

    // A third right answer reaches a badge rung, and grants the title to nobody again.
    const more = bodyOf<JournalTriviaResponse>(await post(ada.deviceToken, { answers: [answer("creature.owl.eyes")] }));
    expect(more.granted.map((r) => r.at)).toEqual([3]);
    expect(more.badges.map((b) => b.id)).toEqual(["trivia-3"]);
    for (const id of ["c_ada", "c_ada2"]) expect(readLook((await harness.repo.getCharacter(householdId, id))!).revision).toBe(1);
  });

  it("gives a hero made after the rung its title: read back at once, written on her next batch", async () => {
    const { harness, householdId, ada, post } = await family();
    await post(ada.deviceToken, { answers: [answer("creature.moth.wings"), answer("creature.newt.tail")] });
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ada3", ownerPlayerId: "p_1", name: "Pip" }), householdId });

    // The book reads it back before anything is written to her.
    const journal = value(await getJournal({ householdId, playerId: "p_1" }, harness.deps));
    const pip = journal.heroes.find((h) => h.id === "c_ada3");
    expect(pip?.look?.unlocked).toContain("the_learned");
    expect(pip?.look?.sources?.["the_learned"]).toBe("From the quiz");
    expect((await harness.repo.getCharacter(householdId, "c_ada3"))?.look).toBeUndefined();

    // And the book can pick it for her, keeping the receipt.
    const picked = await respond(
      event("POST", "/api/journal/kit", {
        body: { characterId: "c_ada3", changes: [{ field: "title", before: null, after: "the_learned" }] },
        headers: { "x-kad-device-token": ada.deviceToken },
      }),
      { deps: async () => harness.deps, verifyAccount: async () => null },
    );
    expect(picked.statusCode).toBe(200);
    const stored = readLook((await harness.repo.getCharacter(householdId, "c_ada3"))!);
    expect(stored.title).toBe("the_learned");
    expect(stored.unlocked["the_learned"]).toMatchObject({ from: "trivia", rung: 2 });

    // A hero whose grant was lost is caught up by her next batch, even one that counts nothing.
    await harness.repo.putCharacter({ ...makeCharacter({ id: "c_ada4", ownerPlayerId: "p_1", name: "Fern" }), householdId });
    await post(ada.deviceToken, { answers: [answer("creature.moth.wings")] });
    expect(readLook((await harness.repo.getCharacter(householdId, "c_ada4"))!).unlocked["the_learned"]).toMatchObject({ from: "trivia", rung: 2 });
    // Nobody already holding it is written again.
    expect(await grantTriviaLooks(householdId, "p_1", [1, 2], AT, harness.deps)).toBe(0);
  });

  it("unions two phones for one kid, keeping the earliest mastery and the latest miss", async () => {
    const { harness, householdId, ada, post } = await family();
    const second = await harness.identity.issueDeviceToken({ householdId, playerId: "p_1" });
    await post(ada.deviceToken, {
      answers: [answer("creature.moth.wings", { at: "2026-07-04T17:10:00.000Z" }), answer("creature.owl.eyes", { picked: "Wrong one", at: "2026-07-04T17:10:00.000Z" })],
    });
    // The other phone's queue drains later, with answers from before.
    const res = bodyOf<JournalTriviaResponse>(
      await post(second.token, {
        answers: [
          answer("creature.newt.tail", { at: "2026-07-04T16:00:00.000Z" }),
          answer("creature.owl.eyes", { picked: "Wrong two", at: "2026-07-04T16:00:00.000Z", round: "old" }),
        ],
      }),
    );
    expect(Object.keys(res.trivia.mastered).sort()).toEqual(["creature.moth.wings", "creature.newt.tail"]);
    expect(res.trivia.missed).toEqual({ "creature.owl.eyes": { at: "2026-07-04T17:10:00.000Z", round: "r1" } });
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(2);
  });

  it("retries a lost race from a fresh read, so neither phone's answers are lost", async () => {
    const { harness, householdId, ada } = await family();
    let raced = false;
    const repo = new Proxy(harness.repo, {
      get(target, prop) {
        if (prop === "putTrivia") {
          return async (write: Parameters<GameRepository["putTrivia"]>[0]) => {
            if (!raced) {
              raced = true;
              // The other phone's batch lands between this one's read and its write.
              await answerTrivia({ householdId, playerId: "p_1", body: { answers: [answer("creature.owl.eyes")] } }, harness.deps);
            }
            return target.putTrivia(write);
          };
        }
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const res = value(await answerTrivia({ householdId, playerId: ada.principal.playerId, body: { answers: [answer("creature.moth.wings")] } }, { ...harness.deps, repo }));
    expect(Object.keys(res.trivia.mastered).sort()).toEqual(["creature.moth.wings", "creature.owl.eyes"]);
    expect(res.trivia.rungs).toEqual([1, 2]);
    // The rung the other batch granted is not told again; this one's is.
    expect(res.granted.map((r) => r.at)).toEqual([2]);
    expect((await harness.repo.getTrivia(householdId, "p_1"))?.revision).toBe(2);
  });
});

describe("the book's read of the quiz", () => {
  it("carries her record (empty before she quizzes) and her quiz badges, and only hers", async () => {
    const { rt, ada, ben, post } = await family();
    const read = async (token: string) => bodyOf<JournalResponse>(await respond(event("GET", "/api/journal", { headers: { "x-kad-device-token": token } }), rt));
    expect((await read(ada.deviceToken)).trivia).toEqual({ v: 1, mastered: {}, missed: {}, rungs: [] });

    await post(ada.deviceToken, { answers: [answer("creature.moth.wings"), answer("creature.newt.tail")] });
    const hers = await read(ada.deviceToken);
    expect(hers.trivia).toMatchObject({ mastered: { "creature.moth.wings": { firstTry: true } }, rungs: [1, 2] });
    expect(hers.profile?.badges.map((b) => b.id)).toEqual(expect.arrayContaining(["trivia-1", "trivia-first-2"]));
    const his = await read(ben.deviceToken);
    expect(his.trivia?.mastered).toEqual({});
    expect(his.profile?.badges.map((b) => b.id)).not.toContain("trivia-1");
  });

  it("lets her pick a quiz badge for her page", async () => {
    const { harness, householdId, ada, post } = await family();
    await post(ada.deviceToken, { answers: [answer("creature.moth.wings")] });
    const saved = value(await saveFlair({ householdId, playerId: "p_1", body: { title: "trivia-1" } }, harness.deps));
    expect(saved.flair.title).toBe("trivia-1");
    expect(saved.badges.map((b) => b.id)).toContain("trivia-1");
    // One she has not earned is refused.
    expect((await saveFlair({ householdId, playerId: "p_1", body: { title: "trivia-3" } }, harness.deps)).ok).toBe(false);
  });

  it("is whole when her record cannot be read: everything else, and no record to replace the phone's", async () => {
    const { harness, householdId, ada, post } = await family();
    await post(ada.deviceToken, { answers: [answer("creature.moth.wings"), answer("creature.newt.tail")] });
    const broken = {
      ...harness.deps,
      repo: new Proxy(harness.repo, {
        get(target, prop) {
          if (prop === "getTrivia") return () => Promise.reject(new Error("the table is not answering"));
          const v: unknown = Reflect.get(target, prop, target);
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      }),
    };
    const journal = value(await getJournal({ householdId, playerId: "p_1" }, broken));
    expect(journal.trivia).toBeUndefined();
    expect(journal.heroes.map((h) => h.id).sort()).toEqual(["c_ada", "c_ada2"]);
    // Her titles stand as written.
    expect(journal.heroes[0]?.look?.unlocked).toContain("the_learned");
    expect(journal.profile).toBeDefined();
  });
});
