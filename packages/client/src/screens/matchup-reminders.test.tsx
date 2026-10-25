// @vitest-environment jsdom
/**
 * Matchup reminders (docs/matchups.md "Presentation"): the TV's opening chips
 * and the callout beside a roll, the phone's hints for its own hero and the
 * badge on its check. And the other half of the promise: with matchups off
 * (Gemfall: no table, no events, no chips) every one of these draws nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  beginEncounter,
  parseBoard,
  setSpeaker,
  type Bestiary,
  type Chapter,
  type DiceRoll,
  type EncounterEvent,
  type EncounterState,
  type MatchupRules,
  type ResolvedCharacter,
} from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { FightLog, fightLogLines } from "./FightLog";
import { CheckMatchupBadges, HeroFightHints } from "./MatchupHints";
import { calloutOf, calloutsOfRoll, checkBadges, chipsForHero, fightChips, spokenCallouts } from "./matchup-copy";

const TABLE: MatchupRules = {
  traits: { thorny: { name: "Thorny", icon: "thorns", text: "Prickly all over.", hint: "Thorny: Burst works well" } },
  checkTags: { sneak: { name: "Sneak", text: "getting past unseen" } },
  edges: [
    { id: "burst_thorny", hero: { class: "duskrunner" }, on: "attack", foe: "thorny", roll: 2, text: "Burst makes thorny things think twice." },
    { id: "griffin_thorny", hero: { species: "griffin" }, on: "attack", foe: "thorny", roll: -1, text: "Light wings snag on thorns." },
    { id: "griffin_sneak", hero: { species: "griffin" }, on: "check", tag: "sneak", roll: -1, text: "Griffins are loud." },
  ],
  opinion: { likedFoeRoll: 2, dislikedFoeRoll: 2, likedCheckRoll: 1, dislikedCheckRoll: 1 },
  exemptCampaigns: ["gemfall"],
};
const ON = makeRules({ matchups: TABLE });
const OFF = makeRules();

function hero(): ResolvedCharacter {
  return {
    id: "c_sky",
    ownerPlayerId: "p_1",
    name: "Skyclaw",
    species: "griffin",
    class: "duskrunner",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 1, quick: 9, clever: 1, heart: 1 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 12,
    attackStat: "quick",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
}

function fight(on: boolean): EncounterState {
  return {
    ...beginEncounter(
      {
        board: parseBoard([".....", ".....", "....."]),
        party: [{ character: hero(), at: { x: 1, y: 1 } }],
        enemies: [
          {
            spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 13, quick: 3, steps: 5, attack: 3, ...(on ? { traits: ["thorny"] } : {}) },
            at: { x: 2, y: 1 },
          },
        ],
      },
      { rules: ON, abilities: {}, rng: { next: () => 0.5 }, ...(on ? { matchups: TABLE } : {}) },
    ),
    startedAt: 7,
  };
}

const roll = (over: Partial<DiceRoll> = {}): DiceRoll => ({
  die: 14, mod: 2, total: 16, tn: 13, result: "hit", characterId: "c_sky", stat: "quick", ...over,
});

const withMatchups: EncounterEvent[] = [
  { type: "matchup", actorId: "c_sky", targetId: "wisp#1", id: "burst_thorny", text: "Burst makes thorny things think twice.", roll: 2, damage: 0 },
  { type: "matchup", actorId: "c_sky", targetId: "wisp#1", id: "griffin_thorny", text: "Light wings snag on thorns.", roll: -1, damage: 0 },
  { type: "roll", roll: roll(), targetId: "wisp#1", tier: "graze" },
  { type: "damage", actorId: "wisp#1", amount: 2, hp: 4 },
];
const plain: EncounterEvent[] = withMatchups.filter((e) => e.type !== "matchup");

function mount(ui: React.ReactElement, rules = ON, encounter: EncounterState | null = null, campaignId = "riftlight") {
  useGameStore.setState({
    presentation: null,
    rules,
    campaign: { id: campaignId } as never,
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "" },
    state: {
      runId: "r_1", roomCode: "ABCD", mode: "party", seq: 1, phase: "encounter", campaignId,
      chapterId: "ch_1", sceneId: "s_1", sceneType: "encounter", narration: "", art: null,
      party: [], prompt: null, lastRoll: null, flags: {}, xpEarned: 0,
      updatedAt: "2026-07-04T18:00:00.000Z", encounter,
    },
  });
  return render(ui);
}

afterEach(() => {
  cleanup();
  setSpeaker(null);
});

describe("callout words", () => {
  it("tells a plus from a minus by icon and words, and skips a note that moves nothing", () => {
    const plus = calloutOf({ id: "a", text: "Burst is strong.", roll: 2, damage: 0 })!;
    const minus = calloutOf({ id: "b", text: "It singles you out.", roll: -1, damage: 0 })!;
    expect([plus.icon, minus.icon]).toEqual(["plus", "minus"]);
    expect(plus.line).toBe("Strong here! Burst is strong.");
    expect(minus.line).toBe("Careful: It singles you out.");
    expect(calloutOf({ id: "c", text: "x", roll: 0, damage: 0 })).toBeNull();
    expect(calloutsOfRoll({})).toEqual([]);
  });

  it("reads aloud without symbols", () => {
    const spoken = spokenCallouts([calloutOf({ id: "b", text: "It singles you out.", roll: -1, damage: 0 })!]);
    expect(spoken).toBe("Careful. It singles you out.");
  });
});

describe("the fight log's callout", () => {
  it("shows each matchup beside the roll, and the phone's sentence carries it too", () => {
    const lines = fightLogLines([{ seq: 1, events: withMatchups }], fight(true));
    expect(lines[0]!.swing?.matchups?.map((c) => c.sign)).toEqual(["plus", "minus"]);
    expect(lines[0]!.text).toContain("Strong here! Burst makes thorny things think twice. Careful: Light wings snag on thorns.");
  });

  it("is the very same line without matchups", () => {
    const lines = fightLogLines([{ seq: 1, events: plain }], fight(false));
    expect(lines[0]!.text).toBe("Skyclaw rolled 14 + 2 Quick = 16 vs Guard 13. Graze! Bramblewisp 1 takes 2. 4 left.");
    expect(lines[0]!.swing).not.toHaveProperty("matchups");
  });

  it("draws icon and words on the TV, and says it for read-aloud", () => {
    const said: string[] = [];
    setSpeaker((text) => said.push(text));
    const view = mount(<FightLog />, ON, fight(true));
    act(() => {
      useGameStore.setState({ presentation: { seq: 5000, presentation: { kind: "COMBAT_SEQUENCE", events: withMatchups } } });
    });
    expect(screen.getByText("Strong here! Burst makes thorny things think twice.")).toBeTruthy();
    expect(screen.getByText("Careful: Light wings snag on thorns.")).toBeTruthy();
    expect(view.container.querySelectorAll(".fight-log__matchup--plus svg, .fight-log__matchup--minus svg").length).toBe(2);
    expect(said.join(" ")).toContain("Careful. Light wings snag on thorns.");
  });

  it("draws nothing extra when no matchup applied", () => {
    const view = mount(<FightLog />, OFF, fight(false));
    act(() => {
      useGameStore.setState({ presentation: { seq: 5001, presentation: { kind: "COMBAT_SEQUENCE", events: plain } } });
    });
    expect(view.container.querySelector(".fight-log__matchup")).toBeNull();
    expect(view.container.querySelector(".fight-log__chips")).toBeNull();
  });
});

describe("the opening chips", () => {
  it("shows the fight's hint with its trait icon on the TV, and no numbers", () => {
    const view = mount(<FightLog />, ON, fight(true));
    expect(screen.getByText("Thorny: Burst works well")).toBeTruthy();
    expect(view.container.querySelectorAll(".fight-log__chip svg").length).toBe(1);
    expect(view.container.querySelector(".fight-log__chips")?.textContent).not.toMatch(/\d/);
    expect(view.container.querySelectorAll("button, a, [tabindex]").length).toBe(0);
  });

  it("goes away on its own", () => {
    vi.useFakeTimers();
    try {
      const view = mount(<FightLog />, ON, fight(true));
      expect(view.container.querySelector(".fight-log__chips")).not.toBeNull();
      act(() => { vi.advanceTimersByTime(21000); });
      expect(view.container.querySelector(".fight-log__chips")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives none with no matchup table, or in an exempt campaign", () => {
    expect(fightChips(OFF, "riftlight", fight(true))).toEqual([]);
    expect(fightChips(null, "riftlight", fight(true))).toEqual([]);
    expect(fightChips(ON, "gemfall", fight(true))).toEqual([]);
    expect(fightChips(ON, "riftlight", fight(true)).map((h) => h.id)).toEqual(["trait:thorny"]);
  });
});

describe("the phone's hints for its own hero", () => {
  it("keeps the hints that name this hero, and says which way", () => {
    const chips = chipsForHero(ON, "riftlight", fight(true), "c_sky");
    expect(chips).toHaveLength(1);
    expect(chipsForHero(ON, "riftlight", fight(true), "c_other")).toEqual([]);
  });

  it("shows a plus or minus icon with words, and nothing when matchups are off", () => {
    const view = mount(<HeroFightHints encounter={fight(true)} heroId="c_sky" />);
    expect(screen.getByText("Thorny: Burst works well")).toBeTruthy();
    expect(view.container.querySelectorAll(".matchup-hints__item svg").length).toBe(1);
    cleanup();
    const off = mount(<HeroFightHints encounter={fight(false)} heroId="c_sky" />, OFF);
    expect(off.container.innerHTML).toBe("");
    cleanup();
    const gemfall = mount(<HeroFightHints encounter={fight(true)} heroId="c_sky" />, ON, null, "gemfall");
    expect(gemfall.container.innerHTML).toBe("");
  });
});

describe("the check prompt's badge", () => {
  const chapter = {
    scenes: { s_sneak: { type: "check", tags: ["sneak"] }, s_plain: { type: "check" } },
  } as unknown as Chapter;

  it("names the tag and the reason", () => {
    expect(checkBadges(ON, "riftlight", hero(), { tags: ["sneak"] })).toEqual([
      { id: "griffin_sneak", sign: "minus", text: "Sneak: Griffins are loud." },
    ]);
    const view = mount(<CheckMatchupBadges chapter={chapter} sceneId="s_sneak" hero={hero()} />);
    expect(screen.getByText("Sneak: Griffins are loud.")).toBeTruthy();
    expect(view.container.querySelectorAll("svg").length).toBe(1);
  });

  it("adds a creature's opinion of this hero's species, from the bestiary", () => {
    const bestiary = {
      creatures: {
        glass_crab: { canon_id: "creature.glass_crab", name: "Glass Crab", likes: ["griffin"], dislikes: [] },
        sour_wolf: { canon_id: "creature.sour_wolf", name: "Sour Wolf", dislikes: ["griffin"] },
      },
    } as unknown as Bestiary;
    expect(checkBadges(ON, "riftlight", hero(), { discovers: ["creature.glass_crab"] }, 2, bestiary)).toEqual([
      { id: "opinion:liked", sign: "plus", text: "The Glass Crab likes you." },
    ]);
    const wary = makeRules({ matchups: { ...TABLE, opinion: { ...TABLE.opinion, dislikedCheckRoll: -1 } } });
    expect(checkBadges(wary, "riftlight", hero(), { cast: [{ figure: "entities/sour_wolf" }] }, 2, bestiary)).toEqual([
      { id: "opinion:disliked", sign: "minus", text: "The Sour Wolf does not trust you." },
    ]);
    // No bestiary, or an exempt campaign: nothing, as before.
    expect(checkBadges(ON, "riftlight", hero(), { discovers: ["creature.glass_crab"] })).toEqual([]);
    expect(checkBadges(ON, "gemfall", hero(), { discovers: ["creature.glass_crab"] }, 2, bestiary)).toEqual([]);
  });

  it("is absent for an untagged scene, matchups off, or an exempt campaign", () => {
    expect(checkBadges(ON, "riftlight", hero(), {})).toEqual([]);
    expect(checkBadges(OFF, "riftlight", hero(), { tags: ["sneak"] })).toEqual([]);
    expect(checkBadges(ON, "gemfall", hero(), { tags: ["sneak"] })).toEqual([]);
    expect(mount(<CheckMatchupBadges chapter={chapter} sceneId="s_plain" hero={hero()} />).container.innerHTML).toBe("");
  });
});
