/**
 * The words the combat panel uses for the place fighting back (#201). Each
 * line has to say the rule — what to do, and what it costs — not just name
 * the thing, because the board's marks are glyphs and the list is where a
 * child (or a screen reader) learns what they mean.
 */

import { describe, expect, it } from "vitest";
import { clockLine, exitLine, hazardIcon, hazardLine, rescueLine, tileWords } from "./environment-copy";

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
    expect(new Set((["fire", "thorns", "rift"] as const).map(hazardIcon)).size).toBe(3);
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
