// @vitest-environment jsdom
/**
 * The phone's camp (#620, docs/camp.md §5.3, §6.1, §12.5, §12.6): the
 * first-session choice shows once and can be skipped; every camp action has a
 * named, keyboard-reachable control outside the picture; the shared-edit
 * limit is said before the first change and, once used, disables further
 * shared changes with a short message while a new piece stays free; Undo is
 * offered for your own latest change only; indoors there are no shared spots;
 * and the panel goes with the downtime, holding nothing up.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CampMoment, CampView, ClientIntent, HeroKitView, PartyMember, RunState } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { CampButton, CampPanel, KitWelcome } from "./CampPanel";
import { closeCampPanel, openCampPanel } from "./camp-panel";
import { announceKitNews, announceLookNews, clearKitNews, seeCampNews } from "../store/kit-news";
import { kitAccent } from "@kad/shared";
import { campClothMatrix } from "../world/camp-kit-art";
import { useGameStore } from "../store";

const me: PartyMember = makeMember({
  playerId: "p_1",
  character: makeCharacter({ id: "c_1", ownerPlayerId: "p_1", name: "Sparklehoof" }),
});
const friend: PartyMember = makeMember({
  playerId: "p_2",
  character: makeCharacter({ id: "c_2", ownerPlayerId: "p_2", name: "Thistle" }),
});

const kit = (over: Partial<HeroKitView> = {}): HeroKitView => ({ revision: 4, style: null, tent: null, color: null, slots: [null, null], unlocked: [], ...over });
const camp = (over: Partial<CampView> = {}): CampView => ({
  revision: 2,
  frameStage: 2,
  grownBy: ["gemfall"],
  dashCash: 3,
  owned: ["shop_striped_awning", "find_noodle_awning", "shop_lantern_string", "shop_weathervane_pole"],
  placed: {},
  friends: [],
  shopOpen: true,
  ...over,
});
const moment = (over: Partial<CampMoment> = {}): CampMoment => ({ id: "lobby|r:-:0", kind: "lobby", outdoor: true, changes: {}, ...over });
const table = (over: Partial<RunState> = {}): RunState =>
  makeState({ phase: "lobby", party: [me, friend], camp: camp(), campMoment: moment(), kits: { c_1: kit(), c_2: kit() }, ...over });

let sent: ClientIntent[] = [];
const dispatch = (intent: ClientIntent): void => {
  sent.push(intent);
};

beforeEach(() => {
  sent = [];
  globalThis.localStorage?.clear();
});
afterEach(() => {
  cleanup();
  act(() => closeCampPanel());
});

describe("the first-session choice (§5.3)", () => {
  it("offers a one-tap style for an unchosen hero, and picking it writes her kit", () => {
    render(<KitWelcome state={table()} me={me} held={false} dispatch={dispatch} />);
    expect(screen.getByRole("heading", { name: "Pick your camp style!" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    fireEvent.click(screen.getByRole("button", { name: "Quilted" }));
    expect(sent).toEqual([{ type: "KIT_EDIT", characterId: "c_1", revision: 4, style: "quilted", color: "rose" }]);
    expect(screen.queryByTestId("kit-welcome")).toBeNull();
  });

  it("shows each style's tent once the camp has tents, in her color, and its bedroll before (§4.5)", () => {
    const { container, unmount } = render(<KitWelcome state={table()} me={friend} held={false} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    const tents = [...container.querySelectorAll(".kit-welcome__style svg[data-camp-tent]")];
    expect(tents.map((svg) => svg.getAttribute("data-camp-tent"))).toEqual(["rolled", "quilted", "patched"]);
    for (const svg of tents) {
      // The painting, then the same painting clipped to its cloth and tinted: the poles and ropes stay as painted.
      const images = svg.querySelectorAll("image");
      expect(images).toHaveLength(2);
      expect(images[1]!.getAttribute("clip-path")).toMatch(/^url\(#/);
      expect(svg.querySelector("feColorMatrix")!.getAttribute("values")).toBe(campClothMatrix(kitAccent("rose", friend.character.appearance.accent)));
      // Cropped to what is painted, not the whole canvas.
      expect(svg.getAttribute("viewBox")).not.toBe("0 0 1024 1024");
    }
    expect(container.querySelector(".kit-welcome__style [data-camp-kit]")).toBeNull();
    unmount();
    const early = render(<KitWelcome state={table({ camp: camp({ frameStage: 1, grownBy: [] }) })} me={friend} held={false} dispatch={dispatch} />);
    expect(early.container.querySelectorAll(".kit-welcome__style [data-camp-kit]")).toHaveLength(3);
    expect(early.container.querySelector(".kit-welcome__style [data-camp-tent]")).toBeNull();
  });

  it("can be skipped, and shows only once", () => {
    const { unmount } = render(<KitWelcome state={table()} me={friend} held={false} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(screen.queryByTestId("kit-welcome")).toBeNull();
    expect(sent).toEqual([]);
    unmount();
    render(<KitWelcome state={table()} me={friend} held={false} dispatch={dispatch} />);
    expect(screen.queryByTestId("kit-welcome")).toBeNull();
  });

  it("is never offered to a hero whose kid already chose, nor without a camp, nor in a scene", () => {
    render(<KitWelcome state={table({ kits: { c_1: kit({ style: "rolled" }) } })} me={me} held={false} dispatch={dispatch} />);
    render(<KitWelcome state={table({ camp: undefined })} me={me} held={false} dispatch={dispatch} />);
    render(<KitWelcome state={table({ phase: "scene", campMoment: undefined })} me={me} held={false} dispatch={dispatch} />);
    expect(screen.queryByTestId("kit-welcome")).toBeNull();
  });
});

function openPanel(state: RunState): ReturnType<typeof render> {
  const view = render(
    <>
      <CampButton state={state} />
      <CampPanel state={state} me={me} held={false} dispatch={dispatch} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Camp" }));
  return view;
}

describe("the Camp panel's controls (§12.6, docs/accessibility.md)", () => {
  it("names every action outside the picture, and keeps the picture's own taps out of the tab order", () => {
    openPanel(table());
    const dialog = screen.getByRole("dialog", { name: /camp$/ });
    // Every button the kid can reach has a name.
    for (const button of within(dialog).getAllByRole("button")) expect(button.textContent?.trim() || button.getAttribute("aria-label")).toBeTruthy();
    // Her kit: tent, bedroll and pack, color, and her decoration spots.
    for (const name of ["Tent", "Bedroll and pack", "Color", "Decorations on your tent"]) expect(within(dialog).getByRole("group", { name })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Spot 1" })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Spot 2" })).toBeTruthy();
    // Each shared spot, by name, with what it shows.
    expect(within(dialog).getByRole("group", { name: "Cookfire: Cookfire" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Awning: nothing yet" })).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Banner pole: Crew banner" })).toBeTruthy();
    // The picture is decoration for a screen reader; its tap targets are not tab stops.
    const picture = dialog.querySelector(".camp-panel__picture")!;
    expect(picture.getAttribute("aria-hidden")).toBe("true");
    for (const tap of picture.querySelectorAll("button")) expect(tap.tabIndex).toBe(-1);
  });

  it("changes only her own kit, with no limit", () => {
    openPanel(table());
    const tent = screen.getByRole("group", { name: "Tent" });
    fireEvent.click(within(tent).getByRole("button", { name: /Patched tent/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Color" })).getByRole("button", { name: "Blue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Spot 1" }), { target: { value: "deco_pinwheel" } });
    expect(sent).toEqual([
      { type: "KIT_EDIT", characterId: "c_1", revision: 4, tent: "patched" },
      { type: "KIT_EDIT", characterId: "c_1", revision: 4, color: "meadow" },
      { type: "KIT_EDIT", characterId: "c_1", revision: 4, slots: ["deco_pinwheel", null] },
    ]);
    // Her friend's kit is not hers to change.
    expect(screen.queryByText("Thistle's kit")).toBeNull();
    // A milestone tent she has not earned is not offered.
    expect(within(tent).queryByRole("button", { name: /Mythic/ })).toBeNull();
  });

  it("says the shared limit before the first change, then picks for a spot", () => {
    openPanel(table());
    expect(screen.getByTestId("camp-limit-rule").textContent).toMatch(/one camp spot at each stop/);
    expect(screen.queryByTestId("camp-limit-used")).toBeNull();
    const awning = screen.getByRole("group", { name: "Awning: nothing yet" });
    fireEvent.click(within(awning).getByRole("button", { name: "Striped awning" }));
    expect(sent).toEqual([{ type: "CAMP_PLACE", moment: "lobby|r:-:0", hotspot: "awning", piece: "shop_striped_awning" }]);
  });

  it("once the change is used, disables further shared changes with a short message, and offers Undo", () => {
    const used = table({
      camp: camp({ placed: { awning: "shop_striped_awning" } }),
      campMoment: moment({ changes: { p_1: [{ hotspot: "awning", before: null, after: "shop_striped_awning", counted: true }] } }),
    });
    openPanel(used);
    expect(screen.getByTestId("camp-limit-used").textContent).toMatch(/camp change for now/);
    const lanterns = screen.getByRole("group", { name: "Lanterns: nothing yet" });
    expect((within(lanterns).getByRole("button", { name: "Lantern string" }) as HTMLButtonElement).disabled).toBe(true);
    // Her own kit is still hers to change.
    expect((within(screen.getByRole("group", { name: "Tent" })).getAllByRole("button")[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Undo my change to the awning" }));
    expect(sent).toEqual([{ type: "CAMP_UNDO", moment: "lobby|r:-:0" }]);
  });

  it("offers no Undo once somebody else has picked over her change", () => {
    openPanel(
      table({
        camp: camp({ placed: { awning: "find_noodle_awning" } }),
        campMoment: moment({
          changes: {
            p_1: [{ hotspot: "awning", before: null, after: "shop_striped_awning", counted: true }],
            p_2: [{ hotspot: "awning", before: "shop_striped_awning", after: "find_noodle_awning", counted: true }],
          },
        }),
      }),
    );
    expect(screen.queryByTestId("camp-undo")).toBeNull();
  });

  it("keeps a piece first owned this chapter free at the chapter's end, its spot lit", () => {
    const end = table({
      phase: "chapter_complete",
      campMoment: moment({ id: "chapterEnd|r:c:9", kind: "chapterEnd", changes: { p_1: [{ hotspot: "awning", before: null, after: "shop_striped_awning", counted: true }] } }),
      camp: camp({ placed: { awning: "shop_striped_awning" } }),
      campShop: { visit: "v", balance: 0, options: [], votes: {}, result: { kind: "bought", pieceId: "shop_weathervane_pole", label: "Weathervane pole" } },
    });
    openPanel(end);
    const pole = screen.getByRole("group", { name: "Banner pole: Crew banner" });
    expect(pole.className).toContain("is-lit");
    const weathervane = within(pole).getByRole("button", { name: /Weathervane pole/ }) as HTMLButtonElement;
    expect(weathervane.textContent).toContain("New, free");
    expect(weathervane.disabled).toBe(false);
  });

  it("has no shared spots indoors, where her own kit still changes", () => {
    openPanel(table({ phase: "scene", sceneType: "rest", campMoment: moment({ id: "rest:s|x", kind: "rest", outdoor: false }) }));
    expect(screen.getByTestId("camp-indoors")).toBeTruthy();
    expect(screen.queryByTestId("camp-limit-rule")).toBeNull();
    expect(screen.getByRole("group", { name: "Tent" })).toBeTruthy();
    // Packed down (§3.2, #625): no campsite painting, tent or campfire, only each hero's bedroll and pack.
    expect(document.querySelector(".kad-static-camp")).toBeNull();
    expect(document.querySelector(".kad-static-camp__backdrop")).toBeNull();
    const packed = screen.getByTestId("camp-packed");
    expect(packed.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(packed.querySelectorAll("[data-camp-kit]").length).toBe(packed.querySelectorAll("li").length);
  });

  it("goes with the downtime: Begin closes it, and there is no Camp button in a scene", () => {
    const state = table();
    const view = openPanel(state);
    expect(screen.getByTestId("camp-panel")).toBeTruthy();
    view.rerender(
      <>
        <CampButton state={{ ...state, phase: "scene", campMoment: undefined }} />
        <CampPanel state={{ ...state, phase: "scene", campMoment: undefined }} me={me} held={false} dispatch={dispatch} />
      </>,
    );
    expect(screen.queryByTestId("camp-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Camp" })).toBeNull();
  });

  it("closes with Done or Escape", () => {
    openPanel(table());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("camp-panel")).toBeNull();
    act(() => openCampPanel());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("camp-panel")).toBeNull();
  });
});

describe("friends and buddies on the phone (#624, §4.4, §8.5)", () => {
  const cards = [
    { id: "bun", name: "Bun", figure: "cast/bun" },
    { id: "mosshorn", name: "Mosshorn", figure: "entities/mosshorn", size: "small" as const },
    { id: "duckling", name: "Duckling", figure: "entities/duckling" },
    { id: "kid_goat", name: "Kid goat", figure: "cast/snowhorn_kid" },
    { id: "lamb", name: "Lamb", figure: "cast/goat_kid" },
  ];
  const friendly = (over: Partial<HeroKitView> = {}): RunState =>
    table({
      camp: camp({ friends: cards.map((c) => c.id) }),
      campMoment: moment({ friends: { rotation: ["lamb", "bun", "mosshorn", "duckling", "kid_goat"], out: ["lamb", "bun", "mosshorn", "duckling"], cards } }),
      kits: { c_1: kit(over), c_2: kit() },
    });

  it("picks her buddy in her kit, from the crew's friends, or none", () => {
    openPanel(friendly());
    const picker = screen.getByTestId("buddy-picker");
    expect(within(picker).getByRole("button", { name: "No buddy" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(picker).getByRole("button", { name: "Kid goat" }));
    expect(sent).toEqual([{ type: "KIT_EDIT", characterId: "c_1", revision: 4, buddy: "kid_goat" }]);
  });

  it("shows her buddy picked, and takes it back to none", () => {
    openPanel(friendly({ buddy: "bun" }));
    const picker = screen.getByTestId("buddy-picker");
    expect(within(picker).getByRole("button", { name: "Bun" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(picker).getByRole("button", { name: "No buddy" }));
    expect(sent).toEqual([{ type: "KIT_EDIT", characterId: "c_1", revision: 4, buddy: null }]);
  });

  it("calls a friend who is out over, a moment apart, and lists every friend without saying anybody left", () => {
    const taps: string[] = [];
    useGameStore.setState({ tapFriend: async (id: string) => (taps.push(id), true) });
    openPanel(friendly());
    const section = screen.getByTestId("camp-friends");
    // A named button for each friend out, and none for the one taking its turn later.
    expect(within(section).getAllByRole("button").map((b) => b.textContent)).toEqual(["Call Lamb over", "Call Bun over", "Call Mosshorn over", "Call Duckling over"]);
    for (let i = 0; i < 10; i++) fireEvent.click(within(section).getByRole("button", { name: "Call Bun over" }));
    expect(taps).toEqual(["bun"]);
    expect(within(section).getByRole("status").textContent).toBe("Bun is on the way!");
    expect(screen.getByTestId("friend-collection").textContent).toContain("Kid goat");
    expect(screen.getByTestId("friend-collection").textContent).not.toMatch(/left|gone|away/i);
  });

  it("indoors, where nobody walks, says hi to a friend and tells her the TV shows it, not that it is coming (#624, §3.2)", () => {
    const taps: string[] = [];
    useGameStore.setState({ tapFriend: async (id: string) => (taps.push(id), true) });
    const indoor = friendly();
    openPanel({ ...indoor, phase: "scene", sceneType: "rest", sceneId: "rest_bell_house", campMoment: { ...indoor.campMoment!, id: "rest:rest_bell_house|x", kind: "rest", outdoor: false } } as RunState);
    const section = screen.getByTestId("camp-friends");
    expect(within(section).getAllByRole("button").map((b) => b.textContent)).toEqual(["Say hi to Lamb", "Say hi to Bun", "Say hi to Mosshorn", "Say hi to Duckling"]);
    fireEvent.click(within(section).getByRole("button", { name: "Say hi to Bun" }));
    expect(taps).toEqual(["bun"]);
    expect(within(section).getByRole("status").textContent).toBe("Bun says hi! Look at the TV.");
    expect(within(section).getByRole("status").textContent).not.toMatch(/on the way|over|coming/i);
  });

  it("has no friends section and no buddy picker for a crew with no friends", () => {
    openPanel(table());
    expect(screen.queryByTestId("camp-friends")).toBeNull();
    expect(screen.queryByTestId("buddy-picker")).toBeNull();
  });
});

describe("her look at the chapter's end (docs/hero-looks.md §8.2)", () => {
  it("is in the panel, beside her kit, where what the chapter earned is first hers to try on", () => {
    openPanel(table({ phase: "chapter_complete", campMoment: moment({ id: "chapterEnd|r:c:9", kind: "chapterEnd" }) }));
    expect(screen.getByRole("group", { name: "Tent" })).toBeTruthy();
    expect(screen.getByTestId("look-editor")).toBeTruthy();
  });
});

describe("New! on the Camp button", () => {
  beforeEach(() => {
    clearKitNews();
    seeCampNews();
    useGameStore.setState({ session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" } as never });
  });
  afterEach(() => {
    clearKitNews();
    seeCampNews();
    useGameStore.setState({ session: null });
  });

  const view = (state: RunState) =>
    render(
      <>
        <CampButton state={state} />
        <CampPanel state={state} me={me} held={false} dispatch={dispatch} />
      </>,
    );

  it("says New! for her own hero's news, not another kid's, until she opens Camp", () => {
    view(table());
    act(() => announceKitNews("r_1", 3, [{ characterId: "c_2", pieceId: "sworn", kind: "tent" }], 1));
    expect(screen.queryByTestId("camp-button-new")).toBeNull();
    act(() => announceLookNews("r_1", 4, [{ characterId: "c_1", lookId: "the_bold", kind: "title", cause: "campaign" }], 0));
    expect(screen.getByTestId("camp-button-new").textContent).toBe("New!");
    const button = screen.getByRole("button", { name: "Camp: something new to try" });
    fireEvent.click(button);
    expect(screen.getByTestId("camp-panel")).toBeTruthy();
    expect(screen.queryByTestId("camp-button-new")).toBeNull();
  });

  it("keeps it across a reload, and only while there is a Camp to open", () => {
    act(() => announceKitNews("r_1", 5, [{ characterId: "c_1", pieceId: "sworn", kind: "tent" }], 1));
    expect(JSON.parse(globalThis.localStorage.getItem("kad.campNew") ?? "[]")).toEqual(["c_1"]);
    // Mid-scene there is no Camp button at all; it says New! at the next rest.
    const scene = view(table({ phase: "scene", campMoment: undefined }));
    expect(screen.queryByTestId("camp-button")).toBeNull();
    scene.unmount();
    view(table({ phase: "scene", sceneType: "rest", campMoment: moment({ id: "rest:s|x", kind: "rest" }) }));
    expect(screen.getByTestId("camp-button-new")).toBeTruthy();
  });

  it("opens at the part a piece's news names, its heading still focused", () => {
    const scrolled: Element[] = [];
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      view(table());
      act(() => openCampPanel("look"));
      expect(scrolled).toEqual([screen.getByTestId("look-editor")]);
      expect(document.activeElement?.id).toBe(screen.getByRole("dialog").getAttribute("aria-labelledby"));
      // Opened again from the button: the top, nowhere else.
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      fireEvent.click(screen.getByRole("button", { name: "Camp" }));
      expect(scrolled).toHaveLength(1);
    } finally {
      Element.prototype.scrollIntoView = before;
    }
  });
});
