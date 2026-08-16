// @vitest-environment jsdom
/**
 * PlayerPanel — the four prompts, the bag, and the rule they all share.
 *
 * Same reason as `combat-panel.test.tsx`: `screens.test.tsx` proves this
 * renders, which for a 746-line panel holding four prompt machines and an
 * inventory is a smoke test wearing a coverage number. What matters here is
 * what happens *between* taps, and one rule governs all of it — **nothing is
 * final until the confirm bar** (spec §11).
 *
 * Two things in this file are subtler than they look and are why it exists:
 *
 *  - the item-swap answer is a *tri-state*. `undefined` is "not decided",
 *    `null` is "leave it behind", and a string is "drop this one". Collapsing
 *    null and undefined turns an un-answered prompt into a silent "leave it",
 *    which loses the item the party just earned.
 *  - the bag selection is resolved by *item*, not by slot. The server rewrites
 *    the inventory underneath an open sheet (a swap, a used potion, a grant),
 *    and an index that survived that would point "Use it" at whatever slid in.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  Campaign,
  ClientIntent,
  InventoryEntry,
  ItemCatalog,
  PartyMember,
  Prompt,
  ResolvedCharacter,
  RunState,
} from "@kad/shared";
import { beginEncounter, INVENTORY_SLOTS, parseBoard } from "@kad/shared";
import { makeItems, makeRules } from "../../../shared/src/test-fixtures";
import { useGameStore } from "../store";
import { PlayerPanel } from "./PlayerPanel";

const ITEMS: ItemCatalog = makeItems();
const POTION: InventoryEntry = { itemId: "sunbloom_draught", kind: "consumable" };

/** The names `makeItems()` actually ships, so the fixture cannot drift. */
const POTION_NAME = ITEMS["sunbloom_draught"]?.name ?? "Sunbloom Draught";

function character(overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 3, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function member(overrides: Partial<PartyMember> = {}): PartyMember {
  const char = overrides.character ?? character();
  return {
    character: char,
    playerId: char.ownerPlayerId,
    hp: char.maxHp,
    down: false,
    connected: true,
    ready: false,
    ...overrides,
  };
}

const CAMPAIGN = { id: "c", chapters: ["ch_1"] } as unknown as Campaign;

interface MountOptions {
  party?: PartyMember[];
  prompt?: Prompt | null;
  phase?: RunState["phase"];
  playerId?: string;
  items?: ItemCatalog | null;
  campaign?: Campaign | null;
  narration?: string;
  sceneType?: RunState["sceneType"];
}

function baseState(options: MountOptions): RunState {
  return {
    runId: "r_1",
    roomCode: "ABCD",
    mode: "travel",
    seq: 1,
    phase: options.phase ?? "scene",
    campaignId: "c",
    chapterId: "ch_1",
    sceneId: "s_1",
    sceneType: options.sceneType ?? "story",
    narration: options.narration ?? "",
    art: null,
    party: options.party ?? [member()],
    prompt: options.prompt ?? null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: "2026-07-04T18:00:00.000Z",
  };
}

function mount(options: MountOptions = {}) {
  const sent: ClientIntent[] = [];
  const send = vi.fn(async (intent: ClientIntent) => {
    sent.push(intent);
    return true;
  });

  useGameStore.setState({
    session: {
      runId: "r_1",
      roomCode: "ABCD",
      playerId: options.playerId ?? "p_1",
      mode: "travel",
      sessionToken: "t",
    },
    state: baseState(options),
    items: options.items === undefined ? ITEMS : options.items,
    campaign: options.campaign === undefined ? CAMPAIGN : options.campaign,
    send,
    // The panel calls this on mount; it must not reach the network here.
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });

  const view = render(<PlayerPanel />);
  return { ...view, sent, send };
}

/** Push a new server state in, the way a channel patch would. */
function serverSends(next: Partial<RunState>): void {
  const current = useGameStore.getState().state!;
  act(() => {
    useGameStore.setState({ state: { ...current, ...next, seq: current.seq + 1 } });
  });
}

const choicePrompt = (overrides: Partial<Extract<Prompt, { kind: "choice" }>> = {}): Prompt => ({
  kind: "choice",
  sceneId: "s_1",
  options: [
    { id: "east", label: "Take the east path", icon: "path" },
    { id: "west", label: "Take the west path", icon: "path" },
  ],
  forPlayerIds: [],
  vote: false,
  ...overrides,
});

const doIt = () => screen.getByRole("button", { name: "Do it!" });

/** Every `role="status"` line on screen — `Spinner` carries one of its own. */
const statusLines = (): string[] => screen.getAllByRole("status").map((n) => n.textContent ?? "");
const someStatusSays = (text: string): boolean => statusLines().some((t) => t.includes(text));

/** A real, minimal fight, so the in-combat branches are reachable honestly. */
function realEncounter() {
  return beginEncounter(
    {
      board: parseBoard(["...", "...", "..."]),
      party: [{ character: character(), at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
          at: { x: 2, y: 2 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
}

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Before there is anything to show
// ---------------------------------------------------------------------------

describe("before the character arrives", () => {
  it("says it is looking rather than rendering an empty sheet", () => {
    useGameStore.setState({
      session: null,
      state: null,
      loadContent: async () => undefined,
      loadChapter: async () => undefined,
    });
    render(<PlayerPanel />);
    expect(someStatusSays("Finding your character")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Choice
// ---------------------------------------------------------------------------

describe("a choice", () => {
  it("sends nothing on the first tap, and the label on the confirm", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ prompt: choicePrompt() });

    await user.click(screen.getByRole("button", { name: /Take the east path/ }));
    expect(sent).toEqual([]);

    // The bar echoes the option, so what is about to happen is readable.
    const bar = screen.getByText("Take the east path", { selector: ".confirm__what span" });
    expect(bar).toBeTruthy();

    await user.click(doIt());
    expect(sent).toEqual([{ type: "CHOOSE", choiceId: "east" }]);
  });

  it("marks the pending option as pressed, so the tap is visible before it commits", async () => {
    const user = userEvent.setup();
    mount({ prompt: choicePrompt() });
    const east = screen.getByRole("button", { name: /Take the east path/ });
    expect(east.getAttribute("aria-pressed")).toBe("false");

    await user.click(east);
    expect(screen.getByRole("button", { name: /Take the east path/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /Take the west path/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("changes its mind without sending, and can pick the other one", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ prompt: choicePrompt() });

    await user.click(screen.getByRole("button", { name: /east/ }));
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(sent).toEqual([]);
    expect(screen.queryByRole("button", { name: "Do it!" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /west/ }));
    await user.click(doIt());
    expect(sent).toEqual([{ type: "CHOOSE", choiceId: "west" }]);
  });

  it("drops a pending choice when the question changes underneath it", async () => {
    /*
     * The dangerous one, and the reason `promptKey` exists. A confirm bar left
     * standing across a scene change commits an answer to a question that is
     * no longer on screen.
     */
    const user = userEvent.setup();
    const { sent } = mount({ prompt: choicePrompt() });
    await user.click(screen.getByRole("button", { name: /east/ }));
    expect(screen.getByRole("button", { name: "Do it!" })).toBeTruthy();

    /*
     * The new scene deliberately reuses the option id "east". A question whose
     * ids happen not to overlap is cleared for free — `chosenOption` simply
     * fails to find the old id — so only a scene that reuses one actually
     * exercises `promptKey`. Chapters reuse "east" constantly.
     */
    serverSends({
      sceneId: "s_2",
      prompt: choicePrompt({
        sceneId: "s_2",
        options: [{ id: "east", label: "Squeeze through the gap", icon: "path" }],
      }),
    });

    expect(screen.queryByRole("button", { name: "Do it!" })).toBeNull();
    expect(sent).toEqual([]);
    const gap = screen.getByRole("button", { name: /Squeeze through the gap/ });
    expect(gap.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows who voted for what, by character name", () => {
    mount({
      party: [
        member(),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
      ],
      prompt: choicePrompt({ vote: true, votes: { p_2: "west" } }),
    });

    expect(screen.getByText("Everyone votes")).toBeTruthy();
    const west = screen.getByRole("button", { name: /Take the west path/ });
    expect(west.textContent).toContain("Thistle");
  });

  it("marks my own vote as already cast", () => {
    // A vote already registered has to read as chosen even across a reload —
    // the pending selection is local, the vote is the server's.
    mount({ prompt: choicePrompt({ vote: true, votes: { p_1: "east" } }) });
    expect(
      screen.getByRole("button", { name: /Take the east path/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Roll
// ---------------------------------------------------------------------------

describe("a roll", () => {
  const roll: Prompt = {
    kind: "roll",
    sceneId: "s_1",
    stat: "clever",
    tn: 12,
    prompt: "Can you read the runes?",
    characterId: "c_1",
  };

  it("names the stat and the number to beat, then rolls once", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ prompt: roll });

    expect(screen.getByText("Can you read the runes?")).toBeTruthy();
    // Scoped to the prompt: the stat name also appears down in the stat row.
    const prompt = screen.getByText("Can you read the runes?").closest(".prompt")!;
    expect(within(prompt as HTMLElement).getByText("clever")).toBeTruthy();
    expect(within(prompt as HTMLElement).getByText("beat 12")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Roll!" }));
    expect(sent).toEqual([{ type: "ROLL" }]);
  });

  it("will not roll twice while the first one is in flight", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const send = vi.fn(
      () => new Promise<boolean>((resolve) => (release = () => resolve(true))),
    );
    mount({ prompt: roll });
    useGameStore.setState({ send });

    await user.click(screen.getByRole("button", { name: "Roll!" }));
    const rolling = screen.getByRole("button", { name: "Rolling…" });
    expect(rolling.hasAttribute("disabled")).toBe(true);
    await user.click(rolling);
    expect(send).toHaveBeenCalledTimes(1);
    release();
  });

  it("is not offered to a player the roll is not for", () => {
    mount({
      party: [
        member(),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
      ],
      prompt: { ...roll, characterId: "c_2" },
      playerId: "p_1",
    });
    expect(screen.queryByRole("button", { name: "Roll!" })).toBeNull();
    // And it says who the table is waiting on, by name.
    expect(someStatusSays("Thistle is rolling")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The item swap — the tri-state
// ---------------------------------------------------------------------------

describe("an item swap", () => {
  const swap: Prompt = {
    kind: "item_swap",
    characterId: "c_1",
    incomingItemId: "sunbloom_draught",
  };
  const heldA: InventoryEntry = { itemId: "thorn_charm", kind: "trinket" };

  function mountSwap() {
    return mount({
      party: [member({ character: character({ inventory: [heldA] }) })],
      prompt: swap,
    });
  }

  it("shows no confirm bar until something is actually chosen", () => {
    /*
     * `undefined` is the un-answered state. If it were collapsed with `null`
     * the bar would be up from the first render reading "Leave it behind",
     * one tap from throwing away what the party just earned.
     */
    mountSwap();
    expect(screen.queryByRole("button", { name: "Yes, do that" })).toBeNull();
  });

  it("sends null for 'leave it behind' — not undefined, not a missing field", async () => {
    const user = userEvent.setup();
    const { sent } = mountSwap();

    await user.click(screen.getByRole("button", { name: /Leave it behind/ }));
    expect(sent).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Yes, do that" }));

    expect(sent).toEqual([{ type: "RESOLVE_ITEM_SWAP", dropItemId: null }]);
    // The field has to be present and null — an absent key is a different
    // answer to the server than an explicit "leave it".
    expect(Object.hasOwn(sent[0] as object, "dropItemId")).toBe(true);
  });

  it("sends the id of the item being dropped", async () => {
    const user = userEvent.setup();
    const { sent } = mountSwap();

    await user.click(screen.getByRole("button", { name: /Drop/ }));
    await user.click(screen.getByRole("button", { name: "Yes, do that" }));
    expect(sent).toEqual([{ type: "RESOLVE_ITEM_SWAP", dropItemId: "thorn_charm" }]);
  });

  it("goes back to undecided on Change, not to 'leave it'", async () => {
    const user = userEvent.setup();
    const { sent } = mountSwap();

    await user.click(screen.getByRole("button", { name: /Leave it behind/ }));
    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(sent).toEqual([]);
    expect(screen.queryByRole("button", { name: "Yes, do that" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Leave it behind/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("names the item that was found", () => {
    mountSwap();
    expect(screen.getByText(new RegExp(`You found ${POTION_NAME}`))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Ready and starting
// ---------------------------------------------------------------------------

describe("readying up", () => {
  it("toggles to ready, and back", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ phase: "lobby" });

    await user.click(screen.getByRole("button", { name: "I'm ready!" }));
    expect(sent).toEqual([{ type: "READY", ready: true }]);

    serverSends({ party: [member({ ready: true })] });
    await user.click(screen.getByRole("button", { name: "Wait, not yet" }));
    expect(sent[1]).toEqual({ type: "READY", ready: false });
  });

  it("hides Begin the adventure until the whole party is ready", async () => {
    /*
     * It cannot be tapped out from under anyone. One player readying while
     * another is still building a character would start the chapter without
     * them — the engine refuses, but the button should never have been there.
     */
    const user = userEvent.setup();
    const half = [
      member({ ready: true }),
      member({ character: character({ id: "c_2", ownerPlayerId: "p_2" }), ready: false }),
    ];
    const { sent } = mount({ phase: "lobby", party: half });
    expect(screen.queryByRole("button", { name: /Begin the adventure/ })).toBeNull();

    serverSends({ party: half.map((m) => ({ ...m, ready: true })) });
    await user.click(screen.getByRole("button", { name: /Begin the adventure/ }));
    expect(sent).toEqual([{ type: "START_CHAPTER", chapterId: "ch_1" }]);
  });

  it("does not offer to begin when the campaign names no chapter", () => {
    // Content is data: an empty campaign is a content bug, and the panel's job
    // is to not invent a chapter id to send.
    mount({ phase: "lobby", party: [member({ ready: true })], campaign: null });
    expect(screen.queryByRole("button", { name: /Begin the adventure/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The bag
// ---------------------------------------------------------------------------

describe("the bag", () => {
  function mountBag(inventory: InventoryEntry[], overrides: Partial<PartyMember> = {}) {
    return mount({
      party: [member({ character: character({ inventory }), ...overrides })],
    });
  }

  it("offers a heal on a run that has never had a fight", async () => {
    /*
     * A regression pin, not a nicety. `RunState.encounter` is optional and
     * arrives three ways: **absent** on a run that has never fought
     * (`createRunState` in engine.ts does not set the field), `null` once a
     * fight has ended, and an object during one. This panel tested it with
     * `!== null`, which reads "absent" as "a fight is happening" — so from the
     * lobby until the party's first fight was over, every item in the bag said
     * "Use it from your turn in the fight" and the button was never drawn.
     *
     * `baseState` above deliberately leaves the field off for exactly this
     * reason: it is what the engine really produces.
     */
    const user = userEvent.setup();
    const state = useGameStore.getState().state;
    expect(state === null || !("encounter" in state)).toBe(true);

    mountBag([POTION], { hp: 4 });
    expect("encounter" in useGameStore.getState().state!).toBe(false);

    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));
    expect(screen.getByRole("button", { name: /Use it/ })).toBeTruthy();
  });

  it("opens an item's sheet on tap and closes it again", async () => {
    const user = userEvent.setup();
    mountBag([POTION], { hp: 4 });

    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));
    expect(screen.getByRole("button", { name: /Use it/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Close/ }));
    expect(screen.queryByRole("button", { name: /Use it/ })).toBeNull();
  });

  it("uses the selected item and closes the sheet behind it", async () => {
    const user = userEvent.setup();
    const { sent } = mountBag([POTION], { hp: 4 });

    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));
    await user.click(screen.getByRole("button", { name: /Use it/ }));

    expect(sent).toEqual([{ type: "USE_ITEM", itemId: "sunbloom_draught" }]);
    expect(screen.queryByRole("button", { name: /Use it/ })).toBeNull();
  });

  it("follows the item when the server reshuffles the bag under an open sheet", async () => {
    /*
     * The reason the selection stores an id and not just a slot. Something
     * ahead of the potion is consumed, everything shifts down a slot, and the
     * sheet must still be describing the potion rather than whatever landed
     * in slot 1.
     */
    const charm: InventoryEntry = { itemId: "thorn_charm", kind: "trinket" };
    const user = userEvent.setup();
    mountBag([charm, POTION], { hp: 4 });

    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));
    expect(screen.getByRole("button", { name: /Use it/ })).toBeTruthy();

    serverSends({
      party: [member({ character: character({ inventory: [POTION] }), hp: 4 })],
    });

    // Still the potion, now in slot 0 — not the trinket, which is gone.
    const detail = document.querySelector(".item-detail");
    expect(detail?.textContent).toContain(POTION_NAME);
    expect(screen.getByRole("button", { name: /Use it/ })).toBeTruthy();
  });

  it("closes the sheet when the selected item leaves the bag entirely", async () => {
    const user = userEvent.setup();
    mountBag([POTION], { hp: 4 });
    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));

    serverSends({ party: [member({ character: character({ inventory: [] }), hp: 4 })] });

    // Quietly clears rather than adopting a stranger.
    expect(document.querySelector(".item-detail")).toBeNull();
  });

  it("explains why a heal cannot be used at full health instead of offering it", async () => {
    const user = userEvent.setup();
    mountBag([POTION]);
    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));

    expect(screen.queryByRole("button", { name: /Use it/ })).toBeNull();
    expect(document.querySelector(".item-detail__passive")?.textContent).toContain("full health");
  });

  it("sends a fight-only consumable to the fight rather than offering it here", async () => {
    const user = userEvent.setup();
    mountBag([POTION], { hp: 4 });
    serverSends({ encounter: realEncounter() });

    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME) }));
    expect(screen.queryByRole("button", { name: /Use it/ })).toBeNull();
    expect(document.querySelector(".item-detail__passive")?.textContent).toContain(
      "from your turn in the fight",
    );
  });

  it("says a trinket is always on rather than offering a use", async () => {
    const user = userEvent.setup();
    const charm: InventoryEntry = { itemId: "thorn_charm", kind: "trinket" };
    mountBag([charm], { hp: 4 });

    await user.click(screen.getByRole("button", { name: /thorn_charm|Thorn/ }));
    expect(screen.getByText("Always on")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use it/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Waiting on the rest of the table
// ---------------------------------------------------------------------------

describe("waiting", () => {
  it("names who the party is waiting for", () => {
    mount({
      party: [
        member(),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
      ],
      prompt: choicePrompt({ forPlayerIds: ["p_2"] }),
      playerId: "p_1",
    });
    expect(someStatusSays("Waiting for Thistle")).toBe(true);
  });

  it("falls back to listening when there is no question at all", () => {
    mount({ prompt: null });
    expect(someStatusSays("Listen to the story")).toBe(true);
  });

  it("says when a player is knocked down, and that it is recoverable", () => {
    mount({ party: [member({ down: true, hp: 0 })] });
    expect(someStatusSays("Knocked down")).toBe(true);
    expect(someStatusSays("a friend can help you up")).toBe(true);
  });

  it("echoes the narration next to the answers so they are readable together", () => {
    // Travel Mode shows one surface at a time; without this the question and
    // its answers sit on opposite sides of a toggle.
    mount({ prompt: choicePrompt(), narration: "A wall of thorns twice your height." });
    expect(screen.getByText("A wall of thorns twice your height.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Growing up — spending a banked stat point (spec §8.1)
// ---------------------------------------------------------------------------

/**
 * Levelling banks a point; a Rest scene is where it becomes a stat. The engine
 * and the server transaction for this were built first and nothing dispatched
 * the intent, so a character could bank points for a whole campaign and never
 * be offered a way to spend one.
 *
 * The two rules under test are the ones the server also enforces
 * (`prepareStatPointSpend`): **only at a Rest scene**, and **only into a stat
 * that is under its ceiling**. The panel does not re-derive either — it reads
 * `sceneType` and `spendableStats` off the mirrored state — so what these
 * assert is that it reads them at all, and that nothing is spent before the
 * confirm bar is tapped (spec §11).
 */
describe("spending a banked stat point", () => {
  const withPoints = (unspentPoints: number, overrides: Partial<ResolvedCharacter> = {}) =>
    member({ character: character({ unspentPoints, ...overrides }) });

  it("offers every legal stat once the party is resting", () => {
    mount({ party: [withPoints(1)], sceneType: "rest" });

    expect(screen.getByText("You have a point to spend!")).toBeTruthy();
    for (const stat of ["might", "quick", "clever", "heart"]) {
      expect(screen.getByRole("button", { name: new RegExp(stat, "i") })).toBeTruthy();
    }
  });

  it("counts the points when there is more than one", () => {
    mount({ party: [withPoints(3)], sceneType: "rest" });
    expect(screen.getByText("You have 3 points to spend!")).toBeTruthy();
  });

  it("stays out of the way anywhere but a Rest scene", () => {
    // The server refuses the intent outside one, so offering it here would be
    // a button that fails — which on a phone is indistinguishable from a bug.
    mount({ party: [withPoints(2)], sceneType: "story" });
    expect(screen.queryByText(/points to spend!/)).toBeNull();
  });

  it("stays out of the way when there is nothing banked", () => {
    mount({ party: [withPoints(0)], sceneType: "rest" });
    expect(screen.queryByText(/to spend!/)).toBeNull();
  });

  it("never draws a stat that has hit its ceiling", () => {
    mount({
      party: [withPoints(1, { spendableStats: ["quick", "clever", "heart"] })],
      sceneType: "rest",
    });
    // Hidden, not disabled — the panel's rule for every other prompt.
    expect(screen.queryByRole("button", { name: /might/i })).toBeNull();
    expect(screen.getByRole("button", { name: /quick/i })).toBeTruthy();
  });

  it("says so when there is a point in hand and nowhere left to put it", () => {
    mount({ party: [withPoints(1, { spendableStats: [] })], sceneType: "rest" });
    expect(screen.getByText(/as strong as it can get/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Grow!/ })).toBeNull();
  });

  it("sends nothing until the confirm bar is tapped", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ party: [withPoints(1)], sceneType: "rest" });

    await user.click(screen.getByRole("button", { name: /might/i }));
    expect(sent).toEqual([]);

    await user.click(screen.getByRole("button", { name: /Grow!/ }));
    expect(sent).toEqual([{ type: "SPEND_STAT_POINT", stat: "might" }]);
  });

  it("lets a mis-tap be taken back", async () => {
    const user = userEvent.setup();
    const { sent } = mount({ party: [withPoints(1)], sceneType: "rest" });

    await user.click(screen.getByRole("button", { name: /clever/i }));
    await user.click(screen.getByRole("button", { name: /Change/ }));
    expect(screen.queryByRole("button", { name: /Grow!/ })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("shows what the point actually buys", async () => {
    // "3 → 4" is the whole basis for choosing one stat over another, and the
    // player it is aimed at is eight.
    const user = userEvent.setup();
    mount({ party: [withPoints(1)], sceneType: "rest" });

    await user.click(screen.getByRole("button", { name: /clever/i }));
    // character() ships clever: 3.
    expect(screen.getByText(/clever 3 → 4/i)).toBeTruthy();
  });

  it("drops a pending selection the server has since made illegal", async () => {
    // Somebody else's trinket, a re-resolve, a stat that hit its cap between
    // the tap and the confirm: the selection clears rather than confirming
    // against a stat the server would now refuse.
    const user = userEvent.setup();
    mount({ party: [withPoints(2)], sceneType: "rest" });

    await user.click(screen.getByRole("button", { name: /might/i }));
    expect(screen.getByRole("button", { name: /Grow!/ })).toBeTruthy();

    act(() => {
      serverSends({
        party: [withPoints(1, { stats: { might: 3, quick: 3, clever: 3, heart: 5 }, spendableStats: ["quick", "clever", "heart"] })],
      });
    });

    expect(screen.queryByRole("button", { name: /Grow!/ })).toBeNull();
  });

  it("survives a party snapshot persisted before spendableStats existed", () => {
    /*
     * `RunState.party[]` holds *resolved* characters and is persisted as plain
     * JSON; `getState` hands the stored object back verbatim and a member is
     * re-resolved only when something touches it. So a run in flight across a
     * deploy arrives with no list at all, and reading `.length` off it would
     * white-screen the controller at the Rest scene — the Friday-evening
     * failure `RunState`'s own comments exist to rule out.
     *
     * Absent means unknown, not none: the panel offers all four and lets the
     * server refuse, rather than telling a player owed a point that every stat
     * is maxed and eating the spend.
     */
    const stale = character({ unspentPoints: 1 });
    delete (stale as { spendableStats?: unknown }).spendableStats;

    expect(() => mount({ party: [member({ character: stale })], sceneType: "rest" })).not.toThrow();
    expect(screen.getByText("You have a point to spend!")).toBeTruthy();
    for (const stat of ["might", "quick", "clever", "heart"]) {
      expect(screen.getByRole("button", { name: new RegExp(stat, "i") })).toBeTruthy();
    }
  });

  it("keeps the reminder on the pinned strip, where a whole sitting can pass without scrolling to it", () => {
    mount({ party: [withPoints(1)], sceneType: "story" });
    expect(screen.getByText("1 point to spend when you rest")).toBeTruthy();

    cleanup();
    mount({ party: [withPoints(2)], sceneType: "story" });
    expect(screen.getByText("2 points to spend when you rest")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Trading at a Rest scene (spec §9.4)
// ---------------------------------------------------------------------------

/**
 * "Drag on your phone, tap to accept on theirs." The two-tap rule (spec §11)
 * is spread across two devices here rather than two taps on one: the offer is
 * the selection — nothing leaves the giver's bag — and the other phone holds
 * the confirm.
 *
 * What this file is really guarding is the *giving* side's list of names. The
 * server refuses an offer into a full bag, and a name that always fails is
 * worse than a name that is not there, so the panel has to leave those out —
 * and it has to leave out somebody already holding this exact offer, or a
 * second tap sends a duplicate the server rejects.
 */
describe("passing an item to a friend", () => {
  const THISTLE = character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" });

  function twoAtRest(overrides: Partial<MountOptions> = {}) {
    return mount({
      party: [
        member({ character: character({ inventory: [POTION] }) }),
        member({ character: THISTLE }),
      ],
      sceneType: "rest",
      ...overrides,
    });
  }

  /** Open the bag entry, which is where the give list hangs. */
  async function openThePotion(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: new RegExp(POTION_NAME, "i") }));
  }

  it("offers the item to the friend, once", async () => {
    const user = userEvent.setup();
    const { sent } = twoAtRest();

    await openThePotion(user);
    expect(screen.getByText("Give it to a friend")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Thistle/ }));
    expect(sent).toEqual([
      { type: "OFFER_ITEM", itemId: POTION.itemId, toPlayerId: "p_2" },
    ]);
  });

  it("does not offer to give anything away outside a Rest scene", async () => {
    const user = userEvent.setup();
    twoAtRest({ sceneType: "story" });

    await openThePotion(user);
    expect(screen.queryByText("Give it to a friend")).toBeNull();
  });

  it("still offers to a friend whose bag is full — §9.1 answers that on their end", async () => {
    // Hiding the name would teach a second, worse answer ("that name is just
    // not there") for a situation the game has already taught once, with the
    // swap prompt she meets when she finds something with six slots full.
    const user = userEvent.setup();
    const stuffed = Array.from({ length: INVENTORY_SLOTS }, () => POTION);
    const { sent } = mount({
      party: [
        member({ character: character({ inventory: [POTION] }) }),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle", inventory: stuffed }) }),
      ],
      sceneType: "rest",
    });

    await openThePotion(user);
    await user.click(screen.getByRole("button", { name: /Thistle/ }));
    expect(sent).toEqual([{ type: "OFFER_ITEM", itemId: POTION.itemId, toPlayerId: "p_2" }]);
  });

  it("leaves out a friend who is already being offered this exact item", async () => {
    const user = userEvent.setup();
    twoAtRest();
    serverSends({
      trades: [{ id: "t1", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: POTION.itemId }],
    });

    await openThePotion(user);
    // Not in the give list any more...
    expect(screen.queryByRole("button", { name: /^Thistle$/ })).toBeNull();
    // ...and the offer is visible as outstanding instead.
    expect(screen.getByText("Waiting for an answer")).toBeTruthy();
  });

  it("says so when there is nobody to give anything to", async () => {
    const user = userEvent.setup();
    mount({ party: [member({ character: character({ inventory: [POTION] }) })], sceneType: "rest" });

    await openThePotion(user);
    expect(screen.getByText(/Nobody else is here/)).toBeTruthy();
  });

  it("lets an unanswered offer be taken back", async () => {
    const user = userEvent.setup();
    const { sent } = twoAtRest();
    serverSends({
      trades: [{ id: "t1", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: POTION.itemId }],
    });

    await user.click(screen.getByRole("button", { name: /Take it back/ }));
    expect(sent).toEqual([{ type: "RESOLVE_TRADE", tradeId: "t1", accept: false }]);
  });
});

describe("being offered an item", () => {
  function offeredToMe(overrides: Partial<RunState> = {}) {
    const view = mount({
      party: [
        member({ character: character({ inventory: [POTION] }) }),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
      ],
      playerId: "p_2",
      sceneType: "rest",
    });
    serverSends({
      trades: [{ id: "t1", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: POTION.itemId }],
      ...overrides,
    });
    return view;
  }

  it("names who is giving what", () => {
    offeredToMe();
    expect(screen.getByText(/wants to give you/)).toBeTruthy();
    expect(screen.getByText("Sparklehoof")).toBeTruthy();
  });

  it("takes it", async () => {
    const user = userEvent.setup();
    const { sent } = offeredToMe();

    await user.click(screen.getByRole("button", { name: /Yes please!/ }));
    expect(sent).toEqual([{ type: "RESOLVE_TRADE", tradeId: "t1", accept: true }]);
  });

  it("declines it", async () => {
    const user = userEvent.setup();
    const { sent } = offeredToMe();

    await user.click(screen.getByRole("button", { name: /No thanks/ }));
    expect(sent).toEqual([{ type: "RESOLVE_TRADE", tradeId: "t1", accept: false }]);
  });

  it("shows somebody else's offer to neither of the wrong phones", () => {
    // p_1 gives to p_2; a third player's phone is not part of that conversation.
    mount({
      party: [
        member({ character: character({ inventory: [POTION] }) }),
        member({ character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }) }),
        member({ character: character({ id: "c_3", ownerPlayerId: "p_3", name: "Bramble" }) }),
      ],
      playerId: "p_3",
      sceneType: "rest",
    });
    serverSends({
      trades: [{ id: "t1", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: POTION.itemId }],
    });

    expect(screen.queryByText(/wants to give you/)).toBeNull();
    expect(screen.queryByText("Waiting for an answer")).toBeNull();
  });

  it("renders a run persisted before trading existed", () => {
    // `trades` is optional on RunState; the panel coalesces rather than
    // indexing into undefined.
    expect(() => mount({ sceneType: "rest" })).not.toThrow();
    expect(screen.queryByText(/wants to give you/)).toBeNull();
  });
});

/**
 * The receiving end with six slots full — §9.1's "keep it and drop one, or
 * leave it", answered on the accept rather than by a second prompt.
 *
 * The rule under test is that **the confirm does not exist until she has said
 * what goes down**. The panel never draws a button that would be refused, and
 * an accept without a drop is exactly that.
 */
describe("being offered an item with a full bag", () => {
  const STUFFED = Array.from({ length: INVENTORY_SLOTS }, () => POTION);
  const TRINKET: InventoryEntry = { itemId: "river_charm", kind: "trinket" };

  function offeredWithFullBag(mine: InventoryEntry[] = STUFFED) {
    const view = mount({
      party: [
        member({ character: character({ inventory: [TRINKET] }) }),
        member({
          character: character({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle", inventory: mine }),
        }),
      ],
      playerId: "p_2",
      sceneType: "rest",
    });
    serverSends({
      trades: [{ id: "t1", fromPlayerId: "p_1", toPlayerId: "p_2", itemId: TRINKET.itemId }],
    });
    return view;
  }

  it("asks what to put down instead of offering an accept that would be refused", () => {
    offeredWithFullBag();
    expect(screen.getByText(/Your bag is full/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Yes please!/ })).toBeNull();
    // Saying no is always available — declining is free at any bag size.
    expect(screen.getByRole("button", { name: /No thanks/ })).toBeTruthy();
  });

  it("sends the drop alongside the accept, in one event", async () => {
    const user = userEvent.setup();
    const { sent } = offeredWithFullBag();

    await user.click(screen.getAllByRole("button", { name: new RegExp(`Put down ${POTION_NAME}`) })[0]!);
    expect(sent).toEqual([]);

    await user.click(screen.getByRole("button", { name: /Yes please!/ }));
    expect(sent).toEqual([
      { type: "RESOLVE_TRADE", tradeId: "t1", accept: true, dropItemId: POTION.itemId },
    ]);
  });

  it("asks nothing when there is room", async () => {
    const user = userEvent.setup();
    const { sent } = offeredWithFullBag([POTION]);

    expect(screen.queryByText(/Your bag is full/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Yes please!/ }));
    // No dropItemId at all, rather than an explicit undefined.
    expect(sent).toEqual([{ type: "RESOLVE_TRADE", tradeId: "t1", accept: true }]);
  });

  it("stops sending the drop once a slot has been freed", async () => {
    /*
     * She picks what to put down while her bag is full, then drinks something
     * before tapping accept. Sending the drop anyway would destroy that item
     * for nothing — the server refuses it, and the panel should never have
     * offered it.
     */
    const user = userEvent.setup();
    const { sent } = offeredWithFullBag();

    await user.click(screen.getAllByRole("button", { name: new RegExp(`Put down ${POTION_NAME}`) })[0]!);

    act(() => {
      useGameStore.setState((prev) => ({
        state: {
          ...prev.state!,
          party: [
            prev.state!.party[0]!,
            {
              ...prev.state!.party[1]!,
              character: {
                ...prev.state!.party[1]!.character,
                inventory: STUFFED.slice(0, INVENTORY_SLOTS - 1),
              },
            },
          ],
        },
      }));
    });

    await user.click(screen.getByRole("button", { name: /Yes please!/ }));
    expect(sent).toEqual([{ type: "RESOLVE_TRADE", tradeId: "t1", accept: true }]);
  });

  it("drops a chosen item that the server has since taken away", () => {
    // The same rule the bag's own selection follows: the server rewrites
    // inventories under an open card, and a stale choice must not be confirmed.
    offeredWithFullBag();
    act(() => {
      useGameStore.setState((prev) => ({
        state: {
          ...prev.state!,
          party: [
            prev.state!.party[0]!,
            {
              ...prev.state!.party[1]!,
              character: { ...prev.state!.party[1]!.character, inventory: [POTION] },
            },
          ],
        },
      }));
    });
    // Room again, so the question is gone entirely rather than half-answered.
    expect(screen.queryByText(/Your bag is full/)).toBeNull();
    expect(screen.getByRole("button", { name: /Yes please!/ })).toBeTruthy();
  });
});
