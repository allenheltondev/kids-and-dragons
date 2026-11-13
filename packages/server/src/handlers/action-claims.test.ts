/**
 * The order of what a committed step claims before its broadcast
 * (`claimStepRewards` in action.ts): which claims go side by side and which
 * still wait for the one before. Each claim is replaced by one that logs when
 * it starts and ends and takes a few milliseconds, so the log shows the
 * schedule and nothing else; what each claim writes is tested in its own file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunState } from "@kad/shared";
import type { RunRecord } from "../store/repository.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { createRoom } from "./room.ts";

const log: string[] = [];

/** A claim that logs its start and end and answers `value` a few ms later. */
function timed<T>(name: string, value: T) {
  return async () => {
    log.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    log.push(`end:${name}`);
    return value;
  };
}

vi.mock("./field-guide.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./field-guide.ts")>()),
  recordStepFinds: vi.fn(timed("recordStepFinds", [] as string[])),
}));
vi.mock("./camp-finds.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./camp-finds.ts")>()),
  claimCampFinds: vi.fn(timed("claimCampFinds", [])),
}));
vi.mock("./camp-milestones.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./camp-milestones.ts")>()),
  claimMilestones: vi.fn(timed("claimMilestones", [])),
}));
vi.mock("./camp-pay.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./camp-pay.ts")>()),
  claimCampDrops: vi.fn(timed("claimCampDrops", [])),
  settleChapterEndCamp: vi.fn(timed("settleChapterEndCamp", [])),
}));
vi.mock("./camp-edit.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./camp-edit.ts")>()),
  recordOuting: vi.fn(timed("recordOuting", undefined)),
}));
vi.mock("./look-unlocks.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./look-unlocks.ts")>()),
  claimLookUnlocks: vi.fn(timed("claimLookUnlocks", [])),
}));

const { applyAction, claimStepRewards } = await import("./action.ts");

const at = (entry: string) => {
  const i = log.indexOf(entry);
  expect(i, entry).toBeGreaterThanOrEqual(0);
  return i;
};

beforeEach(() => {
  log.length = 0;
});

describe("claimStepRewards", () => {
  it("runs the kit's milestones beside the camp's drops and outing, and keeps every other order", async () => {
    const harness = makeHarness();
    const { householdId } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("setup failed");
    const state = (await harness.repo.getState(created.value.runId)) as RunState;
    const run = (await harness.repo.getRun(created.value.runId)) as RunRecord;

    await claimStepRewards(
      {
        state,
        next: state,
        run,
        intent: { type: "CHOOSE", choiceId: "east" },
        stepDrops: [],
        chapterEndCamp: { householdId, chapterId: "c_1", pay: 5 },
        settlement: null,
      },
      harness.deps,
    );

    // The camp's finds write the camp and heroes' rows, so both strands wait for them.
    expect(at("start:claimMilestones")).toBeGreaterThan(at("end:claimCampFinds"));
    expect(at("start:claimCampDrops")).toBeGreaterThan(at("end:claimCampFinds"));
    // Heroes' rows and the camp: side by side.
    expect(at("start:claimCampDrops")).toBeLessThan(at("end:claimMilestones"));
    expect(at("start:claimMilestones")).toBeLessThan(at("end:claimCampDrops"));
    // Two camp writes: one after the other.
    expect(at("start:recordOuting")).toBeGreaterThan(at("end:claimCampDrops"));
    // A drop this step rolled lands before the pay closes the chapter to drops.
    expect(at("start:settleChapterEndCamp")).toBeGreaterThan(at("end:recordOuting"));
    expect(at("start:settleChapterEndCamp")).toBeGreaterThan(at("end:claimMilestones"));
    // The looks after the kit's and the camp's.
    expect(at("start:claimLookUnlocks")).toBeGreaterThan(at("end:settleChapterEndCamp"));
  });
});

describe("applyAction after its commit", () => {
  it("records the step's finds in the book beside the camp's claims", async () => {
    const harness: TestHarness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 1);
    const created = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!created.ok) throw new Error("setup failed");
    const player = players[0];
    if (!player) throw new Error("setup failed");

    const response = await applyAction(
      { runId: created.value.runId, playerId: player.principal.playerId, seq: 0, intent: { type: "CHOOSE", choiceId: "east" } },
      harness.deps,
    );

    expect(response).toMatchObject({ ok: true, seq: 1 });
    expect(at("start:recordStepFinds")).toBeLessThan(at("end:claimCampFinds"));
    expect(at("start:claimCampFinds")).toBeLessThan(at("end:recordStepFinds"));
  });
});
