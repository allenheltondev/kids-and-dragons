/**
 * Fixtures for the colocated `*.test.ts` files.
 *
 * Named so vitest's `*.test.ts` glob does not collect it as a suite.
 *
 * Rules and chapter fixtures are imported from `@kad/shared`'s own fixture file
 * rather than re-typed here. They are deliberately not part of that package's
 * public surface, so this is a test-only relative import — one site, so if the
 * file moves exactly one thing breaks. The alternative is a second, subtly
 * different copy of a 150-line `RulesContent`, which is how test suites start
 * disagreeing about the rules.
 */

import { makeChapter, makeItems, makeRules } from "../../shared/src/test-fixtures.ts";
import { makeRng } from "@kad/shared";
import type { Chapter, ItemCatalog, Role, RulesContent, RunState } from "@kad/shared";
import { LocalSseChannel } from "./channel/room-channel.ts";
import type { ContentStore } from "./content/loader.ts";
import type { ApplyIntentResult, Engine, EngineContext, IntentInput } from "./engine/port.ts";
import type { HandlerDeps } from "./handlers/deps.ts";
import { DevIdentity, type DeviceIdentity } from "./identity.ts";
import { MemoryRepository } from "./store/memory-repository.ts";

export { makeChapter, makeItems, makeRules };

export const T0 = Date.parse("2026-07-04T18:00:00.000Z");

export interface TestClock {
  now(): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function makeClock(start = T0): TestClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}

export function makeContent(
  overrides: { rules?: RulesContent; items?: ItemCatalog; chapters?: Chapter[] } = {},
): ContentStore {
  const rules = overrides.rules ?? makeRules();
  const items = overrides.items ?? makeItems();
  const chapters = new Map((overrides.chapters ?? [makeChapter()]).map((c) => [c.id, c]));
  return {
    root: "<fixture>",
    rules: () => rules,
    items: () => items,
    chapter: (id) => chapters.get(id) ?? null,
    chapterIds: () => [...chapters.keys()],
  };
}

/**
 * An engine that does exactly what the test tells it to.
 *
 * The protocol tests (seq gating, patch monotonicity, replay) are about the
 * transport, so they must not fail because a chapter's numbers changed. The
 * real engine is used in `handlers/flow.test.ts`, where it belongs.
 */
export function stubEngine(
  apply: (state: RunState, input: IntentInput, ctx: EngineContext) => ApplyIntentResult,
): Engine {
  return {
    applyIntent: apply,
    createRunState: (input) => ({
      runId: input.runId,
      roomCode: input.roomCode,
      mode: input.mode,
      seq: 0,
      phase: "lobby",
      campaignId: input.campaignId,
      chapterId: null,
      sceneId: null,
      sceneType: null,
      narration: "",
      art: null,
      party: [],
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: input.now,
    }),
  };
}

/** A stub whose accepted intents set one flag, so patches are easy to assert. */
export function flagSettingEngine(): Engine {
  return stubEngine((state, input) => {
    if (input.intent.type !== "CHOOSE") {
      return { state, error: { code: "ILLEGAL", message: `stub rejects ${input.intent.type}` } };
    }
    if (input.intent.choiceId === "noop") return { state };
    return {
      state: { ...state, flags: { ...state.flags, [input.intent.choiceId]: true } },
      presentation: { kind: "CHOICE_MADE", choiceId: input.intent.choiceId, byPlayerId: input.playerId },
    };
  });
}

export interface TestHarness {
  deps: HandlerDeps;
  repo: MemoryRepository;
  channel: LocalSseChannel;
  identity: DevIdentity;
  clock: TestClock;
}

export interface HarnessOptions {
  engine?: Engine;
  content?: ContentStore;
  clock?: TestClock;
  /** Scripted room-code randomness. Defaults to a seeded generator. */
  random?: () => number;
}

export function makeHarness(options: HarnessOptions = {}): TestHarness {
  const clock = options.clock ?? makeClock();
  const repo = new MemoryRepository({ now: clock.now });
  const channel = new LocalSseChannel();
  const identity = new DevIdentity(repo, clock.now);
  const seeded = makeRng("test-room-codes");

  return {
    repo,
    channel,
    identity,
    clock,
    deps: {
      repo,
      channel,
      identity,
      content: options.content ?? makeContent(),
      engine: options.engine ?? flagSettingEngine(),
      rng: makeRng,
      random: options.random ?? (() => seeded.next()),
      now: clock.now,
    },
  };
}

/** Cycles through fixed codes, so a collision can be forced on demand. */
export function scriptedRandom(codes: string[]): () => number {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits: number[] = [];
  for (const code of codes) {
    for (const ch of code) digits.push(alphabet.indexOf(ch) / alphabet.length);
  }
  let i = 0;
  return () => digits[i++ % digits.length] ?? 0;
}

export interface SeededPlayer {
  principal: DeviceIdentity;
  deviceToken: string;
}

/** A household with `count` players, each on a bound device. */
export async function seedHousehold(
  harness: TestHarness,
  count = 1,
  role: Role = "adult",
): Promise<{ householdId: string; players: SeededPlayer[] }> {
  const householdId = "h_test";
  await harness.repo.putHousehold({
    id: householdId,
    displayName: "Test household",
    ownerSub: "sub-test",
    guest: false,
    createdAt: new Date(harness.clock.now()).toISOString(),
  });

  const players: SeededPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const playerId = `p_${i + 1}`;
    await harness.repo.putPlayer({
      id: playerId,
      householdId,
      displayName: `Player ${i + 1}`,
      color: "#7FD4C1",
      role,
    });
    const { token, deviceId } = await harness.identity.issueDeviceToken({
      householdId,
      playerId,
      role,
    });
    players.push({ principal: { deviceId, householdId, playerId, role }, deviceToken: token });
  }
  return { householdId, players };
}
