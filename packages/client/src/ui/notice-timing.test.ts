/**
 * How long a shared-screen notice stays up (notice-timing.ts): four seconds for a short one,
 * longer for longer words, never past six.
 */

import { describe, expect, it } from "vitest";
import { NOTICE_MAX_MS, NOTICE_MIN_MS, noticeMs } from "./notice-timing";

describe("noticeMs", () => {
  it("gives a short notice four seconds", () => {
    expect(NOTICE_MIN_MS).toBe(4000);
    expect(noticeMs("Pip joined")).toBe(4000);
    expect(noticeMs("Pip and Bo joined")).toBe(4250);
  });

  it("gives longer words longer, a quarter second a word", () => {
    expect(noticeMs("Pip, Bo and Cy joined")).toBe(4500);
    expect(noticeMs("Could not hand over the game.")).toBe(4750);
  });

  it("never holds a notice past six seconds", () => {
    expect(NOTICE_MAX_MS).toBe(6000);
    expect(noticeMs("word ".repeat(200))).toBe(6000);
  });

  it("reads blank space as no words", () => {
    expect(noticeMs("   ")).toBe(4000);
  });
});
