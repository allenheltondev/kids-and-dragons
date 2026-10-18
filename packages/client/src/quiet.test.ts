// @vitest-environment jsdom
/**
 * Quiet mode (#260), as the acceptance asks for it: a full combat encounter,
 * checked against the cue list, plays no sudden loud sound and no screen
 * shake.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { EncounterEvent, Presentation } from "@kad/shared";
import { CUE_QUIET, PRESENTATION_CUES } from "./audio/cues";
import type { CueId } from "./audio/cue";
import { CUE_TONES } from "./audio/synth";
import { impactBeats, impactStrengthOf, joltStrength, PRESENTATION_SHAKES } from "./world/shake";
import { isQuiet, onQuietChange, setQuiet } from "./quiet";

afterEach(() => setQuiet(false));

/** Every presentation a fight can produce, from its first board to its last cheer. */
const ENCOUNTER: Presentation["kind"][] = [
  "ENCOUNTER_BEGAN",
  "ROLL",
  "COMBAT_SEQUENCE",
  "ATTACK",
  "HEAL",
  "DOWN",
  "REVIVE",
  "LEVEL_UP",
  "TRANSFORM",
  "CHAPTER_COMPLETE",
];

/** Beside the presentations, the cues a roll or a slip adds in the middle of a fight. */
const EXTRA_COMBAT_CUES: CueId[] = ["bonk", "error", "tap", "choice"];

/** The loudest a recipe may be and still count as soft; the dropped ones peak at 0.2 and up. */
const SOFT_PEAK = 0.18;

function played(): CueId[] {
  const cues = ENCOUNTER.map((kind) => PRESENTATION_CUES[kind]).filter((id): id is CueId => id !== null);
  return [...cues, ...EXTRA_COMBAT_CUES];
}

describe("the cue list in a quiet room", () => {
  it("decides every cue, and drops the impacts and stingers of a fight", () => {
    for (const id of ["attack", "down", "bonk", "encounter-begin", "level-up", "transform", "victory"] as CueId[]) {
      expect(CUE_QUIET[id], id).toBe("drop");
    }
    expect(Object.keys(CUE_QUIET).sort()).toEqual(Object.keys(CUE_TONES).sort());
  });

  it("leaves a whole encounter with nothing sudden or loud to play", () => {
    const survivors = played().filter((id) => CUE_QUIET[id] === "keep");
    expect(survivors.length).toBeGreaterThan(0);
    for (const id of survivors) {
      const peak = Math.max(...CUE_TONES[id].map((tone) => tone.gain));
      expect(peak, `${id} peaks at ${peak}`).toBeLessThanOrEqual(SOFT_PEAK);
    }
  });
});

describe("the stage in a quiet room", () => {
  const FIGHT: EncounterEvent[] = [
    { type: "damage" } as never,
    { type: "shoved" } as never,
    { type: "down" } as never,
  ];

  it("has impacts to silence, and silences every one of them", () => {
    const beats = impactBeats(FIGHT, 3000);
    expect(beats.length).toBe(FIGHT.length);
    for (const event of FIGHT) expect(impactStrengthOf(event)).toBeGreaterThan(0);
    for (const beat of beats) expect(joltStrength(beat.strength, { reducedMotion: false, quiet: true })).toBe(0);
    for (const strength of Object.values(PRESENTATION_SHAKES)) {
      expect(joltStrength(strength, { reducedMotion: false, quiet: true })).toBe(0);
    }
  });

  it("shakes as before in a loud room, and not at all for reduced motion", () => {
    expect(joltStrength(0.7, { reducedMotion: false, quiet: false })).toBe(0.7);
    expect(joltStrength(0.7, { reducedMotion: true, quiet: false })).toBe(0);
  });
});

describe("the device's view of the room", () => {
  it("dims the display and tells listeners, once per change", () => {
    const seen: boolean[] = [];
    const stop = onQuietChange((quiet) => seen.push(quiet));
    setQuiet(true);
    setQuiet(true);
    expect(isQuiet()).toBe(true);
    expect(document.documentElement.hasAttribute("data-quiet")).toBe(true);
    setQuiet(false);
    expect(document.documentElement.hasAttribute("data-quiet")).toBe(false);
    stop();
    expect(seen).toEqual([true, false]);
  });
});
