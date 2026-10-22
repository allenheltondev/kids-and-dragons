// @vitest-environment jsdom
/**
 * CombatControls — the select→(aim→)commit walk, driven through a real DOM.
 *
 * `screens.test.tsx` proves this panel *renders*. That is a low bar for a
 * state machine whose entire job is what happens between taps, and it is the
 * wrong bar for the two rules the panel exists to enforce: **a tap on a legal
 * thing does it, and nothing else is on screen to tap** (spec §7.2, §11). A
 * misfire here is a child's turn spent on the wrong tile, which is the most
 * upsetting failure the game has — so what each tap sends, and when, is the
 * whole subject.
 *
 * So these drive it the way a thumb does — click, look, click — and assert on
 * two things only: what is on screen, and what reached `send`. The store is
 * real (`useGameStore.setState`), the encounter is real (`beginEncounter`), and
 * the action cards come from `legalActions`, the same function the server
 * re-runs to validate. The only fixture is the ability catalog, which is local
 * so these tests stay about the panel rather than about `content/abilities.json`
 * — `screens.test.tsx` already guards the real catalog's shape.
 *
 * The other half of §7.2 — "illegal moves are not presented, so they can't be
 * attempted" — is asserted as an *absence*: nothing here is ever disabled, so
 * a button that should not exist has to genuinely not exist.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beginEncounter,
  parseBoard,
  type AbilityCatalog,
  type ClientIntent,
  type EncounterSetup,
  type EncounterState,
  type EnemySpec,
  type ItemCatalog,
  type PartyMember,
  type ResolvedCharacter,
  type RulesContent,
} from "@kad/shared";
import { makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { CombatControls } from "./CombatPanel";
import { describeBeats, needsLine, rollWords } from "./fight-log";

const RULES: RulesContent = makeRules();
const ITEMS: ItemCatalog = makeItems();

/**
 * Written for the *shapes* the panel walks, one ability per shape, because the
 * branches under test are "how many things must be picked and in what order":
 *
 *   strike       — a figure, one of them          (target: the tap commits)
 *   volley       — two different figures          (target → target commits)
 *   thorns       — two tiles                      (tile → tile commits)
 *   pounce       — a tile, then a figure from it  (tile → tile-target commits)
 *   shout        — nothing at all                 (the card commits)
 */
const CATALOG: AbilityCatalog = {
  strike: {
    id: "strike",
    name: "Strike",
    icon: "swords",
    timing: "action",
    target: { kind: "enemy", range: 6 },
    effects: [{ effect: { type: "attack", damage: 2 } }],
  },
  volley: {
    id: "volley",
    name: "Volley",
    icon: "arrow",
    timing: "action",
    target: { kind: "enemy", range: 6, count: 2 },
    effects: [{ effect: { type: "attack", damage: 1 } }],
  },
  thorns: {
    id: "thorns",
    name: "Thorns",
    icon: "thorn",
    timing: "action",
    target: { kind: "tile", range: 6, tileCount: 2 },
    effects: [{ effect: { type: "growWall" }, to: "self" }],
  },
  pounce: {
    id: "pounce",
    name: "Pounce",
    icon: "arrow",
    timing: "action",
    target: {
      kind: "tile",
      range: 6,
      openTileOnly: true,
      affects: "enemy",
      followUp: { kind: "enemy", range: "adjacent" },
    },
    effects: [{ effect: { type: "moveSelf" } }, { effect: { type: "attack", damage: 2 } }],
  },
  shout: {
    id: "shout",
    name: "Shout",
    icon: "moon",
    timing: "action",
    target: { kind: "self" },
    effects: [{ effect: { type: "evade" }, to: "self" }],
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_hero",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "thornguard",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    // Quick 9 against a Quick-3 wisp so the hero reliably leads and every test
    // below can say "her turn" without pinning a die.
    stats: { might: 4, quick: 9, clever: 1, heart: 1 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 12,
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

function wisp(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return {
    id: "wisp",
    name: "Bramblewisp",
    count: 1,
    hp: 6,
    guard: 11,
    quick: 3,
    steps: 5,
    attack: 3,
    ...overrides,
  };
}

/** Five by five, all open. The hero at (1,2), one wisp beside her at (2,2). */
function encounterWith(overrides: Partial<EncounterSetup> = {}): EncounterState {
  const setup: EncounterSetup = {
    board: parseBoard([".....", ".....", ".....", ".....", "....."]),
    party: [{ character: character(), at: { x: 1, y: 2 } }],
    enemies: [{ spec: wisp(), at: { x: 2, y: 2 } }],
    ...overrides,
  };
  return beginEncounter(setup, { rules: RULES, abilities: CATALOG, rng: { next: () => 0.5 } });
}

function member(char: ResolvedCharacter): PartyMember {
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: true,
  };
}

interface MountOptions {
  encounter?: EncounterState;
  characters?: ResolvedCharacter[];
  /** Whose device this is. Defaults to the first character's owner. */
  playerId?: string;
  items?: ItemCatalog | null;
  abilities?: AbilityCatalog | null;
  rules?: RulesContent | null;
}

/**
 * Puts a real encounter in the real store and renders the panel over it.
 *
 * The characters are seated *in the encounter*, not only in the party list:
 * `legalActions` reads the combatant's abilities, which `beginEncounter` copies
 * off the character. Wiring only the store would leave every hero with the
 * three universal actions and silently make each ability test vacuous.
 */
function mount(options: MountOptions = {}) {
  const chars = options.characters ?? [character()];
  const encounter =
    options.encounter ??
    encounterWith({
      party: chars.map((c, i) => ({ character: c, at: { x: 1, y: i + 2 } })),
    });
  const sent: ClientIntent[] = [];
  const send = vi.fn(async (intent: ClientIntent) => {
    sent.push(intent);
    return true;
  });

  useGameStore.setState({
    session: {
      runId: "r_1",
      roomCode: "ABCD",
      playerId: options.playerId ?? chars[0]?.ownerPlayerId ?? "p_1",
      mode: "travel",
      sessionToken: "t",
    },
    state: {
      runId: "r_1",
      roomCode: "ABCD",
      mode: "travel",
      seq: 1,
      phase: "scene",
      campaignId: null,
      chapterId: "ch_1",
      sceneId: "s_1",
      sceneType: "encounter",
      narration: "",
      art: null,
      party: chars.map(member),
      prompt: null,
      lastRoll: null,
      flags: {},
      xpEarned: 0,
      updatedAt: "2026-07-04T18:00:00.000Z",
      encounter,
    },
    rules: options.rules === undefined ? RULES : options.rules,
    abilities: options.abilities === undefined ? CATALOG : options.abilities,
    items: options.items === undefined ? ITEMS : options.items,
    synced: true,
    send,
  });

  const view = render(<CombatControls />);
  return { ...view, sent, send, encounter };
}

/** The action cards, by their visible label. */
function cardNames(): string[] {
  return screen
    .queryAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "")
    .filter((t) => t.length > 0);
}

const card = (name: string) => screen.getByRole("button", { name });
const tile = (x: number, y: number) =>
  screen.getByRole("button", { name: new RegExp(`column ${x + 1}, row ${y + 1}$`) });
const changeButtons = () => screen.getAllByRole("button", { name: "Change" });
const END = "End my turn";

beforeEach(() => {
  useGameStore.setState({ send: async () => true });
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// Whose turn it is
// ---------------------------------------------------------------------------

describe("whose turn it is", () => {
  it("offers nothing on somebody else's turn, and says whose", () => {
    /*
     * A second hero with a *lower* Quick would still lead sometimes on a tied
     * die, so the wisp is given the clock directly: turnIndex points at it.
     */
    const encounter = encounterWith();
    const wispIndex = encounter.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...encounter, turnIndex: wispIndex } });

    expect(screen.getByRole("status").textContent).toContain("Bramblewisp");
    // The board stays — it is the map to plan the next turn on — but not one
    // of its squares is a button, and there are no cards: absent, not disabled.
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("renders nothing at all once the fight is over", () => {
    // The panel lives in PlayerPanel's prompt slot and is mounted whenever the
    // run state is; "no encounter" has to mean an empty slot, not an empty box
    // with a heading in it.
    const { container } = mount();
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: null } });
    });
    expect(container.innerHTML).toBe("");
  });

  it("writes everyone's HP on their square, on every turn", () => {
    // A Party Mode phone has no other view of the board, so the board is the
    // fight's whole shared state — and "which one is nearly done" is read off
    // the map rather than looked up. Checked on a monster's turn, when there
    // is nothing else on the pane to carry it.
    const base = encounterWith({
      enemies: [
        { spec: wisp(), at: { x: 2, y: 2 } },
        { spec: wisp(), at: { x: 2, y: 3 } },
      ],
    });
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) =>
        c.id === "wisp#2" ? { ...c, hp: 2 } : c.side === "party" ? { ...c, hp: 7 } : c,
      ),
    };
    const wispIndex = hurt.order.findIndex((id) => id.startsWith("wisp"));
    const { container } = mount({ encounter: { ...hurt, turnIndex: wispIndex } });

    const hp = (selector: string) =>
      [...container.querySelectorAll(selector)].map((cell) => cell.querySelector(".combat__cell-hp")?.textContent);
    expect(hp(".combat__cell--party")).toEqual(["7"]);
    expect(hp(".combat__cell--enemy")).toEqual(["6", "2"]);
  });

  it("draws a near square's dot bigger than one at the edge of the reach", () => {
    // Diagonals cost one step, so the reach is a square and its corners look
    // as close as the squares beside you. The dot's size says how far.
    const { container } = mount();
    const nearness = (x: number, y: number) =>
      Number(
        (container.querySelector(`[data-x="${x}"][data-y="${y}"] .combat__dot`) as HTMLElement)
          .style.getPropertyValue("--nearness"),
      );
    // The hero stands at (1,2) with 4 steps on a 5×5 board: the farthest
    // square on offer, (4,4), is 3 away.
    expect(nearness(1, 1)).toBe(1);
    expect(nearness(4, 4)).toBe(0);
    expect(nearness(3, 3)).toBeCloseTo(0.5);
  });

  it("keeps a figure's facing when its foe is straight above or below, as the TV does", () => {
    // The hero at (1,2) faces the wisp on her right. She steps to (2,1),
    // straight above it: nobody is sideways to face, so she stays turned.
    const { container } = mount();
    const facesRight = () =>
      container.querySelector(".combat__cell--party")!.classList.contains("combat__cell--faces-right");
    expect(facesRight()).toBe(true);
    const current = useGameStore.getState().state!;
    const enc = current.encounter!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: {
            ...enc,
            board: { ...enc.board, actors: enc.board.actors.map((a) => (a.id === "c_hero" ? { ...a, x: 2, y: 1 } : a)) },
          },
        },
      });
    });
    expect(facesRight()).toBe(true);
  });

  it("starts every figure's facing fresh at a new fight, even with the same ids", () => {
    // Fight one: the hero faces the wisp on her right. Fight two reuses both
    // ids and starts her straight above it, with nobody sideways to face: a
    // fresh figure is drawn as it is painted, facing left, as on the TV.
    const { container } = mount({ encounter: { ...encounterWith(), startedAt: 1 } });
    const facesRight = () =>
      container.querySelector(".combat__cell--party")!.classList.contains("combat__cell--faces-right");
    expect(facesRight()).toBe(true);
    const current = useGameStore.getState().state!;
    const second = encounterWith({ party: [{ character: character(), at: { x: 2, y: 1 } }] });
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: { ...second, startedAt: 2 } } });
    });
    expect(facesRight()).toBe(false);
  });

  it("reads everyone's hearts to a screen reader, on every turn", () => {
    // The squares are hidden from assistive tech, and the hearts with them.
    // The list says it in words, buttons-free, even on a monster's turn.
    const base = encounterWith({
      enemies: [
        { spec: wisp(), at: { x: 2, y: 2 } },
        { spec: wisp(), at: { x: 2, y: 3 } },
      ],
    });
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) =>
        c.id === "wisp#2" ? { ...c, hp: 0, down: true } : c.side === "party" ? { ...c, hp: 7 } : c,
      ),
    };
    const wispIndex = hurt.order.findIndex((id) => id === "wisp#1");
    mount({ encounter: { ...hurt, turnIndex: wispIndex } });

    const list = screen.getByRole("list", { name: "Everyone in the fight" });
    const rows = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toContain("You (Sparklehoof): 7 of 10 hearts");
    expect(rows).toContain("Bramblewisp 1, enemy: 6 of 6 hearts, taking a turn");
    expect(rows).toContain("Bramblewisp 2, enemy: knocked down");
    expect(within(list).queryAllByRole("button")).toEqual([]);
  });

  it("turns figures to face the nearest opponent", () => {
    // Art is drawn facing left. The hero at (1,2) has the wisp at (2,2) on
    // her right, so she turns; the wisp's nearest hero is on its left, so it
    // stays as drawn.
    const { container } = mount();
    expect(container.querySelector(".combat__cell--party")?.classList.contains("combat__cell--faces-right")).toBe(true);
    expect(container.querySelector(".combat__cell--enemy")?.classList.contains("combat__cell--faces-right")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The rule: a tap on a legal thing does it
// ---------------------------------------------------------------------------

describe("a friend who stepped away (#258)", () => {
  /** Sparklehoof (Quick 9) leads; this phone is Thistle's. */
  function onAwayFriendsTurn(connected: boolean) {
    const lead = character();
    const friend = character({ id: "c_friend", ownerPlayerId: "p_2", name: "Thistle", stats: { might: 2, quick: 1, clever: 1, heart: 1 } });
    const mounted = mount({ characters: [lead, friend], playerId: "p_2" });
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({
        state: { ...current, party: current.party.map((m) => (m.playerId === "p_1" ? { ...m, connected } : m)) },
      });
    });
    return mounted;
  }

  it("says they stepped away and lets this phone pass their turn, one tap", async () => {
    const user = userEvent.setup();
    const { sent } = onAwayFriendsTurn(false);
    expect(screen.getByText("Sparklehoof stepped away.")).toBeTruthy();
    // Passing is all a stand-in may do: no cards, no squares.
    expect(cardNames()).toEqual(["Pass Sparklehoof\u2019s turn"]);
    await user.click(screen.getByRole("button", { name: /^Pass Sparklehoof/ }));
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("offers nothing while they are still here", () => {
    onAwayFriendsTurn(true);
    expect(screen.getByText("It's Sparklehoof's turn.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("a tap does the thing (spec §11)", () => {
  it("walks on the tile tap — no confirm bar, nothing else appears", async () => {
    const user = userEvent.setup();
    const { sent } = mount();

    await user.click(tile(1, 1));
    expect(sent).toEqual([{ type: "MOVE", to: { x: 1, y: 1 } }]);
    expect(screen.queryByRole("button", { name: /do it/i })).toBeNull();
  });

  it("holds the whole turn while the phone catches up after a drop (#413)", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["shout"] })] });
    act(() => {
      useGameStore.setState({ synced: false });
    });
    try {
      // No gold squares to walk to, and the cards hear no tap.
      expect(screen.queryByRole("button", { name: /column 2, row 2$/ })).toBeNull();
      await user.click(card("Shout"));
      expect(sent).toEqual([]);
      expect(screen.getByText("Catching up with the game…")).toBeTruthy();

      act(() => {
        useGameStore.setState({ synced: true });
      });
      await user.click(card("Shout"));
      expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "shout" }]);
    } finally {
      useGameStore.setState({ synced: true });
    }
  });

  it("does a card with nothing to aim on the card tap", async () => {
    // Shout and Get Ready, nobody in reach: one card to a row, each with its
    // sentence on it, so the tap is the commit.
    const user = userEvent.setup();
    const far = encounterWith({
      party: [{ character: character({ actions: ["shout"] }), at: { x: 1, y: 2 } }],
      enemies: [{ spec: wisp(), at: { x: 4, y: 4 } }],
    });
    const { sent } = mount({ characters: [character({ actions: ["shout"] })], encounter: far });

    await user.click(card("Shout"));
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "shout" }]);
  });

  it("stands every card on a row of its own, sentence and all, and does it on one tap", async () => {
    /*
     * A playtest: "when you have 4+ options it hides the descriptions of what
     * the options do." Packed two or three to a row a card had room for its
     * name only; a tap-to-read pause fixed that at the cost of a second tap
     * nobody guessed. So the cards stand one to a row with their sentences,
     * however many there are, and the tap is the commit.
     */
    const SAID: AbilityCatalog = Object.fromEntries(
      Object.entries(CATALOG).map(([id, ability]) => [id, { ...ability, summary: `What ${ability.name} does.` }]),
    );
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["strike", "shout", "volley"] })], abilities: SAID });
    const list = document.querySelector(".combat__actions")!;
    expect(list.hasAttribute("data-columns")).toBe(false);
    expect(list.getAttribute("data-dense")).toBe("true");
    for (const name of ["Strike", "Shout", "Volley"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) }).textContent).toContain(`What ${name} does.`);
    }
    expect(screen.getByRole("button", { name: /^Get Ready/ }).textContent).toContain("+2 on your next roll");
    expect(document.querySelector(".combat__reading")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Shout/ }));
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "shout" }]);
  });

  it("offers no End turn while there is a card to play — Get Ready is how you pass", () => {
    /*
     * The turn used to end with a button and a confirm, every turn. The engine
     * now ends a spent turn itself, and before the action is spent "end my
     * turn" is a strictly worse Get Ready (same skip, no +2) — so it is not a
     * choice on the list, and an accidental skipped turn is not a tap away.
     */
    mount();
    expect(screen.getByRole("button", { name: /^Get Ready/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: END })).toBeNull();
  });

  it("offers End turn, one tap, when steps are left after the action (Twin Step)", async () => {
    const user = userEvent.setup();
    const base = encounterWith();
    const { sent } = mount({ encounter: { ...base, actionTaken: true, moveAfterAction: true } });

    expect(screen.getAllByRole("button", { name: /^Move to column/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/You can still walk 4 steps, or end your turn/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: END }));
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("offers End turn when there is nothing at all to do", async () => {
    // A catalog with no Get Ready and nobody in reach: the one turn with no
    // card has to stay endable.
    const user = userEvent.setup();
    const far = encounterWith({ enemies: [{ spec: wisp(), at: { x: 4, y: 4 } }] });
    const { sent } = mount({ encounter: far, abilities: { ...CATALOG, ready: { ...CATALOG.shout!, id: "ready", name: "Nothing", target: { kind: "enemy", range: "adjacent" } } } });
    expect(screen.queryByRole("button", { name: /^Get Ready/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: END }));
    expect(sent).toEqual([{ type: "END_TURN" }]);
  });

  it("holds the cards in place, inert, while a commit is on its way, then clears on a refusal", async () => {
    const user = userEvent.setup();
    let release = (ok: boolean): void => void ok;
    const send = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    // Nobody in reach, so Shout and Get Ready have a row each and Shout's tap is the commit.
    const far = encounterWith({
      party: [{ character: character({ actions: ["shout"] }), at: { x: 1, y: 2 } }],
      enemies: [{ spec: wisp(), at: { x: 4, y: 4 } }],
    });
    mount({ characters: [character({ actions: ["shout"] })], encounter: far });
    useGameStore.setState({ send });

    const shout = card("Shout");
    await user.click(shout);
    expect(send).toHaveBeenCalledTimes(1);
    // Nothing to double-tap, and nothing moves: the card is the same node it
    // was (not re-dealt), inside an inert box, and a second tap sends nothing.
    // The gold squares go, and the hint's own line says why.
    expect(card("Shout")).toBe(shout);
    expect(shout.closest("[inert]")).not.toBeNull();
    await user.click(shout);
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("Doing it…");

    // A refusal (a stale phone) hands the turn back rather than sticking.
    await act(async () => {
      release(false);
    });
    expect(card("Shout").closest("[inert]")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Move to column/ }).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The aim steps
// ---------------------------------------------------------------------------

describe("aiming", () => {
  it("asks who, and the answer is the commit", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();
    expect(sent).toEqual([]);

    // Enemy ids carry their placement ordinal, so "which one am I about to
    // hit" survives three identical wisps (combat-grid.ts `combatantLabel`).
    // The target button also says how many hearts it has left.
    const target = screen.getByRole("button", { name: /Bramblewisp 1/ });
    expect(target.textContent).toContain("6/6");
    await user.click(target);
    expect(sent).toEqual([
      { type: "COMBAT_ACTION", abilityId: "strike", targetId: "wisp#1" },
    ]);
  });

  it("offers the Songkeeper herself as a target, marked as you (#309)", async () => {
    const user = userEvent.setup();
    const abilities: AbilityCatalog = {
      ...CATALOG,
      lullaby: {
        id: "lullaby",
        name: "Lullaby",
        icon: "note",
        timing: "action",
        target: { kind: "ally", range: "board", includeSelf: true },
        effects: [{ effect: { type: "heal", amount: 2 } }],
      },
    };
    const keeper = character({ class: "songkeeper", actions: ["lullaby"] });
    const hurt = (enc: EncounterState): EncounterState => ({
      ...enc,
      combatants: enc.combatants.map((c) => (c.side === "party" ? { ...c, hp: 3 } : c)),
    });

    // A table of one: the only thing to aim at is yourself.
    const solo = mount({
      abilities,
      characters: [keeper],
      encounter: hurt(
        encounterWith({ party: [{ character: keeper, at: { x: 1, y: 2 } }] }),
      ),
    });
    await user.click(card("Lullaby"));
    expect(screen.getAllByRole("button", { name: /Sparklehoof \(you\)/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /Sparklehoof \(you\)/ }));
    expect(solo.sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "lullaby", targetId: "c_hero" }]);
  });

  it("picks two different figures for a two-target ability, and counts them", async () => {
    const user = userEvent.setup();
    const archer = character({ actions: ["volley"] });
    const { sent } = mount({
      characters: [archer],
      encounter: encounterWith({
        party: [{ character: archer, at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp(), at: { x: 2, y: 2 } },
          { spec: wisp(), at: { x: 2, y: 3 } },
        ],
      }),
    });

    await user.click(card("Volley"));
    expect(screen.getByText(/Volley: who\? \(1 of 2\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    // The one already picked is gone from the list — the same figure twice is
    // not two targets, and the server would refuse it.
    expect(screen.getByText(/Volley: who\? \(2 of 2\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bramblewisp 1/ })).toBeNull();

    // The last pick is the commit.
    await user.click(screen.getByRole("button", { name: /Bramblewisp 2/ }));

    // Several chosen things ride the *plural* field. One would ride `targetId`.
    expect(sent).toEqual([
      { type: "COMBAT_ACTION", abilityId: "volley", targetIds: ["wisp#1", "wisp#2"] },
    ]);
  });

  it("lets an up-to-N ability stop early with Go, once one is picked", async () => {
    // "Up to": the server accepts fewer. With one wisp picked and another on
    // offer, Go sends the one — through the singular field, since it is one.
    const user = userEvent.setup();
    const archer = character({ actions: ["volley"] });
    const { sent } = mount({
      characters: [archer],
      encounter: encounterWith({
        party: [{ character: archer, at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp(), at: { x: 2, y: 2 } },
          { spec: wisp(), at: { x: 2, y: 3 } },
        ],
      }),
    });

    await user.click(card("Volley"));
    expect(screen.queryByRole("button", { name: /Go!/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    await user.click(screen.getByRole("button", { name: /Go!/ }));
    expect(sent).toEqual([{ type: "COMBAT_ACTION", abilityId: "volley", targetId: "wisp#1" }]);
  });

  it("sends Go once, however fast it is tapped twice before the board catches up", async () => {
    // The worst case: both taps land before React has re-rendered, so the
    // second one still finds Go! on screen and the handler from the first.
    const user = userEvent.setup();
    const send = vi.fn(() => new Promise<boolean>(() => {}));
    const archer = character({ actions: ["volley"] });
    mount({
      characters: [archer],
      encounter: encounterWith({
        party: [{ character: archer, at: { x: 1, y: 2 } }],
        enemies: [
          { spec: wisp(), at: { x: 2, y: 2 } },
          { spec: wisp(), at: { x: 2, y: 3 } },
        ],
      }),
    });
    useGameStore.setState({ send });

    await user.click(card("Volley"));
    await user.click(screen.getByRole("button", { name: /Bramblewisp 1/ }));
    const go = screen.getByRole("button", { name: /Go!/ });
    act(() => {
      go.click();
      go.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    // And the question row is gone with it: nothing left to Change mid-send.
    expect(screen.queryByRole("button", { name: /Go!/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("collects two tiles for a two-tile ability, keeping the first one lit", async () => {
    const user = userEvent.setup();
    const { sent, container } = mount({ characters: [character({ actions: ["thorns"] })] });

    await user.click(card("Thorns"));
    expect(screen.getByText(/tap a glowing tile\. \(1 of 2\)/)).toBeTruthy();

    await user.click(tile(0, 0));
    expect(screen.getByText(/tap a glowing tile\. \(2 of 2\)/)).toBeTruthy();
    expect(container.querySelectorAll(".combat__cell--selected")).toHaveLength(1);
    // The tile just taken is no longer offered — the same square twice is one
    // wall, not two, and the server refuses the action outright.
    expect(screen.queryByRole("button", { name: "Aim at column 1, row 1" })).toBeNull();

    // The second tile completes the wall, and sends it.
    await user.click(tile(0, 1));
    expect(sent).toEqual([
      {
        type: "COMBAT_ACTION",
        abilityId: "thorns",
        targetTiles: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ]);
  });

  it("pairs a tile with the figures reachable from it, never recombining them", async () => {
    /*
     * Pounce lands, then swings from where it landed. The pairing is the
     * server's list (`tileTargets`); building it on the phone from "tiles" ×
     * "targets" would offer a landing spot with a victim it cannot reach.
     */
    const user = userEvent.setup();
    const cat = character({ actions: ["pounce"] });
    const { sent } = mount({
      characters: [cat],
      encounter: encounterWith({
        party: [{ character: cat, at: { x: 0, y: 0 } }],
        // Two wisps, far apart on purpose: the landing tile below is adjacent
        // to the first and nowhere near the second. A phone that built its own
        // target list from `targets` would offer both.
        enemies: [
          { spec: wisp(), at: { x: 4, y: 4 } },
          { spec: wisp(), at: { x: 4, y: 0 } },
        ],
      }),
    });

    await user.click(card("Pounce"));
    await user.click(tile(3, 4));
    expect(screen.getByText(/Pounce: who\?/)).toBeTruthy();

    // Exactly one victim is reachable from where it would land.
    const offered = screen.getAllByRole("button", { name: /Bramblewisp/ });
    expect(offered.map((b) => b.textContent)).toHaveLength(1);
    expect(offered[0]!.textContent).toContain("Bramblewisp 1");

    await user.click(offered[0]!);

    expect(sent).toEqual([
      {
        type: "COMBAT_ACTION",
        abilityId: "pounce",
        targetId: "wisp#1",
        targetTile: { x: 3, y: 4 },
      },
    ]);
  });

  it("asks one question at a time — move tiles and cards vanish while aiming", async () => {
    /*
     * The grid is the answer surface for whatever is being asked *right now*.
     * Leaving move destinations lit under a "who?" step means a tap meant for
     * the question silently walks somewhere instead — and with no confirm,
     * walks for real.
     */
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike", "shout"] })] });
    const moveTiles = () => screen.queryAllByRole("button", { name: /^Move to column/ });
    expect(moveTiles().length).toBeGreaterThan(0);

    await user.click(card("Strike"));
    expect(moveTiles()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Shout" })).toBeNull();
  });

  it("abandons a half-aimed ability cleanly", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ characters: [character({ actions: ["thorns"] })] });

    await user.click(card("Thorns"));
    await user.click(tile(0, 0));
    await user.click(changeButtons()[0]!);

    expect(sent).toEqual([]);
    expect(screen.getByRole("button", { name: "Thorns" })).toBeTruthy();
    // The abandoned tile is no longer lit.
    expect(document.querySelectorAll(".combat__cell--selected")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Only legal taps exist
// ---------------------------------------------------------------------------

describe("only legal taps exist (§7.2)", () => {
  it("never renders a disabled control — a greyed button is a question", async () => {
    // The rule from the module header. `disabled` appears nowhere in this
    // panel: a commit in flight makes the cards inert for that moment, under
    // "Doing it…", and never marks a button disabled.
    mount({ characters: [character({ actions: ["strike", "shout"] })] });
    const disabled = screen.getAllByRole("button").filter((b) => b.hasAttribute("disabled"));
    expect(disabled).toEqual([]);
  });

  it("offers nothing once the action and the steps are gone — the engine is ending the turn", () => {
    const base = encounterWith();
    mount({ encounter: { ...base, stepsLeft: 0, actionTaken: true } });

    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);
    expect(screen.queryByRole("button", { name: END })).toBeNull();
    expect(cardNames()).toEqual([]);
  });

  it("offers no action cards once the action is spent", () => {
    const base = encounterWith();
    mount({
      characters: [character({ actions: ["strike"] })],
      encounter: { ...base, actionTaken: true },
    });
    expect(cardNames()).not.toContain("Strike");
  });

  it("does not offer an ability the character does not have", () => {
    mount({ characters: [character({ actions: ["strike"] })] });
    const names = cardNames();
    expect(names).toContain("Strike");
    expect(names).not.toContain("Volley");
    expect(names).not.toContain("Pounce");
  });

  it("waits for the rules and the catalog rather than guessing", () => {
    // Both ride the same content fetch. Until they land there are no cards —
    // but the board and the party are still drawn, so the phone is not blank.
    mount({ characters: [character({ actions: ["strike"] })], abilities: null });
    expect(cardNames()).not.toContain("Strike");
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Items in a fight (§7.2's fourth universal action)
// ---------------------------------------------------------------------------

describe("items in a fight", () => {
  const potion = { itemId: "sunbloom_draught", kind: "consumable" as const };

  it("offers a healing draught only when it would do something", async () => {
    const hurt = encounterWith();
    const wounded = {
      ...hurt,
      combatants: hurt.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    const user = userEvent.setup();
    const { sent } = mount({
      characters: [character({ inventory: [potion] })],
      encounter: wounded,
    });

    await user.click(screen.getByRole("button", { name: /Use Sunbloom Draught/ }));
    expect(sent).toEqual([{ type: "USE_ITEM", itemId: "sunbloom_draught" }]);
  });

  it("hides a heal at full health — a use that changes nothing must not be offered", () => {
    mount({ characters: [character({ inventory: [potion] })] });
    expect(cardNames().some((n) => n.includes("Sunbloom"))).toBe(false);
  });

  it("hides every item once the action is spent", () => {
    const base = encounterWith();
    const wounded = {
      ...base,
      actionTaken: true,
      combatants: base.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    mount({ characters: [character({ inventory: [potion] })], encounter: wounded });
    expect(cardNames().some((n) => n.includes("Sunbloom"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fitting on one screen
// ---------------------------------------------------------------------------

describe("fitting every card on one screen", () => {
  it("shows two of the same item as one card that says how many", () => {
    const base = encounterWith();
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    const potion = { itemId: "sunbloom_draught", kind: "consumable" as const };
    mount({ characters: [character({ inventory: [potion, potion] })], encounter: hurt });
    const cards = screen.getAllByRole("button", { name: /Sunbloom/ });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.textContent).toContain("×2");
  });

  it("folds a full bag into one card that opens in place, and the item tap commits", async () => {
    /*
     * Seven ability cards and two kinds of item would be nine cards loose.
     * Past six, the bag folds into "Use an item", so the card rows (and the
     * board above them) still fit the pane.
     */
    const user = userEvent.setup();
    const hero = character({
      actions: ["strike", "volley", "thorns", "pounce", "shout"],
      inventory: [
        { itemId: "sunbloom_draught", kind: "consumable" },
        { itemId: "brave_whistle", kind: "consumable" },
      ],
    });
    // The fight is built from this hero, so its combatant carries the five
    // abilities: seven cards with Attack and Get Ready, nine with the items.
    const base = encounterWith({ party: [{ character: hero, at: { x: 1, y: 2 } }] });
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    const { sent, container } = mount({ characters: [hero], encounter: hurt });

    expect(screen.queryByRole("button", { name: /Sunbloom/ })).toBeNull();
    const list = container.querySelector(".combat__actions")!;
    expect(list.getAttribute("data-dense")).toBe("true");

    await user.click(screen.getByRole("button", { name: /^Use an item/ }));
    expect(screen.getByText("Use an item: which one?")).toBeTruthy();
    // The ability cards stepped aside: one question at a time.
    expect(screen.queryByRole("button", { name: /^Strike/ })).toBeNull();
    expect(sent).toEqual([]);

    await user.click(screen.getByRole("button", { name: /Use Sunbloom Draught/ }));
    expect(sent).toEqual([{ type: "USE_ITEM", itemId: "sunbloom_draught" }]);
  });

  it("keeps items loose while everything fits", () => {
    const base = encounterWith();
    const hurt = {
      ...base,
      combatants: base.combatants.map((c) => (c.side === "party" ? { ...c, hp: 4 } : c)),
    };
    mount({
      characters: [
        character({
          inventory: [
            { itemId: "sunbloom_draught", kind: "consumable" },
            { itemId: "brave_whistle", kind: "consumable" },
          ],
        }),
      ],
      encounter: hurt,
    });
    expect(screen.queryByRole("button", { name: /^Use an item/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Use Sunbloom Draught/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use Brave Whistle/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The board keeps its size for the turn
// ---------------------------------------------------------------------------

describe("the board keeps its size for the turn", () => {
  /*
   * The board takes whatever height the pane has left, so anything around it
   * that comes and goes resizes the map mid-turn. jsdom has no layout to
   * measure, so these pin the seats instead: things are kept and hidden,
   * not removed, and the card rows hold their shape.
   */
  it("keeps the cards dense for the whole turn when one goes away", () => {
    mount({ characters: [character({ actions: ["strike"] })] });
    const dense = () => document.querySelector(".combat__actions")?.getAttribute("data-dense");
    // Attack (the wisp is beside her), Strike and Get Ready: three, so dense.
    expect(screen.getByRole("button", { name: /^Attack/ })).toBeTruthy();
    expect(dense()).toBe("true");

    // She steps away: Attack goes, and two cards alone would not be dense.
    // Same turn, so the same short rows.
    const current = useGameStore.getState().state!;
    const enc = current.encounter!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: {
            ...enc,
            stepsLeft: enc.stepsLeft - 2,
            board: { ...enc.board, actors: enc.board.actors.map((a) => (a.id === "c_hero" ? { ...a, x: 0, y: 0 } : a)) },
          },
        },
      });
    });
    expect(screen.queryByRole("button", { name: /^Attack/ })).toBeNull();
    expect(dense()).toBe("true");
  });

  it("gives your turn no row of its own and says the steps in the hint", () => {
    // A playtest: "Your turn, Name!" over the board was not a good use of the
    // room. The pinned strip lights up instead (player-panel.test.tsx).
    mount({ encounter: encounterWith() });
    expect(screen.queryByText(/Your turn/)).toBeNull();
    expect(document.querySelector(".combat__waiting")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Walk up to \d+ steps on gold, or pick one thing\./);
  });

  it("keeps the walking key in its seat once there is nowhere to walk", () => {
    const base = encounterWith();
    const { container } = mount({ encounter: { ...base, stepsLeft: 0, actionTaken: true } });
    const walkKey = container.querySelector(".combat__key--walk")!.parentElement!;
    expect(walkKey.style.visibility).toBe("hidden");
    // And the hint's line is still there, empty, rather than gone.
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The turn boundary
// ---------------------------------------------------------------------------

describe("the turn boundary", () => {
  it("drops a half-aimed ability when the turn moves on", async () => {
    /*
     * The dangerous one. A "who?" step left standing across a turn change is
     * a tap that commits last turn's intent against this turn's board — the
     * server would refuse it, but only after the child watched it happen.
     */
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();

    // The same turn, one step spent: still a new question. Wrapped in `act` so
    // the store write and the effect it triggers land before the assertion —
    // a server patch arrives the same way, outside React's own event handling.
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: { ...current.encounter!, stepsLeft: current.encounter!.stepsLeft - 1 },
        },
      });
    });

    expect(screen.queryByText(/Strike: who\?/)).toBeNull();
    expect(screen.getByRole("button", { name: "Strike" })).toBeTruthy();
  });

  it("lets go of a sent move once its patch lands", async () => {
    // The tappables step aside while the move is on its way; the patch that
    // spends the step is a new question, and they come back for it.
    const user = userEvent.setup();
    mount();
    await user.click(tile(1, 1));
    expect(screen.queryAllByRole("button", { name: /^Move to column/ })).toEqual([]);

    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({
        state: {
          ...current,
          encounter: { ...current.encounter!, stepsLeft: current.encounter!.stepsLeft - 1 },
        },
      });
    });
    expect(screen.queryAllByRole("button", { name: /^Move to column/ }).length).toBeGreaterThan(0);
  });

  it("drops a pending selection when the clock hands on to somebody else", async () => {
    const user = userEvent.setup();
    mount({ characters: [character({ actions: ["strike"] })] });

    await user.click(card("Strike"));
    expect(screen.getByText(/Strike: who\?/)).toBeTruthy();

    const current = useGameStore.getState().state!;
    const wispIndex = current.encounter!.order.findIndex((id) => id.startsWith("wisp"));
    act(() => {
      useGameStore.setState({
        state: { ...current, encounter: { ...current.encounter!, turnIndex: wispIndex } },
      });
    });

    expect(screen.queryByText(/Strike: who\?/)).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Bramblewisp");
  });
});

// ---------------------------------------------------------------------------
// What just happened — the roll, shown
// ---------------------------------------------------------------------------

describe("what just happened", () => {
  const roll = (over: Partial<import("@kad/shared").DiceRoll> = {}): import("@kad/shared").DiceRoll => ({
    die: 14,
    mod: 3,
    total: 17,
    tn: 11,
    result: "hit",
    characterId: "c_hero",
    stat: "might",
    ...over,
  });

  it("reads a roll out the way the table would", () => {
    expect(rollWords(roll())).toBe("14 + 3 Might = 17 vs Guard 11");
    expect(rollWords(roll({ mod: 0, total: 14, stat: undefined }))).toBe("14 = 14 vs Guard 11");
    expect(rollWords(roll({ mod: -1, total: 13, stat: undefined }))).toBe("14 - 1 = 13 vs Guard 11");
  });

  it("names the viewer You, everyone else by name, and says who took what", () => {
    const encounter = encounterWith();
    const beats = describeBeats(
      [
        { type: "roll", roll: roll(), targetId: "wisp#1", tier: "solid" },
        { type: "damage", actorId: "wisp#1", amount: 3, hp: 3 },
        { type: "roll", roll: roll({ characterId: "wisp#1", die: 4, mod: 3, total: 7, tn: 12, result: "miss", stat: undefined }), targetId: "c_hero" },
        { type: "moved", actorId: "wisp#1", to: { x: 0, y: 0 } },
        { type: "down", actorId: "c_hero" },
      ],
      encounter,
      "c_hero",
      7,
    );
    // A swing is one line: the roll gathers the hurt that follows it.
    expect(beats.map((b) => b.text)).toEqual([
      "You rolled 14 + 3 Might = 17 vs Guard 11. Solid hit! Bramblewisp 1 takes 3. 3 left.",
      "Bramblewisp 1 rolled 4 + 3 = 7 vs Guard 12. Miss!",
      "You are knocked down!",
    ]);
    // Good news green, bad news red (shape and words carry it too: spec §11).
    expect(beats.map((b) => b.tone)).toEqual(["good", "plain", "bad"]);
  });

  it("says each tier, what the roll needed and whose Guard that was", () => {
    const encounter = encounterWith();
    const swing = (tier: "graze" | "solid" | "critical", amount: number, die: number) =>
      describeBeats(
        [
          { type: "roll", roll: roll({ die, total: die + 3 }), targetId: "wisp#1", tier },
          { type: "damage", actorId: "wisp#1", amount, hp: 6 - amount },
        ],
        encounter,
        "c_hero",
        1,
      );
    expect(swing("graze", 2, 9)[0]!.text).toBe("You rolled 9 + 3 Might = 12 vs Guard 11. Graze! Bramblewisp 1 takes 2. 4 left.");
    expect(swing("solid", 3, 14)[0]!.text).toContain("Solid hit! Bramblewisp 1 takes 3.");
    expect(swing("critical", 5, 20)[0]!.text).toContain("Critical! Bramblewisp 1 takes 5. 1 left.");
    expect(needsLine(swing("graze", 2, 9)[0]!.swing!)).toBe("Needs 11: Bramblewisp 1's Guard");

    // A monster's swing at the phone's own hero needs the hero's Guard.
    const atMe = describeBeats(
      [
        { type: "roll", roll: roll({ characterId: "wisp#1", die: 20, total: 23, tn: 12, stat: undefined }), targetId: "c_hero", tier: "critical" },
        { type: "damage", actorId: "c_hero", amount: 5, hp: 0 },
        { type: "down", actorId: "c_hero" },
      ],
      encounter,
      "c_hero",
      2,
    );
    expect(atMe.map((b) => b.text)).toEqual(["Bramblewisp 1 rolled 20 + 3 = 23 vs Guard 12. Critical! You take 5 and are knocked down!"]);
    expect(needsLine(atMe[0]!.swing!)).toBe("Needs 12: your Guard");
    expect(atMe[0]!.tone).toBe("bad");
  });

  it("keeps the opening monster round when it arrives before the fight does", () => {
    /*
     * The channel delivers ENCOUNTER_BEGAN, with any monster turns that ran
     * before the first hero's, ahead of the patch that puts the encounter in
     * state. The log must still hold that round once the fight appears.
     */
    const fight = { ...encounterWith(), startedAt: 42 };
    mount({ encounter: fight });
    const current = useGameStore.getState().state!;
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: null } });
    });
    act(() => {
      useGameStore.setState({
        presentation: {
          seq: 43,
          presentation: {
            kind: "ENCOUNTER_BEGAN",
            mapId: "thicket",
            firstActorId: "c_hero",
            events: [
              { type: "roll", roll: roll({ characterId: "wisp#1", die: 16, mod: 3, total: 19, tn: 12, stat: undefined }) },
              { type: "damage", actorId: "c_hero", amount: 3, hp: 7 },
            ],
          },
        },
      });
    });
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: fight } });
    });
    const log = screen.getByRole("group", { name: "What just happened" });
    expect(log.textContent).toContain("You take 3. 7 left.");

    // And a fight that ends takes its log with it. The next one has nothing
    // to say until its first beat: no line at all, not "The fight is on!".
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: null } });
    });
    act(() => {
      useGameStore.setState({ state: { ...current, encounter: { ...encounterWith(), startedAt: 99 } } });
    });
    expect(screen.queryByRole("group", { name: "What just happened" })).toBeNull();
    expect(document.body.textContent).not.toContain("You take 3");
    expect(document.body.textContent).not.toContain("The fight is on!");
  });

  it("shows the last beat on the phone in one line: the sum, the Guard it needed, how hard it landed", () => {
    const encounter = encounterWith();
    const wispIndex = encounter.order.findIndex((id) => id.startsWith("wisp"));
    mount({ encounter: { ...encounter, turnIndex: wispIndex } });

    act(() => {
      useGameStore.setState({
        presentation: {
          // Past the seq the test before left in the store: an older one
          // would read as a replay, and the panel would show that one's beat.
          seq: 109,
          presentation: {
            kind: "COMBAT_SEQUENCE",
            events: [
              { type: "heal", actorId: "wisp#1", amount: 1, hp: 6 },
              { type: "roll", roll: roll({ characterId: "wisp#1", die: 16, mod: 3, total: 19, tn: 12, stat: undefined }), targetId: "c_hero", tier: "solid" },
              { type: "damage", actorId: "c_hero", amount: 3, hp: 7 },
            ],
          },
        },
      });
    });
    // The line takes its row when the turn moves on, never mid-turn.
    const heroIndex = encounter.order.indexOf("c_hero");
    act(() => {
      const current = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...current, encounter: { ...current.encounter!, turnIndex: heroIndex } } });
    });

    const log = screen.getByRole("group", { name: "What just happened" });
    // One line on screen, the newest: the swing and what it did, together.
    const shown = log.querySelectorAll(".combat__beat");
    expect(shown).toHaveLength(1);
    expect(shown[0]!.textContent).toBe("Bramblewisp 1 rolled 16 + 3 = 19 vs Guard 12. Solid hit! You take 3. 7 left.");
    expect(shown[0]!.className).toContain("combat__line");
    // The whole beat is still there for a screen reader.
    expect(within(log).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Bramblewisp 1 gets 1 back. 6 now.",
      "Bramblewisp 1 rolled 16 + 3 = 19 vs Guard 12. Solid hit! You take 3. 7 left.",
    ]);
  });
});

describe("the phone's line holds still", () => {
  const roll = (over: Partial<import("@kad/shared").DiceRoll> = {}): import("@kad/shared").DiceRoll => ({
    die: 14,
    mod: 3,
    total: 17,
    tn: 11,
    result: "hit",
    characterId: "c_hero",
    stat: "might",
    ...over,
  });
  const swing = (seq: number) => ({
    seq,
    presentation: {
      kind: "COMBAT_SEQUENCE" as const,
      events: [
        { type: "roll" as const, roll: roll({ characterId: "wisp#1", die: 16, mod: 3, total: 19, tn: 12, stat: undefined }), targetId: "c_hero", tier: "solid" as const },
        { type: "damage" as const, actorId: "c_hero", amount: 3, hp: 7 },
      ],
    },
  });
  const step = (seq: number) => ({
    seq,
    presentation: { kind: "COMBAT_SEQUENCE" as const, events: [{ type: "moved" as const, actorId: "c_hero", to: { x: 1, y: 1 } }] },
  });
  const turnTo = (index: number) =>
    act(() => {
      const current = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...current, encounter: { ...current.encounter!, turnIndex: index } } });
    });
  const line = () => document.querySelector(".combat__beat")?.textContent ?? null;

  it("keeps the last swing through a step, and a step after a step", () => {
    // A review: a step arrives as a batch that says nothing, and taking it
    // as the last beat blanked the line, so the board grew a row and lost it
    // again between a step and an attack.
    const encounter = encounterWith();
    mount({ encounter: { ...encounter, turnIndex: encounter.order.findIndex((id) => id.startsWith("wisp")) } });
    act(() => useGameStore.setState({ presentation: swing(201) }));
    turnTo(encounter.order.indexOf("c_hero"));
    expect(line()).toContain("Solid hit! You take 3.");

    act(() => useGameStore.setState({ presentation: step(202) }));
    expect(line()).toContain("Solid hit! You take 3.");
    act(() => useGameStore.setState({ presentation: step(203) }));
    expect(line()).toContain("Solid hit! You take 3.");
  });

  it("gives a first line its row at the next turn, not in the middle of this one", () => {
    // Move, then attack, with steps still to walk: the board must not lose a
    // row under the finger aiming at it.
    const encounter = encounterWith();
    mount({ encounter: { ...encounter, turnIndex: encounter.order.indexOf("c_hero") } });
    act(() => useGameStore.setState({ presentation: step(301) }));
    expect(document.querySelector(".combat__log")).toBeNull();
    act(() => useGameStore.setState({ presentation: swing(302) }));
    expect(document.querySelector(".combat__log")).toBeNull();
    // Said to a screen reader all the same.
    expect(screen.getByRole("group", { name: "What just happened" }).textContent).toContain("Solid hit!");

    turnTo(encounter.order.findIndex((id) => id.startsWith("wisp")));
    expect(line()).toContain("Solid hit! You take 3.");
  });
});

// ---------------------------------------------------------------------------
// The place fighting back (#201)
// ---------------------------------------------------------------------------

describe("the place fighting back (#201)", () => {
  /** The 5×5 fight, with a clock, an open way out, a hot square and somebody to save. */
  function riftFight(): EncounterState {
    return encounterWith({
      environment: {
        clock: { rounds: 3, label: "The rift closes", onExpire: "collapse" },
        exits: [{ id: "tear", label: "The tear", tiles: [{ x: 0, y: 0 }] }],
        hazards: [{ id: "fire", kind: "fire", label: "Rift fire", tiles: [{ x: 1, y: 1 }], damage: 2 }],
        rescue: { name: "Pip", at: { x: 4, y: 4 } },
      },
    });
  }

  it("says the clock, the way out, the rescue and the fire in words above the board", () => {
    mount({ encounter: riftFight() });
    const rift = screen.getByRole("list", { name: "The rift" });
    const lines = within(rift).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      "The rift closes in 3 rounds.",
      "The tear is open: end your turn on it to escape.",
      "Free Pip: end your turn next to them. 3 rounds left.",
      "Rift fire: stopping on it costs 2 hearts.",
    ]);
  });

  it("names what a square is on the square's own button, so a screen reader hears it before the tap", () => {
    mount({ encounter: riftFight() });
    expect(screen.getByRole("button", { name: "Move to column 1, row 1: The tear, open: stop here to escape" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to column 2, row 2: Rift fire, don't stop here" })).toBeTruthy();
  });

  it("shows none of it in a fight without an environment", () => {
    mount();
    expect(screen.queryByRole("list", { name: "The rift" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /row \d+: / })).toEqual([]);
  });

  it("puts the rift's beats into words", () => {
    const encounter = riftFight();
    const beats = describeBeats(
      [
        { type: "hazard", actorId: "c_hero", hazardId: "fire", label: "Rift fire" },
        { type: "freed", byId: "c_hero" },
        { type: "escaped", actorId: "c_hero", exitId: "tear" },
        { type: "relocated", actorId: "wisp#1", to: { x: 3, y: 3 } },
        { type: "riftClock", onExpire: "collapse" },
        { type: "surge", amount: 1 },
        { type: "captiveLost" },
      ],
      encounter,
      "c_hero",
      3,
    );
    expect(beats.map((b) => b.text)).toEqual([
      "Rift fire gets you!",
      "You freed Pip!",
      "You step through the rift!",
      "The rift throws Bramblewisp 1 somewhere new!",
      "The rift is closing!",
      "The rift surges: everyone still here loses 1.",
      "Pip is lost to the rift.",
    ]);
  });
});
