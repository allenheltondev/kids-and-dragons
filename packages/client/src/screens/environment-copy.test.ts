/**
 * The words the combat panel uses for the place fighting back (#201). Each
 * line has to say the rule — what to do, and what it costs — not just name
 * the thing, because the board's marks are glyphs and the list is where a
 * child (or a screen reader) learns what they mean.
 */

import { describe, expect, it } from "vitest";
import {
  clockLine,
  clockReadout,
  environmentBeatLine,
  exitLine,
  hazardIcon,
  hazardLine,
  rescueLine,
  tileWords,
} from "./environment-copy";

describe("the rift clock", () => {
  const clock = { label: "The rift closes", onExpire: "collapse" as const, expired: false };
  it("counts down in rounds, and says when it is the last one", () => {
    expect(clockLine({ ...clock, roundsLeft: 3 })).toBe("The rift closes in 3 rounds.");
    expect(clockLine({ ...clock, roundsLeft: 1 })).toBe("The rift closes at the end of this round!");
    expect(clockLine({ ...clock, roundsLeft: 0, expired: true })).toBe("The rift closes — now!");
  });
  it("says what staying past a surge costs", () => {
    expect(clockLine({ label: "The rift boils", onExpire: "surge", roundsLeft: 0, expired: true, surge: 2 })).toBe(
      "The rift boils — now! Every round you stay, everyone loses 2 hearts.",
    );
  });
});

describe("exits, hazards and the rescue", () => {
  it("says when a way out opens, how to use it, and when it shuts", () => {
    const exit = { id: "t", label: "The tear", tiles: [] };
    expect(exitLine({ ...exit, open: false, opensIn: 1 })).toBe("The tear opens next round.");
    expect(exitLine({ ...exit, open: false, opensIn: 2 })).toBe("The tear opens in 2 rounds.");
    expect(exitLine({ ...exit, open: true, closesIn: 1 })).toBe(
      "The tear is open: end your turn on it to escape. It closes after this round!",
    );
    expect(exitLine({ ...exit, open: false, gone: true })).toBe("The tear has closed.");
  });

  it("says what stopping on a hazard costs, and gives each kind its own shape", () => {
    const fire = { id: "f", kind: "fire" as const, label: "Rift fire", tiles: [], damage: 1, active: true };
    expect(hazardLine(fire)).toBe("Rift fire: stopping on it costs 1 heart.");
    expect(hazardLine({ ...fire, active: false })).toBe("Rift fire (not yet): soon stopping on it costs 1 heart.");
    expect(hazardLine({ ...fire, active: false, gone: true })).toBe("Rift fire has died down.");
    expect(new Set((["fire", "thorns", "rift"] as const).map(hazardIcon)).size).toBe(3);
  });

  it("says what ground that slows, holds or throws does, in words (#220)", () => {
    const mud = { id: "m", kind: "rift" as const, label: "Rift mud", tiles: [], damage: 0, active: true };
    expect(hazardLine({ ...mud, slow: { steps: 1, turns: 2 } })).toBe("Rift mud: stopping on it slows you 1 step for 2 turns.");
    expect(hazardLine({ ...mud, damage: 2, root: true })).toBe("Rift mud: stopping on it costs 2 hearts and holds you still next turn.");
    expect(hazardLine({ ...mud, damage: 1, slow: { steps: 2, turns: 1 }, push: { direction: "north", tiles: 2 } })).toBe(
      "Rift mud: stopping on it costs 1 heart, slows you 2 steps for a turn and throws you 2 squares north.",
    );
    expect(hazardLine({ ...mud, push: { direction: "east", tiles: 1 } })).toBe("Rift mud: stopping on it throws you east.");
  });

  it("says how to free the captive, and what became of them", () => {
    const pip = { name: "Pip", at: { x: 0, y: 0 } };
    expect(rescueLine({ ...pip, status: "waiting" })).toBe("Free Pip: end your turn next to them.");
    expect(rescueLine({ ...pip, status: "waiting", roundsLeft: 1 })).toBe(
      "Free Pip: end your turn next to them. This round is the last chance!",
    );
    expect(rescueLine({ ...pip, status: "freed" })).toBe("Pip is free!");
    expect(rescueLine({ ...pip, status: "lost" })).toBe("Pip is lost to the rift.");
  });

  it("names a square's mark in words", () => {
    expect(tileWords({ kind: "exit", label: "The tear", active: false })).toBe("The tear, closed");
    expect(tileWords({ kind: "hazard", label: "Rift fire", active: true })).toBe("Rift fire, don't stop here");
  });
});

describe("the clock on the shared screen", () => {
  const clock = { label: "The rift closes", onExpire: "collapse" as const, expired: false };
  it("is a number, then a warning, then a zero — shapes, not just colours", () => {
    expect(clockReadout({ ...clock, roundsLeft: 3 })).toEqual({
      figure: "3",
      text: "The rift closes in 3 rounds.",
      mood: "calm",
    });
    expect(clockReadout({ ...clock, roundsLeft: 1 })).toEqual({
      figure: "!",
      text: "The rift closes at the end of this round!",
      mood: "urgent",
    });
    expect(clockReadout({ ...clock, roundsLeft: 0, expired: true })).toEqual({
      figure: "0",
      text: "The rift closes — now!",
      mood: "expired",
    });
  });
});

describe("the place's beats, in words", () => {
  const names: Record<string, string> = { c_1: "Sparklehoof", "wisp#1": "Bramblewisp 1" };
  const words = { name: (id: string) => names[id] ?? id, isParty: (id: string) => id === "c_1", captive: "Pip" };
  const you = { ...words, name: (id: string) => (id === "c_1" ? "You" : words.name(id)) };

  it("tells every environmental beat, for the room and for the hero it happened to", () => {
    const fire = { type: "hazard" as const, hazardId: "f", label: "Rift fire" };
    expect(environmentBeatLine({ ...fire, actorId: "c_1" }, words)).toEqual({ text: "Rift fire gets Sparklehoof!", tone: "bad" });
    expect(environmentBeatLine({ ...fire, actorId: "c_1" }, you)!.text).toBe("Rift fire gets you!");
    expect(environmentBeatLine({ ...fire, actorId: "wisp#1" }, words)!.tone).toBe("good");
    expect(environmentBeatLine({ type: "escaped", actorId: "c_1", exitId: "t" }, words)!.text).toBe(
      "Sparklehoof steps through the rift!",
    );
    expect(environmentBeatLine({ type: "escaped", actorId: "c_1", exitId: "t" }, you)!.text).toBe("You step through the rift!");
    expect(environmentBeatLine({ type: "freed", byId: "c_1" }, words)!.text).toBe("Sparklehoof freed Pip!");
    expect(environmentBeatLine({ type: "captiveLost" }, words)).toEqual({ text: "Pip is lost to the rift.", tone: "bad" });
    expect(environmentBeatLine({ type: "relocated", actorId: "wisp#1", to: { x: 0, y: 0 } }, words)!.text).toBe(
      "The rift throws Bramblewisp 1 somewhere new!",
    );
    expect(environmentBeatLine({ type: "riftClock", onExpire: "collapse" }, words)!.text).toBe("The rift is closing!");
    expect(environmentBeatLine({ type: "riftClock", onExpire: "surge" }, words)!.text).toBe("The rift is surging!");
    expect(environmentBeatLine({ type: "surge", amount: 2 }, words)!.text).toBe("The rift surges: everyone still here loses 2.");
  });

  it("says nothing about an ordinary beat", () => {
    expect(environmentBeatLine({ type: "down", actorId: "c_1" }, words)).toBeNull();
    expect(environmentBeatLine({ type: "moved", actorId: "c_1", to: { x: 1, y: 1 } }, words)).toBeNull();
  });
});
