// @vitest-environment jsdom
/**
 * Riftlight on screen (#229): the world view draws each rift the party can see
 * with its colour layers on a Starweaver's phone, and as a neutral shimmer on
 * the TV and every other phone; the Starweaver's World tab lights while there
 * is something to read.
 *
 * The fixture is a real graph run through the real engine (`journeyView`), so
 * the rifts are authored the way mechanics.md says Riftlight rifts are
 * (`reveal: "when-crossed"`, no label, every one `uses: 1` or `persistent`)
 * and the view is exactly what the server would send every screen alike.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import {
  completeVisit,
  journeyView,
  parseCampaignGraph,
  startJourney,
  type Campaign,
  type CampaignView,
  type ClassId,
  type GraphEdge,
  type JourneyView,
  type ParsedCampaignGraph,
  type PartyMember,
  type RunState,
} from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { useGameStore } from "../store";
import { resetFieldGuideCache } from "./content";
import { dismissPlayerSheet } from "../store/player-navigation";
import { LobbyContent } from "./LobbyContent";
import { forgetRiftSightings } from "./RiftSight";
import { setAudioSink, type CueId } from "../audio/cue";
import { PartyLayout } from "../layout/PartyLayout";
import { TravelLayout } from "../layout/TravelLayout";

// ---------------------------------------------------------------------------
// The fixture: one place with a rift of every kind on its way out
// ---------------------------------------------------------------------------

const FAR = "The Far Shore";

/** Every rift state the acceptance criteria name, with what a Starweaver sees. */
const RIFTS: { edge: string; rift: NonNullable<GraphEdge["rift"]>; effects: string[] }[] = [
  {
    edge: "dormant",
    rift: { opensWhen: { flag: "moon_up" }, uses: 1, oneWay: true },
    effects: ["rift_base", "rift_green", "rift_amber", "rift_violet"],
  },
  { edge: "amber", rift: { uses: 1 }, effects: ["rift_base", "rift_amber"] },
  { edge: "blue", rift: { persistent: true }, effects: ["rift_base", "rift_blue"] },
  { edge: "violet", rift: { uses: 1, oneWay: true }, effects: ["rift_base", "rift_amber", "rift_violet"] },
  {
    edge: "timed",
    rift: { uses: 1, lasts: { unit: "visits", count: 3 } },
    effects: ["rift_shrink", "rift_amber"],
  },
  {
    edge: "unstable",
    rift: { uses: 1, unstable: { collapsesAfter: 1 } },
    effects: ["rift_stutter", "rift_amber"],
  },
  {
    edge: "linked",
    rift: { persistent: true, linkedTo: "linked-back" },
    effects: ["rift_base", "rift_blue", "rift_sync"],
  },
];

function fixtureGraph(): ParsedCampaignGraph {
  const edges: Record<string, GraphEdge> = {
    "far-to-end": { from: "far", to: "end", kind: "forward" },
    "linked-back": {
      from: "far",
      to: "hub",
      kind: "return",
      rift: { persistent: true, linkedTo: "linked", reveal: "when-crossed" },
    },
  };
  for (const { edge, rift } of RIFTS) {
    edges[edge] = { from: "hub", to: "far", kind: "forward", blocked: "shown", rift: { ...rift, reveal: "when-crossed" } };
  }
  const campaign = {
    id: "riftlight-fixture",
    title: "Riftlight Fixture",
    blurb: "",
    chapters: ["c-hub", "c-far", "c-end"],
    graph: {
      version: 1,
      entry: "hub",
      flags: ["moon_up"],
      nodes: {
        hub: { chapter: "c-hub", title: "The Hub" },
        far: { chapter: "c-far", title: FAR },
        end: { chapter: "c-end", ending: { title: "The End" } },
      },
      edges,
    },
  } as Campaign;
  const { graph, problems } = parseCampaignGraph(campaign);
  expect(problems).toEqual([]);
  return graph!;
}

/** Standing at the hub's exit choice, as the server's view would say. */
function hubView(): JourneyView {
  const graph = fixtureGraph();
  const start = startJourney(graph);
  const done = completeVisit(graph, start, {
    node: start.node,
    visit: start.visit,
    chapterId: start.chapter,
    outcome: "success",
    flags: {},
  });
  if (!done.ok || done.duplicate) throw new Error("fixture: hub did not complete");
  return journeyView(graph, done.journey);
}

const campaignWith = (journey: JourneyView | undefined): CampaignView => ({
  id: "riftlight-fixture",
  title: "Riftlight Fixture",
  chapters: 3,
  next: null,
  ...(journey ? { journey } : {}),
});

const GEMFALL: CampaignView = {
  id: "gemfall",
  title: "Gemfall",
  blurb: "Mount Red Sky has erupted.",
  chapters: 8,
  next: { index: 1, title: "The City That Smelled Opportunity" },
};

const seat = (playerId: string, klass: ClassId, name: string): PartyMember =>
  makeMember({ playerId, character: makeCharacter({ id: `c_${playerId}`, ownerPlayerId: playerId, class: klass, name }) });

const STARWEAVER = seat("p_sw", "starweaver", "Lumi");
const SONGKEEPER = seat("p_sk", "songkeeper", "Sparklehoof");
const SECOND_STARWEAVER = seat("p_sw2", "starweaver", "Orrin");

/** The TV: a display client, no seat. */
const TV = "";

function store(playerId: string, overrides: Partial<RunState>): void {
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId, mode: "party", sessionToken: playerId === TV ? "" : "t" },
    state: makeState({ mode: "party", phase: "lobby", party: [STARWEAVER, SONGKEEPER], ...overrides }),
    chapter: null,
    progression: null,
    presentation: null,
    loadContent: async () => undefined,
    loadChapter: async () => undefined,
  });
}

function lobby(playerId: string, overrides: Partial<RunState> = {}) {
  store(playerId, { campaign: campaignWith(hubView()), ...overrides });
  return render(<LobbyContent />);
}

/** Each drawn rift's layers, by the effect sheet each one would draw. */
function drawnEffects(root: ParentNode): string[][] {
  return [...root.querySelectorAll(".rift-glyph")].map((glyph) =>
    [...glyph.querySelectorAll("[data-effect]")].map((layer) => layer.getAttribute("data-effect") ?? ""),
  );
}

/**
 * Everything a person could read or hear on the screen: its text, and every
 * accessible name, description or alternative written into an attribute.
 */
function everythingSaid(root: HTMLElement): string {
  const attributes = [...root.querySelectorAll("*")].flatMap((node) =>
    ["aria-label", "aria-description", "alt", "title"].map((name) => node.getAttribute(name) ?? ""),
  );
  return [root.textContent ?? "", ...attributes].join("\n");
}

const COLOR_OR_PATTERN = /green|amber|blue|violet|purple|breath|flicker|ripple|spiral|shrink|stutter|pulse/i;
const RULE = /one[- ]way|once|single|persist|stays open|come back|linked|other mouth|timed|unstable|requirement/i;

afterEach(() => {
  cleanup();
  forgetRiftSightings();
  setAudioSink(null);
  vi.useRealTimers();
  resetFieldGuideCache();
  dismissPlayerSheet();
});

// ---------------------------------------------------------------------------
// The world view
// ---------------------------------------------------------------------------

describe("a Starweaver's phone", () => {
  it("draws every fixture rift with its Riftlight layers", () => {
    const { container } = lobby(STARWEAVER.playerId);
    expect(drawnEffects(container)).toEqual(RIFTS.map((rift) => rift.effects));
    expect(container.querySelector(".rift-sight--riftlight")).not.toBeNull();
  });

  it("says each colour with its pattern, so none is colour alone", () => {
    const { container } = lobby(STARWEAVER.playerId);
    const readings = [...container.querySelectorAll(".rift-sight__reading")].map((node) => node.textContent);
    expect(readings).toEqual([
      "Green, breathing slowly · Amber, one flicker · Violet, spiraling inward",
      "Amber, one flicker",
      "Blue, rippling steadily",
      "Amber, one flicker · Violet, spiraling inward",
      "Amber, one flicker · It is shrinking",
      "Amber, one flicker · It stutters",
      "Blue, rippling steadily · It pulses to a steady beat",
    ]);
  });

  it("still never says what a colour means", () => {
    const { container } = lobby(STARWEAVER.playerId);
    expect(everythingSaid(container.querySelector(".rift-sight")!)).not.toMatch(RULE);
  });

  it("keeps to the #196 spoiler rule: a hidden destination is not named", () => {
    const { container } = lobby(STARWEAVER.playerId);
    const sight = container.querySelector<HTMLElement>(".rift-sight")!;
    expect(everythingSaid(sight)).not.toContain(FAR);
    expect([...sight.querySelectorAll(".rift-sight__label")].map((node) => node.textContent)).toEqual(
      RIFTS.map(() => "Into the rift"),
    );
  });

  it("is every Starweaver's: a second one at the table sees the same on their own phone", () => {
    const party = [STARWEAVER, SONGKEEPER, SECOND_STARWEAVER];
    const first = drawnEffects(lobby(STARWEAVER.playerId, { party }).container);
    cleanup();
    const second = drawnEffects(lobby(SECOND_STARWEAVER.playerId, { party }).container);
    expect(first).toEqual(RIFTS.map((rift) => rift.effects));
    expect(second).toEqual(first);
  });
});

describe("every other screen", () => {
  const neutral = RIFTS.map(() => ["rift_neutral"]);

  for (const [who, playerId] of [
    ["the TV", TV],
    ["a non-Starweaver phone at a table with a Starweaver", SONGKEEPER.playerId],
  ] as const) {
    it(`${who} draws only the neutral shimmer for the same rifts, and says no colour or rule`, () => {
      const { container } = lobby(playerId);
      expect(drawnEffects(container)).toEqual(neutral);
      expect(container.querySelector(".rift-sight--riftlight")).toBeNull();
      const said = everythingSaid(container);
      expect(said).not.toMatch(COLOR_OR_PATTERN);
      expect(said).not.toMatch(RULE);
      expect(said).not.toContain(FAR);
      expect(within(container.querySelector<HTMLElement>(".rift-sight")!).getAllByText("A faint shimmer")).toHaveLength(
        RIFTS.length,
      );
    });
  }

  it("a party with no Starweaver: no phone shows colours", () => {
    const party = [SONGKEEPER, seat("p_tg", "thornguard", "Bramble")];
    for (const member of party) {
      const { container } = lobby(member.playerId, { party });
      expect(drawnEffects(container)).toEqual(neutral);
      cleanup();
    }
  });

  it("the TV never draws a colour layer, whoever is seated and whatever the room mode", () => {
    for (const mode of ["party", "travel"] as const) {
      const party = [STARWEAVER, SECOND_STARWEAVER];
      store(TV, { mode, party, campaign: campaignWith(hubView()) });
      const { container } = render(<PartyLayout surface="world" />);
      expect(drawnEffects(container)).toEqual(neutral);
      expect(container.querySelector("[data-riftlight-indicator]")).toBeNull();
      cleanup();
    }
  });
});

describe("campaigns without rifts render exactly as before", () => {
  it("an ordered campaign (Gemfall) draws no rift, for anybody", () => {
    for (const playerId of [STARWEAVER.playerId, SONGKEEPER.playerId, TV]) {
      const { container } = lobby(playerId, { campaign: GEMFALL });
      expect(container.querySelector(".rift-sight")).toBeNull();
      expect(container.querySelector(".rift-glyph")).toBeNull();
      cleanup();
    }
  });

  it("a Starweaver's lobby for an ordered campaign is the same DOM as anyone else's", () => {
    const starweaver = lobby(STARWEAVER.playerId, { campaign: GEMFALL }).container.innerHTML;
    cleanup();
    const songkeeper = lobby(SONGKEEPER.playerId, { campaign: GEMFALL }).container.innerHTML;
    expect(starweaver).toBe(songkeeper);
  });

  it("a graph campaign whose ways are not rifts draws none", () => {
    const journey: JourneyView = {
      node: "orchard",
      title: "The Orchard",
      visit: 1,
      status: "choosing",
      chapter: "sampler-orchard",
      exits: [{ edge: "lane", to: "mill", kind: "forward", label: "The Mill", available: true, arrival: "new" }],
    };
    const { container } = lobby(STARWEAVER.playerId, { campaign: campaignWith(journey) });
    expect(container.querySelector(".rift-sight")).toBeNull();
  });

  it("a rift that is used up gives off no light, and is not drawn", () => {
    const journey: JourneyView = {
      ...hubView(),
      exits: [
        {
          edge: "spent",
          to: "",
          kind: "forward",
          label: "Into the rift",
          available: false,
          reason: "rift-consumed",
          arrival: "new",
          rift: { status: "consumed", oneWay: true },
          hiddenDestination: true,
        },
      ],
    };
    const { container } = lobby(STARWEAVER.playerId, { campaign: campaignWith(journey) });
    expect(container.querySelector(".rift-sight")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The menu indicator
// ---------------------------------------------------------------------------

describe("the Riftlight indicator", () => {
  const worldTab = (container: HTMLElement): HTMLElement =>
    within(container.querySelector<HTMLElement>("nav")!).getAllByRole("button")[0]!;

  it("lights on a Starweaver's World tab while a rift is in view and they are elsewhere (Party Mode phone)", () => {
    store(STARWEAVER.playerId, { campaign: campaignWith(hubView()) });
    const { container } = render(<PartyLayout surface="player" />);
    const tab = worldTab(container);
    expect(tab.querySelector("[data-riftlight-indicator]")).not.toBeNull();
    expect(within(tab).getByRole("img", { name: "Riftlight to look at" })).toBeTruthy();
  });

  /*
   * The rule: lit while a lit rift is in view and the Starweaver is not on
   * World. Looking clears it; leaving World with the rift still there, or a
   * rift appearing while they are away, lights it again.
   */
  const lit = (container: HTMLElement): boolean => worldTab(container).querySelector("[data-riftlight-indicator]") !== null;
  const tap = (button: HTMLElement): void => act(() => button.click());

  for (const [mode, layout] of [
    ["Party", () => <PartyLayout surface="player" />],
    ["Travel", () => <TravelLayout />],
  ] as const) {
    describe(`in ${mode} Mode`, () => {
      const mount = (journey: JourneyView) => {
        store(STARWEAVER.playerId, { mode: mode === "Party" ? "party" : "travel", campaign: campaignWith(journey) });
        const { container } = render(layout());
        // Travel Mode opens on the world; start both from the controls.
        tap(within(container.querySelector<HTMLElement>("nav")!).getByRole("button", { name: "You" }));
        return container;
      };

      it("clears while the Starweaver is on World, and lights again when they leave it", () => {
        const container = mount(hubView());
        expect(lit(container)).toBe(true);
        tap(worldTab(container));
        expect(lit(container)).toBe(false);
        tap(within(container.querySelector<HTMLElement>("nav")!).getByRole("button", { name: "Map" }));
        expect(lit(container)).toBe(true);
        tap(worldTab(container));
        tap(within(container.querySelector<HTMLElement>("nav")!).getByRole("button", { name: "You" }));
        expect(lit(container)).toBe(true);
      });

      it("lights when a rift comes into view while they are away, and not while they are looking", () => {
        const container = mount({ ...hubView(), status: "playing", exits: [] });
        expect(lit(container)).toBe(false);
        const arrive = () =>
          act(() => {
            const state = useGameStore.getState().state!;
            useGameStore.setState({ state: { ...state, campaign: campaignWith(hubView()) } });
          });
        arrive();
        expect(lit(container)).toBe(true);
        // Away again, on World this time: the next rift is already in front of them.
        act(() => {
          const state = useGameStore.getState().state!;
          useGameStore.setState({ state: { ...state, campaign: campaignWith({ ...hubView(), status: "playing", exits: [] }) } });
        });
        tap(worldTab(container));
        arrive();
        expect(lit(container)).toBe(false);
      });
    });
  }

  it("goes out when no rift is in view: the party has set off", () => {
    store(STARWEAVER.playerId, { campaign: campaignWith({ ...hubView(), status: "playing", exits: [] }) });
    const { container } = render(<PartyLayout surface="player" />);
    expect(container.querySelector("[data-riftlight-indicator]")).toBeNull();
  });

  it("is never lit for an ordered campaign", () => {
    store(STARWEAVER.playerId, { campaign: GEMFALL });
    const { container } = render(<PartyLayout surface="player" />);
    expect(container.querySelector("[data-riftlight-indicator]")).toBeNull();
  });

  it("is never lit on a phone that is not a Starweaver's", () => {
    store(SONGKEEPER.playerId, { campaign: campaignWith(hubView()) });
    const { container } = render(<PartyLayout surface="player" />);
    expect(container.querySelector("[data-riftlight-indicator]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The painted sheets, and a rift opening or collapsing
// ---------------------------------------------------------------------------

describe("the painted sheets", () => {
  it("every layer draws its own sheet", () => {
    const { container } = lobby(STARWEAVER.playerId);
    for (const layer of container.querySelectorAll<HTMLElement>(".rift-glyph [data-effect]")) {
      expect(layer.style.backgroundImage).toMatch(`/assets/effects/${layer.getAttribute("data-effect")}.sheet.png`);
    }
  });
});

describe("a rift opening or collapsing", () => {
  /** The hub as before, with one of its rifts changed. */
  const changed = (edge: string, status: "open" | "consumed"): JourneyView => {
    const view = hubView();
    return {
      ...view,
      exits: view.exits.map((exit) =>
        exit.edge === edge && exit.rift ? { ...exit, available: status === "open", rift: { ...exit.rift, status } } : exit,
      ),
    };
  };

  const heard: CueId[] = [];
  const listen = (): void => {
    heard.length = 0;
    setAudioSink({ cue: (id) => heard.push(id), music: () => undefined });
  };
  const update = (journey: JourneyView): void =>
    act(() => {
      const state = useGameStore.getState().state!;
      useGameStore.setState({ state: { ...state, campaign: campaignWith(journey) } });
    });
  const once = (root: ParentNode): string[] =>
    [...root.querySelectorAll(".rift-glyph__layer--once")].map((layer) => layer.getAttribute("data-effect") ?? "");

  it("arriving draws the rifts as they are: nothing opens, nothing sounds", () => {
    listen();
    const { container } = lobby(TV);
    expect(once(container)).toEqual([]);
    expect(heard).toEqual([]);
  });

  it("a rift that wakes at the party's place unfolds once, with its cue, then shows its loop", () => {
    vi.useFakeTimers();
    listen();
    const { container } = lobby(TV);
    update(changed("dormant", "open"));
    expect(once(container)).toEqual(["rift_open"]);
    expect(container.querySelectorAll(".rift-glyph--opening")).toHaveLength(1);
    expect(heard).toEqual(["rift-open"]);
    act(() => vi.advanceTimersByTime(1000));
    expect(once(container)).toEqual([]);
    expect(drawnEffects(container)).toEqual(RIFTS.map(() => ["rift_neutral"]));
    expect(heard).toEqual(["rift-open"]);
  });

  it("a rift that goes dark folds shut once, with its cue, then is gone", () => {
    vi.useFakeTimers();
    listen();
    const { container } = lobby(STARWEAVER.playerId);
    update(changed("amber", "consumed"));
    expect(once(container)).toEqual(["rift_collapse"]);
    const folding = container.querySelector<HTMLElement>(".rift-sight__rift--collapsing")!;
    expect(folding.getAttribute("aria-hidden")).toBe("true");
    expect(heard).toEqual(["rift-collapse"]);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector(".rift-sight__rift--collapsing")).toBeNull();
    expect(container.querySelectorAll(".rift-sight__rift")).toHaveLength(RIFTS.length - 1);
  });

  it("the moment survives the lobby unmounting while a chapter plays", () => {
    listen();
    lobby(TV);
    cleanup();
    store(TV, { campaign: campaignWith(changed("dormant", "open")) });
    const { container } = render(<LobbyContent />);
    expect(once(container)).toEqual(["rift_open"]);
    expect(heard).toEqual(["rift-open"]);
  });
});
