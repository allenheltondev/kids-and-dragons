/**
 * The gate's two parsers, and the distinction they exist to keep.
 *
 * `inspect()` itself shells out to ffmpeg, so it is exercised by running the
 * gate rather than by a test that would have to fake a media toolchain. What
 * *is* tested here is everything that reads a tool's output — the part where
 * "the tool is not installed", "the tool refused this file" and "the file is
 * fine" got conflated, which is the bug this file guards.
 */

import { describe, expect, it } from "vitest";
import { faultLine, parsePeak } from "./verify";

describe("reading a volumedetect report", () => {
  const REPORT = [
    "[Parsed_volumedetect_0 @ 0x1] n_samples: 57600",
    "[Parsed_volumedetect_0 @ 0x1] mean_volume: -21.8 dB",
    "[Parsed_volumedetect_0 @ 0x1] max_volume: -3.2 dB",
  ].join("\n");

  it("finds the peak", () => {
    expect(parsePeak(REPORT)).toBe(-3.2);
  });

  it("reads digital silence as the very low number it is", () => {
    // What a failed encode looks like: right length, no samples above -91dB.
    expect(parsePeak("max_volume: -91.0 dB")).toBe(-91);
  });

  it("says nothing when there is no report to read", () => {
    // Not "the file is silent" — *nothing is known*, which is the distinction
    // the gate is built around.
    expect(parsePeak("")).toBeNull();
    expect(parsePeak("mean_volume: -21.8 dB")).toBeNull();
  });
});

describe("reading a refusal", () => {
  it("takes the line that names the fault, not the banner above it", () => {
    const stderr = [
      "ffmpeg version 7.0.2 Copyright (c) 2000-2024 the FFmpeg developers",
      "  built with gcc 13",
      "[in#0 @ 0x1] Error opening input: Invalid data found when processing input",
    ].join("\n");
    expect(faultLine(stderr)).toContain("Invalid data found");
  });

  it("still says something when a tool fails without a word", () => {
    expect(faultLine("")).toBe("the file could not be read");
    expect(faultLine("\n\n  \n")).toBe("the file could not be read");
  });
});
