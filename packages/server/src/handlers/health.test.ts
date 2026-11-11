/**
 * `GET /api/health` (handlers/health.ts): it must say whether a game can run,
 * which is more than whether a function answered.
 */

import { describe, expect, it, vi } from "vitest";
import { makeHarness } from "../test-support";
import { checkHealth, HEALTH_PROBE_ROOM, wantsDeep } from "./health";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./room";

const quiet = { service: "kad-api", now: Date.UTC(2026, 10, 11), log: () => {} };

describe("health", () => {
  it("is ok when the API boots and holds content, and says how much", async () => {
    const harness = makeHarness();
    const read = vi.spyOn(harness.deps.repo, "getRoom");
    const result = await checkHealth(async () => harness.deps, quiet);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, service: "kad-api", time: "2026-11-11T00:00:00.000Z" });
    expect(result.body.content?.chapters).toBeGreaterThan(0);
    expect(result.body.content?.campaigns).toBe(harness.deps.content.campaignIds().length);
    expect(result.body.content?.rulesVersion).toBe(harness.deps.content.rules().version);
    expect(result.body).not.toHaveProperty("failed");
    // The plain form must answer when the table cannot, so it never asks the table.
    expect(result.body).not.toHaveProperty("store");
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the table once when asked to, at a code no room can have", async () => {
    const harness = makeHarness();
    const read = vi.spyOn(harness.deps.repo, "getRoom");
    const result = await checkHealth(async () => harness.deps, { ...quiet, deep: true });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, store: "ok" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(HEALTH_PROBE_ROOM);
    // Room codes are four letters from a fixed alphabet; the probe is neither.
    expect(HEALTH_PROBE_ROOM.length).not.toBe(ROOM_CODE_LENGTH);
    expect([...HEALTH_PROBE_ROOM].every((letter) => ROOM_CODE_ALPHABET.includes(letter))).toBe(false);
  });

  it("answers 503 and names the boot when the API cannot start, without the detail", async () => {
    const logged: unknown[] = [];
    const result = await checkHealth(
      async () => {
        throw new Error("missing required environment variable TABLE_NAME at C:\\secret\\path");
      },
      { ...quiet, log: (_message, error) => logged.push(error) },
    );

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, service: "kad-api", time: "2026-11-11T00:00:00.000Z", failed: "boot" });
    // The endpoint is public: the variable's name and the path go to the log only.
    expect(JSON.stringify(result.body)).not.toMatch(/TABLE_NAME|secret/);
    expect(String(logged[0])).toMatch(/TABLE_NAME/);
  });

  it("answers 503 for content that loaded empty, which the loader does not refuse", async () => {
    const harness = makeHarness();
    const empty = { ...harness.deps, content: { ...harness.deps.content, chapterIds: () => [] as string[] } };
    Object.setPrototypeOf(empty.content, Object.getPrototypeOf(harness.deps.content));
    const result = await checkHealth(async () => empty, quiet);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, failed: "content", content: { chapters: 0 } });
  });

  it("answers 503 for content that cannot be read at all", async () => {
    const harness = makeHarness();
    const broken = {
      ...harness.deps,
      content: {
        ...harness.deps.content,
        chapterIds: () => {
          throw new Error("ENOENT content/chapters");
        },
      },
    };
    const result = await checkHealth(async () => broken, quiet);

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, failed: "content" });
    expect(JSON.stringify(result.body)).not.toMatch(/ENOENT/);
  });

  it("answers 503 and names the store when the deep read fails, still reporting the content", async () => {
    const harness = makeHarness();
    vi.spyOn(harness.deps.repo, "getRoom").mockRejectedValue(new Error("AccessDeniedException: not authorized on arn:aws:dynamodb"));
    const deep = await checkHealth(async () => harness.deps, { ...quiet, deep: true });

    expect(deep.status).toBe(503);
    expect(deep.body).toMatchObject({ ok: false, failed: "store", store: "unreachable" });
    expect(deep.body.content?.chapters).toBeGreaterThan(0);
    expect(JSON.stringify(deep.body)).not.toMatch(/arn:aws|AccessDenied/);

    // And with the table broken, the plain form is still ok: it reports what does work.
    const plain = await checkHealth(async () => harness.deps, quiet);
    expect(plain.status).toBe(200);
  });

  it("takes ?deep, ?deep=1 and ?deep=true, and nothing else", () => {
    expect(wantsDeep({ deep: "" })).toBe(true);
    expect(wantsDeep({ deep: "1" })).toBe(true);
    expect(wantsDeep({ deep: "true" })).toBe(true);
    expect(wantsDeep({})).toBe(false);
    expect(wantsDeep({ deep: "0" })).toBe(false);
    expect(wantsDeep({ deep: ["1", "1"] })).toBe(false);
  });
});
