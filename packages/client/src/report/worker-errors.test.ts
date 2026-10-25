// @vitest-environment jsdom
/** The page's half of worker error reporting (#459). */

import { describe, expect, it, vi } from "vitest";
import { diagnose } from "../../../shared/src/error-report";
import { listenForWorkerErrors, workerError, workerErrorStage, WORKER_STAGES } from "./worker-errors";

describe("workerErrorStage", () => {
  it("reads the stage of a worker's error message", () => {
    for (const stage of WORKER_STAGES) {
      expect(workerErrorStage({ type: "kad:sw-error", stage, message: "x", build: "dev" })).toBe(stage);
    }
  });

  it("ignores anything else a worker or a page might post", () => {
    expect(workerErrorStage(null)).toBeNull();
    expect(workerErrorStage("kad:sw-error")).toBeNull();
    expect(workerErrorStage({ type: "other", stage: "install" })).toBeNull();
    expect(workerErrorStage({ type: "kad:sw-error", stage: "install; drop table" })).toBeNull();
    expect(workerErrorStage({ type: "kad:sw-error" })).toBeNull();
  });
});

describe("workerError", () => {
  it("diagnoses to a phrase per stage, with no stack", () => {
    const kinds = WORKER_STAGES.map((stage) => diagnose("Error", workerError(stage).message));
    expect(kinds).toEqual([
      "Error: service worker install failed",
      "Error: service worker activate failed",
      "Error: service worker file mismatch",
      "Error: service worker out of space",
    ]);
    expect(workerError("install").stack).toBe("");
  });
});

describe("listenForWorkerErrors", () => {
  it("hands each worker error to the reporter and nothing else", () => {
    const target = new EventTarget();
    const send = vi.fn();
    listenForWorkerErrors(target, send);

    target.dispatchEvent(new MessageEvent("message", { data: { type: "kad:sw-error", stage: "activate", message: "Maya", build: "dev" } }));
    target.dispatchEvent(new MessageEvent("message", { data: { type: "something-else" } }));

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0] as Error;
    expect(sent.message).toBe("service worker activate");
    expect(sent.message).not.toMatch(/maya/i);
  });

  it("does nothing where there is no service worker", () => {
    expect(() => listenForWorkerErrors(undefined, vi.fn())).not.toThrow();
  });
});
