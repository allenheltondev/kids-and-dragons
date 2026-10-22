// @vitest-environment jsdom
/**
 * Class tokens and the rank-up moment (#314).
 *
 * The token is always its own name on screen, its notches and pips are said
 * in words as well as drawn as shapes, spare tokens sit in the pack outside
 * the six slots, and the moment on the shared screen goes away by itself
 * without ever taking a tap.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { INVENTORY_SLOTS, rankUpLine } from "@kad/shared";
import type { PartyMember, ResolvedCharacter, RulesContent } from "@kad/shared";
import { useGameStore } from "../store";
import { CharacterSheet } from "./CharacterSheet";
import { ClassToken, TokenCard } from "./ClassToken";
import { RANK_UP_MS, RankUpCard, RankUpMoment, resetRankUpMoments } from "./RankUpMoment";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const RULES = JSON.parse(readFileSync(path.join(ROOT, "content", "rules.json"), "utf8")) as RulesContent;

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Pip",
    species: "unicorn",
    class: "thornguard",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 2,
    xp: 0,
    tier: "fledgling",
    stats: { might: 4, quick: 2, clever: 1, heart: 2 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 2,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "might",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

const member = (c: ResolvedCharacter): PartyMember => ({ character: c, playerId: c.ownerPlayerId, hp: 8, down: false, connected: true, ready: true });

afterEach(() => {
  cleanup();
  useGameStore.setState({ rules: null });
});

describe("the worn token", () => {
  it("is named as the gear it is, with its notches in words", () => {
    render(<ClassToken classId="starweaver" rank="expert" owner="your" />);
    expect(screen.getByRole("img", { name: "your star circlet, 2 notches" })).toBeTruthy();
    expect(document.querySelectorAll(".token-notch")).toHaveLength(3);
    expect(document.querySelectorAll(".token-notch--cut")).toHaveLength(2);
  });

  it("can be pressed and held to hear what it is (#256)", () => {
    render(<ClassToken classId="duskrunner" rank="none" />);
    const token = screen.getByRole("img");
    expect(token.dataset.helpKind).toBe("token");
    expect(token.dataset.helpName).toBe("Dusk hood");
  });

  it("shows the rank and the next notch's pips, said as a count too", () => {
    render(<TokenCard character={character({ rank: "apprentice", deeds: { shove_off_friend: 1 } })} isMe rules={RULES} partySize={3} />);
    expect(screen.getByText("Your thorn bracer")).toBeTruthy();
    expect(screen.getByText("Thornguard Apprentice")).toBeTruthy();
    expect(screen.getByText("Next notch: Thornguard Expert")).toBeTruthy();
    expect(screen.getByText("Shove a monster off a hurt friend")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(document.querySelectorAll(".deed-pip")).toHaveLength(3);
    expect(document.querySelectorAll(".deed-pip--done")).toHaveLength(1);
  });

  it("reads the class alone with no rank, and a hero alone sees the deed she can do alone", () => {
    render(<TokenCard character={character()} isMe={false} rules={RULES} partySize={1} />);
    expect(screen.getByText("Pip's thorn bracer")).toBeTruthy();
    expect(screen.getByText("Thornguard")).toBeTruthy();
    expect(screen.getByText("End your turn on your feet next to a monster")).toBeTruthy();
  });

  it("draws a long count as a bar with its number: a Songkeeper's hearts", () => {
    render(<TokenCard character={character({ class: "songkeeper", rank: "apprentice", deeds: { song_hearts: 7 } })} isMe rules={RULES} partySize={2} />);
    expect(screen.getByText("7 of 15")).toBeTruthy();
    expect(document.querySelector(".deed-pips__bar")).not.toBeNull();
  });

  it("says every notch is cut at Master", () => {
    render(<TokenCard character={character({ rank: "master" })} isMe rules={RULES} partySize={2} />);
    expect(screen.getByText("Every notch is cut!")).toBeTruthy();
  });
});

describe("spare tokens in the pack", () => {
  it("sit beside the six slots, with their notches, and take none of them", () => {
    useGameStore.setState({ rules: RULES });
    render(
      <CharacterSheet
        member={member(character({ class: "starweaver", spares: [{ class: "thornguard", rank: "expert" }, { class: "songkeeper", rank: "none" }] }))}
        isMe
        items={{}}
      />,
    );
    expect(document.querySelectorAll(".sheetview__slot")).toHaveLength(INVENTORY_SLOTS);
    expect(screen.getByText("Your old gear")).toBeTruthy();
    expect(screen.getByRole("img", { name: "thorn bracer, 2 notches" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "song bell, no notches yet" })).toBeTruthy();
    expect(screen.getByText("Your star circlet")).toBeTruthy();
  });

  it("are not drawn for a hero who has only worn one class", () => {
    render(<CharacterSheet member={member(character())} isMe items={{}} />);
    expect(screen.queryByText(/old gear/)).toBeNull();
  });
});

describe("the rank-up moment", () => {
  const dusk = rankUpLine("Pip", RULES.classes.duskrunner, "apprentice", "c_1");
  const thorn = rankUpLine("Pip", RULES.classes.thornguard, "expert", "c_1");
  const party = [member(character({ class: "duskrunner" }))];

  beforeEach(() => {
    vi.useFakeTimers();
    resetRankUpMoments();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lifts the token over the shared screen for a few seconds, then lets it go for good", () => {
    render(<RankUpMoment ups={[dusk]} party={party} rules={RULES} momentKey="camp:c_1.apprentice" />);
    const moment = screen.getByTestId("rank-up-moment");
    // A picture: the line under the story says it, and read-aloud reads it, once.
    expect(moment.getAttribute("aria-hidden")).toBe("true");
    expect(moment.textContent).toContain("Duskrunner Apprentice!");
    expect(moment.querySelector(".class-token--glow .token-notch--fresh")).not.toBeNull();
    expect(RANK_UP_MS).toBeLessThanOrEqual(5000);
    act(() => { vi.advanceTimersByTime(RANK_UP_MS); });
    expect(screen.queryByTestId("rank-up-moment")).toBeNull();
    // Redrawn on the same scene, it does not cheer twice.
    cleanup();
    render(<RankUpMoment ups={[dusk]} party={party} rules={RULES} momentKey="camp:c_1.apprentice" />);
    expect(screen.queryByTestId("rank-up-moment")).toBeNull();
    // A new rank is a new moment.
    cleanup();
    render(<RankUpMoment ups={[thorn]} party={party} rules={RULES} momentKey="road:c_1.expert" />);
    expect(screen.getByTestId("rank-up-moment")).toBeTruthy();
  });

  it("takes no taps: nothing in it is a control", () => {
    render(<RankUpMoment ups={[dusk, thorn]} party={party} rules={RULES} momentKey="k" />);
    expect(screen.getByTestId("rank-up-moment").querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("has the crows say it for a Duskrunner, and only a Duskrunner", () => {
    render(<RankUpMoment ups={[dusk]} party={party} rules={RULES} momentKey="a" />);
    expect(screen.getByTestId("rank-up-moment").textContent).toContain("Don't mess with us.");
    cleanup();
    render(<RankUpMoment ups={[thorn]} party={party} rules={RULES} momentKey="b" />);
    expect(screen.getByTestId("rank-up-moment").textContent).not.toMatch(/mess with us/);
  });

  it("is a card with the whole line on the earning kid's phone, crow and all", () => {
    render(<RankUpCard up={dusk} />);
    const card = screen.getByTestId("player-rank-up");
    expect(card.textContent).toContain("Pip is a Duskrunner Apprentice now! New move: Vanish.");
    expect(card.textContent).toContain("Don't mess with us.");
    expect(screen.getByRole("img", { name: "your dusk hood, 1 notch" })).toBeTruthy();
  });
});
