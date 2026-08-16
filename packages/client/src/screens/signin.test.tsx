/**
 * The keepsake screens.
 *
 * Two things are worth holding here, and neither is about the happy path:
 *
 *  1. **The offer stays out of the way.** It must render nothing at all where
 *     sign-in cannot work, while it is still finding that out, and once the
 *     household has been claimed. A stray offer is an account prompt in front
 *     of a child, which is the exact thing anonymous play exists to prevent.
 *  2. **The lantern is a picture of the party**, not decoration — one light per
 *     member, in that character's own colour, positioned distinctly.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PartyMember } from "@kad/shared";
import { hasIcon } from "./icons";
import { KeepsakeLantern, motePositions } from "./KeepsakeLantern";
import { KeepsakeOffer, OfferStep, SignInFlow, namesOf, shouldOfferKeepsake } from "./SignInFlow";

function member(playerId: string, name: string, accent: string): PartyMember {
  return {
    playerId,
    hp: 10,
    down: false,
    connected: true,
    ready: true,
    character: {
      id: `c_${playerId}`,
      ownerPlayerId: playerId,
      name,
      species: "unicorn",
      class: "songkeeper",
      appearance: { palette: "meadow", accent },
      level: 1,
      xp: 0,
      tier: "fledgling",
      stats: { might: 1, quick: 2, clever: 2, heart: 4 },
      unspentPoints: 0,
      spendableStats: ["might", "quick", "clever", "heart"],
      maxHp: 10,
      steps: 4,
      guard: 10,
      attackStat: "heart",
      actions: [],
      worldAbility: "",
      inventory: [],
      questItems: [],
      souvenirs: [],
      isProvisional: false,
    committedLevel: 1,
    },
  };
}

const PARTY = [
  member("p_1", "Sparklehoof", "#7FD4C1"),
  member("p_2", "Ember", "#F2A65A"),
  member("p_3", "Rue", "#9A8CF2"),
];

const MOTES = PARTY.map((m) => ({
  id: m.playerId,
  color: m.character.appearance.accent,
  name: m.character.name,
}));

describe("SignInFlow", () => {
  it("renders nothing until somebody opens it", () => {
    expect(renderToStaticMarkup(<SignInFlow />)).toBe("");
  });

  it("survives an empty store, like every other screen", () => {
    expect(() => renderToStaticMarkup(<SignInFlow />)).not.toThrow();
  });
});

describe("the offer's words", () => {
  const html = renderToStaticMarkup(<OfferStep motes={MOTES} />);

  it("names the characters being kept rather than 'your data'", () => {
    expect(html).toContain("Sparklehoof, Ember and Rue");
  });

  it("states the cost of saying no, in days", () => {
    // A vague "your progress may be lost" would be both scarier and less true.
    expect(html).toContain("seven days");
  });

  it("promises there is no password, where the doubt is", () => {
    expect(html).toContain("No password");
  });

  it("never uses the vocabulary of an account system", () => {
    /*
     * The tone guard. Cognito is an implementation detail of keeping three
     * characters; the moment this screen says "create an account" it has
     * stopped being part of the game.
     */
    // "Password" itself is fine and appears above — the promise that there
    // isn't one is the reassurance. What is banned is the vocabulary of
    // *having* an account.
    for (const banned of ["sign up", "sign in", "account", "register", "log in"]) {
      expect(html.toLowerCase()).not.toContain(banned);
    }
  });

  it("lists every character by name, each in its own colour", () => {
    for (const mote of MOTES) {
      expect(html).toContain(mote.name);
      expect(html).toContain(mote.color);
    }
  });
});

describe("shouldOfferKeepsake", () => {
  /*
   * The predicate behind "the offer stays out of the way". A stray offer is an
   * account prompt in front of a child, which is the exact thing anonymous play
   * exists to prevent — so each way of *not* showing it is its own case.
   */
  it("offers when there is a pool, a party, and no account yet", () => {
    expect(shouldOfferKeepsake(true, false, 3)).toBe(true);
  });

  it("stays silent while availability is still unknown", () => {
    // `null`, not `false`. Showing the offer and then withdrawing it is worse
    // than showing it a moment late.
    expect(shouldOfferKeepsake(null, false, 3)).toBe(false);
  });

  it("stays silent where there is no user pool at all", () => {
    expect(shouldOfferKeepsake(false, false, 3)).toBe(false);
  });

  it("stays silent once the household has been claimed", () => {
    // Never becomes a permanent "manage your account" affordance.
    expect(shouldOfferKeepsake(true, true, 3)).toBe(false);
  });

  it("stays silent before anybody has a character to keep", () => {
    expect(shouldOfferKeepsake(true, false, 0)).toBe(false);
  });
});

describe("KeepsakeOffer", () => {
  it("renders nothing from a cold start", () => {
    // Availability is unknown and there is no party — the state every phone
    // mounts in.
    expect(renderToStaticMarkup(<KeepsakeOffer />)).toBe("");
  });
});

describe("KeepsakeLantern", () => {
  const motes = MOTES;

  it("holds one light per party member, in that character's colour", () => {
    const html = renderToStaticMarkup(<KeepsakeLantern motes={motes} />);
    for (const mote of motes) {
      expect(html).toContain(mote.color);
    }
  });

  it("places each light somewhere different", () => {
    // Three flames stacked at one point is the bug that a CSS transform
    // overriding the SVG positioning attribute produces, and it is invisible
    // in a diff.
    const positions = motePositions(3);
    const seen = new Set(positions.map((p) => `${String(p.x)},${String(p.y)}`));
    expect(seen.size).toBe(3);
    for (const position of positions) {
      // Inside the glass, which spans roughly x 36-84, y 43-127.
      expect(position.x).toBeGreaterThan(36);
      expect(position.x).toBeLessThan(84);
      expect(position.y).toBeGreaterThan(43);
      expect(position.y).toBeLessThan(127);
    }
  });

  it("keeps every light inside the glass however big the party gets", () => {
    for (let n = 1; n <= 6; n++) {
      for (const position of motePositions(n)) {
        expect(position.x).toBeGreaterThan(36);
        expect(position.x).toBeLessThan(84);
      }
    }
  });

  it("lights up rather than erroring when nobody is being kept", () => {
    const html = renderToStaticMarkup(<KeepsakeLantern motes={[]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("A lantern waiting to be lit");
  });

  it("describes who it holds, for a screen reader", () => {
    const html = renderToStaticMarkup(<KeepsakeLantern motes={motes} />);
    expect(html).toContain("a light for Sparklehoof, Ember and Rue");
  });

  it("gives two lanterns on one page their own gradients", () => {
    // Shared ids would make the second lantern steal the first one's glow.
    const html = renderToStaticMarkup(
      <>
        <KeepsakeLantern motes={motes} />
        <KeepsakeLantern motes={motes} />
      </>,
    );
    const ids = [...html.matchAll(/id="(kad-lantern-glow-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("namesOf", () => {
  it("reads like a sentence at every party size", () => {
    expect(namesOf([])).toBe("your characters");
    expect(namesOf([{ name: "Rue" }])).toBe("Rue");
    expect(namesOf([{ name: "Rue" }, { name: "Ember" }])).toBe("Rue and Ember");
    expect(namesOf([{ name: "Rue" }, { name: "Ember" }, { name: "Ash" }])).toBe(
      "Rue, Ember and Ash",
    );
  });
});

describe("the flow's icons", () => {
  it("has a real glyph for every icon the flow names", () => {
    /*
     * `Icon` falls back to a neutral glyph for an unknown name rather than
     * throwing (spec §1.5 — a missing icon must degrade, never break a scene).
     * That safety net also means a typo here would ship as a silent grey circle
     * on the one screen an adult ever reads, so the names are asserted.
     */
    for (const name of ["keepsake", "lantern", "envelope", "passkey", "check", "back", "forward", "close"]) {
      expect({ name, known: hasIcon(name) }).toEqual({ name, known: true });
    }
  });
});
