import { describe, expect, it } from "vitest";
import { Recorder, percentile, renderMarkdown } from "./metrics.ts";
import { parseConfig } from "./run.ts";
import { distanceToFight } from "./table.ts";

const sample = (route: string, ms: number, status = 200, code?: string, at = 1_000_000) => ({ route, status, ms, code, at });

describe("percentile", () => {
  it("is the nearest rank of an ascending list", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});

describe("Recorder", () => {
  it("counts 429 and STALE_SEQ apart from errors, per route", () => {
    const recorder = new Recorder();
    recorder.record(sample("POST /api/action", 10));
    recorder.record(sample("POST /api/action", 20, 200, "STALE_SEQ"));
    recorder.record(sample("POST /api/action", 30, 200, "ILLEGAL"));
    recorder.record(sample("POST /api/action", 40, 429));
    recorder.record(sample("POST /api/presence", 5, 500));
    recorder.record(sample("POST /api/presence", 1500, 0));

    const report = recorder.report(2);
    const action = report.routes.find((r) => r.route === "POST /api/action")!;
    expect(action).toMatchObject({ count: 4, tooMany: 1, staleSeq: 1, errors: 1, max: 40, rps: 2 });
    const presence = report.routes.find((r) => r.route === "POST /api/presence")!;
    expect(presence.errors).toBe(2);
    expect(report).toMatchObject({ total: 6, tooMany: 1, staleSeq: 1, errors: 3, rps: 3 });
  });

  it("finds the busiest second", () => {
    const recorder = new Recorder();
    for (let i = 0; i < 5; i++) recorder.record(sample("GET /api/state (script read)", 1, 200, undefined, 5_000 + i));
    recorder.record(sample("GET /api/state (script read)", 1, 200, undefined, 9_000));
    expect(recorder.report(10).peakRps).toBe(5);
  });

  it("reports an empty run without dividing by zero", () => {
    const report = new Recorder().report(0);
    expect(report).toMatchObject({ total: 0, peakRps: 0, errors: 0, routes: [] });
  });
});

describe("renderMarkdown", () => {
  it("writes a row per route with the percentiles", () => {
    const recorder = new Recorder();
    for (let i = 1; i <= 100; i++) recorder.record(sample("POST /api/room", i));
    const text = renderMarkdown(recorder.report(10));
    expect(text).toContain("| Route | Count | /s | p50 ms | p95 ms | p99 ms |");
    expect(text).toContain("| POST /api/room | 100 | 10.00 | 50.0 | 95.0 | 99.0 | 100 | 0 | 0 | 0 |");
    expect(text).toContain("Requests: 100 in 10s");
  });
});

describe("parseConfig", () => {
  it("defaults to a small run against the dev server, with a real phone's heartbeat", () => {
    const config = parseConfig([])!;
    expect(config.baseUrl).toBe("http://localhost:8787");
    expect(config.stages).toEqual([3]);
    expect(config.table.heartbeatMs).toBe(20_000);
    expect(config.table.phones).toBe(3);
  });

  it("takes a ramp as stages", () => {
    expect(parseConfig(["--ramp", "10,50,100", "--duration", "120"])!.stages).toEqual([10, 50, 100]);
  });

  it("refuses a table the game cannot seat", () => {
    expect(() => parseConfig(["--phones", "5"])).toThrow(/--phones/);
    expect(() => parseConfig(["--tables", "0"])).toThrow(/--tables/);
  });

  it("returns null for --help", () => {
    expect(parseConfig(["--help"])).toBeNull();
  });
});

describe("distanceToFight", () => {
  it("counts the exits from each scene to the nearest encounter", () => {
    const distance = distanceToFight({
      scenes: {
        start: { type: "story", choices: [{ goto: "road" }, { goto: "gate" }] },
        road: { type: "check", onSuccess: { goto: "fight" }, onFailure: { goto: "start" } },
        gate: { type: "story", choices: [{ goto: "end" }] },
        fight: { type: "encounter", onVictory: { goto: "end" } },
        end: { type: "story", choices: [] },
      },
    });
    expect(distance.get("fight")).toBe(0);
    expect(distance.get("road")).toBe(1);
    expect(distance.get("start")).toBe(2);
    expect(distance.has("gate")).toBe(false);
  });
});
